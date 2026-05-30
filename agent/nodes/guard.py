from state import DiagramState
from llm import call_llm

async def guard(state: DiagramState) -> DiagramState:
    reply = await call_llm(
        system="Reply only 'yes' or 'no'. Is the following text describing a process, system, or structure that could be represented as a diagram?",
        user=state["prompt"],
        tier="fast",
        max_tokens=10,
    )
    return {"is_diagram_request": reply.strip().lower().startswith("yes")}