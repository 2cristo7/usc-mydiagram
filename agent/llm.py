import json
import os
import httpx

# ---------------------------------------------------------------------------
# Backends
# ---------------------------------------------------------------------------

class OllamaBackend:
    def __init__(self, model: str, url: str):
        self.model = model
        self.url = url

    async def complete(self, system: str, user: str, max_tokens: int) -> str:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user",   "content": f"/no_think\n{user}"},
            ],
            "stream": False,
            "think": False,
            "options": {"num_predict": max_tokens},
        }
        print(f"\n[OLLAMA/{self.model}] system: {system[:80]}...")
        print(f"[OLLAMA/{self.model}] user:   {user[:120]}")
        async with httpx.AsyncClient(timeout=300) as client:
            response = await client.post(self.url, json=payload)
            response.raise_for_status()
        content = response.json()["message"]["content"]
        if "<think>" in content and "</think>" in content:
            content = content.split("</think>")[-1].strip()
        print(f"[OLLAMA/{self.model}] reply:  {content[:200]}")
        return content

    async def stream(self, system: str, user: str, max_tokens: int):
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user",   "content": f"/no_think\n{user}"},
            ],
            "stream": True,
            "think": False,
            "options": {"num_predict": max_tokens},
        }
        print(f"\n[OLLAMA/{self.model}] stream system: {system[:80]}...")
        async with httpx.AsyncClient(timeout=300) as client:
            async with client.stream("POST", self.url, json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line:
                        try:
                            data = json.loads(line)
                            content = data.get("message", {}).get("content", "")
                            if content:
                                yield content
                        except (json.JSONDecodeError, KeyError):
                            pass


class OpenAIBackend:
    def __init__(self, model: str, api_key: str):
        self.model = model
        self.api_key = api_key
        self.url = "https://api.openai.com/v1/chat/completions"

    async def complete(self, system: str, user: str, max_tokens: int) -> str:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ],
            "max_tokens": max_tokens,
        }
        headers = {"Authorization": f"Bearer {self.api_key}"}
        print(f"\n[OPENAI/{self.model}] system: {system[:80]}...")
        print(f"[OPENAI/{self.model}] user:   {user[:120]}")
        async with httpx.AsyncClient(timeout=120) as client:
            response = await client.post(self.url, json=payload, headers=headers)
            response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        print(f"[OPENAI/{self.model}] reply:  {content[:200]}")
        return content

    async def stream(self, system: str, user: str, max_tokens: int):
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ],
            "max_tokens": max_tokens,
            "stream": True,
        }
        headers = {"Authorization": f"Bearer {self.api_key}"}
        print(f"\n[OPENAI/{self.model}] stream system: {system[:80]}...")
        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream("POST", self.url, json=payload, headers=headers) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line.startswith("data: ") and line != "data: [DONE]":
                        try:
                            data = json.loads(line[6:])
                            content = data["choices"][0]["delta"].get("content", "")
                            if content:
                                yield content
                        except (json.JSONDecodeError, KeyError):
                            pass


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

def _resolve_model(tier: str) -> OllamaBackend | OpenAIBackend:
    profile = os.environ.get("LLM_PROFILE", "local")

    if profile == "local":
        url = os.environ.get("OLLAMA_URL", "http://localhost:11434/api/chat")
        if tier == "fast":
            model = os.environ.get("OLLAMA_MODEL_FAST", "qwen3:8b")
        else:
            model = os.environ.get("OLLAMA_MODEL_CAPABLE", "qwen3:8b")
        return OllamaBackend(model=model, url=url)

    if profile == "openai":
        api_key = os.environ.get("OPENAI_API_KEY", "")
        if tier == "fast":
            model = os.environ.get("OPENAI_MODEL_FAST", "gpt-4o-mini")
        else:
            model = os.environ.get("OPENAI_MODEL_CAPABLE", "gpt-4o")
        return OpenAIBackend(model=model, api_key=api_key)

    raise ValueError(f"Unknown LLM_PROFILE: '{profile}'. Use 'local' or 'openai'.")


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def call_llm(system: str, user: str, tier: str = "capable", max_tokens: int = 2048) -> str:
    backend = _resolve_model(tier)
    return await backend.complete(system, user, max_tokens)


async def stream_llm(system: str, user: str, tier: str = "capable", max_tokens: int = 2048):
    backend = _resolve_model(tier)
    async for chunk in backend.stream(system, user, max_tokens):
        yield chunk
