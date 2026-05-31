import asyncio
import ijson
from state import DiagramState
from llm import stream_llm
from schemas import NodeType, DiagramNode


def make_extract_nodes(queue: asyncio.Queue | None = None):
    async def extract_nodes(state: DiagramState) -> DiagramState:
        prompt = state["prompt"]
        diagram_type = state["diagram_type"].value

        valid_node_types = "|".join(e.value for e in NodeType)

        system = f"""You are extracting nodes from a {diagram_type} diagram description.
Return ONLY a JSON array, no explanation, no code blocks.
Each element must follow this exact structure:
{{"id": "slug_without_spaces", "label": "Human Readable Name", "node_type": "{valid_node_types}", "attributes": ["field: TYPE CONSTRAINT"]}}
Example for an ERD: [{{"id": "user", "label": "User", "node_type": "table", "attributes": ["id: INT PK", "email: VARCHAR NOT NULL"]}}]"""

        raw_stream = stream_llm(system=system, user=prompt, tier="capable", max_tokens=500)

        events = ijson.sendable_list()
        coro = ijson.items_coro(events, "item")

        nodes: list[DiagramNode] = []

        async def drain():
            while events:
                node_dict = events.pop(0)
                try:
                    node = DiagramNode.model_validate(node_dict)
                    nodes.append(node)
                    if queue is not None:
                        await queue.put(node)
                except Exception as e:
                    print(f"[extract_nodes] validation error: {e} — skipping node: {node_dict}")

        try:
            async for chunk in raw_stream:
                coro.send(chunk.encode())
                await drain()
            coro.close()
            await drain()
        except Exception as e:
            print(f"[extract_nodes] ijson parse error: {e}")

        return {"nodes": nodes}

    return extract_nodes
