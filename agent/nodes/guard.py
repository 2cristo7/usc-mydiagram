from state import DiagramState
from llm import call_llm

_AFFIRMATIVE = ("yes", "sí", "si")

async def guard(state: DiagramState) -> DiagramState:
    reply = await call_llm(
        system=(
            "You are a binary classifier. Answer with exactly one English word, "
            "'yes' or 'no', and nothing else (no punctuation, no other language). "
            "Does the following text describe any entities, concepts, process, system, "
            "or structure that could be represented as a diagram?"
        ),
        user=state["prompt"],
        tier="fast",
        max_tokens=10,
    )
    normalized = reply.strip().lower().lstrip("'\"").rstrip(".'\"")
    return {"is_diagram_request": normalized.startswith(_AFFIRMATIVE)}