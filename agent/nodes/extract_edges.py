import asyncio
import ijson
from state import DiagramState
from llm import stream_llm
from schemas import EdgeType, DiagramEdge


def make_extract_edges(queue: asyncio.Queue | None = None):
    async def extract_edges(state: DiagramState) -> DiagramState:
        prompt = state["prompt"]
        diagram_type = state["diagram_type"].value
        nodes = state["nodes"]
        node_ids = {n.id for n in nodes}

        valid_edge_types = "|".join(e.value for e in EdgeType)

        system = f"""You are extracting edges from a {diagram_type} diagram description.
Return ONLY a JSON array, no explanation, no code blocks.
Each element must follow this exact structure:
{{"id": "e1", "source": "source_node_id", "target": "target_node_id", "label": "Relationship Label", "edge_type": "{valid_edge_types}"}}
Only use node ids from this list: {[n.id for n in nodes]}.
Example: [{{"id": "e1", "source": "user", "target": "order", "label": "places", "edge_type": "one_to_many"}}]"""

        raw_stream = stream_llm(system=system, user=prompt, tier="capable", max_tokens=500)

        events = ijson.sendable_list()
        coro = ijson.items_coro(events, "item")

        edges: list[DiagramEdge] = []

        async def drain():
            while events:
                edge_dict = events.pop(0)
                try:
                    edge = DiagramEdge.model_validate(edge_dict)
                except Exception as e:
                    print(f"[extract_edges] validation error: {e} — skipping edge: {edge_dict}")
                    continue
                # Validación inline: source y target deben existir entre los nodos ya extraídos.
                if edge.source not in node_ids or edge.target not in node_ids:
                    print(f"[extract_edges] orphan edge skipped: {edge.source} -> {edge.target} (node not found)")
                    continue
                edges.append(edge)
                if queue is not None:
                    await queue.put({"_type": "edge", "data": edge.model_dump()})

        try:
            async for chunk in raw_stream:
                coro.send(chunk.encode())
                await drain()
            coro.close()
            await drain()
        except Exception as e:
            print(f"[extract_edges] ijson parse error: {e}")

        return {"edges": edges}

    return extract_edges
