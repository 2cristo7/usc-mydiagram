from dotenv import load_dotenv
load_dotenv()

import asyncio
import json
import uuid
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional
from graph import build_graph, initial_generation_state
from outcome import classify_outcome
from schemas import CompactDiagram, DiagramType

app = FastAPI()

# S9.3b — El rate limiter se trasladó al BACKEND (Node): el agente queda con solo
# lógica de agente (generación + tools). El control de admisión (rate limit,
# caché) vive en el backend, que es el único punto de entrada. Ver
# backend/src/rateLimit.ts y backend/src/cache.ts.

_SENTINEL = object()

# ---------------------------------------------------------------------------
# S7.4 — Estado de sesión de clarificaciones (entre /refine/stream y /resume)
# ---------------------------------------------------------------------------
# interrupt() EXIGE checkpointer: al pausar, LangGraph guarda los messages (el
# "cerebro a medio pensar" del agente) por thread_id y los restaura al reanudar.
# Round-tripear ese estado por el cliente expondría internals del LLM y abriría
# manipulación → vive en memoria del proceso, acotado: un MemorySaver singleton +
# el workspace pendiente por thread_id. DEUDA consciente de statelessness (TTL/
# limpieza de sesiones abandonadas → pendientes.md; en S8 el checkpointer puede
# ser Postgres sobre Supabase y el proceso vuelve a ser stateless).
_checkpointer = None  # lazy: import de langgraph solo si se usa /refine
_pending_clarifications: dict = {}  # thread_id -> DiagramWorkspace pausado


def _get_checkpointer():
    global _checkpointer
    if _checkpointer is None:
        from langgraph.checkpoint.memory import InMemorySaver
        _checkpointer = InMemorySaver()
    return _checkpointer

class GenerateRequest(BaseModel):
    prompt: str
    # S10.2 — Tipo preseleccionado desde la UI (opcional). Ausente/None =
    # automático: el agente clasifica el tipo como hasta ahora. Pydantic valida
    # el valor contra el enum DiagramType en el BORDE: un tipo forzado fuera del
    # enum da 422 explícito, no fallo silencioso (tipos en los bordes, §2).
    diagram_type: Optional[DiagramType] = None


# S7.1 — Refinamiento sobre un diagrama existente. `diagram` es la versión
# compacta (sin title) que el frontend serializa con diagramToJson. Pydantic lo
# valida al parsear: un diagrama malformado da 422 explícito, no fallo silencioso.
class RefineRequest(BaseModel):
    prompt: str
    diagram: CompactDiagram


# S7.4 — Reanudación tras una clarificación. Endpoint SEPARADO de /refine/stream:
# sus campos obligatorios son otros (thread_id+answer, sin prompt ni diagram) y un
# modelo único con campos "obligatorios según flag" no es expresable en Pydantic
# declarativo. La validación aquí es de BORDE, no semántica: interpretar si la
# respuesta contesta la pregunta o pide otra cosa es trabajo del AGENTE en el loop
# (tiene el contexto y las tools para pivotar), no de un validador previo.
class ResumeRequest(BaseModel):
    thread_id: str
    answer: str = Field(min_length=1)

@app.get("/health")
def health():
    return {"status": "ok", "service": "agent"}


@app.post("/generate/stream")
async def generate_stream(req: GenerateRequest):
    queue: asyncio.Queue = asyncio.Queue()
    graph = build_graph(queue)

    initial_state = initial_generation_state(req.prompt, req.diagram_type)

    async def run_graph():
        # La taxonomía de desenlaces vive en classify_outcome (S6.9): main.py es el
        # único punto que ve los tres casos (final limpio, guard-reject y crash).
        try:
            result = await graph.ainvoke(initial_state)
            event = classify_outcome(result)
        except Exception as e:
            print(f"[generate_stream] graph error: {e!r}")
            event = classify_outcome(None, crashed=True)
        try:
            await queue.put(event)
        finally:
            await queue.put(_SENTINEL)

    async def node_stream():
        graph_task = asyncio.create_task(run_graph())
        try:
            while True:
                item = await queue.get()
                if item is _SENTINEL:
                    break
                yield json.dumps(item) + "\n"
        finally:
            await graph_task

    return StreamingResponse(node_stream(), media_type="application/x-ndjson")


