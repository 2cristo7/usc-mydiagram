"""Registro de prompts específicos por tipo de diagrama (S6.6).

Antes, `extract_nodes`/`extract_edges` usaban un único prompt con ejemplo ERD
para los 7 tipos → topologías lineales y `node_type`/`edge_type` incoherentes
(un flowchart salía como cadena de `step`, sin `decision`).

Diseño:
- El **formato JSON de salida** es idéntico para todos los tipos → vive fijo en
  los headers de este módulo (`_NODE_HEADER` / `_EDGE_HEADER`), una sola vez.
- Lo único que cambia entre tipos es la **guía semántica**: qué `node_type`/
  `edge_type` usar, cuándo, y un ejemplo coherente con ese diagrama. Eso vive en
  los fragmentos `*_NODE_PROMPT` / `*_EDGE_PROMPT`.
- `get_node_prompt` / `get_edge_prompt` componen header + fragmento. Un tipo sin
  entrada propia cae al fragmento genérico (`_FALLBACK_*`), que sí ofrece todos
  los tipos del enum.

Idioma: las instrucciones y los `label`/`attributes` de los ejemplos están en
castellano para que el LLM genere los diagramas en castellano. Los VALORES de
`node_type`/`edge_type` se mantienen en inglés porque son los literales del
schema Pydantic (`schemas.py`); traducirlos rompería la validación.

El mapa "tipos permitidos por DiagramType" implícito en estos fragmentos es la
semilla de la validación semántica del lado agente (S6.7, GitLab #124).
"""
from schemas import DiagramType, NodeType, EdgeType


# ---------------------------------------------------------------------------
# Headers fijos (formato de salida, idéntico para todos los tipos)
# ---------------------------------------------------------------------------

_NODE_HEADER = """Estás extrayendo los NODOS de un diagrama de tipo {dt} a partir de la descripción del usuario.
Devuelve ÚNICAMENTE un array JSON, sin texto adicional, sin markdown, sin bloques de código.
Cada elemento DEBE tener exactamente esta forma:
{{"id": "slug_sin_espacios", "label": "Nombre Legible", "node_type": "<tipo>", "attributes": ["..."]}}
Reglas:
- "id": corto, en minúsculas, snake_case, único. Derívalo del label.
- "label": el nombre visible, EN CASTELLANO.
- "attributes": lista de strings (puede estar vacía). Ver la guía específica más abajo.
- Extrae todos los elementos distintos que implique la descripción; no inventes elementos no relacionados.
- Todo el texto visible (labels y attributes) debe estar EN CASTELLANO.
"""

_EDGE_HEADER = """Estás extrayendo las ARISTAS (relaciones) de un diagrama de tipo {dt} a partir de la descripción del usuario.
Devuelve ÚNICAMENTE un array JSON, sin texto adicional, sin markdown, sin bloques de código.
Cada elemento DEBE tener exactamente esta forma:
{{"id": "e1", "source": "id_nodo_origen", "target": "id_nodo_destino", "label": "Etiqueta de la relación", "edge_type": "<tipo>"}}
Reglas:
- "source" y "target" DEBEN ser ids que existan en la lista de nodos de más abajo. Nunca inventes ids.
- "id": corto y único ("e1", "e2", ...).
- Elige "edge_type" según la guía específica de más abajo; no uses un tipo de otra familia de diagramas.
- El "label" debe estar EN CASTELLANO.
"""


# ---------------------------------------------------------------------------
# ERD — entidad/relación
# ---------------------------------------------------------------------------

_ERD_NODE_PROMPT = """Esto es un ERD. Cada nodo es una tabla de base de datos.
- node_type: siempre "table".
- attributes: las columnas de la tabla, un string cada una, con formato "nombre: TIPO RESTRICCIÓN"
  (p. ej. "id: INT PK", "email: VARCHAR UNIQUE", "usuario_id: INT FK"). Marca las claves
  primarias con PK y las foráneas con FK.
Ejemplo:
[{"id": "usuario", "label": "Usuario", "node_type": "table", "attributes": ["id: INT PK", "email: VARCHAR UNIQUE"]},
 {"id": "pedido", "label": "Pedido", "node_type": "table", "attributes": ["id: INT PK", "usuario_id: INT FK", "total: DECIMAL"]}]"""

_ERD_EDGE_PROMPT = """Las relaciones entre tablas expresan cardinalidad.
- edge_type: uno de "one_to_one", "one_to_many", "many_to_many".
- label: el verbo de la relación ("realiza", "contiene", "pertenece a").
- Una clave foránea en el lado "muchos" implica un "one_to_many" desde el lado "uno".
Ejemplo:
[{"id": "e1", "source": "usuario", "target": "pedido", "label": "realiza", "edge_type": "one_to_many"}]"""


