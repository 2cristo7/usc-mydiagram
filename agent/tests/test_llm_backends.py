"""Cobertura de los backends comerciales de llm.py y caminos de error.

Complementa test_llm_runtime.py (que cubre la SELECCIÓN de backend y el happy path
de complete) con las ramas que faltaban:
- OpenAIBackend.complete: HTTP 401, otros HTTP, ConnectError, TimeoutException, red
  genérica, respuesta malformada; y OpenAIBackend.stream (chunks SSE, 401, red).
- AnthropicBackend/GeminiBackend.complete: 401, HTTP genérico, conexión, timeout,
  red genérica, payload inesperado.
- _validate_user_base_url: URL malformada, scheme no http/https, sin host, host
  irresoluble (gaierror).
- get_chat_model: caminos env-based (local/openai/anthropic) y per-request
  (LLMConfig), más los errores (perfil desconocido, transport browser, provider
  desconocido en config).

Mockea httpx con monkeypatch/patch + AsyncMock igual que test_call_ollama.py; no
usa respx (no instalado).
"""
import httpx
import pytest
from unittest.mock import patch, MagicMock, AsyncMock

from llm import (
    OpenAIBackend, AnthropicBackend, GeminiBackend, LLMError,
    LLMConfig, _validate_user_base_url, get_chat_model,
)


def _http_status_error(status: int) -> httpx.HTTPStatusError:
    resp = MagicMock()
    resp.status_code = status
    return httpx.HTTPStatusError("err", request=MagicMock(), response=resp)


def _ok_post_response(json_value):
    r = MagicMock()
    r.raise_for_status = MagicMock()
    r.json.return_value = json_value
    return r


# ---------------------------------------------------------------------------
# OpenAIBackend.complete — ramas de error
# ---------------------------------------------------------------------------

OPENAI = OpenAIBackend(model="gpt-4o", api_key="sk-test")


@pytest.mark.asyncio
async def test_openai_complete_returns_content():
    resp = _ok_post_response({"choices": [{"message": {"content": "hola openai"}}]})
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(return_value=resp)
        result = await OPENAI.complete("system", "user", max_tokens=50)
    assert result == "hola openai"


@pytest.mark.asyncio
async def test_openai_complete_401_is_api_key_error():
    resp = MagicMock()
    resp.raise_for_status.side_effect = _http_status_error(401)
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(return_value=resp)
        with pytest.raises(LLMError, match="API key"):
            await OPENAI.complete("system", "user", max_tokens=50)


@pytest.mark.asyncio
async def test_openai_complete_other_status_propagates_status():
    resp = MagicMock()
    resp.raise_for_status.side_effect = _http_status_error(500)
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(return_value=resp)
        with pytest.raises(LLMError, match="HTTP 500"):
            await OPENAI.complete("system", "user", max_tokens=50)


@pytest.mark.asyncio
async def test_openai_complete_connect_error():
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(
            side_effect=httpx.ConnectError("no conecta")
        )
        with pytest.raises(LLMError, match="No se pudo conectar"):
            await OPENAI.complete("system", "user", max_tokens=50)


@pytest.mark.asyncio
async def test_openai_complete_timeout():
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(
            side_effect=httpx.TimeoutException("tardó")
        )
        with pytest.raises(LLMError, match="tardó demasiado"):
            await OPENAI.complete("system", "user", max_tokens=50)


@pytest.mark.asyncio
async def test_openai_complete_unexpected_payload():
    # Falta la clave choices → KeyError → LLMError de respuesta inesperada.
    resp = _ok_post_response({"unexpected": "shape"})
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(return_value=resp)
        with pytest.raises(LLMError, match="respuesta inesperada"):
            await OPENAI.complete("system", "user", max_tokens=50)


@pytest.mark.asyncio
async def test_openai_complete_generic_network_error():
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json.side_effect = httpx.ReadError("corte")
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(return_value=resp)
        with pytest.raises(LLMError, match="interrumpió la conexión"):
            await OPENAI.complete("system", "user", max_tokens=50)


# ---------------------------------------------------------------------------
# OpenAIBackend.stream
# ---------------------------------------------------------------------------

def _stream_cm(mock_response):
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=mock_response)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


@pytest.mark.asyncio
async def test_openai_stream_yields_content_and_skips_malformed():
    lines = [
        'data: {"choices":[{"delta":{"content":"Hola"}}]}',
        'data: no-es-json',                       # malformada → descartada
        'data: {"choices":[{"delta":{"content":" mundo"}}]}',
        "data: [DONE]",
    ]

    async def _aiter_lines():
        for ln in lines:
            yield ln

    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.aiter_lines = _aiter_lines

    with patch("llm.httpx.AsyncClient") as mc:
        client = mc.return_value.__aenter__.return_value
        client.stream = MagicMock(return_value=_stream_cm(resp))
        chunks = [c async for c in OPENAI.stream("system", "user", max_tokens=50)]

    assert "".join(chunks) == "Hola mundo"


