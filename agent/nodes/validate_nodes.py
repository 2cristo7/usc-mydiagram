from state import DiagramState

MAX_NODE_RETRIES = 3


async def validate_nodes(state: DiagramState) -> DiagramState:
    """Punto de decisión del bucle de nodos (S6.7), entre extract_nodes y
    extract_edges. Gemelo de validate (aristas): extract_nodes retiene los nodos
    inválidos (Pydantic o semánticos); aquí se decide reintentar o rendirse.

    El tope MAX_NODE_RETRIES vive aquí, en un solo sitio; route_after_validate_nodes
    solo refleja la decisión leyendo node_validation_errors."""
    invalid = state.get("invalid_nodes", [])

    # Hay nodos inválidos retenidos y queda presupuesto: construir el feedback
    # (motivo por nodo) y devolver al grafo a extract_nodes para regenerarlos.
    if invalid and state["node_retry_count"] < MAX_NODE_RETRIES:
        reasons = [item["reason"] for item in invalid]
        print(f"[validate_nodes] {len(invalid)} invalid node(s) — retry {state['node_retry_count'] + 1}/{MAX_NODE_RETRIES}")
        for item in invalid:
            print(f"[validate_nodes]   {item['reason']} — {item['raw']}")
        return {
            "node_validation_errors": reasons,
            "node_retry_count": state["node_retry_count"] + 1,
        }

    # Sin presupuesto: descartar los inválidos restantes con log que los nombra
    # (degradación honesta). Es seguro porque nunca se streamearon ni entraron en
    # state["nodes"] → el canvas es coherente. Las aristas se extraen después con
    # node_ids = solo los nodos válidos; cualquier referencia a uno descartado
    # caerá como huérfana y la gestionará el bucle de aristas.
    if invalid:
        print(
            f"[validate_nodes] giving up after {MAX_NODE_RETRIES} retries — "
            f"dropping {len(invalid)} invalid node(s): {[item['raw'] for item in invalid]}"
        )

    return {"node_validation_errors": []}
