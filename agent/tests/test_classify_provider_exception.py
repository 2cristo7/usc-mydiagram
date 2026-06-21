"""S10.x — Clasificación de excepciones del proveedor LLM en /refine.

El loop ReAct de /refine usa los chat models de LangChain (no los backends httpx de
llm.py), así que las excepciones llegan con los nombres/mensajes de los SDKs. Esta
función las mapea a mensajes accionables en español por categoría: auth (401/key),
cuota (429) y —añadido en este sprint— conexión/timeout (proveedor caído).
"""
from main import _classify_provider_exception


class _FakeStatusError(Exception):
    """Imita una excepción de SDK con status_code (p. ej. AuthenticationError)."""
    def __init__(self, status_code, message=""):
        super().__init__(message)
        self.status_code = status_code


def test_auth_401_returns_actionable_message():
    msg = _classify_provider_exception(_FakeStatusError(401), provider="openai")
    assert msg is not None
    assert "API key" in msg and "OpenAI" in msg


def test_rate_limit_429_returns_actionable_message():
    msg = _classify_provider_exception(_FakeStatusError(429), provider="anthropic")
    assert msg is not None
    assert "límite" in msg or "cuota" in msg


def test_connection_error_returns_connectivity_message():
    # Nombre de clase tipo APIConnectionError (LangChain/OpenAI) → mensaje de conexión.
    class APIConnectionError(Exception):
        pass
    msg = _classify_provider_exception(APIConnectionError("Connection refused"),
                                       provider="ollama")
    assert msg is not None
    assert "conectar" in msg.lower()


def test_timeout_error_returns_connectivity_message():
    class ReadTimeout(Exception):
        pass
    msg = _classify_provider_exception(ReadTimeout("Request timed out"),
                                       provider="gemini")
    assert msg is not None
    assert "conectar" in msg.lower() or "tardó" in msg.lower()


def test_unrelated_exception_returns_none():
    # Un error no reconocible del proveedor → None (el caller usa su genérico).
    msg = _classify_provider_exception(ValueError("algo raro"), provider="openai")
    assert msg is None
