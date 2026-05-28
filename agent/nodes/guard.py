from state import DiagramState
from llm import call_llm

async def guard(state: DiagramState) -> DiagramState:
    reply = await call_llm(
        system="Reply only 'yes' or 'no'. Is the following text a request to generate a software diagram?",
        user=state["prompt"],
        max_tokens=3,
    )
    return {"is_diagram_request": reply.strip().lower().startswith("yes")}