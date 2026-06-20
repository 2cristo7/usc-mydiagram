"""Tests para LLMConfig → LLMRuntime (resolución per-request) y BrowserBackend.

Cubre:
- Resolución de LLMConfig a los backends correctos (ollama, openai, anthropic, gemini)
- Fallback a env-based cuando llm_config es None
- BrowserBackend: complete OK (200), y errores 409/502/504
- stream_llm y call_llm con runtime= respetan el runtime en vez del env
"""
import pytest
import httpx
from unittest.mock import patch, MagicMock, AsyncMock

from llm import (
    LLMConfig, LLMRuntime, LLMError,
    OllamaBackend, OpenAIBackend, AnthropicBackend, GeminiBackend, BrowserBackend,
    call_llm, stream_llm,
)


# ---------------------------------------------------------------------------
# LLMConfig → LLMRuntime._backend_for (resolución de backends)
# ---------------------------------------------------------------------------

def test_runtime_none_config_falls_back_to_env(monkeypatch):
    """Sin config, LLMRuntime delega a _resolve_model (env-based)."""
    monkeypatch.setenv("LLM_PROFILE", "local")
    runtime = LLMRuntime(config=None)
    backend = runtime._backend_for("capable")
    assert isinstance(backend, OllamaBackend)


def test_runtime_openai_config_picks_openai_backend():
    cfg = LLMConfig(
        provider="openai",
        transport="api",
        model_fast="gpt-4o-mini",
        model_capable="gpt-4o",
        api_key="sk-test",
    )
    runtime = LLMRuntime(config=cfg)
    fast = runtime._backend_for("fast")
    capable = runtime._backend_for("capable")
    assert isinstance(fast, OpenAIBackend)
    assert fast.model == "gpt-4o-mini"
    assert isinstance(capable, OpenAIBackend)
    assert capable.model == "gpt-4o"
    assert fast.api_key == "sk-test"


def test_runtime_anthropic_config_picks_anthropic_backend():
    cfg = LLMConfig(
        provider="anthropic",
        transport="api",
        model_fast="claude-haiku-4-5",
        model_capable="claude-sonnet-4-6",
        api_key="sk-ant-test",
    )
    runtime = LLMRuntime(config=cfg)
    backend = runtime._backend_for("capable")
    assert isinstance(backend, AnthropicBackend)
    assert backend.model == "claude-sonnet-4-6"
    assert backend.api_key == "sk-ant-test"


def test_runtime_gemini_config_picks_gemini_backend():
    cfg = LLMConfig(
        provider="gemini",
        transport="api",
        model_fast="gemini-2.0-flash",
        model_capable="gemini-2.5-pro",
        api_key="AIza-test",
    )
    runtime = LLMRuntime(config=cfg)
    backend = runtime._backend_for("fast")
    assert isinstance(backend, GeminiBackend)
    assert backend.model == "gemini-2.0-flash"
    assert backend.api_key == "AIza-test"


def test_runtime_ollama_direct_accepts_public_base_url(monkeypatch):
    """Una base_url pública válida selecciona OllamaBackend (DNS mockeado para no
    depender de la red en tests)."""
    import llm as llm_mod
    monkeypatch.setattr(
        llm_mod.socket, "getaddrinfo",
        lambda *a, **k: [(2, 1, 6, "", ("93.184.216.34", 11434))],
    )
    cfg = LLMConfig(
        provider="ollama",
        transport="direct",
        model_fast="qwen3:1.7b",
        model_capable="qwen3:8b",
        base_url="http://ollama.example.com:11434/api/chat",
    )
    runtime = LLMRuntime(config=cfg)
    backend = runtime._backend_for("capable")
    assert isinstance(backend, OllamaBackend)
    assert backend.model == "qwen3:8b"
    assert backend.url == "http://ollama.example.com:11434/api/chat"


