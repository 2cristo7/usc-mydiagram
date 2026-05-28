import pytest
import httpx
from unittest.mock import patch, MagicMock, AsyncMock
from main import call_ollama


@pytest.mark.asyncio
async def test_normal_response():
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {"message": {"content": "respuesta del modelo"}}

    with patch('main.httpx.AsyncClient') as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
        result = await call_ollama("system prompt", "user prompt")

    assert result == "respuesta del modelo"


@pytest.mark.asyncio
async def test_http_error():
    mock_response = MagicMock()
    mock_response.raise_for_status.side_effect = httpx.HTTPStatusError(
        "Error", request=MagicMock(), response=MagicMock()
    )

    with patch('main.httpx.AsyncClient') as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
        with pytest.raises(httpx.HTTPStatusError):
            await call_ollama("system prompt", "user prompt")


@pytest.mark.asyncio
async def test_stripping_think():
    mock_response = MagicMock()
    mock_response.raise_for_status = MagicMock()
    mock_response.json.return_value = {
        "message": {"content": "<think>razonamiento interno</think>respuesta del modelo"}
    }

    with patch('main.httpx.AsyncClient') as mock_client:
        mock_client.return_value.__aenter__.return_value.post = AsyncMock(return_value=mock_response)
        result = await call_ollama("system prompt", "user prompt")

    assert result == "respuesta del modelo"
