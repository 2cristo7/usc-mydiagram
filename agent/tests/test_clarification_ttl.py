"""TTL de clarificaciones abandonadas (S10.3).

Una clarificación que el usuario nunca responde (cierra la pestaña, abandona) debe
caducar y purgarse para que ni el dict en memoria ni los threads del checkpointer
crezcan sin cota. El barrido es perezoso (se ejecuta al registrar/reanudar), así que
estos tests lo invocan directamente sobre el estado del módulo.
"""

import time

import pytest

import main


@pytest.fixture(autouse=True)
def _clean_pending():
    """Aísla el estado global de módulo entre tests.

    `_pending_clarifications` es un dict de proceso y `_checkpointer` es un
    singleton perezoso que OTROS tests de la suite (los endpoints /refine de
    test_agent_graph.py) inicializan al llamar a `_get_checkpointer`. Ese
    InMemorySaver persiste en el módulo y contamina
    `test_forget_thread_is_best_effort_without_checkpointer`, que asume el caso de
    un proceso que nunca corrió /refine (checkpointer en None). Reseteamos ambos
    antes y después para que el test pase tanto en aislamiento como en la suite."""
    main._pending_clarifications.clear()
    main._checkpointer = None
    yield
    main._pending_clarifications.clear()
    main._checkpointer = None


@pytest.mark.asyncio
async def test_sweep_purges_expired_keeps_fresh():
    now = time.monotonic()
    # Una caducada (deadline en el pasado) y una viva (deadline lejano).
    main._pending_clarifications["expired"] = (object(), now - 1)
    main._pending_clarifications["fresh"] = (object(), now + 1000)

    await main._sweep_expired_clarifications()

    assert "expired" not in main._pending_clarifications
    assert "fresh" in main._pending_clarifications


@pytest.mark.asyncio
async def test_sweep_noop_when_all_fresh():
    now = time.monotonic()
    main._pending_clarifications["a"] = (object(), now + 1000)
    main._pending_clarifications["b"] = (object(), now + 1000)

    await main._sweep_expired_clarifications()

    assert set(main._pending_clarifications) == {"a", "b"}


@pytest.mark.asyncio
async def test_forget_thread_is_best_effort_without_checkpointer():
    # Sin checkpointer inicializado (caso de un proceso que nunca corrió /refine)
    # no debe lanzar: la purga es best-effort.
    assert main._checkpointer is None
    await main._forget_thread("whatever")  # no raise
