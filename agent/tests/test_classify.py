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


# S10.2 — Tipo preseleccionado por el usuario en la UI: viaja en el estado ya
# como DiagramType. classify debe RESPETARLO y saltarse la llamada LLM de
# clasificación de tipo, haciendo SOLO la del título.
@pytest.mark.asyncio
async def test_classify_respects_preset_type_and_skips_type_call():
    # Una sola entrada en side_effect: si classify intentara clasificar el tipo
    # haría una segunda llamada y agotaría el mock (StopAsyncIteration).
    mock = AsyncMock(side_effect=["Mi Modelo"])
    state = {"prompt": "lo que sea", "diagram_type": DiagramType.SEQUENCE}
    with patch("nodes.classify.call_llm", new=mock):
        result = await classify(state)
    assert result["diagram_type"] == DiagramType.SEQUENCE
    assert result["title"] == "Mi Modelo"
    # Exactamente UNA llamada (la del título): la de tipo se saltó.
    assert mock.await_count == 1


@pytest.mark.asyncio
async def test_classify_preset_type_does_not_classify_even_for_weird_prompt():
    # El prompt no parece de ese tipo, pero el usuario manda: no se reclasifica.
    mock = AsyncMock(side_effect=["Título"])
    state = {"prompt": "una tabla de usuarios y pedidos", "diagram_type": DiagramType.MINDMAP}
    with patch("nodes.classify.call_llm", new=mock):
        result = await classify(state)
    assert result["diagram_type"] == DiagramType.MINDMAP
    assert mock.await_count == 1


@pytest.mark.asyncio
async def test_classify_runs_type_and_title_concurrently():
    # S10.2 — en modo automático las dos llamadas (tipo y título) corren EN
    # PARALELO (asyncio.gather), no en secuencia. Se fuerza el solapamiento: la
    # llamada de TIPO se bloquea hasta que la de TÍTULO haya empezado. Si fueran
    # secuenciales (tipo entero antes que título), el evento nunca se activaría y
    # el wait_for daría timeout → este test rompe. Es la red de seguridad de la
    # optimización frente a un futuro revert a `await` secuencial.
    import asyncio

    title_started = asyncio.Event()

    async def fake_call_llm(*, system, **_):
        if "Reply with exactly one of these values" in system:  # llamada de tipo
            await asyncio.wait_for(title_started.wait(), timeout=1.0)
            return "flowchart"
        title_started.set()  # llamada de título
        return "Título"

    with patch("nodes.classify.call_llm", new=fake_call_llm):
        result = await classify(_state())
    assert result["diagram_type"] == DiagramType.FLOWCHART
    assert result["title"] == "Título"


@pytest.mark.asyncio
async def test_classify_none_preset_classifies_as_before():
    # diagram_type presente pero None = automático → mismo flujo que sin la clave.
    mock = AsyncMock(side_effect=["flowchart", "Café"])
    state = {"prompt": "hacer café", "diagram_type": None}
    with patch("nodes.classify.call_llm", new=mock):
        result = await classify(state)
    assert result["diagram_type"] == DiagramType.FLOWCHART
    assert mock.await_count == 2
