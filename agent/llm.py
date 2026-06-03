import json
import os
import httpx

# ---------------------------------------------------------------------------
# Filtro de tokens de razonamiento (<think>...</think>) para modelos locales
# ---------------------------------------------------------------------------

_THINK_OPEN = "<think>"
_THINK_CLOSE = "</think>"
_TAIL = max(len(_THINK_OPEN), len(_THINK_CLOSE)) - 1  # margen por si el tag llega partido


async def _strip_think(stream):
    """Elimina bloques <think>...</think> de un stream de texto, con estado
    entre chunks para tolerar tags partidos en la frontera de dos chunks."""
    buf = ""
    in_think = False
    async for content in stream:
        buf += content
        out = ""
        while True:
            if in_think:
                i = buf.find(_THINK_CLOSE)
                if i == -1:
                    # seguimos dentro: descartamos, retenemos cola por si es media etiqueta
                    if len(buf) > _TAIL:
                        buf = buf[-_TAIL:]
                    break
                buf = buf[i + len(_THINK_CLOSE):]
                in_think = False
            else:
                i = buf.find(_THINK_OPEN)
                if i == -1:
                    # fuera de think: emitimos todo menos la posible media etiqueta de cola
                    if len(buf) > _TAIL:
                        out += buf[:-_TAIL]
                        buf = buf[-_TAIL:]
                    break
                out += buf[:i]
                buf = buf[i + len(_THINK_OPEN):]
                in_think = True
        if out:
            yield out
    if not in_think and buf:
        yield buf

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

        async def _raw():
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

        async for chunk in _strip_think(_raw()):
            yield chunk


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


# ---------------------------------------------------------------------------
# Chat-model para el AGENTE (S7.3)
# ---------------------------------------------------------------------------
# El camino de GENERACIÓN (S6) usa call_llm/stream_llm (HTTP crudo, una sola
# completion): le basta texto plano. El camino del AGENTE (loop ReAct) necesita
# tool calling estructurado — `bind_tools()`/`ToolNode` —, que solo dan los
# BaseChatModel de LangChain. Por eso una API distinta, pero MISMO eje de routing
# (LLM_PROFILE) y mismos nombres de modelo por env: producción/local de la visión
# global se respeta, con Anthropic como tercer perfil para el agente.
#
# Imports LAZY: cada perfil solo importa su paquete provider; correr en `local`
# no exige tener instalado langchain-openai ni langchain-anthropic.

def get_chat_model(tier: str = "capable"):
    """Devuelve un BaseChatModel de LangChain con tool calling, según LLM_PROFILE.

    `tier` espeja _resolve_model: "fast" usa el modelo ligero, cualquier otro el
    capaz (el agente usa "capable": el tool calling exige el modelo fiable)."""
    profile = os.environ.get("LLM_PROFILE", "local")
    fast = tier == "fast"

    if profile == "local":
        from langchain_ollama import ChatOllama
        model = os.environ.get("OLLAMA_MODEL_FAST" if fast else "OLLAMA_MODEL_CAPABLE", "qwen3:8b")
        # ChatOllama quiere la raíz del servidor, no el endpoint /api/chat que usa
        # el backend crudo. Derivamos una de la otra para no duplicar config.
        chat_url = os.environ.get("OLLAMA_URL", "http://localhost:11434/api/chat")
        base_url = chat_url.split("/api/")[0]
        return ChatOllama(model=model, base_url=base_url, temperature=0)

    if profile == "openai":
        from langchain_openai import ChatOpenAI
        model = os.environ.get("OPENAI_MODEL_FAST" if fast else "OPENAI_MODEL_CAPABLE",
                               "gpt-4o-mini" if fast else "gpt-4o")
        return ChatOpenAI(model=model, api_key=os.environ.get("OPENAI_API_KEY", ""), temperature=0)

    if profile == "anthropic":
        from langchain_anthropic import ChatAnthropic
        model = os.environ.get("ANTHROPIC_MODEL_FAST" if fast else "ANTHROPIC_MODEL_CAPABLE",
                               "claude-haiku-4-5" if fast else "claude-sonnet-4-6")
        return ChatAnthropic(model=model, api_key=os.environ.get("ANTHROPIC_API_KEY", ""), temperature=0)

    raise ValueError(f"Unknown LLM_PROFILE: '{profile}'. Use 'local', 'openai' or 'anthropic'.")