# ---------------------------------------------------------------------------
# UML de clases
# ---------------------------------------------------------------------------

_UML_NODE_PROMPT = """Esto es un diagrama de clases UML. Cada nodo es una clase o interfaz.
- node_type: siempre "class".
- attributes: atributos Y métodos, cada uno un string con prefijo de visibilidad
  "+" público, "-" privado, "#" protegido.
  Atributos: "- saldo: float". Métodos: "+ ingresar(cantidad: float): void".
Ejemplo:
[{"id": "cuenta", "label": "Cuenta", "node_type": "class", "attributes": ["- saldo: float", "+ ingresar(cantidad: float): void", "+ retirar(cantidad: float): bool"]},
 {"id": "cuenta_ahorro", "label": "CuentaAhorro", "node_type": "class", "attributes": ["- tipo_interes: float"]}]"""

_UML_EDGE_PROMPT = """Relaciones entre clases.
- edge_type:
  - "inherits": una clase hereda de otra (es-un).
  - "implements": una clase implementa una interfaz.
  - "association": una clase usa/contiene una referencia a otra (tiene-un).
  - "depends_on": una dependencia transitoria (la usa en la firma de un método).
- label: nombre de rol o multiplicidad si es relevante; puede ser corto.
- En la herencia, source = subclase, target = superclase.
Ejemplo:
[{"id": "e1", "source": "cuenta_ahorro", "target": "cuenta", "label": "hereda", "edge_type": "inherits"}]"""


# ---------------------------------------------------------------------------
# Diagrama de secuencia
# ---------------------------------------------------------------------------

_SEQUENCE_NODE_PROMPT = """Esto es un diagrama de secuencia. Cada nodo es un participante (actor, servicio u objeto) que intercambia mensajes.
- node_type: siempre "actor".
- attributes: déjalo vacío ([]).
- Ordena los participantes de izquierda a derecha según el orden en que aparecen por primera vez en la interacción.
Ejemplo:
[{"id": "usuario", "label": "Usuario", "node_type": "actor", "attributes": []},
 {"id": "servicio_auth", "label": "ServicioAuth", "node_type": "actor", "attributes": []},
 {"id": "base_datos", "label": "Base de Datos", "node_type": "actor", "attributes": []}]"""

_SEQUENCE_EDGE_PROMPT = """Cada arista es un mensaje entre dos participantes, en orden cronológico.
- edge_type: siempre "sequence".
- label: el mensaje / llamada al método ("login(usuario, clave)", "validar token", "devolver sesión").
- Crea una arista por mensaje; emítelas en el orden en que ocurren.
- Una respuesta es su propia arista, con source/target intercambiados.
Ejemplo:
[{"id": "e1", "source": "usuario", "target": "servicio_auth", "label": "login(usuario, clave)", "edge_type": "sequence"},
 {"id": "e2", "source": "servicio_auth", "target": "base_datos", "label": "buscar usuario", "edge_type": "sequence"}]"""


# ---------------------------------------------------------------------------
# Flowchart — el caso que motivó S6.6
# ---------------------------------------------------------------------------

_FLOWCHART_NODE_PROMPT = """Esto es un diagrama de flujo (flowchart). Usa ÚNICAMENTE estos tipos de nodo:
- "terminator": el inicio y el fin del flujo. Incluye siempre un "Inicio" y al menos un "Fin".
- "step": una acción o proceso (un rectángulo): "Añadir al carrito", "Enviar email".
- "decision": un punto de bifurcación (un rombo). Crea un "decision" SIEMPRE que el texto
  exprese una condición o una alternativa — palabras como "si", "cuando", "o", "en caso de",
  "según". El label es una pregunta de sí/no ("¿Hay stock?").
- attributes: déjalo vacío ([]) para todos los nodos de flowchart.
NO modeles una bifurcación como dos pasos secuenciales — DEBE ser un nodo "decision" con
varias aristas de salida.
Ejemplo para "para conseguir leche, mira en el supermercado; si está, cómprala; si no, cógela de la granja":
[{"id": "inicio", "label": "Inicio", "node_type": "terminator", "attributes": []},
 {"id": "comprobar_super", "label": "¿Está en el supermercado?", "node_type": "decision", "attributes": []},
 {"id": "comprar_super", "label": "Comprar en el supermercado", "node_type": "step", "attributes": []},
 {"id": "coger_granja", "label": "Coger de la granja", "node_type": "step", "attributes": []},
 {"id": "fin", "label": "Fin", "node_type": "terminator", "attributes": []}]"""

