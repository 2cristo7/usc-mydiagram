"""S6.2 — Clasificación de tipo + título (`classify.py`).

classify hace DOS llamadas al LLM (tier fast): una para el `diagram_type` (debe
devolver un valor del enum) y otra para el `title`. Lo que se cubre:
- el tipo se normaliza (strip + lower) y se convierte a DiagramType;
- ante un tipo NO reconocido, degrada a 'erd' en vez de reventar (fallback);
- el título se devuelve tal cual (stripped).
El LLM se mockea con side_effect (primera llamada = tipo, segunda = título).
"""
import pytest
from unittest.mock import patch, AsyncMock

from nodes.classify import classify
from schemas import DiagramType


def _state(prompt="un diagrama de flujo para hacer café"):
    return {"prompt": prompt}


@pytest.mark.asyncio
async def test_classify_returns_type_and_title():
    mock = AsyncMock(side_effect=["flowchart", "Hacer Café"])
    with patch("nodes.classify.call_llm", new=mock):
        result = await classify(_state())
    assert result["diagram_type"] == DiagramType.FLOWCHART
    assert result["title"] == "Hacer Café"


@pytest.mark.asyncio
async def test_classify_normalizes_type_casing_and_spaces():
    # El LLM puede devolver "  FLOWCHART\n"; debe resolverse al enum igualmente.
    mock = AsyncMock(side_effect=["  FLOWCHART\n", "Café"])
    with patch("nodes.classify.call_llm", new=mock):
        result = await classify(_state())
    assert result["diagram_type"] == DiagramType.FLOWCHART


@pytest.mark.asyncio
async def test_classify_unknown_type_falls_back_to_erd():
    # Tipo fuera del enum → no se propaga un valor inválido ni se lanza: degrada a
    # 'erd' (fallar hacia un default usable, con log de aviso).
    mock = AsyncMock(side_effect=["banana", "Algo"])
    with patch("nodes.classify.call_llm", new=mock):
        result = await classify(_state())
    assert result["diagram_type"] == DiagramType.ERD
    assert result["title"] == "Algo"


@pytest.mark.asyncio
async def test_classify_strips_title():
    mock = AsyncMock(side_effect=["erd", "  Mi Modelo  "])
    with patch("nodes.classify.call_llm", new=mock):
        result = await classify(_state())
    assert result["title"] == "Mi Modelo"


@pytest.mark.asyncio
async def test_classify_uses_fast_tier_for_both_calls():
    mock = AsyncMock(side_effect=["erd", "T"])
    with patch("nodes.classify.call_llm", new=mock):
        await classify(_state())
    assert all(c.kwargs["tier"] == "fast" for c in mock.await_args_list)
