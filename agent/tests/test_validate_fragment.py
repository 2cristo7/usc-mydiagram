"""S10.4 — validate_fragment: integridad referencial de los fragmentos combinados.

Un fragmento (UML CombinedFragment) que apunta a un mensaje o a un hijo inexistente
dejaría un marco fantasma; se valida y se descarta (no se corrige en bucle). Cubre
todas las reglas de la función: sin operandos, alt con un solo operando, message_id
inexistente, child_fragment_id inexistente, operando vacío, y el caso válido.
"""
from schemas import (
    Fragment, FragmentOperand, FragmentKind, validate_fragment,
)


VALID_EDGES = {"e1", "e2", "e3"}
VALID_FRAGS = {"f1", "f2"}


def _op(guard="[x]", messages=None, children=None):
    return FragmentOperand(
        guard=guard,
        message_ids=messages or [],
        child_fragment_ids=children or [],
    )


def test_fragment_without_operands_is_invalid():
    frag = Fragment(id="f1", kind=FragmentKind.OPT, operands=[])
    ok, reason = validate_fragment(frag, VALID_EDGES, VALID_FRAGS)
    assert ok is False
    assert "sin operandos" in reason


def test_alt_with_single_operand_is_invalid():
    frag = Fragment(id="f1", kind=FragmentKind.ALT, operands=[_op(messages=["e1"])])
    ok, reason = validate_fragment(frag, VALID_EDGES, VALID_FRAGS)
    assert ok is False
    assert "alt requiere al menos 2" in reason


def test_message_id_not_in_edges_is_invalid():
    frag = Fragment(id="f1", kind=FragmentKind.OPT, operands=[_op(messages=["e99"])])
    ok, reason = validate_fragment(frag, VALID_EDGES, VALID_FRAGS)
    assert ok is False
    assert "mensaje inexistente" in reason
    assert "e99" in reason


def test_child_fragment_id_not_existing_is_invalid():
    frag = Fragment(
        id="f1", kind=FragmentKind.OPT,
        operands=[_op(messages=["e1"], children=["fX"])],
    )
    ok, reason = validate_fragment(frag, VALID_EDGES, VALID_FRAGS)
    assert ok is False
    assert "fragmento hijo inexistente" in reason
    assert "fX" in reason


def test_operand_empty_is_invalid():
    # Operando sin mensajes ni hijos: marco vacío.
    frag = Fragment(id="f1", kind=FragmentKind.OPT, operands=[_op()])
    ok, reason = validate_fragment(frag, VALID_EDGES, VALID_FRAGS)
    assert ok is False
    assert "operando vacío" in reason


def test_valid_alt_fragment_passes():
    frag = Fragment(
        id="f1", kind=FragmentKind.ALT,
        operands=[_op(messages=["e1"]), _op(guard="[else]", messages=["e2"])],
    )
    ok, reason = validate_fragment(frag, VALID_EDGES, VALID_FRAGS)
    assert ok is True
    assert reason == ""


def test_valid_opt_with_child_fragment_passes():
    frag = Fragment(
        id="f2", kind=FragmentKind.LOOP,
        operands=[_op(messages=["e3"], children=["f1"])],
    )
    ok, reason = validate_fragment(frag, VALID_EDGES, VALID_FRAGS)
    assert ok is True