_FLOWCHART_EDGE_PROMPT = """Las aristas son la dirección del flujo entre nodos.
- edge_type:
  - "flow": una transición normal sin condición (step→step, inicio→step). Deja el label vacío o corto.
  - "conditional": una arista que SALE de un nodo "decision". DEBE haber una por rama
    (al menos dos), y el label es el resultado de la condición ("sí"/"no" o el nombre de la opción).
- Un nodo "decision" tiene 2 o más aristas "conditional" de salida; todo lo demás usa "flow".
Ejemplo (coherente con los nodos de arriba):
[{"id": "e1", "source": "inicio", "target": "comprobar_super", "label": "", "edge_type": "flow"},
 {"id": "e2", "source": "comprobar_super", "target": "comprar_super", "label": "sí", "edge_type": "conditional"},
 {"id": "e3", "source": "comprobar_super", "target": "coger_granja", "label": "no", "edge_type": "conditional"},
 {"id": "e4", "source": "comprar_super", "target": "fin", "label": "", "edge_type": "flow"},
 {"id": "e5", "source": "coger_granja", "target": "fin", "label": "", "edge_type": "flow"}]"""


# ---------------------------------------------------------------------------
# Arquitectura de software (incluye C4)
# ---------------------------------------------------------------------------

_ARCHITECTURE_NODE_PROMPT = """Esto es un diagrama de arquitectura de software. Elige el node_type que corresponda a cada elemento:
- "service": una aplicación / microservicio / API.
- "database": cualquier almacén de datos (SQL, NoSQL, caché).
- "queue": un broker de mensajes o cola de eventos (Kafka, RabbitMQ, SQS).
- "gateway": un API gateway, balanceador de carga o proxy inverso.
- Niveles C4, cuando la descripción trata de personas y sistemas:
  "person" (un usuario humano), "system" (un sistema completo), "container" (una app/runtime
  dentro de un sistema), "component" (un módulo dentro de un container).
- attributes: etiqueta(s) de tecnología opcional(es), p. ej. ["tech: PostgreSQL"]; si no, [].
Ejemplo:
[{"id": "api_gateway", "label": "API Gateway", "node_type": "gateway", "attributes": []},
 {"id": "servicio_auth", "label": "Servicio de Autenticación", "node_type": "service", "attributes": ["tech: Node.js"]},
 {"id": "bd_usuarios", "label": "BD de Usuarios", "node_type": "database", "attributes": ["tech: PostgreSQL"]},
 {"id": "bus_eventos", "label": "Bus de Eventos", "node_type": "queue", "attributes": ["tech: Kafka"]}]"""

_ARCHITECTURE_EDGE_PROMPT = """Las aristas son relaciones en tiempo de ejecución entre componentes.
- edge_type:
  - "calls": un componente envía una petición a otro (HTTP/RPC síncrono) o publica en una cola.
  - "depends_on": una dependencia estructural que no es una llamada directa.
- label: protocolo o propósito ("REST", "publica eventos", "lee/escribe").
Ejemplo:
[{"id": "e1", "source": "api_gateway", "target": "servicio_auth", "label": "REST", "edge_type": "calls"},
 {"id": "e2", "source": "servicio_auth", "target": "bd_usuarios", "label": "lee/escribe", "edge_type": "depends_on"}]"""


# ---------------------------------------------------------------------------
# Máquina de estados
# ---------------------------------------------------------------------------

_STATE_MACHINE_NODE_PROMPT = """Esto es una máquina de estados. Cada nodo es un estado del sistema.
- node_type: "state" para estados normales; "terminator" para el pseudo-estado inicial
  y para los estados finales, si la descripción los tiene.
- attributes: déjalo vacío ([]).
Ejemplo para el ciclo de vida de un pedido:
[{"id": "inicio", "label": "Inicio", "node_type": "terminator", "attributes": []},
 {"id": "pendiente", "label": "Pendiente", "node_type": "state", "attributes": []},
 {"id": "pagado", "label": "Pagado", "node_type": "state", "attributes": []},
 {"id": "enviado", "label": "Enviado", "node_type": "state", "attributes": []}]"""

_STATE_MACHINE_EDGE_PROMPT = """Las aristas son transiciones entre estados.
- edge_type: siempre "transition".
- label: el evento/disparador que provoca la transición ("pago recibido", "enviar pedido").
Ejemplo:
[{"id": "e1", "source": "inicio", "target": "pendiente", "label": "", "edge_type": "transition"},
 {"id": "e2", "source": "pendiente", "target": "pagado", "label": "pago recibido", "edge_type": "transition"},
 {"id": "e3", "source": "pagado", "target": "enviado", "label": "enviar pedido", "edge_type": "transition"}]"""


# ---------------------------------------------------------------------------
# Mapa mental
# ---------------------------------------------------------------------------

