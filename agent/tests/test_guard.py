"""S6.1b — Guardia de intención (`guard.py`) + routing de corte temprano.

El guardia clasifica con un solo token (yes/no) si el prompt es una petición de
diagrama. La lógica a cubrir es la INTERPRETACIÓN de la respuesta del LLM (parsing
permisivo: strip + lower + startswith "yes") y el routing posterior
(route_after_guard): True → classify, False → END (corte sin gastar el resto del
pipeline). El LLM se mockea; aquí no se prueba el modelo, sino cómo el nodo lee su
respuesta y cómo el grafo decide a partir de ella.
"""
import pytest
from unittest.mock import patch, AsyncMock
from langgraph.graph import END

from nodes.guard import guard
from graph import route_after_guard


def _state(prompt="describe un proceso de login"):
    return {"prompt": prompt, "is_diagram_request": False}


@pytest.mark.parametrize(
    "reply, expected",
    [
        ("yes", True),
        ("Yes", True),
        ("  YES  ", True),            # se normaliza con strip + lower
        ("Yes, it is a process.", True),  # startswith "yes" tras normalizar
        ("no", False),
        ("No, it's just prose.", False),
        ("maybe", False),            # cualquier cosa que no empiece por "yes" → no
        ("", False),
    ],
)
@pytest.mark.asyncio
async def test_guard_parses_llm_reply(reply, expected):
    with patch("nodes.guard.call_llm", new=AsyncMock(return_value=reply)):
        result = await guard(_state())
    assert result["is_diagram_request"] is expected


@pytest.mark.asyncio
async def test_guard_uses_fast_tier():
    # El guardia es un corte barato: debe usar el tier rápido, no el caro.
    mock = AsyncMock(return_value="yes")
    with patch("nodes.guard.call_llm", new=mock):
        await guard(_state())
    assert mock.await_args.kwargs["tier"] == "fast"


def test_route_after_guard_accepts():
    assert route_after_guard({"is_diagram_request": True}) == "classify"


def test_route_after_guard_rejects_to_end():
    # Rechazo → END: el grafo no ejecuta classify ni la extracción (corte temprano).
    assert route_after_guard({"is_diagram_request": False}) == END