@pytest.mark.asyncio
async def test_openai_stream_401_raises_api_key_error():
    resp = MagicMock()
    resp.raise_for_status.side_effect = _http_status_error(401)

    with patch("llm.httpx.AsyncClient") as mc:
        client = mc.return_value.__aenter__.return_value
        client.stream = MagicMock(return_value=_stream_cm(resp))
        with pytest.raises(LLMError, match="API key"):
            _ = [c async for c in OPENAI.stream("system", "user", max_tokens=50)]


@pytest.mark.asyncio
async def test_openai_stream_other_status_propagates():
    resp = MagicMock()
    resp.raise_for_status.side_effect = _http_status_error(503)

    with patch("llm.httpx.AsyncClient") as mc:
        client = mc.return_value.__aenter__.return_value
        client.stream = MagicMock(return_value=_stream_cm(resp))
        with pytest.raises(LLMError, match="HTTP 503"):
            _ = [c async for c in OPENAI.stream("system", "user", max_tokens=50)]


@pytest.mark.asyncio
async def test_openai_stream_connect_error():
    with patch("llm.httpx.AsyncClient") as mc:
        client = mc.return_value.__aenter__.return_value
        client.stream = MagicMock(side_effect=httpx.ConnectError("no conecta"))
        with pytest.raises(LLMError, match="No se pudo conectar"):
            _ = [c async for c in OPENAI.stream("system", "user", max_tokens=50)]


@pytest.mark.asyncio
async def test_openai_stream_timeout():
    with patch("llm.httpx.AsyncClient") as mc:
        client = mc.return_value.__aenter__.return_value
        client.stream = MagicMock(side_effect=httpx.TimeoutException("tardó"))
        with pytest.raises(LLMError, match="tardó demasiado"):
            _ = [c async for c in OPENAI.stream("system", "user", max_tokens=50)]


@pytest.mark.asyncio
async def test_openai_stream_generic_network_error():
    with patch("llm.httpx.AsyncClient") as mc:
        client = mc.return_value.__aenter__.return_value
        client.stream = MagicMock(side_effect=httpx.ReadError("reset"))
        with pytest.raises(LLMError, match="interrumpió la conexión"):
            _ = [c async for c in OPENAI.stream("system", "user", max_tokens=50)]


# ---------------------------------------------------------------------------
# AnthropicBackend.complete — ramas de error
# ---------------------------------------------------------------------------

ANTHROPIC = AnthropicBackend(model="claude-haiku-4-5", api_key="sk-ant-test")


@pytest.mark.asyncio
async def test_anthropic_complete_401_is_api_key_error():
    resp = MagicMock()
    resp.raise_for_status.side_effect = _http_status_error(401)
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(return_value=resp)
        with pytest.raises(LLMError, match="API key"):
            await ANTHROPIC.complete("system", "user", max_tokens=50)


@pytest.mark.asyncio
async def test_anthropic_complete_other_status():
    resp = MagicMock()
    resp.raise_for_status.side_effect = _http_status_error(500)
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(return_value=resp)
        with pytest.raises(LLMError, match="Anthropic.*HTTP 500"):
            await ANTHROPIC.complete("system", "user", max_tokens=50)


@pytest.mark.asyncio
async def test_anthropic_complete_connect_error():
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(
            side_effect=httpx.ConnectError("x")
        )
        with pytest.raises(LLMError, match="No se pudo conectar"):
            await ANTHROPIC.complete("system", "user", max_tokens=50)


@pytest.mark.asyncio
async def test_anthropic_complete_timeout():
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(
            side_effect=httpx.TimeoutException("x")
        )
        with pytest.raises(LLMError, match="tardó demasiado"):
            await ANTHROPIC.complete("system", "user", max_tokens=50)


@pytest.mark.asyncio
async def test_anthropic_complete_unexpected_payload():
    resp = _ok_post_response({"no": "content"})
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(return_value=resp)
        with pytest.raises(LLMError, match="respuesta inesperada"):
            await ANTHROPIC.complete("system", "user", max_tokens=50)


@pytest.mark.asyncio
async def test_anthropic_complete_generic_network_error():
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json.side_effect = httpx.ReadError("corte")
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(return_value=resp)
        with pytest.raises(LLMError, match="interrumpió la conexión"):
            await ANTHROPIC.complete("system", "user", max_tokens=50)


