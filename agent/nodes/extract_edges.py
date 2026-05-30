from state import DiagramState
from llm import call_llm
import json
from schemas import EdgeType, DiagramEdge

async def extract_edges(state: DiagramState) -> DiagramState:
    prompt = state["prompt"]
    diagram_type = state["diagram_type"]
    nodes = state["nodes"]

    valid_edge_types = "|".join(e.value for e in EdgeType)

    llm_response = await call_llm (
        system = f"""You are extracting edges from a {diagram_type} diagram description.
Return ONLY a JSON array, no explanation, no code blocks.
Each element must follow this exact structure:
{{"id": "e1", "source": "source_node_id", "target": "target_node_id", "label": "Relationship Label", "edge_type": "{valid_edge_types}"}}
Only use node ids from this list: {[n.id for n in nodes]}.
Example: [{{"id": "e1", "source": "user", "target": "order", "label": "places", "edge_type": "one_to_many"}}]""",
            user=prompt,
        tier="capable",
        max_tokens=500,
    )
    try:
        llm_response = json.loads(llm_response)
    except json.JSONDecodeError:
        print(f"Error: LLM response is not valid JSON: {llm_response}")
        llm_response = []
    edges = [DiagramEdge.model_validate(n) for n in llm_response]
    return {"edges": edges}
