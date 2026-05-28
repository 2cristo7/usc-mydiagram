import httpx

OLLAMA_URL = "http://localhost:11434/api/chat"
MODEL = "qwen3:8b"

async def call_llm(system: str, user: str, max_tokens: int = 2048) -> str:
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": f"/no_think\n{user}"},
        ],
        "stream": False,
        "think": False,
        "options": {"num_predict": max_tokens},
    }
    print(f"\n[OLLAMA] system: {system[:80]}...")
    print(f"[OLLAMA] user:   {user[:120]}")
    async with httpx.AsyncClient(timeout=300) as client:
        response = await client.post(OLLAMA_URL, json=payload)
        response.raise_for_status()
    content = response.json()["message"]["content"]
    # Eliminar bloque <think>...</think> si el modelo lo incluye
    if "<think>" in content and "</think>" in content:
        content = content.split("</think>")[-1].strip()
    print(f"[OLLAMA] reply:  {content[:200]}")
    return content


async def stream_ollama(system: str, user: str, max_tokens: int = 2048):
    payload = {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user",   "content": f"/no_think\n{user}"},
        ],
        "stream": True,
        "think": False,
        "options": {"num_predict": max_tokens},
    }
    print(f"\n[OLLAMA] system: {system[:80]}...")
    print(f"[OLLAMA] user:   {user[:120]}")
    async with httpx.AsyncClient(timeout=300) as client:
        async with client.stream("POST", OLLAMA_URL, json=payload) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if line:
                    try:
                        data = json.loads(line)
                        content = data.get("message", {}).get("content", "")
                        if content:
                            yield content
                            print(f"[OLLAMA] chunk: {content[:80]}")
                    except (json.JSONDecodeError, KeyError):
                        pass