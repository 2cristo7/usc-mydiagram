from state import DiagramState
from structural import validate_structure

MAX_SCHEMA_RETRIES = 3


async def validate_schema(state: DiagramState) -> DiagramState:
    """Punto de decisión del bucle ESTRUCTURAL (S6.8), tras synthesize — único
    nodo que ve el diagrama ENSAMBLADO entero.

    Complementa las validaciones locales (validate_nodes/validate_edges, que miran
    pieza a pieza) detectando carencias del CONJUNTO: un diagrama con todos sus
    elementos válidos por separado puede ser estructuralmente inválido (flowchart
    sin inicio/fin, grupos aislados). Un fallo estructural es una CARENCIA, no una
    pieza mala — por eso no se "retiene" como invalid_*, sino que se reporta como
    structural_gaps {type, reason} y el bucle de relleno (route_after_validate_schema)
    vuelve a extract_nodes o extract_edges, según el type, para AÑADIR lo que falta.

    Tercer bucle de feedback, simétrico a los de nodos y aristas:
    - tope MAX_SCHEMA_RETRIES aquí, en un solo sitio; el router solo refleja la
      decisión leyendo structural_gaps.
    - presupuesto propio (schema_retry_count), separado de retry_count y
      node_retry_count: un diagrama que gastó su saldo regenerando piezas no debe
      llegar aquí sin saldo para rellenar el hueco.
    - al agotar el presupuesto: degradación con log honesto. El diagrama se
      entrega tal cual (parcial pero coherente: lo streameado es válido). El aviso
      explícito al usuario y la taxonomía de degradación son S6.9."""
    diagram = state.get("diagram")
    if diagram is None:
        return {"structural_gaps": []}

    gaps = validate_structure(diagram.diagram_type, diagram.nodes, diagram.edges)

    # Hay huecos y queda presupuesto: reportar y devolver al grafo para rellenar.
    if gaps and state["schema_retry_count"] < MAX_SCHEMA_RETRIES:
        print(
            f"[validate_schema] {len(gaps)} structural gap(s) — "
            f"retry {state['schema_retry_count'] + 1}/{MAX_SCHEMA_RETRIES}"
        )
        for g in gaps:
            print(f"[validate_schema]   [{g['type']}] {g['reason']}")
        return {"structural_gaps": gaps, "schema_retry_count": state["schema_retry_count"] + 1}

    # Sin presupuesto: degradar. Log que nombra los huecos no resueltos y registro
    # en `degradations` (S6.9, category "structure") para que la carencia llegue al
    # END y se comunique al usuario, en vez de entregar un diagrama silenciosamente
    # incompleto. Vaciar structural_gaps sigue siendo obligatorio (corta el bucle).
    if gaps:
        print(
            f"[validate_schema] giving up after {MAX_SCHEMA_RETRIES} retries — "
            f"degrading with {len(gaps)} unresolved structural gap(s): {[g['reason'] for g in gaps]}"
        )
        if not any(d["category"] == "structure" for d in state.get("degradations", [])):
            return {
                "structural_gaps": [],
                "degradations": [
                    {"category": "structure", "reasons": [g["reason"] for g in gaps]}
                ],
            }

    return {"structural_gaps": []}