async def _run_refine_agent(ws, graph_input, thread_id: str):
    """Corre (o reanuda) el loop ReAct sobre `ws` emitiendo eventos NDJSON en vivo
    (generador async). S7.5: astream(stream_mode="updates") en vez de ainvoke —
    cada nodo completado yielda su aporte al estado y tool_events lo traduce a
    eventos `tool_call`/`tool_result` (con el delta del servidor) que el frontend
    pinta sin esperar al final. El desenlace terminal sigue siendo único:
    `clarification` si el grafo quedó pausado en interrupt() (el workspace se
    retiene en sesión para la reanudación), `done` con el snapshot completo +
    refinement_history si terminó (verdad que el frontend aplica SIEMPRE,
    reconciliando cualquier evento perdido). Compartido por /refine/stream y
    /refine/resume: ambos desenlaces pueden darse en cualquiera de los dos (una
    reanudación puede volver a pedir aclaración)."""
    from agent_graph import build_agent_graph, extract_history, tool_events

    agent_graph = build_agent_graph(ws, checkpointer=_get_checkpointer())
    # recursion_limit acota el loop ReAct: cada vuelta agent→tools cuenta; un tope
    # evita que un modelo que no converge gire indefinidamente.
    config = {"configurable": {"thread_id": thread_id}, "recursion_limit": 50}

    interrupt_payload = None
    async for update in agent_graph.astream(graph_input, config, stream_mode="updates"):
        if "__interrupt__" in update:
            # El interrupt aparece como chunk propio del stream; el evento
            # clarification se emite al final (tras agotar el stream) para
            # mantener un único desenlace terminal por respuesta HTTP.
            interrupt_payload = update["__interrupt__"][0].value
            continue
        for event in tool_events(update, ws):
            yield event

    if interrupt_payload is not None:
        # Grafo pausado en clarify: retenemos el workspace (ya mutado por las
        # tools previas al interrupt) hasta que llegue la respuesta del usuario.
        _pending_clarifications[thread_id] = ws
        yield {
            "_type": "clarification",
            "thread_id": thread_id,
            "question": interrupt_payload.get("question", ""),
            "options": interrupt_payload.get("options", []),
        }
        return

    # astream no devuelve el estado final como ainvoke: se recupera del
    # checkpointer (aget_state) — de ahí salen los messages para derivar la traza.
    # refinement_history se DERIVA de los messages finales (extract_history): la
    # traza ya existe en el estado del grafo, no se construye en paralelo.
    state = await agent_graph.aget_state(config)
    yield {
        "_type": "done",
        "title": None,
        "diagram": ws.to_compact().model_dump(mode="json"),
        "refinement_history": extract_history(state.values.get("messages", [])),
        "degraded": False,
        "degradations": [],
    }


def _log_refine_event(event: dict) -> None:
    """Log de transmisión del agente (espejo del ⏩ del gateway): una línea por
    evento NDJSON emitido por el loop ReAct."""
    t = event.get("_type")
    if t == "tool_call":
        print(f"[refine] tool_call   → {event['tool']}({json.dumps(event.get('args', {}), ensure_ascii=False)})")
    elif t == "tool_result":
        extra = f" +node {event['node']['id']}" if "node" in event else f" +edge {event['edge']['id']}" if "edge" in event else ""
        print(f"[refine] tool_result → {event['tool']}: {json.dumps(event.get('result'), ensure_ascii=False)[:200]}{extra}")
    elif t == "clarification":
        print(f"[refine] clarification → \"{event.get('question', '')}\" opciones={event.get('options', [])}")
    elif t == "done":
        d = event.get("diagram") or {}
        print(f"[refine] done → {len(d.get('nodes', []))} nodos, {len(d.get('edges', []))} aristas · "
              f"history: {[h['tool'] for h in event.get('refinement_history', [])]}")


def _refine_response(ws, graph_input, thread_id: str) -> StreamingResponse:
    async def stream():
        try:
            async for event in _run_refine_agent(ws, graph_input, thread_id):
                _log_refine_event(event)
                yield json.dumps(event) + "\n"
        except Exception as e:
            print(f"[refine_stream] agent error: {e!r}")
            yield json.dumps({
                "_type": "error",
                "category": "internal_error",
                "message": "Se produjo un error refinando el diagrama. Vuelve a intentarlo en unos segundos.",
            }) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")


@app.post("/refine/stream")
async def refine_stream(req: RefineRequest):
    # S7.3 — Loop ReAct real. Construimos el workspace de ESTA petición desde el
    # diagrama compacto, y un grafo de agente cuyas tools cierran sobre él. El
    # workspace es la fuente de verdad: las tools lo mutan, y al terminar
    # ws.to_compact() es el diagrama refinado (incluido el caso regenerate, que lo
    # reemplaza por dentro). Imports locales para no acoplar el arranque del módulo
    # a langchain (solo se necesita en este endpoint).
    from langchain_core.messages import SystemMessage, HumanMessage
    from agent_graph import build_system_prompt
    from tools import DiagramWorkspace

    ws = DiagramWorkspace.from_compact(req.diagram)
    messages = [SystemMessage(content=build_system_prompt(ws)), HumanMessage(content=req.prompt)]
    thread_id = uuid.uuid4().hex
    return _refine_response(ws, {"messages": messages}, thread_id)


@app.post("/refine/resume")
async def refine_resume(req: ResumeRequest):
    # S7.4 — La respuesta del usuario reanuda el grafo pausado: Command(resume=
    # answer) hace que el interrupt() del nodo clarify DEVUELVA ese texto, y el
    # checkpointer restaura los messages por thread_id. El workspace pendiente se
    # extrae de sesión (si vuelve a interrumpir, _run_refine_agent lo re-retiene).
    from langgraph.types import Command

    ws = _pending_clarifications.pop(req.thread_id, None)
    if ws is None:
        raise HTTPException(
            status_code=404,
            detail="No hay ninguna clarificación pendiente para ese thread_id (¿expiró o ya fue respondida?).",
        )
    return _refine_response(ws, Command(resume=req.answer), req.thread_id)
