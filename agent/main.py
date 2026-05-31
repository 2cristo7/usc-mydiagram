from dotenv import load_dotenv
load_dotenv()

import asyncio
import json
import time
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from graph import build_graph

app = FastAPI()
rate_limit_store = {}

_SENTINEL = object()

class GenerateRequest(BaseModel):
    prompt: str

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
    }

    async def run_graph():
        try:
            result = await graph.ainvoke(initial_state)
            if not result.get("is_diagram_request"):
                await queue.put({"_type": "error", "message": "El prompt no describe un diagrama."})
            elif not result.get("diagram"):
                await queue.put({"_type": "error", "message": "No se pudo generar el diagrama."})
            else:
                await queue.put({"_type": "done", "title": result["diagram"].title})
        except Exception as e:
            print(f"[generate_stream] graph error: {e!r}")
            await queue.put({"_type": "error", "message": "Error generando el diagrama."})
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
