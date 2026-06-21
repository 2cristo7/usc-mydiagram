import asyncio
from langgraph.graph import StateGraph, END
from state import DiagramState
from nodes.guard import guard
from nodes.classify import make_classify
from nodes.extract_nodes import make_extract_nodes
from nodes.extract_edges import make_extract_edges
from nodes.extract_fragments import make_extract_fragments
from nodes.synthesize import synthesize
from nodes.validate_edges import validate_edges, MAX_RETRIES
from nodes.validate_nodes import validate_nodes, MAX_NODE_RETRIES
from nodes.validate_schema import validate_schema, MAX_SCHEMA_RETRIES


# Límite de recursión del grafo de GENERACIÓN. El default de LangGraph (25) se
# queda corto: hay TRES bucles de feedback (nodos, aristas, estructura) de hasta
# MAX_*_RETRIES vueltas cada uno, y cada vuelta atraviesa varios nodos (p. ej.
# extract→validate, o el bucle estructural reentrando a extract_nodes→…→
# validate_schema). Sin un tope holgado, un modelo que no converge dispararía
# GraphRecursionError, que main.py captura como `internal_error` genérico —
# enmascarando la causa real (el LLM no logró un diagrama válido). Cota superior
# generosa: cada vuelta de cualquier bucle cuesta como mucho ~6 transiciones de
# nodo (peor caso del bucle estructural), por la suma de los tres presupuestos,
# más holgura para los nodos de un solo paso (guard/classify/synthesize).
GENERATION_RECURSION_LIMIT = (
    (MAX_NODE_RETRIES + MAX_RETRIES + MAX_SCHEMA_RETRIES) * 6 + 20
)


def route_after_guard(state: DiagramState) -> str:
    return "classify" if state["is_diagram_request"] else END

def route_after_classify(state: DiagramState) -> str:
    # S10.3 — Desambiguación de tipo: si classify detectó ambigüedad UML y emitió
    # el evento `type_clarification`, cortamos a END sin generar nada. El evento ya
    # emitido por la queue es la salida válida; outcome.py sabrá no emitir error/done.
    if state.get("needs_type_clarification"):
        return END
    return "extract_nodes"

def route_after_validate_nodes(state: DiagramState) -> str:
    # node_validation_errors no-vacío = validate_nodes decidió reintentar (hay nodos
    # inválidos y queda presupuesto). El tope vive en validate_nodes, no aquí. Volvemos
    # a extract_nodes (modo feedback) para regenerar solo los retenidos. Vacío → seguir.
    if state["node_validation_errors"]:
        return "extract_nodes"
    return "extract_edges"

def route_after_validate_edges(state: DiagramState) -> str:
    # validation_errors no-vacío = validate_edges decidió reintentar (hay inválidas y
    # queda presupuesto). El tope vive en validate_edges, no aquí. Volvemos a la
    # EXTRACCIÓN para regenerar solo las aristas inválidas con feedback. Limpio →
    # synthesize (S6.8 reordenó: validate_edges va ANTES de synthesize, así no se
    # ensambla un diagrama con aristas locales aún inválidas).
    # S10.4 — antes de ensamblar, pasamos por extract_fragments (no-op salvo en
    # secuencia): los fragmentos necesitan los mensajes ya validados y ordenados.
    if state["validation_errors"]:
        return "extract_edges"
    return "extract_fragments"

def route_after_validate_schema(state: DiagramState) -> str:
    # structural_gaps no-vacío = validate_schema decidió reintentar (hay huecos y
    # queda presupuesto). El tope vive en validate_schema. El type del gap decide
    # destino (S6.8 P5b): algún hueco de "nodes" → extract_nodes (falta un nodo, y
    # en cascada sus aristas); solo "edges" → extract_edges (nodos OK, falta
    # conectarlos). Vacío (limpio o degradado) → fin.
    gaps = state["structural_gaps"]
    if not gaps:
        return END
    if any(g["type"] == "nodes" for g in gaps):
        return "extract_nodes"
    return "extract_edges"


def initial_generation_state(prompt: str, diagram_type=None, llm_runtime=None) -> dict:
    """Estado inicial del pipeline de generación S6. Centralizado aquí (S7.3) para
    que /generate/stream y el nodo `regenerate` del agente (escape hatch
    regenerate_from_scratch) arranquen el grafo con EXACTAMENTE los mismos campos
    sembrados — un campo olvidado en uno de los dos sitios daría KeyError en algún
    nodo según el camino. Una sola fuente de verdad evita ese drift.

    S10.2 — `diagram_type` opcional: si el usuario preseleccionó el tipo en la UI,
    entra aquí ya parseado (DiagramType) y classify se salta la llamada LLM de
    clasificación. None = automático (comportamiento histórico: lo clasifica el
    LLM). El escape hatch regenerate_from_scratch no fuerza tipo → default None.

    S10.x — `llm_runtime` (per-request): LLMRuntime construido desde llm_config.
    None → comportamiento histórico (los nodos resuelven desde env vars)."""
    return {
        "prompt": prompt,
        "is_diagram_request": False,
        "diagram_type": diagram_type,
        "title": None,
        "nodes": [],
        "edges": [],
        "fragments": [],
        "invalid_edges": [],
        "invalid_nodes": [],
        "diagram": None,
        "validation_errors": [],
        "retry_count": 0,
        "node_retry_count": 0,
        "node_validation_errors": [],
        "structural_gaps": [],
        "schema_retry_count": 0,
        "degradations": [],
        # S10.3 — flag de desambiguación de tipo (default False: no hay pregunta pendiente)
        "needs_type_clarification": False,
        # S10.x — runtime LLM per-request (None = env-based)
        "llm": llm_runtime,
    }


def build_graph(queue: asyncio.Queue | None = None):
    builder = StateGraph(DiagramState)
    builder.add_node("guard", guard)
    builder.add_conditional_edges("guard", route_after_guard)
    builder.add_node("classify", make_classify(queue))
    builder.add_conditional_edges("classify", route_after_classify)
    builder.add_node("extract_nodes", make_extract_nodes(queue))
    builder.add_node("validate_nodes", validate_nodes)
    builder.add_edge("extract_nodes", "validate_nodes")
    builder.add_conditional_edges("validate_nodes", route_after_validate_nodes)
    builder.add_node("extract_edges", make_extract_edges(queue))
    builder.add_edge("extract_edges", "validate_edges")
    builder.add_node("validate_edges", validate_edges)
    builder.add_conditional_edges("validate_edges", route_after_validate_edges)
    builder.add_node("extract_fragments", make_extract_fragments(queue))
    builder.add_edge("extract_fragments", "synthesize")
    builder.add_node("synthesize", synthesize)
    builder.add_edge("synthesize", "validate_schema")
    builder.add_node("validate_schema", validate_schema)
    builder.add_conditional_edges("validate_schema", route_after_validate_schema)
    builder.set_entry_point("guard")
    return builder.compile()
