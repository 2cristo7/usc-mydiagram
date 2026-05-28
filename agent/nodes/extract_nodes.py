from state import DiagramState
from llm import call_llm
import json
from schemas import NodeType, DiagramNode

async def extract_nodes(state: DiagramState) -> DiagramState:
    promt = state["prompt"]
    diagram_type = state["diagram_type"]

    valid_node_types = "|".join(e.value for e in NodeType)

    llm_response = await call_llm (
    system = f"""You are extracting nodes from a {diagram_type} diagram description.
        Return ONLY a JSON array, no explanation, no code blocks.
        Each element must follow this exact structure:
        {{"id": "slug_without_spaces", "label": "Human Readable Name", "node_type": "{valid_node_types}", "attributes": ["field: TYPE CONSTRAINT"]}}
        Example for an ERD: [{{"id": "user", "label": "User", "node_type": "table", "attributes": ["id: INT PK", "email: VARCHAR NOT NULL"]}}]""",
        user=promt,
        max_tokens=500,
    )
    try:
        llm_response = json.loads(llm_response)
    except json.JSONDecodeError:
        print(f"Error: LLM response is not valid JSON: {llm_response}")
        llm_response = []
    nodes = [DiagramNode.model_validate(n) for n in llm_response]
    return {"nodes": nodes}