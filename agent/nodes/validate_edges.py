from state import DiagramState

MAX_RETRIES = 3


async def validate_edges(state: DiagramState) -> DiagramState:
    """Punto de decisión del bucle de aristas (S6.5c/S6.7), tras synthesize.
    Gemelo de validate_nodes: extract_edges retiene las aristas inválidas (huérfanas,
    semánticas o Pydantic) en invalid_edges; aquí se decide reintentar o rendirse.

    El tope MAX_RETRIES vive aquí, en un solo sitio; route_after_validate_edges solo
    refleja la decisión leyendo validation_errors."""
    invalid = state.get("invalid_edges", [])

    # Hay aristas inválidas retenidas y queda presupuesto: construir el feedback
    # (motivo por arista) y devolver al grafo a extract_edges para regenerarlas.
    if invalid and state["retry_count"] < MAX_RETRIES:
        reasons = [item["reason"] for item in invalid]
        print(f"[validate_edges] {len(invalid)} invalid edge(s) — retry {state['retry_count'] + 1}/{MAX_RETRIES}")
        for item in invalid:
            print(f"[validate_edges]   {item['reason']} — {item['raw']}")
        return {"validation_errors": reasons, "retry_count": state["retry_count"] + 1}

    # Sin presupuesto: descartar las inválidas restantes con log que las nombra
    # (degradación honesta). Seguro porque nunca se streamearon ni entraron en
    # diagram.edges → el diagrama es coherente. Además de vaciar la señal de
    # routing (obligatorio: si no, bucle infinito), se registra la degradación en
    # el canal `degradations` (S6.9) para que sobreviva al END. Guarda de
    # idempotencia: si el bucle estructural reentra por aquí ya agotado, no se
    # duplica la entrada "edges".
    if invalid:
        print(
            f"[validate_edges] giving up after {MAX_RETRIES} retries — "
            f"dropping {len(invalid)} invalid edge(s): {[item['raw'] for item in invalid]}"
        )
        if not any(d["category"] == "edges" for d in state.get("degradations", [])):
            return {
                "validation_errors": [],
                "degradations": [
                    {"category": "edges", "reasons": [item["reason"] for item in invalid]}
                ],
            }

    return {"validation_errors": []}