_MINDMAP_NODE_PROMPT = """Esto es un mapa mental. Cada nodo es un tema.
- node_type: siempre "topic". Incluye el único tema central más sus ramas y sub-ramas.
- attributes: déjalo vacío ([]).
Ejemplo:
[{"id": "ml", "label": "Aprendizaje Automático", "node_type": "topic", "attributes": []},
 {"id": "supervisado", "label": "Supervisado", "node_type": "topic", "attributes": []},
 {"id": "no_supervisado", "label": "No Supervisado", "node_type": "topic", "attributes": []},
 {"id": "regresion", "label": "Regresión", "node_type": "topic", "attributes": []}]"""

_MINDMAP_EDGE_PROMPT = """Las aristas conectan un tema padre con cada uno de sus temas hijos (un árbol, del centro hacia afuera).
- edge_type: siempre "association".
- label: normalmente vacío.
Ejemplo:
[{"id": "e1", "source": "ml", "target": "supervisado", "label": "", "edge_type": "association"},
 {"id": "e2", "source": "ml", "target": "no_supervisado", "label": "", "edge_type": "association"},
 {"id": "e3", "source": "supervisado", "target": "regresion", "label": "", "edge_type": "association"}]"""


# ---------------------------------------------------------------------------
# Fallback genérico — para un DiagramType sin entrada propia
# ---------------------------------------------------------------------------

_ALL_NODE_TYPES = ", ".join(t.value for t in NodeType)
_ALL_EDGE_TYPES = ", ".join(t.value for t in EdgeType)

_FALLBACK_NODE_PROMPT = (
    "Elige el node_type de esta lista, escogiendo el más apropiado para cada elemento: "
    f"{_ALL_NODE_TYPES}.\n"
    "attributes es una lista de strings (puede estar vacía).\n"
    'Ejemplo: [{"id": "usuario", "label": "Usuario", "node_type": "table", "attributes": ["id: INT PK"]}]'
)

_FALLBACK_EDGE_PROMPT = (
    "Elige el edge_type de esta lista, escogiendo el más apropiado para cada relación: "
    f"{_ALL_EDGE_TYPES}.\n"
    'Ejemplo: [{"id": "e1", "source": "usuario", "target": "pedido", "label": "realiza", "edge_type": "one_to_many"}]'
)


# ---------------------------------------------------------------------------
# Registros + accessors
# ---------------------------------------------------------------------------

_NODE_PROMPTS: dict[DiagramType, str] = {
    DiagramType.ERD:           _ERD_NODE_PROMPT,
    DiagramType.UML_CLASS:     _UML_NODE_PROMPT,
    DiagramType.SEQUENCE:      _SEQUENCE_NODE_PROMPT,
    DiagramType.FLOWCHART:     _FLOWCHART_NODE_PROMPT,
    DiagramType.ARCHITECTURE:  _ARCHITECTURE_NODE_PROMPT,
    DiagramType.STATE_MACHINE: _STATE_MACHINE_NODE_PROMPT,
    DiagramType.MINDMAP:       _MINDMAP_NODE_PROMPT,
}

_EDGE_PROMPTS: dict[DiagramType, str] = {
    DiagramType.ERD:           _ERD_EDGE_PROMPT,
    DiagramType.UML_CLASS:     _UML_EDGE_PROMPT,
    DiagramType.SEQUENCE:      _SEQUENCE_EDGE_PROMPT,
    DiagramType.FLOWCHART:     _FLOWCHART_EDGE_PROMPT,
    DiagramType.ARCHITECTURE:  _ARCHITECTURE_EDGE_PROMPT,
    DiagramType.STATE_MACHINE: _STATE_MACHINE_EDGE_PROMPT,
    DiagramType.MINDMAP:       _MINDMAP_EDGE_PROMPT,
}


def get_node_prompt(diagram_type: DiagramType) -> str:
    """System prompt completo para extraer NODOS de `diagram_type`.

    Compone el header de formato fijo + el fragmento semántico del tipo (o el
    genérico si el tipo no tiene entrada propia)."""
    header = _NODE_HEADER.format(dt=diagram_type.value)
    fragment = _NODE_PROMPTS.get(diagram_type, _FALLBACK_NODE_PROMPT)
    return f"{header}\n{fragment}"


def get_edge_prompt(diagram_type: DiagramType, valid_ids: list[str]) -> str:
    """System prompt completo para extraer ARISTAS de `diagram_type`.

    Como en `extract_nodes`/`extract_edges`, los ids válidos son estado en
    tiempo de ejecución, así que se inyectan aquí (no en el fragmento estático)."""
    header = _EDGE_HEADER.format(dt=diagram_type.value)
    fragment = _EDGE_PROMPTS.get(diagram_type, _FALLBACK_EDGE_PROMPT)
    return f"{header}\n{fragment}\nLos ÚNICOS ids de nodo válidos son: {valid_ids}."
