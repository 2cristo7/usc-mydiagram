"""S10.4 — extract_fragments: tercera pasada EXCLUSIVA de secuencia que agrupa
mensajes en fragmentos combinados (alt/opt/loop/par).

Espeja test_classify/test_retry_loop: el LLM se mockea sustituyendo stream_llm por
un generador async (_fake_stream). Cubre:
- no-op para tipos que no son secuencia y para secuencia sin aristas;
- salida bien formada (un fragmento alt válido);
- salida envuelta en prosa / vallas ```json que JsonArrayStream + ijson toleran;
- salida vacía (sin array) → fragments=[];
- fragmento referencialmente inválido (mensaje inexistente) → se descarta;
- respuesta truncada (array sin cerrar) → degradación 'structure'.
"""
import json

import pytest
from unittest.mock import patch

from nodes.extract_fragments import make_extract_fragments
from schemas import DiagramType, DiagramEdge, EdgeType


def _edge(id_, source="A", target="B", label="msg"):
    return DiagramEdge(id=id_, source=source, target=target, label=label,
                       edge_type=EdgeType.SEQUENCE)


def _state(edges=None, diagram_type=DiagramType.SEQUENCE):
    return {
        "prompt": "diagrama de secuencia de un login",
        "diagram_type": diagram_type,
        "edges": edges if edges is not None else [],
    }


async def _fake_stream(text):
    """Imita stream_llm: async generator que entrega el texto en dos trozos."""
    mid = len(text) // 2
    for chunk in (text[:mid], text[mid:]):
        yield chunk


# ---------------------------------------------------------------------------
# No-op: tipo distinto de secuencia o sin aristas
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_non_sequence_is_noop():
    # Para cualquier tipo que no sea secuencia no llama al LLM y devuelve [].
    result = await make_extract_fragments()(_state(
        edges=[_edge("e1")], diagram_type=DiagramType.ERD,
    ))
    assert result == {"fragments": []}


@pytest.mark.asyncio
async def test_sequence_without_edges_is_noop():
    result = await make_extract_fragments()(_state(edges=[]))
    assert result == {"fragments": []}


# ---------------------------------------------------------------------------
# Salida bien formada
# ---------------------------------------------------------------------------

def _alt_fragment(fid="f1", a="e1", b="e2"):
    return {
        "id": fid,
        "kind": "alt",
        "operands": [
            {"guard": "[ok]", "message_ids": [a], "child_fragment_ids": []},
            {"guard": "[else]", "message_ids": [b], "child_fragment_ids": []},
        ],
    }


@pytest.mark.asyncio
async def test_well_formed_alt_fragment_is_parsed():
    raw = json.dumps([_alt_fragment()])
    state = _state(edges=[_edge("e1"), _edge("e2")])
    with patch("nodes.extract_fragments.stream_llm", return_value=_fake_stream(raw)):
        result = await make_extract_fragments()(state)
    frags = result["fragments"]
    assert len(frags) == 1
    assert frags[0].id == "f1"
    assert frags[0].kind.value == "alt"
    assert len(frags[0].operands) == 2
    assert "degradations" not in result


@pytest.mark.asyncio
async def test_prose_and_fences_are_tolerated():
    # qwen3 a menudo envuelve el array en explicación + valla markdown; el
    # JsonArrayStream descarta todo lo previo al '[' y posterior al ']'.
    raw = (
        "Claro, aquí tienes los fragmentos del diagrama:\n```json\n"
        + json.dumps([_alt_fragment()])
        + "\n```\nEspero que te sirva."
    )
    state = _state(edges=[_edge("e1"), _edge("e2")])
    with patch("nodes.extract_fragments.stream_llm", return_value=_fake_stream(raw)):
        result = await make_extract_fragments()(state)
    assert len(result["fragments"]) == 1
    assert result["fragments"][0].id == "f1"


# ---------------------------------------------------------------------------
# Salida vacía (rechazo / prosa pura sin array)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_prose_only_output_yields_no_fragments():
    # Prosa pura sin ningún '['. JsonArrayStream nunca encuentra el array, así que
    # ijson no recibe nada y coro.close() levanta "premature EOF": el nodo lo trata
    # como truncado (degradación 'structure'). Comportamiento compartido con
    # extract_nodes/edges (ver nota en el informe: degradación quizá demasiado
    # agresiva para prosa-pura, pero consistente entre los tres extractores).
    raw = "No hay fragmentos combinados en este diagrama."  # ningún '['
    state = _state(edges=[_edge("e1")])
    with patch("nodes.extract_fragments.stream_llm", return_value=_fake_stream(raw)):
        result = await make_extract_fragments()(state)
    assert result["fragments"] == []
    assert result["degradations"][0]["category"] == "structure"


@pytest.mark.asyncio
async def test_empty_array_yields_no_fragments_clean():
    # Un array vacío explícito SÍ es el camino limpio (sin degradación): ijson ve
    # el '[' y el ']' y cierra sin error.
    state = _state(edges=[_edge("e1")])
    with patch("nodes.extract_fragments.stream_llm", return_value=_fake_stream("[]")):
        result = await make_extract_fragments()(state)
    assert result["fragments"] == []
    assert "degradations" not in result


# ---------------------------------------------------------------------------
# Fragmento inválido referencialmente → se descarta (degradación limpia)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_fragment_referencing_missing_message_is_discarded():
    # El operando referencia "e99", que no existe entre las aristas → descartado.
    bad = {
        "id": "f1",
        "kind": "opt",
        "operands": [{"guard": "[x]", "message_ids": ["e99"], "child_fragment_ids": []}],
    }
    raw = json.dumps([bad])
    state = _state(edges=[_edge("e1")])
    with patch("nodes.extract_fragments.stream_llm", return_value=_fake_stream(raw)):
        result = await make_extract_fragments()(state)
    assert result["fragments"] == []


@pytest.mark.asyncio
async def test_fragment_failing_pydantic_is_skipped():
    # kind fuera del enum FragmentKind → Pydantic lo rechaza y se omite, sin romper.
    bad = {"id": "f1", "kind": "banana", "operands": []}
    good = _alt_fragment(fid="f2")
    raw = json.dumps([bad, good])
    state = _state(edges=[_edge("e1"), _edge("e2")])
    with patch("nodes.extract_fragments.stream_llm", return_value=_fake_stream(raw)):
        result = await make_extract_fragments()(state)
    ids = [f.id for f in result["fragments"]]
    assert ids == ["f2"]


# ---------------------------------------------------------------------------
# Respuesta truncada → degradación 'structure'
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_truncated_response_registers_degradation():
    # Array sin cerrar: ijson aborta a mitad → truncated=True → degradación.
    truncated = '[{"id": "f1", "kind": "opt", "operands": [{"guard": "[x]", "message_ids'
    state = _state(edges=[_edge("e1")])
    with patch("nodes.extract_fragments.stream_llm", return_value=_fake_stream(truncated)):
        result = await make_extract_fragments()(state)
    assert "degradations" in result
    assert result["degradations"][0]["category"] == "structure"
    assert result["degradations"][0]["reasons"]
