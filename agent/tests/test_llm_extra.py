"""Cobertura adicional de llm.py: Ollama.stream, _strip_think, ramas de error de
Ollama.complete y BrowserBackend, y call_llm/stream_llm en modo env-based (sin
runtime). Complementa test_call_ollama.py y test_llm_runtime.py.

Mockea httpx con patch + AsyncMock/MagicMock (sin respx, no instalado).
"""
import httpx
import pytest
from unittest.mock import patch, MagicMock, AsyncMock

from llm import (
    OllamaBackend, BrowserBackend, LLMError, _strip_think,
    call_llm, stream_llm,
)


def _http_status_error(status: int) -> httpx.HTTPStatusError:
    resp = MagicMock()
    resp.status_code = status
    return httpx.HTTPStatusError("err", request=MagicMock(), response=resp)


def _stream_cm(mock_response):
    cm = MagicMock()
    cm.__aenter__ = AsyncMock(return_value=mock_response)
    cm.__aexit__ = AsyncMock(return_value=False)
    return cm


OLLAMA = OllamaBackend(model="qwen3:8b", url="http://localhost:11434/api/chat")


# ---------------------------------------------------------------------------
# _strip_think — filtra <think>...</think> de un stream (incluso partido)
# ---------------------------------------------------------------------------

async def _gen(chunks):
    for c in chunks:
        yield c


@pytest.mark.asyncio
async def test_strip_think_removes_block():
    out = [c async for c in _strip_think(_gen(["<think>razono</think>respuesta"]))]
    assert "".join(out) == "respuesta"


@pytest.mark.asyncio
async def test_strip_think_no_block_passes_through():
    out = [c async for c in _strip_think(_gen(["hola ", "mundo"]))]
    assert "".join(out) == "hola mundo"


@pytest.mark.asyncio
async def test_strip_think_split_across_chunks():
    # El tag <think> llega partido entre dos chunks: el estado entre iteraciones
    # debe tolerarlo y aun así eliminar el bloque.
    chunks = ["antes <th", "ink>oculto</thi", "nk> despues"]
    out = [c async for c in _strip_think(_gen(chunks))]
    assert "".join(out).replace(" ", "") == "antesdespues"


# ---------------------------------------------------------------------------
# Ollama.complete — ramas de error que faltaban
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ollama_complete_http_status_error_message():
    resp = MagicMock()
    resp.raise_for_status.side_effect = _http_status_error(500)
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(return_value=resp)
        with pytest.raises(LLMError, match="HTTP 500"):
            await OLLAMA.complete("s", "u", max_tokens=10)


@pytest.mark.asyncio
async def test_ollama_complete_connect_error():
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(
            side_effect=httpx.ConnectError("x")
        )
        with pytest.raises(LLMError, match="ollama serve"):
            await OLLAMA.complete("s", "u", max_tokens=10)


@pytest.mark.asyncio
async def test_ollama_complete_timeout():
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(
            side_effect=httpx.TimeoutException("x")
        )
        with pytest.raises(LLMError, match="tardó demasiado"):
            await OLLAMA.complete("s", "u", max_tokens=10)


