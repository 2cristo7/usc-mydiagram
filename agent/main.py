from dotenv import load_dotenv
load_dotenv()

import asyncio
import json
import time
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from graph import build_graph, initial_generation_state
from outcome import classify_outcome
from schemas import CompactDiagram

app = FastAPI()
rate_limit_store = {}

_SENTINEL = object()

class GenerateRequest(BaseModel):
    prompt: str


# S7.1 — Refinamiento sobre un diagrama existente. `diagram` es la versión
# compacta (sin title) que el frontend serializa con diagramToJson. Pydantic lo
# valida al parsear: un diagrama malformado da 422 explícito, no fallo silencioso.
class RefineRequest(BaseModel):
    prompt: str
    diagram: CompactDiagram

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
    from agent_graph import build_agent_graph, build_system_prompt
    from tools import DiagramWorkspace

    ws = DiagramWorkspace.from_compact(req.diagram)
    agent_graph = build_agent_graph(ws)
    messages = [SystemMessage(content=build_system_prompt(ws)), HumanMessage(content=req.prompt)]

    async def refine():
        # FRONTERA S7.3 → 7.5: emitimos un único evento terminal con el diagrama
        # entero (snapshot completo: el protocolo incremental node/edge no expresa
        # borrados, que el refinamiento sí hace). El streaming visual de cada tool
        # call y la aplicación quirúrgica en el canvas es 7.5; el gateway hoy ignora
        # el campo `diagram` y solo reenvía title/degraded.
        try:
            # recursion_limit acota el loop ReAct: cada vuelta agent→tools cuenta;
            # un tope evita que un modelo que no converge gire indefinidamente.
            await agent_graph.ainvoke({"messages": messages}, {"recursion_limit": 50})
            event = {
                "_type": "done",
                "title": None,
                "diagram": ws.to_compact().model_dump(mode="json"),
                "degraded": False,
                "degradations": [],
            }
        except Exception as e:
            print(f"[refine_stream] agent error: {e!r}")
            event = {
                "_type": "error",
                "category": "internal_error",
                "message": "Se produjo un error refinando el diagrama. Vuelve a intentarlo en unos segundos.",
            }
        yield json.dumps(event) + "\n"

    return StreamingResponse(refine(), media_type="application/x-ndjson")


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
