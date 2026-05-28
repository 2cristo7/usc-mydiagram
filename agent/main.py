from fastapi import FastAPI, HTTPException, Request
from pydantic import BaseModel, ValidationError
from starlette.responses import StreamingResponse
from schemas import DiagramType, NodeType, EdgeType, DiagramSchema
from state import DiagramState
import httpx
import json
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

    # Llamada 1 — clasificar tipo de diagrama
    valid_types = [t.value for t in DiagramType]
    diagram_type_raw = await call_ollama(
        system=f"Reply with exactly one of these values, no explanation: {valid_types}. What type of diagram does the following text describe?",
        user=req.prompt,
        max_tokens=10,
    )
    diagram_type = diagram_type_raw.strip().strip('"').lower()
    if diagram_type not in valid_types:
        diagram_type = "erd"  # fallback si el modelo alucina

    # Llamada 2 — generar el schema JSON
    schema_raw = await call_ollama(
        system=f"""Generate a JSON representing a '{diagram_type}' diagram.
        Reply ONLY with the JSON, no explanation, no code blocks.
        The JSON must follow exactly this structure:
        {{
        "title": "string",
        "diagram_type": "{diagram_type}",
        "nodes": [
            {{"id": "slug_sin_espacios", "label": "Nombre legible", "node_type": {"|".join(e.value for e in NodeType)}, "attributes": ["campo: TIPO CONSTRAINT"]}}
        ],
        "edges": [
            {{"id": "e1", "source": "id_nodo", "target": "id_nodo", "label": "etiqueta", "edge_type": {"|".join(e.value for e in EdgeType)}}}
        ]
        }}""",
        user=req.prompt,
    )

    # Limpiar posibles bloques de código del LLM
    clean = schema_raw.strip()
    if clean.startswith("```"):
        clean = clean.split("```")[1]
        if clean.startswith("json"):
            clean = clean[4:]

    try:
        data = json.loads(clean)
        diagram = DiagramSchema.model_validate(data)
    except (json.JSONDecodeError, ValidationError) as e:
        raise HTTPException(status_code=500, detail=f"Schema inválido generado por el LLM: {e}")

    set_cache(req.prompt, {"diagram": diagram})
    return {"diagram": diagram}
                    


@app.post("/generate-stream")
async def generate_stream(req: GenerateRequest, request: Request):
    ip = request.client.host
    check_rate_limit(ip, rate_limit_store)

    # Llamada 1 — clasificar tipo de diagrama
    valid_types = [t.value for t in DiagramType]
    diagram_type_raw = await call_ollama(
        system=f"Reply with exactly one of these values, no explanation: {valid_types}. What type of diagram does the following text describe?",
        user=req.prompt,
        max_tokens=10,
    )

    diagram_type = diagram_type_raw.strip().strip('"').lower()
    if diagram_type not in valid_types:
      diagram_type = "erd"

    # Llamada 2 — generar el schema JSON
    return StreamingResponse(
        stream_ollama(
        system=f"""Generate a JSON representing a '{diagram_type}' diagram.
        Reply ONLY with the JSON, no explanation, no code blocks.
        The JSON must follow exactly this structure:
        {{
        "title": "string",
        "diagram_type": "{diagram_type}",
        "nodes": [
            {{"id": "slug_sin_espacios", "label": "Nombre legible", "node_type": {"|".join(e.value for e in NodeType)}, "attributes": ["campo: TIPO CONSTRAINT"]}}
        ],
        "edges": [
            {{"id": "e1", "source": "id_nodo", "target": "id_nodo", "label": "etiqueta", "edge_type": {"|".join(e.value for e in EdgeType)}}}
        ]
        }}""",
        user=req.prompt,
    ), media_type="text/plain")

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