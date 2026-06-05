from dotenv import load_dotenv
load_dotenv()

import asyncio
import json
import time
import uuid
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from graph import build_graph, initial_generation_state
from outcome import classify_outcome
from schemas import CompactDiagram

app = FastAPI()
rate_limit_store = {}

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
async def generate_stream(req: GenerateRequest, request: Request):
    ip = request.client.host
    check_rate_limit(ip, rate_limit_store)

    queue: asyncio.Queue = asyncio.Queue()
    graph = build_graph(queue)

    initial_state = initial_generation_state(req.prompt)

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


async def _run_refine_agent(ws, graph_input, thread_id: str) -> dict:
    """Corre (o reanuda) el loop ReAct sobre `ws` y clasifica el desenlace en un
    evento NDJSON: `clarification` si el grafo quedó pausado en interrupt() (el
    workspace se retiene en sesión para la reanudación), `done` con el snapshot
    completo + refinement_history si terminó. Compartido por /refine/stream y
    /refine/resume: ambos desenlaces pueden darse en cualquiera de los dos (una
    reanudación puede volver a pedir aclaración)."""
    from agent_graph import build_agent_graph, extract_history

    agent_graph = build_agent_graph(ws, checkpointer=_get_checkpointer())
    # recursion_limit acota el loop ReAct: cada vuelta agent→tools cuenta; un tope
    # evita que un modelo que no converge gire indefinidamente.
    config = {"configurable": {"thread_id": thread_id}, "recursion_limit": 50}
    result = await agent_graph.ainvoke(graph_input, config)

    if "__interrupt__" in result:
        # Grafo pausado en clarify: retenemos el workspace (ya mutado por las
        # tools previas al interrupt) hasta que llegue la respuesta del usuario.
        payload = result["__interrupt__"][0].value
        _pending_clarifications[thread_id] = ws
        return {
            "_type": "clarification",
            "thread_id": thread_id,
            "question": payload.get("question", ""),
            "options": payload.get("options", []),
        }

    # FRONTERA S7.4 → 7.5: un único evento terminal con el diagrama entero
    # (snapshot completo: el protocolo incremental node/edge no expresa borrados,
    # que el refinamiento sí hace). refinement_history se DERIVA de los messages
    # finales (extract_history): la traza ya existe en el estado del grafo.
    return {
        "_type": "done",
        "title": None,
        "diagram": ws.to_compact().model_dump(mode="json"),
        "refinement_history": extract_history(result["messages"]),
        "degraded": False,
        "degradations": [],
    }


def _refine_response(ws, graph_input, thread_id: str) -> StreamingResponse:
    async def stream():
        try:
            event = await _run_refine_agent(ws, graph_input, thread_id)
        except Exception as e:
            print(f"[refine_stream] agent error: {e!r}")
            event = {
                "_type": "error",
                "category": "internal_error",
                "message": "Se produjo un error refinando el diagrama. Vuelve a intentarlo en unos segundos.",
            }
        yield json.dumps(event) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")


@app.post("/refine/stream")
async def refine_stream(req: RefineRequest, request: Request):
    ip = request.client.host
    check_rate_limit(ip, rate_limit_store)

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
async def refine_resume(req: ResumeRequest, request: Request):
    ip = request.client.host
    check_rate_limit(ip, rate_limit_store)

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


def check_rate_limit(ip: str, rate_limit_store: dict, RATE_LIMIT: int = 5, WINDOW_SECONDS: int = 60):
    if ip not in rate_limit_store:
        rate_limit_store[ip] = (1, time.time())
        return

    count, window_start = rate_limit_store[ip]

    if time.time() - window_start > WINDOW_SECONDS:
        rate_limit_store[ip] = (1, time.time())
    elif (count >= RATE_LIMIT):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    else:
        rate_limit_store[ip] = (count + 1, window_start)
