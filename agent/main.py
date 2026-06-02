from dotenv import load_dotenv
load_dotenv()

import asyncio
import json
import time
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from graph import build_graph
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

    initial_state = {
        "prompt": req.prompt,
        "is_diagram_request": False,
        "diagram_type": None,
        "title": None,
        "nodes": [],
        "edges": [],
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
    }

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

    # FRONTERA DE SCOPE S7.1 — Lo REAL hasta aquí: el contrato {prompt, diagram} y
    # su validación Pydantic (CompactDiagram). Llegar a este punto significa que el
    # tubo frontend → gateway → agente funciona y el diagrama existente está bien
    # formado. Lo que viene DESPUÉS de la frontera (el loop ReAct que mira el
    # diagrama, elige tools y lo modifica) se construye en S7.2 (tools) y S7.3
    # (agente). Hasta entonces, error NDJSON honesto en vez de fingir refinamiento.
    async def not_implemented_stream():
        event = {
            "_type": "error",
            "message": "El refinamiento de diagramas aún no está disponible (llega en S7.3).",
            "category": "internal_error",
        }
        yield json.dumps(event) + "\n"

    return StreamingResponse(not_implemented_stream(), media_type="application/x-ndjson")


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