# ---------------------------------------------------------------------------
# Ollama.stream
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_ollama_stream_yields_content_and_drops_malformed():
    lines = [
        '{"message": {"content": "Hola"}}',
        "no-es-json",                              # malformada → descartada
        '{"message": {"content": " mundo"}}',
        "",                                         # vacía → ignorada
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
        chunks = [c async for c in OLLAMA.stream("s", "u", max_tokens=10)]

    assert "".join(chunks) == "Hola mundo"


@pytest.mark.asyncio
async def test_ollama_stream_strips_think():
    lines = [
        '{"message": {"content": "<think>razono</think>"}}',
        '{"message": {"content": "resultado"}}',
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
        chunks = [c async for c in OLLAMA.stream("s", "u", max_tokens=10)]

    assert "".join(chunks) == "resultado"


@pytest.mark.asyncio
async def test_ollama_stream_http_status_error():
    resp = MagicMock()
    resp.raise_for_status.side_effect = _http_status_error(502)
    with patch("llm.httpx.AsyncClient") as mc:
        client = mc.return_value.__aenter__.return_value
        client.stream = MagicMock(return_value=_stream_cm(resp))
        with pytest.raises(LLMError, match="HTTP 502"):
            _ = [c async for c in OLLAMA.stream("s", "u", max_tokens=10)]


@pytest.mark.asyncio
async def test_ollama_stream_connect_error():
    with patch("llm.httpx.AsyncClient") as mc:
        client = mc.return_value.__aenter__.return_value
        client.stream = MagicMock(side_effect=httpx.ConnectError("x"))
        with pytest.raises(LLMError, match="ollama serve"):
            _ = [c async for c in OLLAMA.stream("s", "u", max_tokens=10)]


@pytest.mark.asyncio
async def test_ollama_stream_timeout():
    with patch("llm.httpx.AsyncClient") as mc:
        client = mc.return_value.__aenter__.return_value
        client.stream = MagicMock(side_effect=httpx.TimeoutException("x"))
        with pytest.raises(LLMError, match="tardó demasiado"):
            _ = [c async for c in OLLAMA.stream("s", "u", max_tokens=10)]


@pytest.mark.asyncio
async def test_ollama_stream_generic_network_error():
    with patch("llm.httpx.AsyncClient") as mc:
        client = mc.return_value.__aenter__.return_value
        client.stream = MagicMock(side_effect=httpx.ReadError("reset"))
        with pytest.raises(LLMError, match="interrumpió la conexión"):
            _ = [c async for c in OLLAMA.stream("s", "u", max_tokens=10)]


# ---------------------------------------------------------------------------
# BrowserBackend — ramas restantes
# ---------------------------------------------------------------------------

BROWSER = BrowserBackend(model="qwen3:8b", proxy_session="sess")


@pytest.mark.asyncio
async def test_browser_complete_connect_error():
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(
            side_effect=httpx.ConnectError("x")
        )
        with pytest.raises(LLMError, match="No se pudo conectar"):
            await BROWSER.complete("s", "u", max_tokens=10)


@pytest.mark.asyncio
async def test_browser_complete_timeout():
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(
            side_effect=httpx.TimeoutException("x")
        )
        with pytest.raises(LLMError, match="tardó demasiado"):
            await BROWSER.complete("s", "u", max_tokens=10)


@pytest.mark.asyncio
async def test_browser_complete_generic_network_error():
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(
            side_effect=httpx.ReadError("reset")
        )
        with pytest.raises(LLMError, match="interrumpió la conexión"):
            await BROWSER.complete("s", "u", max_tokens=10)


@pytest.mark.asyncio
async def test_browser_complete_401_invalid_secret():
    resp = MagicMock()
    resp.status_code = 401
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(return_value=resp)
        with pytest.raises(LLMError, match="INTERNAL_PROXY_SECRET"):
            await BROWSER.complete("s", "u", max_tokens=10)


@pytest.mark.asyncio
async def test_browser_complete_502_without_json_body_uses_text():
    resp = MagicMock()
    resp.status_code = 502
    resp.json.side_effect = ValueError("no json")
    resp.text = "fallo crudo"
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(return_value=resp)
        with pytest.raises(LLMError, match="fallo crudo"):
            await BROWSER.complete("s", "u", max_tokens=10)


@pytest.mark.asyncio
async def test_browser_complete_unexpected_status_raises():
    # Un status inesperado (p. ej. 418) cae en raise_for_status → LLMError genérico.
    resp = MagicMock()
    resp.status_code = 418
    resp.raise_for_status.side_effect = _http_status_error(418)
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(return_value=resp)
        with pytest.raises(LLMError, match="HTTP 418"):
            await BROWSER.complete("s", "u", max_tokens=10)


@pytest.mark.asyncio
async def test_browser_complete_malformed_json_body():
    resp = MagicMock()
    resp.status_code = 200
    resp.raise_for_status = MagicMock()
    resp.json.side_effect = KeyError("content")
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(return_value=resp)
        with pytest.raises(LLMError, match="respuesta inesperada"):
            await BROWSER.complete("s", "u", max_tokens=10)


# ---------------------------------------------------------------------------
# call_llm / stream_llm en modo env-based (sin runtime)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_call_llm_env_based_uses_resolve_model(monkeypatch):
    monkeypatch.setenv("LLM_PROFILE", "local")
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json.return_value = {"message": {"content": "desde env"}}
    with patch("llm.httpx.AsyncClient") as mc:
        mc.return_value.__aenter__.return_value.post = AsyncMock(return_value=resp)
        result = await call_llm("s", "u", tier="fast")
    assert result == "desde env"


@pytest.mark.asyncio
async def test_stream_llm_env_based_yields_chunks(monkeypatch):
    monkeypatch.setenv("LLM_PROFILE", "local")
    lines = ['{"message": {"content": "uno"}}', '{"message": {"content": " dos"}}']

    async def _aiter_lines():
        for ln in lines:
            yield ln

    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.aiter_lines = _aiter_lines

    with patch("llm.httpx.AsyncClient") as mc:
        client = mc.return_value.__aenter__.return_value
        client.stream = MagicMock(return_value=_stream_cm(resp))
        chunks = [c async for c in stream_llm("s", "u", tier="fast")]

    assert "".join(chunks) == "uno dos"
