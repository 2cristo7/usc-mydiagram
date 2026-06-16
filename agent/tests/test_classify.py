"""S6.2 — Clasificación de tipo + título (`classify.py`).

classify hace DOS llamadas al LLM (tier fast): una para el `diagram_type` (debe
devolver un valor del enum) y otra para el `title`. Lo que se cubre:
- el tipo se normaliza (strip + lower) y se convierte a DiagramType;
- ante un tipo NO reconocido, degrada a 'erd' en vez de reventar (fallback);
- el título se devuelve tal cual (stripped).
El LLM se mockea con side_effect (primera llamada = tipo, segunda = título).

S10.3 — Desambiguación de tipo UML: cuando el LLM devuelve el centinela
`ambiguous_uml`, classify emite el evento `type_clarification` por la queue,
activa `needs_type_clarification=True` y NO asigna diagram_type ni title.
El grafo corta a END limpiamente; classify_outcome no emite done/error.
"""
import asyncio
import pytest
from unittest.mock import patch, AsyncMock

from nodes.classify import make_classify
from schemas import DiagramType


def _state(prompt="un diagrama de flujo para hacer café", diagram_type=None):
    return {"prompt": prompt, "diagram_type": diagram_type}


# ---------------------------------------------------------------------------
# Helper: instancia classify sin queue (tests que no necesitan el evento)
# ---------------------------------------------------------------------------
def _classify_no_queue():
    return make_classify(queue=None)


@pytest.mark.asyncio
async def test_classify_returns_type_and_title():
    mock = AsyncMock(side_effect=["flowchart", "Hacer Café"])
    with patch("nodes.classify.call_llm", new=mock):
        result = await _classify_no_queue()(_state())
    assert result["diagram_type"] == DiagramType.FLOWCHART
    assert result["title"] == "Hacer Café"


@pytest.mark.asyncio
async def test_classify_normalizes_type_casing_and_spaces():
    # El LLM puede devolver "  FLOWCHART\n"; debe resolverse al enum igualmente.
    mock = AsyncMock(side_effect=["  FLOWCHART\n", "Café"])
    with patch("nodes.classify.call_llm", new=mock):
        result = await _classify_no_queue()(_state())
    assert result["diagram_type"] == DiagramType.FLOWCHART


@pytest.mark.asyncio
async def test_classify_unknown_type_falls_back_to_erd():
    # Tipo fuera del enum → no se propaga un valor inválido ni se lanza: degrada a
    # 'erd' (fallar hacia un default usable, con log de aviso).
    mock = AsyncMock(side_effect=["banana", "Algo"])
    with patch("nodes.classify.call_llm", new=mock):
        result = await _classify_no_queue()(_state())
    assert result["diagram_type"] == DiagramType.ERD
    assert result["title"] == "Algo"


@pytest.mark.asyncio
async def test_classify_strips_title():
    mock = AsyncMock(side_effect=["erd", "  Mi Modelo  "])
    with patch("nodes.classify.call_llm", new=mock):
        result = await _classify_no_queue()(_state())
    assert result["title"] == "Mi Modelo"


@pytest.mark.asyncio
async def test_classify_uses_fast_tier_for_both_calls():
    mock = AsyncMock(side_effect=["erd", "T"])
    with patch("nodes.classify.call_llm", new=mock):
        await _classify_no_queue()(_state())
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
        result = await _classify_no_queue()(state)
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
        result = await _classify_no_queue()(state)
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
        result = await _classify_no_queue()(_state())
    assert result["diagram_type"] == DiagramType.FLOWCHART
    assert result["title"] == "Título"


@pytest.mark.asyncio
async def test_classify_none_preset_classifies_as_before():
    # diagram_type presente pero None = automático → mismo flujo que sin la clave.
    mock = AsyncMock(side_effect=["flowchart", "Café"])
    state = {"prompt": "hacer café", "diagram_type": None}
    with patch("nodes.classify.call_llm", new=mock):
        result = await _classify_no_queue()(state)
    assert result["diagram_type"] == DiagramType.FLOWCHART
    assert mock.await_count == 2


@pytest.mark.asyncio
async def test_classify_use_case_prompt_returns_use_case():
    # Un prompt orientado a casos de uso debe clasificarse como use_case.
    mock = AsyncMock(side_effect=["use_case", "Tienda Online — Casos de Uso"])
    state = {"prompt": "diagrama de casos de uso de una tienda online con actores Cliente y Administrador"}
    with patch("nodes.classify.call_llm", new=mock):
        result = await _classify_no_queue()(state)
    assert result["diagram_type"] == DiagramType.USE_CASE
    assert result["title"] == "Tienda Online — Casos de Uso"


@pytest.mark.asyncio
async def test_classify_use_case_is_valid_enum_value():
    # use_case está en el enum → no degrada a erd (verifica que el enum tiene el valor).
    mock = AsyncMock(side_effect=["use_case", "Título"])
    with patch("nodes.classify.call_llm", new=mock):
        result = await _classify_no_queue()({"prompt": "casos de uso de un sistema bancario"})
    assert result["diagram_type"] == DiagramType.USE_CASE
    assert result["diagram_type"].value == "use_case"


