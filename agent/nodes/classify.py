from state import DiagramState
from llm import call_llm
from schemas import DiagramType

async def classify(state: DiagramState) -> DiagramState:
    valid_types = [t.value for t in DiagramType]
    llm_response_type = await call_llm(
      system=f"Reply with exactly one of these values, no explanation: {valid_types}.",
      user=state["prompt"],
      max_tokens=10,
    )
    diagram_type_str = llm_response_type.strip().lower()
    llm_response_title = await call_llm(
      system="Reply with a concise title for the diagram, no explanation.",
      user=state["prompt"],
      max_tokens=20,
    )
    diagram_title_str = llm_response_title.strip()
    if diagram_type_str not in valid_types:
        # Log warning about unrecognized type
        print(f"Warning: LLM returned unrecognized diagram type '{diagram_type_str}'. Defaulting to 'erd'.")
        diagram_type_str = "erd"
    return {"diagram_type": DiagramType(diagram_type_str), "title": diagram_title_str}