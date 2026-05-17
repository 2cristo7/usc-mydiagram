# JSON Schema — MydIAgram

Contrato entre el agente de IA y el frontend. Todo JSON generado por el agente debe conformar este esquema. El frontend asume que el JSON es válido; cualquier desviación produce errores de renderizado silenciosos.

---

## Estructura raíz

```typescript
interface DiagramSchema {
  title:        string;        // requerido — nombre del diagrama generado
  diagram_type: DiagramType;   // requerido — tipo de diagrama (ver tabla inferior)
  nodes:        DiagramNode[]; // requerido — array de nodos, mínimo 1
  edges:        DiagramEdge[]; // requerido — array de aristas, puede ser []
}
```

---

## Estructura de nodo

```typescript
interface DiagramNode {
  id:         string;    // requerido — identificador único dentro del diagrama
  label:      string;    // requerido — texto visible en el canvas
  node_type:  NodeType;  // requerido — determina el componente React Flow a usar
  attributes: string[];  // requerido — lista de atributos/campos (puede ser [])
}
```

`attributes` usa prefijos de visibilidad para nodos UML: `+` público, `-` privado, `#` protegido.
Ejemplos: `"+ nombre: string"`, `"- saldo: float"`, `"# id: int"`.

Para nodos sin atributos semánticos (`actor`, `step`, `state`, `topic`) se pasa `[]`.

---

## Estructura de arista

```typescript
interface DiagramEdge {
  id:        string;    // requerido — identificador único dentro del diagrama
  source:    string;    // requerido — id del nodo origen
  target:    string;    // requerido — id del nodo destino
  label:     string;    // requerido — etiqueta visible (puede ser "")
  edge_type: EdgeType;  // requerido — determina el estilo visual de la arista
}
```

`source` y `target` deben referenciar IDs que existan en `nodes`. Una arista con `source` o `target` inválido produce un nodo huérfano en React Flow.

---

## Tipos de diagrama y nodos/aristas válidos

| `diagram_type`  | `node_type` válidos                  | `edge_type` válidos                                      |
|-----------------|--------------------------------------|----------------------------------------------------------|
| `erd`           | `table`                              | `one_to_one`, `one_to_many`, `many_to_many`              |
| `uml_class`     | `class`                              | `inherits`, `implements`, `depends_on`, `association`    |
| `sequence`      | `actor`, `class`                     | `calls`, `sequence`                                      |
| `flowchart`     | `step`, `decision`, `terminator`     | `sequence`                                               |
| `architecture`  | `service`, `database`, `queue`       | `depends_on`, `association`, `calls`                     |
| `state_machine` | `state`                              | `transition`                                             |
| `mindmap`       | `topic`                              | `association`                                            |

> **Estado de implementación**: `flowchart` (`decision`, `terminator`) está planificado para S5. El resto están implementados en S3–S4.

---

## Semántica de cada `edge_type`

| `edge_type`    | Semántica                                              | Diagramas                    |
|----------------|--------------------------------------------------------|------------------------------|
| `one_to_one`   | Una entidad se relaciona con exactamente otra          | `erd`                        |
| `one_to_many`  | Una entidad se relaciona con N                         | `erd`                        |
| `many_to_many` | N entidades se relacionan con N                        | `erd`                        |
| `inherits`     | Una clase extiende a otra (flecha triángulo hueco)     | `uml_class`                  |
| `implements`   | Una clase implementa una interfaz (línea punteada)     | `uml_class`                  |
| `depends_on`   | A usa a B sin asociación formal                        | `uml_class`, `architecture`  |
| `association`  | Relación estructural genérica                          | `uml_class`, `architecture`, `mindmap` |
| `calls`        | A invoca a B en tiempo de ejecución                    | `sequence`, `architecture`   |
| `sequence`     | Paso siguiente en el flujo                             | `sequence`, `flowchart`      |
| `transition`   | Cambio de estado (puede llevar guarda en `label`)      | `state_machine`              |

---

## Ejemplos completos

### ERD — sistema bancario

