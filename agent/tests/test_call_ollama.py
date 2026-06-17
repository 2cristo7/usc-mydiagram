import pytest
import httpx
from unittest.mock import patch, MagicMock, AsyncMock
from llm import OllamaBackend, LLMError

BACKEND = OllamaBackend(model="qwen3:8b", url="http://localhost:11434/api/chat")


@pytest.mark.asyncio
async def test_normal_response():
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {"message": {"content": "respuesta del modelo"}}

    with patch("llm.httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
        result = await BACKEND.complete("system prompt", "user prompt", max_tokens=100)

    assert result == "respuesta del modelo"


@pytest.mark.asyncio
async def test_http_error():
    mock_response = MagicMock()
    mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "Error", request=MagicMock(), response=MagicMock()
    )

    with patch("llm.httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
        with pytest.raises(LLMError):
            await BACKEND.complete("system prompt", "user prompt", max_tokens=100)


@pytest.mark.asyncio
async def test_stripping_think():
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {
        "message": {"content": "<think>razonamiento interno</think>respuesta del modelo"}
    }

    with patch("llm.httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
        result = await BACKEND.complete("system prompt", "user prompt", max_tokens=100)

    assert result == "respuesta del modelo"