def test_runtime_ollama_direct_rejects_internal_base_url():
    """Mitigación SSRF: una base_url de usuario hacia un host interno (loopback,
    privada, link-local…) se rechaza con LLMError antes de construir el backend."""
    for bad in (
        "http://localhost:11434/api/chat",
        "http://127.0.0.1:11434/api/chat",
        "http://169.254.169.254/latest/meta-data/",
        "http://10.0.0.5:11434/api/chat",
        "file:///etc/passwd",
    ):
        cfg = LLMConfig(
            provider="ollama",
            transport="direct",
            model_fast="qwen3:1.7b",
            model_capable="qwen3:8b",
            base_url=bad,
        )
        runtime = LLMRuntime(config=cfg)
        with pytest.raises(LLMError):
            runtime._backend_for("capable")


def test_runtime_ollama_browser_picks_browser_backend():
    cfg = LLMConfig(
        provider="ollama",
        transport="browser",
        model_fast="qwen3:1.7b",
        model_capable="qwen3:8b",
        proxy_session="sess-abc123",
    )
    runtime = LLMRuntime(config=cfg)
    backend = runtime._backend_for("fast")
    assert isinstance(backend, BrowserBackend)
    assert backend.model == "qwen3:1.7b"
    assert backend.proxy_session == "sess-abc123"


def test_runtime_browser_without_proxy_session_raises():
    cfg = LLMConfig(
        provider="ollama",
        transport="browser",
        model_fast="qwen3:1.7b",
        model_capable="qwen3:8b",
        proxy_session=None,  # falta
    )
    runtime = LLMRuntime(config=cfg)
    with pytest.raises(ValueError, match="proxy_session"):
        runtime._backend_for("fast")


def test_runtime_unknown_provider_raises():
    cfg = LLMConfig(
        provider="deepseek",
        transport="api",
        model_fast="ds-fast",
        model_capable="ds-capable",
    )
    runtime = LLMRuntime(config=cfg)
    with pytest.raises(ValueError, match="Proveedor desconocido"):
        runtime._backend_for("capable")


