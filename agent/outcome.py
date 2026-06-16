"""Taxonomía de desenlaces del grafo (S6.9).

Traduce el resultado de una ejecución del LangGraph en el evento terminal a
emitir por el stream: `done` (con bandera `degraded` + lista de degradaciones por
categoría) o `error` (con su categoría y mensaje accionable).

Por qué es una función PURA fuera del grafo y NO un nodo terminal (S6.9 P1):
hay dos desenlaces que ningún nodo de salida puede observar —
  - guard-reject: el grafo sale por END justo tras `guard` (route_after_guard),
    saltándose cualquier nodo terminal que pudiéramos añadir;
  - excepción interna: si un nodo revienta, `ainvoke` lanza y no llega a
    ejecutarse ningún nodo de salida.
`main.py` es el único punto que ve los tres desenlaces (estado final limpio,
guard-reject y crash), así que la clasificación vive aquí y la llama main.py.

Frontera done/error (S6.9 P3): el umbral es ≥1 nodo válido. Con al menos un nodo
el diagrama es utilizable → `done` (degradado o no). Con cero nodos no hay nada
que mostrar → `error`. guard-reject y excepción son sendas categorías de `error`.
"""
from typing import Optional

from state import DiagramState


# Mensajes accionables por categoría de ERROR (no hay diagrama utilizable).
# Cada uno dice al usuario qué pasó y qué hacer a continuación; nunca un genérico.
ERROR_MESSAGES: dict[str, str] = {
    "not_a_diagram": (
        "El texto no describe un proceso, sistema o estructura representable como "
        "diagrama. Reformúlalo indicando qué entidades hay y cómo se relacionan."
    ),
    "empty": (
        "No se pudo extraer ningún elemento del diagrama. Prueba a describirlo con "
        "más detalle: qué elementos lo componen y cómo se conectan entre sí."
    ),
    "internal_error": (
        "Se produjo un error interno generando el diagrama. Vuelve a intentarlo en "
        "unos segundos."
    ),
}


def classify_outcome(state: Optional[DiagramState], *, crashed: bool = False) -> dict:
    """Clasifica el desenlace del grafo y devuelve el evento terminal del stream.

    `crashed=True` (o `state is None`) → la ejecución lanzó una excepción que
    main.py capturó; no hay estado fiable que inspeccionar."""
    # (a) Excepción interna: el grafo reventó.
    if crashed or state is None:
        return {
            "_type": "error",
            "category": "internal_error",
            "message": ERROR_MESSAGES["internal_error"],
        }

    # (b) Guard-reject: el prompt no es una petición de diagrama.
    if not state.get("is_diagram_request"):
        return {
            "_type": "error",
            "category": "not_a_diagram",
            "message": ERROR_MESSAGES["not_a_diagram"],
        }

    # (b2) S10.3 — Desambiguación de tipo: classify emitió `type_clarification` por
    # la queue y activó este flag. El evento ya fue enviado al cliente; el grafo cortó
    # a END limpiamente. No emitimos `error` ni `done`: devolvemos None para que
    # main.py omita el evento terminal (el stream ya está cerrado con el evento de
    # clarificación como salida válida).
    if state.get("needs_type_clarification"):
        return None

    # (c) Fallo total: cero nodos válidos → no hay diagrama utilizable.
    diagram = state.get("diagram")
    nodes = diagram.nodes if diagram else []
    if not nodes:
        return {
            "_type": "error",
            "category": "empty",
            "message": ERROR_MESSAGES["empty"],
        }

    # (d) Éxito, posiblemente degradado. Las degradaciones acumuladas por los
    # branches de rendición sobreviven en `degradations` (S6.9 P2): si la lista no
    # está vacía, el diagrama es parcial pero usable. El frontend compone el aviso
    # por categoría; aquí se propaga la estructura tal cual.
    degradations = state.get("degradations", [])
    return {
        "_type": "done",
        "title": diagram.title,
        # S7.5 — el done lleva el snapshot completo también en GENERACIÓN (antes
        # solo en refinamiento). Los eventos incrementales node/edge no transmiten
        # el diagram_type, y el frontend lo necesita para poder REFINAR después
        # (CompactDiagram lo exige: sin él, /refine/stream da 422). Además el
        # snapshot reconcilia cualquier node_ready/edge_ready perdido (patrón
        # "eventos = UX efímera; done = verdad", uniforme en ambos caminos).
        "diagram": diagram.model_dump(mode="json", exclude={"title"}),
        "degraded": bool(degradations),
        "degradations": degradations,
    }