# ---------------------------------------------------------------------------
# S10.3 — Desambiguación de tipo UML
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_classify_generic_uml_prompt_emits_clarification_event():
    """Un prompt genérico UML hace que el LLM devuelva el centinela y classify
    emite el evento `type_clarification` por la queue (S10.3)."""
    queue: asyncio.Queue = asyncio.Queue()
    classify = make_classify(queue=queue)

    # El LLM devuelve el centinela; el título NO se usa (las dos llamadas corren
    # en paralelo y el gather devuelve ambas, pero solo usamos la del tipo).
    mock = AsyncMock(side_effect=["ambiguous_uml", "UML Diagram"])
    with patch("nodes.classify.call_llm", new=mock):
        result = await classify({"prompt": "hazme un diagrama UML", "diagram_type": None})

    # El flag debe activarse y NO debe haber diagram_type asignado.
    assert result.get("needs_type_clarification") is True
    assert "diagram_type" not in result
    assert "title" not in result

    # El evento de clarificación debe estar en la queue.
    assert not queue.empty()
    event = queue.get_nowait()
    assert event["_type"] == "type_clarification"
    assert event["question"] == "¿Qué tipo de diagrama UML quieres?"
    options_values = [o["value"] for o in event["options"]]
    assert "sequence" in options_values
    assert "use_case" in options_values


@pytest.mark.asyncio
async def test_classify_generic_uml_does_not_generate_nodes():
    """Cuando hay clarificación pendiente, needs_type_clarification=True hace que
    route_after_classify corte a END → no se generan nodos (S10.3)."""
    from graph import route_after_classify
    from langgraph.graph import END

    state_with_clarification = {
        "needs_type_clarification": True,
        "diagram_type": None,
    }
    assert route_after_classify(state_with_clarification) is END


@pytest.mark.asyncio
async def test_classify_explicit_sequence_prompt_does_not_trigger_clarification():
    """Un prompt que menciona explícitamente 'secuencia' no debe disparar la
    pregunta: el LLM devuelve 'sequence' directamente (S10.3)."""
    queue: asyncio.Queue = asyncio.Queue()
    classify = make_classify(queue=queue)

    mock = AsyncMock(side_effect=["sequence", "Sistema de Login"])
    with patch("nodes.classify.call_llm", new=mock):
        result = await classify({
            "prompt": "diagrama de secuencia del login de usuario",
            "diagram_type": None,
        })

    assert result.get("needs_type_clarification") is False
    assert result["diagram_type"] == DiagramType.SEQUENCE
    assert result["title"] == "Sistema de Login"
    # No debe haber evento en la queue.
    assert queue.empty()


@pytest.mark.asyncio
async def test_classify_explicit_use_case_prompt_does_not_trigger_clarification():
    """Un prompt que describe actores y casos de uso clasifica como use_case,
    sin preguntar (S10.3)."""
    queue: asyncio.Queue = asyncio.Queue()
    classify = make_classify(queue=queue)

    mock = AsyncMock(side_effect=["use_case", "Sistema Bancario"])
    with patch("nodes.classify.call_llm", new=mock):
        result = await classify({
            "prompt": "casos de uso de un banco con actores Cliente y Cajero",
            "diagram_type": None,
        })

    assert result.get("needs_type_clarification") is False
    assert result["diagram_type"] == DiagramType.USE_CASE
    assert queue.empty()


@pytest.mark.asyncio
async def test_classify_preset_type_never_triggers_clarification():
    """Con diagram_type preseleccionado, NUNCA se pregunta aunque el prompt sea
    genérico: el usuario ya eligió (S10.3, regla de preselección)."""
    queue: asyncio.Queue = asyncio.Queue()
    classify = make_classify(queue=queue)

    # Solo una llamada en el mock (la del título); si se llamara al clasificador
    # intentaría consumir una segunda entrada y daría StopAsyncIteration.
    mock = AsyncMock(side_effect=["Diagrama UML"])
    state = {"prompt": "hazme un diagrama UML", "diagram_type": DiagramType.SEQUENCE}
    with patch("nodes.classify.call_llm", new=mock):
        result = await classify(state)

    # Tipo respetado, sin pregunta, sin evento en queue.
    assert result["diagram_type"] == DiagramType.SEQUENCE
    assert result.get("needs_type_clarification") is False
    assert queue.empty()
    assert mock.await_count == 1  # solo el título


@pytest.mark.asyncio
async def test_classify_clarification_no_queue_does_not_crash():
    """Si queue es None (modo sin stream, como en tests unitarios), el centinela
    no debe lanzar excepción: simplemente no emite nada."""
    classify = make_classify(queue=None)

    mock = AsyncMock(side_effect=["ambiguous_uml", "UML Diagram"])
    with patch("nodes.classify.call_llm", new=mock):
        result = await classify({"prompt": "diagrama UML genérico", "diagram_type": None})

    assert result.get("needs_type_clarification") is True
    assert "diagram_type" not in result
