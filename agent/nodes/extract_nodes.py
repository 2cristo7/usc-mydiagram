import asyncio
import ijson
from state import DiagramState
from llm import stream_llm
from schemas import DiagramNode
from prompts import get_node_prompt


def make_extract_nodes(queue: asyncio.Queue | None = None):
    async def extract_nodes(state: DiagramState) -> DiagramState:
        prompt = state["prompt"]

        # Prompt específico del tipo de diagrama (S6.6): nombra los node_types
        # propios de este tipo y da un ejemplo coherente, en vez del genérico ERD.
        system = get_node_prompt(state["diagram_type"])

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
                        await queue.put({"_type": "node", "data": node.model_dump()})
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
