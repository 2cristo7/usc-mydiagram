"""Endpoints FastAPI de main.py (S6/S7/S10).

Cubre lo que faltaba en test_agent_graph.py (que ya ejerce /refine):
- /health;
- /generate/stream: éxito (done), guard-reject (not_a_diagram), LLMError
  (llm_error con provider) y crash interno (internal_error), mockeando el grafo;
- helpers de módulo: _build_runtime (None y con config) y _forget_thread
  (best-effort sin checkpointer, con checkpointer que borra, y que traga errores);
- /refine error paths del wrapper _refine_response: NotImplementedError y LLMError
  (a través de _run_refine_agent mockeado), más /refine/resume 404 (thread expirado).

El grafo se mockea sustituyendo main.build_graph por uno falso cuyo `ainvoke`
devuelve un estado controlado; el TestClient consume el StreamingResponse NDJSON.
"""
import json

import pytest
from unittest.mock import patch, AsyncMock, MagicMock
from fastapi.testclient import TestClient

import main
from llm import LLMConfig, LLMError, LLMRuntime
from schemas import DiagramSchema, DiagramNode, DiagramType, NodeType


def _events(resp) -> list[dict]:
    return [json.loads(line) for line in resp.text.strip().splitlines()]


@pytest.fixture(autouse=True)
def _isolate_module_state():
    main._pending_clarifications.clear()
    main._checkpointer = None
    yield
    main._pending_clarifications.clear()
    main._checkpointer = None


# ---------------------------------------------------------------------------
# /health
# ---------------------------------------------------------------------------

def test_health_ok():
    resp = TestClient(main.app).get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "service": "agent"}


# ---------------------------------------------------------------------------
# /generate/stream
# ---------------------------------------------------------------------------

def _diagram_state():
    diagram = DiagramSchema(
        title="Mi Diagrama", diagram_type=DiagramType.FLOWCHART,
        nodes=[DiagramNode(id="a", label="A", node_type=NodeType.STEP, attributes=[])],
        edges=[],
    )
    return {
        "is_diagram_request": True,
        "needs_type_clarification": False,
        "diagram": diagram,
        "degradations": [],
    }


def _fake_graph(ainvoke_result=None, ainvoke_exc=None):
    graph = MagicMock()
    if ainvoke_exc is not None:
        graph.ainvoke = AsyncMock(side_effect=ainvoke_exc)
    else:
        graph.ainvoke = AsyncMock(return_value=ainvoke_result)
    return graph


def test_generate_stream_success_emits_done():
    graph = _fake_graph(ainvoke_result=_diagram_state())
    with patch("main.build_graph", return_value=graph):
        resp = TestClient(main.app).post("/generate/stream", json={"prompt": "haz un flujo"})
    assert resp.status_code == 200
    last = _events(resp)[-1]
    assert last["_type"] == "done"
    assert last["title"] == "Mi Diagrama"
    assert last["diagram"]["diagram_type"] == "flowchart"


def test_generate_stream_guard_reject_is_not_a_diagram():
    state = {"is_diagram_request": False}
    graph = _fake_graph(ainvoke_result=state)
    with patch("main.build_graph", return_value=graph):
        resp = TestClient(main.app).post("/generate/stream", json={"prompt": "hola"})
    last = _events(resp)[-1]
    assert last["_type"] == "error"
    assert last["category"] == "not_a_diagram"


def test_generate_stream_llm_error_emits_llm_error_with_provider():
    graph = _fake_graph(ainvoke_exc=LLMError("la key no vale"))
    cfg = {
        "provider": "openai", "transport": "api",
        "model_fast": "gpt-4o-mini", "model_capable": "gpt-4o",
        "api_key": "sk-x",
    }
    with patch("main.build_graph", return_value=graph):
        resp = TestClient(main.app).post(
            "/generate/stream", json={"prompt": "x", "llm_config": cfg},
        )
    last = _events(resp)[-1]
    assert last["_type"] == "error"
    assert last["category"] == "llm_error"
    assert last["message"] == "la key no vale"
    assert last["provider"] == "openai"


def test_generate_stream_crash_is_internal_error():
    graph = _fake_graph(ainvoke_exc=RuntimeError("boom"))
    with patch("main.build_graph", return_value=graph):
        resp = TestClient(main.app).post("/generate/stream", json={"prompt": "x"})
    last = _events(resp)[-1]
    assert last["_type"] == "error"
    assert last["category"] == "internal_error"