# ---------------------------------------------------------------------------
# call_llm / stream_llm con runtime= respetan el runtime
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_call_llm_with_runtime_uses_runtime():
    """call_llm(runtime=...) delega al runtime, no a _resolve_model."""
    cfg = LLMConfig(
        provider="openai", transport="api",
        model_fast="gpt-4o-mini", model_capable="gpt-4o",
        api_key="sk-test",
    )
    runtime = LLMRuntime(config=cfg)

    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {"choices": [{"message": {"content": "respuesta"}}]}
    with patch("llm.httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
        result = await call_llm("system", "user", tier="capable", runtime=runtime)
    assert result == "respuesta"


@pytest.mark.asyncio
async def test_stream_llm_with_runtime_uses_runtime():
    """stream_llm(runtime=...) delega al runtime y emite chunks."""
    cfg = LLMConfig(
        provider="openai", transport="api",
        model_fast="gpt-4o-mini", model_capable="gpt-4o",
        api_key="sk-test",
    )
    runtime = LLMRuntime(config=cfg)

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
        chunks = [c async for c in stream_llm("system", "user", tier="capable", runtime=runtime)]

    assert "".join(chunks) == "Hola mundo"


# ---------------------------------------------------------------------------
# BrowserBackend
# ---------------------------------------------------------------------------

def _make_browser():
    return BrowserBackend(model="qwen3:8b", proxy_session="sess-abc")


@pytest.mark.asyncio
async def test_browser_complete_200_returns_content():
    """200 → devuelve el campo 'content' de la respuesta."""
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {"content": "hola desde browser"}

    with patch("llm.httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
        result = await _make_browser().complete("system", "user", max_tokens=100)

    assert result == "hola desde browser"


@pytest.mark.asyncio
async def test_browser_complete_409_raises_browser_disconnected():
    """409 → RuntimeError con mensaje de browser_disconnected."""
    mock_response = MagicMock()
    mock_response.status_code = 409

    with patch("llm.httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
        with pytest.raises(LLMError, match="browser_disconnected"):
            await _make_browser().complete("system", "user", max_tokens=100)


@pytest.mark.asyncio
async def test_browser_complete_504_raises_timeout():
    """504 → RuntimeError con mensaje de timeout."""
    mock_response = MagicMock()
    mock_response.status_code = 504

    with patch("llm.httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
        with pytest.raises(LLMError, match="timeout"):
            await _make_browser().complete("system", "user", max_tokens=100)


@pytest.mark.asyncio
async def test_browser_complete_502_raises_with_detail():
    """502 → RuntimeError con el detail del cuerpo JSON."""
    mock_response = MagicMock()
    mock_response.status_code = 502
    mock_response.json.return_value = {"detail": "upstream error"}

    with patch("llm.httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
        with pytest.raises(LLMError, match="upstream error"):
            await _make_browser().complete("system", "user", max_tokens=100)


@pytest.mark.asyncio
async def test_browser_stream_yields_single_chunk():
    """stream() llama a complete() y devuelve el texto en un único chunk."""
    browser = _make_browser()
    with patch.object(browser, "complete", new=AsyncMock(return_value="texto completo")):
        chunks = [c async for c in browser.stream("system", "user", max_tokens=100)]
    assert chunks == ["texto completo"]


@pytest.mark.asyncio
async def test_browser_sends_correct_payload_and_headers(monkeypatch):
    """Verifica que el payload y la cabecera X-Internal-Token se envíen correctamente."""
    monkeypatch.setenv("INTERNAL_PROXY_SECRET", "mi-secreto")
    monkeypatch.setenv("GATEWAY_INTERNAL_URL", "http://gateway:3001")

    browser = BrowserBackend(model="qwen3:8b", proxy_session="sess-xyz")

    captured_payload = {}
    captured_headers = {}

    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {"content": "ok"}

    async def fake_post(url, json=None, headers=None):
        captured_payload.update(json or {})
        captured_headers.update(headers or {})
        return mock_response

    with patch("llm.httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.post = fake_post
        await browser.complete("mi system", "mi user", max_tokens=50)

    assert captured_payload["proxy_session"] == "sess-xyz"
    assert captured_payload["model"] == "qwen3:8b"
    assert captured_payload["options"]["num_predict"] == 50
    assert any(m["role"] == "system" for m in captured_payload["messages"])
    assert captured_headers.get("X-Internal-Token") == "mi-secreto"


# ---------------------------------------------------------------------------
# AnthropicBackend
# ---------------------------------------------------------------------------

ANTHROPIC = AnthropicBackend(model="claude-haiku-4-5", api_key="sk-ant-test")


@pytest.mark.asyncio
async def test_anthropic_complete_returns_content():
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {"content": [{"text": "respuesta anthropic"}]}
    with patch("llm.httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
        result = await ANTHROPIC.complete("system", "user", max_tokens=50)
    assert result == "respuesta anthropic"


@pytest.mark.asyncio
async def test_anthropic_stream_yields_single_chunk():
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {"content": [{"text": "chunk único"}]}
    with patch("llm.httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
        chunks = [c async for c in ANTHROPIC.stream("system", "user", max_tokens=50)]
    assert chunks == ["chunk único"]


# ---------------------------------------------------------------------------
# GeminiBackend
# ---------------------------------------------------------------------------

GEMINI = GeminiBackend(model="gemini-2.0-flash", api_key="AIza-test")


@pytest.mark.asyncio
async def test_gemini_complete_returns_content():
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {
        "candidates": [{"content": {"parts": [{"text": "respuesta gemini"}]}}]
    }
    with patch("llm.httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
        result = await GEMINI.complete("system", "user", max_tokens=50)
    assert result == "respuesta gemini"


@pytest.mark.asyncio
async def test_gemini_stream_yields_single_chunk():
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {
        "candidates": [{"content": {"parts": [{"text": "chunk gemini"}]}}]
    }
    with patch("llm.httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
        chunks = [c async for c in GEMINI.stream("system", "user", max_tokens=50)]
    assert chunks == ["chunk gemini"]