@pytest.mark.asyncio
async def test_anthropic_sends_correct_payload_and_headers():
    captured = {}

    async def fake_post(url, json=None, headers=None):
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        return _ok_post_response({"content": [{"text": "ok"}]})

    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = fake_post
        await ANTHROPIC.complete("mi system", "mi user", max_tokens=77)

    assert captured["url"] == "https://api.anthropic.com/v1/messages"
    assert captured["json"]["system"] == "mi system"
    assert captured["json"]["max_tokens"] == 77
    assert captured["json"]["messages"][0]["content"] == "mi user"
    assert captured["headers"]["x-api-key"] == "sk-ant-test"
    assert captured["headers"]["anthropic-version"] == "2023-06-01"


# ---------------------------------------------------------------------------
# GeminiBackend.complete — ramas de error
# ---------------------------------------------------------------------------

GEMINI = GeminiBackend(model="gemini-2.0-flash", api_key="AIza-test")


@pytest.mark.asyncio
async def test_gemini_complete_401_is_api_key_error():
    resp = MagicMock()
    resp.raise_for_status.side_effect = _http_status_error(401)
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(return_value=resp)
        with pytest.raises(LLMError, match="API key"):
            await GEMINI.complete("system", "user", max_tokens=50)


@pytest.mark.asyncio
async def test_gemini_complete_other_status():
    resp = MagicMock()
    resp.raise_for_status.side_effect = _http_status_error(429)
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(return_value=resp)
        with pytest.raises(LLMError, match="Gemini.*HTTP 429"):
            await GEMINI.complete("system", "user", max_tokens=50)


@pytest.mark.asyncio
async def test_gemini_complete_connect_error():
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(
            side_effect=httpx.ConnectError("x")
        )
        with pytest.raises(LLMError, match="No se pudo conectar"):
            await GEMINI.complete("system", "user", max_tokens=50)


@pytest.mark.asyncio
async def test_gemini_complete_timeout():
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(
            side_effect=httpx.TimeoutException("x")
        )
        with pytest.raises(LLMError, match="tardó demasiado"):
            await GEMINI.complete("system", "user", max_tokens=50)


@pytest.mark.asyncio
async def test_gemini_complete_unexpected_payload():
    resp = _ok_post_response({"candidates": []})
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(return_value=resp)
        with pytest.raises(LLMError, match="respuesta inesperada"):
            await GEMINI.complete("system", "user", max_tokens=50)


@pytest.mark.asyncio
async def test_gemini_complete_generic_network_error():
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json.side_effect = httpx.ReadError("corte")
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(return_value=resp)
        with pytest.raises(LLMError, match="interrumpió la conexión"):
            await GEMINI.complete("system", "user", max_tokens=50)


@pytest.mark.asyncio
async def test_gemini_url_includes_model_and_key():
    captured = {}

    async def fake_post(url, json=None):
        captured["url"] = url
        captured["json"] = json
        return _ok_post_response(
            {"candidates": [{"content": {"parts": [{"text": "ok"}]}}]}
        )

    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = fake_post
        await GEMINI.complete("sys", "usr", max_tokens=50)

    assert "gemini-2.0-flash:generateContent" in captured["url"]
    assert "key=AIza-test" in captured["url"]
    assert captured["json"]["system_instruction"]["parts"][0]["text"] == "sys"


# ---------------------------------------------------------------------------
# _validate_user_base_url — guard anti-SSRF (casos de error de parseo)
# ---------------------------------------------------------------------------

def test_validate_base_url_rejects_non_http_scheme():
    with pytest.raises(LLMError, match="http o https"):
        _validate_user_base_url("ftp://example.com/x")


def test_validate_base_url_rejects_missing_host():
    # Una URL sin host (solo scheme) → "no tiene host".
    with pytest.raises(LLMError, match="no tiene host"):
        _validate_user_base_url("http://")


def test_validate_base_url_rejects_unresolvable_host(monkeypatch):
    import llm as llm_mod
    import socket

    def _raise(*a, **k):
        raise socket.gaierror("no resuelve")

    monkeypatch.setattr(llm_mod.socket, "getaddrinfo", _raise)
    with pytest.raises(LLMError, match="No se pudo resolver"):
        _validate_user_base_url("http://nonexistent.invalid:11434/api/chat")


def test_validate_base_url_accepts_public_host(monkeypatch):
    import llm as llm_mod
    monkeypatch.setattr(
        llm_mod.socket, "getaddrinfo",
        lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 11434))],
    )
    out = _validate_user_base_url("http://ollama.example.com:11434/api/chat")
    assert out == "http://ollama.example.com:11434/api/chat"


# ---------------------------------------------------------------------------
# get_chat_model — env-based y per-request
# ---------------------------------------------------------------------------

def test_get_chat_model_unknown_profile_raises(monkeypatch):
    monkeypatch.setenv("LLM_PROFILE", "deepseek")
    with pytest.raises(ValueError, match="Unknown LLM_PROFILE"):
        get_chat_model(tier="capable")


