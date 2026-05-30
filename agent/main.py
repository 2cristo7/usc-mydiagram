from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel
from schemas import DiagramType, NodeType, EdgeType
from graph import graph
import time

app = FastAPI()
rate_limit_store = {}
prompt_cache = {}

class GenerateRequest(BaseModel):
    prompt: str

@app.get("/health")
def health():
    return {"status": "ok", "service": "agent"}

@app.post("/generate")
async def generate(req: GenerateRequest, request: Request):
    ip = request.client.host
    check_rate_limit(ip, rate_limit_store)
    cached = get_cached(req.prompt)
    if cached:
        return cached
    
    result = await graph.ainvoke({
          "prompt": req.prompt,
          "is_diagram_request": False,
          "diagram_type": None,
          "title": None,
          "nodes": [],
          "edges": [],
          "diagram": None,
          "validation_errors": [],
          "retry_count": 0,
      })

    if not result["is_diagram_request"]:
        raise HTTPException(status_code=400, detail="El prompt no describe un diagrama.")
    if not result["diagram"]:
        raise HTTPException(status_code=500, detail="No se pudo generar el diagrama.")

    set_cache(req.prompt, {"diagram": result["diagram"]})
    return {"diagram": result["diagram"]}
                    



def check_rate_limit(ip: str, rate_limit_store: dict, RATE_LIMIT: int = 5, WINDOW_SECONDS: int = 60):

    if ip not in rate_limit_store:
        rate_limit_store[ip] = (1, time.time())  # contador, timestamp
        return
    
    count, window_start = rate_limit_store[ip]

    if time.time() - window_start > WINDOW_SECONDS:
        rate_limit_store[ip] = (1, time.time())
    elif (count >= RATE_LIMIT):
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    else:
        rate_limit_store[ip] = (count + 1, window_start)



def get_cached(prompt: str):
    if prompt not in prompt_cache:
        return None
    if (prompt_cache[prompt]["timestamp"] + 60) < time.time():
        prompt_cache.pop(prompt)
        return None
    return prompt_cache[prompt]["response"]

def set_cache(prompt: str, response: dict):
    prompt_cache[prompt] = {"response": response, "timestamp": time.time()}