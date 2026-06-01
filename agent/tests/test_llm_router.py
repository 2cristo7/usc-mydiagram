"""S6.4 — Router multi-modelo configurable por env vars (`llm._resolve_model`)
y backend OpenAI.

El router es un mapeo PURO de variables de entorno a un backend: el perfil
(`LLM_PROFILE`) elige proveedor (Ollama local vs OpenAI) y el `tier` (fast/capable)
elige el modelo dentro del proveedor. Se prueba manipulando `os.environ`
(monkeypatch) y comprobando el TIPO y la configuración del backend devuelto —no se
mockea httpx— porque eso valida el contrato real que ve producción (cambias una
env var, cambias de modelo) sin acoplarse a la forma de la respuesta HTTP.

Aparte, se cubre `OpenAIBackend` (complete normal + error + stream), que hasta S6.10
no tenía test (solo lo tenía Ollama en test_call_ollama).
"""
import pytest
import httpx
from unittest.mock import patch, MagicMock, AsyncMock

from llm import _resolve_model, OllamaBackend, OpenAIBackend


# ----------------------------- Router por env vars -----------------------------

def test_default_profile_is_local(monkeypatch):
    # Sin LLM_PROFILE el sistema arranca en local (Ollama), no peta.
    monkeypatch.delenv("LLM_PROFILE", raising=False)
    backend = _resolve_model("capable")
    assert isinstance(backend, OllamaBackend)


def test_local_fast_and_capable_pick_their_models(monkeypatch):
    monkeypatch.setenv("LLM_PROFILE", "local")
    monkeypatch.setenv("OLLAMA_MODEL_FAST", "qwen3:4b")
    monkeypatch.setenv("OLLAMA_MODEL_CAPABLE", "qwen3:32b")
    assert _resolve_model("fast").model == "qwen3:4b"
    assert _resolve_model("capable").model == "qwen3:32b"


def test_local_uses_default_url_and_model(monkeypatch):
    monkeypatch.setenv("LLM_PROFILE", "local")
    monkeypatch.delenv("OLLAMA_URL", raising=False)
    monkeypatch.delenv("OLLAMA_MODEL_CAPABLE", raising=False)
    backend = _resolve_model("capable")
    assert backend.url == "http://localhost:11434/api/chat"
    assert backend.model == "qwen3:8b"


def test_openai_profile_picks_openai_backend(monkeypatch):
    monkeypatch.setenv("LLM_PROFILE", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.delenv("OPENAI_MODEL_FAST", raising=False)
    monkeypatch.delenv("OPENAI_MODEL_CAPABLE", raising=False)
    fast = _resolve_model("fast")
    capable = _resolve_model("capable")
    assert isinstance(fast, OpenAIBackend) and isinstance(capable, OpenAIBackend)
    assert fast.model == "gpt-4o-mini"      # default tier fast
    assert capable.model == "gpt-4o"        # default tier capable
    assert fast.api_key == "sk-test"


def test_openai_model_overrides(monkeypatch):
    monkeypatch.setenv("LLM_PROFILE", "openai")
    monkeypatch.setenv("OPENAI_MODEL_FAST", "gpt-4.1-mini")
    monkeypatch.setenv("OPENAI_MODEL_CAPABLE", "gpt-4.1")
    assert _resolve_model("fast").model == "gpt-4.1-mini"
    assert _resolve_model("capable").model == "gpt-4.1"


def test_unknown_profile_raises(monkeypatch):
    # Perfil mal escrito → error explícito, no un fallback silencioso a un proveedor
    # arbitrario (invariante "errores explícitos" de la visión global).
    monkeypatch.setenv("LLM_PROFILE", "anthropic")
    with pytest.raises(ValueError, match="Unknown LLM_PROFILE"):
        _resolve_model("fast")


# ----------------------------- Backend OpenAI -----------------------------

OPENAI = OpenAIBackend(model="gpt-4o", api_key="sk-test")


@pytest.mark.asyncio
async def test_openai_complete_returns_content():
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {"choices": [{"message": {"content": "hola"}}]}
    with patch("llm.httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
        result = await OPENAI.complete("system", "user", max_tokens=50)
    assert result == "hola"


@pytest.mark.asyncio
async def test_openai_complete_propagates_http_error():
    mock_response = MagicMock()
    mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "boom", request=MagicMock(), response=MagicMock()
    )
    with patch("llm.httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
        with pytest.raises(httpx.HTTPStatusError):
            await OPENAI.complete("system", "user", max_tokens=50)


@pytest.mark.asyncio
async def test_openai_stream_parses_sse_deltas():
    # El stream OpenAI llega como líneas "data: {json}" + un "data: [DONE]" final
    # que debe ignorarse. Se reconstruye el texto concatenando los deltas.
    lines = [
        'data: {"choices":[{"delta":{"content":"Hola"}}]}',
        'data: {"choices":[{"delta":{"content":" mundo"}}]}',
        "data: [DONE]",
    ]

    async def _aiter_lines():
        for ln in lines:
            yield ln

    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.aiter_lines = _aiter_lines

    stream_cm = MagicMock()
    stream_cm.__aenter__ = AsyncMock(return_value=mock_response)
    stream_cm.__aexit__ = AsyncMock(return_value=False)

    with patch("llm.httpx.AsyncClient") as mock_client:
        client = mock_client.return_value.__aenter__.return_value
        client.stream = MagicMock(return_value=stream_cm)
        chunks = [c async for c in OPENAI.stream("system", "user", max_tokens=50)]

    assert "".join(chunks) == "Hola mundo"
