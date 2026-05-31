from state import DiagramState

MAX_RETRIES = 3


async def validate(state: DiagramState) -> DiagramState:
    diagram = state.get("diagram")
    orphans = state.get("orphan_edges", [])

    # Hay huérfanas retenidas y aún queda presupuesto de reintentos: construir el
    # feedback (motivo por arista) y devolver al grafo a extract_edges para regenerarlas.
    if diagram and orphans and state["retry_count"] < MAX_RETRIES:
        reasons = [
            f'edge "{e.id}" references non-existent node(s): "{e.source}" -> "{e.target}"'
            for e in orphans
        ]
        print(f"[validate] {len(orphans)} orphan edge(s) — retry {state['retry_count'] + 1}/{MAX_RETRIES}")
        for r in reasons:
            print(f"[validate]   {r}")
        return {"validation_errors": reasons, "retry_count": state["retry_count"] + 1}

    # Sin presupuesto (o sin diagrama): descartar las huérfanas restantes. Es seguro
    # porque nunca se streamearon ni entraron en diagram.edges → el diagrama es coherente.
    if orphans:
        print(
            f"[validate] giving up after {MAX_RETRIES} retries — "
            f"dropping {len(orphans)} orphan edge(s): {[e.id for e in orphans]}"
        )

    return {"validation_errors": []}