def test_get_chat_model_env_local(monkeypatch):
    monkeypatch.setenv("LLM_PROFILE", "local")
    sentinel = object()
    fake_module = MagicMock()
    fake_module.ChatOllama = MagicMock(return_value=sentinel)
    with patch.dict("sys.modules", {"langchain_ollama": fake_module}):
        model = get_chat_model(tier="fast")
    assert model is sentinel
    assert fake_module.ChatOllama.called


def test_get_chat_model_env_openai(monkeypatch):
    monkeypatch.setenv("LLM_PROFILE", "openai")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-x")
    sentinel = object()
    fake_module = MagicMock()
    fake_module.ChatOpenAI = MagicMock(return_value=sentinel)
    with patch.dict("sys.modules", {"langchain_openai": fake_module}):
        model = get_chat_model(tier="capable")
    assert model is sentinel


def test_get_chat_model_env_anthropic(monkeypatch):
    monkeypatch.setenv("LLM_PROFILE", "anthropic")
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-ant")
    sentinel = object()
    fake_module = MagicMock()
    fake_module.ChatAnthropic = MagicMock(return_value=sentinel)
    with patch.dict("sys.modules", {"langchain_anthropic": fake_module}):
        model = get_chat_model(tier="fast")
    assert model is sentinel


def test_get_chat_model_browser_transport_raises():
    cfg = LLMConfig(
        provider="ollama", transport="browser",
        model_fast="qwen3:1.7b", model_capable="qwen3:8b",
        proxy_session="sess",
    )
    with pytest.raises(NotImplementedError, match="browser"):
        get_chat_model(tier="capable", llm_config=cfg)


def test_get_chat_model_config_openai(monkeypatch):
    cfg = LLMConfig(
        provider="openai", transport="api",
        model_fast="gpt-4o-mini", model_capable="gpt-4o",
        api_key="sk-cfg",
    )
    sentinel = object()
    fake_module = MagicMock()
    fake_module.ChatOpenAI = MagicMock(return_value=sentinel)
    with patch.dict("sys.modules", {"langchain_openai": fake_module}):
        model = get_chat_model(tier="capable", llm_config=cfg)
    assert model is sentinel
    _, kwargs = fake_module.ChatOpenAI.call_args
    assert kwargs["model"] == "gpt-4o"


def test_get_chat_model_config_anthropic():
    cfg = LLMConfig(
        provider="anthropic", transport="api",
        model_fast="claude-haiku-4-5", model_capable="claude-sonnet-4-6",
        api_key="sk-ant-cfg",
    )
    sentinel = object()
    fake_module = MagicMock()
    fake_module.ChatAnthropic = MagicMock(return_value=sentinel)
    with patch.dict("sys.modules", {"langchain_anthropic": fake_module}):
        model = get_chat_model(tier="fast", llm_config=cfg)
    assert model is sentinel


def test_get_chat_model_config_ollama_with_base_url(monkeypatch):
    import llm as llm_mod
    monkeypatch.setattr(
        llm_mod.socket, "getaddrinfo",
        lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 11434))],
    )
    cfg = LLMConfig(
        provider="ollama", transport="direct",
        model_fast="qwen3:1.7b", model_capable="qwen3:8b",
        base_url="http://ollama.example.com:11434/api/chat",
    )
    sentinel = object()
    fake_module = MagicMock()
    fake_module.ChatOllama = MagicMock(return_value=sentinel)
    with patch.dict("sys.modules", {"langchain_ollama": fake_module}):
        model = get_chat_model(tier="capable", llm_config=cfg)
    assert model is sentinel
    _, kwargs = fake_module.ChatOllama.call_args
    # ChatOllama recibe la raíz, no el endpoint /api/chat.
    assert kwargs["base_url"] == "http://ollama.example.com:11434"


def test_get_chat_model_config_gemini():
    cfg = LLMConfig(
        provider="gemini", transport="api",
        model_fast="gemini-2.0-flash", model_capable="gemini-2.5-pro",
        api_key="AIza-cfg",
    )
    sentinel = object()
    fake_module = MagicMock()
    fake_module.ChatGoogleGenerativeAI = MagicMock(return_value=sentinel)
    with patch.dict("sys.modules", {"langchain_google_genai": fake_module}):
        model = get_chat_model(tier="capable", llm_config=cfg)
    assert model is sentinel


def test_get_chat_model_config_unknown_provider_raises():
    cfg = LLMConfig(
        provider="deepseek", transport="api",
        model_fast="ds-fast", model_capable="ds-capable",
    )
    with pytest.raises(ValueError, match="Proveedor desconocido"):
        get_chat_model(tier="capable", llm_config=cfg)