```json
{
  "title": "ERD sistema bancario",
  "diagram_type": "erd",
  "nodes": [
    { "id": "cliente",     "label": "Cliente",     "node_type": "table", "attributes": ["id: int", "nombre: varchar", "email: varchar"] },
    { "id": "cuenta",      "label": "Cuenta",      "node_type": "table", "attributes": ["id: int", "saldo: decimal", "tipo: varchar"] },
    { "id": "transaccion", "label": "Transacción", "node_type": "table", "attributes": ["id: int", "importe: decimal", "fecha: timestamp"] }
  ],
  "edges": [
    { "id": "e1", "source": "cliente",     "target": "cuenta",      "label": "tiene",    "edge_type": "one_to_many" },
    { "id": "e2", "source": "cuenta",      "target": "transaccion", "label": "genera",   "edge_type": "one_to_many" }
  ]
}
```

### UML Class — sistema de pagos

```json
{
  "title": "UML Class sistema de pagos",
  "diagram_type": "uml_class",
  "nodes": [
    { "id": "payment",      "label": "Payment",      "node_type": "class", "attributes": ["- id: string", "- amount: float", "+ process(): void"] },
    { "id": "card_payment", "label": "CardPayment",  "node_type": "class", "attributes": ["- cardNumber: string", "+ validate(): bool"] },
    { "id": "ipayable",     "label": "<<interface>>\nIPayable", "node_type": "class", "attributes": ["+ pay(): void"] }
  ],
  "edges": [
    { "id": "e1", "source": "card_payment", "target": "payment",  "label": "",        "edge_type": "inherits" },
    { "id": "e2", "source": "card_payment", "target": "ipayable", "label": "",        "edge_type": "implements" }
  ]
}
```

### Sequence — login de usuario

```json
{
  "title": "Sequence login",
  "diagram_type": "sequence",
  "nodes": [
    { "id": "user",     "label": "Usuario",   "node_type": "actor", "attributes": [] },
    { "id": "frontend", "label": "Frontend",  "node_type": "actor", "attributes": [] },
    { "id": "backend",  "label": "Backend",   "node_type": "actor", "attributes": [] }
  ],
  "edges": [
    { "id": "e1", "source": "user",     "target": "frontend", "label": "POST /login",        "edge_type": "calls" },
    { "id": "e2", "source": "frontend", "target": "backend",  "label": "validateCredentials", "edge_type": "calls" },
    { "id": "e3", "source": "backend",  "target": "frontend", "label": "JWT token",           "edge_type": "sequence" },
    { "id": "e4", "source": "frontend", "target": "user",     "label": "redirect /dashboard", "edge_type": "sequence" }
  ]
}
```

### Flowchart — proceso de compra

```json
{
  "title": "Flowchart proceso de compra",
  "diagram_type": "flowchart",
  "nodes": [
    { "id": "inicio",    "label": "Inicio",             "node_type": "terminator", "attributes": [] },
    { "id": "carrito",   "label": "Añadir al carrito",  "node_type": "step",       "attributes": [] },
    { "id": "pago_ok",   "label": "¿Pago aprobado?",    "node_type": "decision",   "attributes": [] },
    { "id": "confirmar", "label": "Confirmar pedido",   "node_type": "step",       "attributes": [] },
    { "id": "error",     "label": "Mostrar error",      "node_type": "step",       "attributes": [] },
    { "id": "fin",       "label": "Fin",                "node_type": "terminator", "attributes": [] }
  ],
  "edges": [
    { "id": "e1", "source": "inicio",    "target": "carrito",   "label": "",   "edge_type": "sequence" },
    { "id": "e2", "source": "carrito",   "target": "pago_ok",   "label": "",   "edge_type": "sequence" },
    { "id": "e3", "source": "pago_ok",   "target": "confirmar", "label": "Sí", "edge_type": "sequence" },
    { "id": "e4", "source": "pago_ok",   "target": "error",     "label": "No", "edge_type": "sequence" },
    { "id": "e5", "source": "confirmar", "target": "fin",       "label": "",   "edge_type": "sequence" },
    { "id": "e6", "source": "error",     "target": "fin",       "label": "",   "edge_type": "sequence" }
  ]
}
```