def test_generate_stream_type_clarification_emits_no_terminal_event():
    # S10.3 — needs_type_clarification → classify_outcome devuelve None → main.py NO
    # añade ningún evento terminal (done/error). El evento de clarificación lo
    # emitiría classify por la queue; aquí el grafo falso no emite nada, así que el
    # stream queda sin líneas.
    state = {"is_diagram_request": True, "needs_type_clarification": True, "diagram": None}
    graph = _fake_graph(ainvoke_result=state)
    with patch("main.build_graph", return_value=graph):
        resp = TestClient(main.app).post("/generate/stream", json={"prompt": "diagrama UML"})
    assert resp.status_code == 200
    assert resp.text.strip() == ""


# ---------------------------------------------------------------------------
# _build_runtime
# ---------------------------------------------------------------------------

def test_build_runtime_none_returns_none():
    assert main._build_runtime(None) is None


def test_build_runtime_with_config_returns_runtime():
    cfg = LLMConfig(
        provider="openai", transport="api",
        model_fast="gpt-4o-mini", model_capable="gpt-4o", api_key="sk",
    )
    rt = main._build_runtime(cfg)
    assert isinstance(rt, LLMRuntime)


# ---------------------------------------------------------------------------
# _forget_thread (best-effort)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_forget_thread_without_checkpointer_is_noop():
    main._checkpointer = None
    await main._forget_thread("t1")  # no raise


@pytest.mark.asyncio
async def test_forget_thread_calls_adelete_thread():
    cp = MagicMock()
    cp.adelete_thread = AsyncMock()
    main._checkpointer = cp
    await main._forget_thread("t1")
    cp.adelete_thread.assert_awaited_once_with("t1")


@pytest.mark.asyncio
async def test_forget_thread_without_deleter_is_noop():
    # Un checkpointer que NO expone adelete_thread se ignora (best-effort).
    cp = object()
    main._checkpointer = cp
    await main._forget_thread("t1")  # no raise


@pytest.mark.asyncio
async def test_forget_thread_swallows_deleter_errors():
    cp = MagicMock()
    cp.adelete_thread = AsyncMock(side_effect=RuntimeError("falló al borrar"))
    main._checkpointer = cp
    await main._forget_thread("t1")  # no raise: la limpieza nunca rompe la respuesta


# ---------------------------------------------------------------------------
# /refine error paths del wrapper _refine_response
# ---------------------------------------------------------------------------

def _erd_refine_body():
    return {
        "prompt": "añade una tabla",
        "diagram": {
            "diagram_type": "erd",
            "nodes": [{"id": "u", "label": "U", "node_type": "table", "attributes": []}],
            "edges": [],
        },
    }


def test_refine_stream_not_implemented_emits_internal_error():
    async def _boom(*a, **k):
        raise NotImplementedError("transport browser no soportado")
        yield  # pragma: no cover — hace de esto un generador async

    with patch("main._run_refine_agent", _boom):
        resp = TestClient(main.app).post("/refine/stream", json=_erd_refine_body())
    last = _events(resp)[-1]
    assert last["_type"] == "error"
    assert last["category"] == "internal_error"
    assert "browser" in last["message"]


def test_refine_stream_llm_error_emits_llm_error():
    async def _boom(*a, **k):
        raise LLMError("modelo caído")
        yield  # pragma: no cover

    with patch("main._run_refine_agent", _boom):
        resp = TestClient(main.app).post("/refine/stream", json=_erd_refine_body())
    last = _events(resp)[-1]
    assert last["_type"] == "error"
    assert last["category"] == "llm_error"
    assert last["message"] == "modelo caído"


def test_refine_stream_generic_error_is_internal_error():
    async def _boom(*a, **k):
        raise RuntimeError("algo raro")
        yield  # pragma: no cover

    with patch("main._run_refine_agent", _boom):
        resp = TestClient(main.app).post("/refine/stream", json=_erd_refine_body())
    last = _events(resp)[-1]
    assert last["_type"] == "error"
    assert last["category"] == "internal_error"


def test_refine_resume_unknown_thread_is_404():
    resp = TestClient(main.app).post(
        "/refine/resume", json={"thread_id": "no-existe", "answer": "sí"},
    )
    assert resp.status_code == 404