### Architecture — microservicios e-commerce

```json
{
  "title": "Architecture e-commerce",
  "diagram_type": "architecture",
  "nodes": [
    { "id": "api_gw",   "label": "API Gateway",       "node_type": "service",  "attributes": [] },
    { "id": "orders",   "label": "Orders Service",    "node_type": "service",  "attributes": [] },
    { "id": "payments", "label": "Payments Service",  "node_type": "service",  "attributes": [] },
    { "id": "db_ord",   "label": "Orders DB",         "node_type": "database", "attributes": [] },
    { "id": "queue",    "label": "Event Queue",       "node_type": "queue",    "attributes": [] }
  ],
  "edges": [
    { "id": "e1", "source": "api_gw",   "target": "orders",   "label": "",              "edge_type": "calls" },
    { "id": "e2", "source": "api_gw",   "target": "payments", "label": "",              "edge_type": "calls" },
    { "id": "e3", "source": "orders",   "target": "db_ord",   "label": "read/write",    "edge_type": "depends_on" },
    { "id": "e4", "source": "orders",   "target": "queue",    "label": "order.created", "edge_type": "calls" },
    { "id": "e5", "source": "payments", "target": "queue",    "label": "payment.done",  "edge_type": "calls" }
  ]
}
```

### State machine — ciclo de vida de un pedido

```json
{
  "title": "State machine pedido",
  "diagram_type": "state_machine",
  "nodes": [
    { "id": "pendiente",  "label": "Pendiente",   "node_type": "state", "attributes": [] },
    { "id": "pagado",     "label": "Pagado",      "node_type": "state", "attributes": [] },
    { "id": "enviado",    "label": "Enviado",     "node_type": "state", "attributes": [] },
    { "id": "entregado",  "label": "Entregado",   "node_type": "state", "attributes": [] },
    { "id": "cancelado",  "label": "Cancelado",   "node_type": "state", "attributes": [] }
  ],
  "edges": [
    { "id": "e1", "source": "pendiente", "target": "pagado",    "label": "pago confirmado",  "edge_type": "transition" },
    { "id": "e2", "source": "pendiente", "target": "cancelado", "label": "timeout 24h",      "edge_type": "transition" },
    { "id": "e3", "source": "pagado",    "target": "enviado",   "label": "stock disponible", "edge_type": "transition" },
    { "id": "e4", "source": "enviado",   "target": "entregado", "label": "confirmación",     "edge_type": "transition" }
  ]
}
```

### Mindmap — conceptos de microservicios

```json
{
  "title": "Mindmap microservicios",
  "diagram_type": "mindmap",
  "nodes": [
    { "id": "root",          "label": "Microservicios",    "node_type": "topic", "attributes": [] },
    { "id": "comunicacion",  "label": "Comunicación",      "node_type": "topic", "attributes": [] },
    { "id": "rest",          "label": "REST",              "node_type": "topic", "attributes": [] },
    { "id": "grpc",          "label": "gRPC",              "node_type": "topic", "attributes": [] },
    { "id": "despliegue",    "label": "Despliegue",        "node_type": "topic", "attributes": [] },
    { "id": "docker",        "label": "Docker",            "node_type": "topic", "attributes": [] },
    { "id": "kubernetes",    "label": "Kubernetes",        "node_type": "topic", "attributes": [] }
  ],
  "edges": [
    { "id": "e1", "source": "root",         "target": "comunicacion", "label": "", "edge_type": "association" },
    { "id": "e2", "source": "root",         "target": "despliegue",   "label": "", "edge_type": "association" },
    { "id": "e3", "source": "comunicacion", "target": "rest",         "label": "", "edge_type": "association" },
    { "id": "e4", "source": "comunicacion", "target": "grpc",         "label": "", "edge_type": "association" },
    { "id": "e5", "source": "despliegue",   "target": "docker",       "label": "", "edge_type": "association" },
    { "id": "e6", "source": "despliegue",   "target": "kubernetes",   "label": "", "edge_type": "association" }
  ]
}
```
