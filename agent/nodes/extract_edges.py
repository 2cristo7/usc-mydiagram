import asyncio
import ijson
from state import DiagramState
from llm import stream_llm
from schemas import EdgeType, DiagramEdge
from prompts import get_edge_prompt


def make_extract_edges(queue: asyncio.Queue | None = None):
    async def extract_edges(state: DiagramState) -> DiagramState:
        prompt = state["prompt"]
        diagram_type = state["diagram_type"].value
        nodes = state["nodes"]
        node_ids = {n.id for n in nodes}

        valid_edge_types = "|".join(e.value for e in EdgeType)
        valid_ids = [n.id for n in nodes]

        # Pasada de feedback (S6.5c): retry_count > 0 significa que validate nos devolvió
        # aquí porque quedaron aristas huérfanas. En vez de regenerar TODAS las aristas
        # (re-streamearía las válidas), regeneramos SOLO las huérfanas retenidas.
        is_feedback = state["retry_count"] > 0

        if is_feedback:
            broken = "\n".join(
                f'- edge "{e.id}": source "{e.source}" -> target "{e.target}"'
                for e in state["orphan_edges"]
            )
            system = f"""You are FIXING broken edges in a {diagram_type} diagram.
The following edges reference node ids that DO NOT exist (usually a typo):
{broken}
The ONLY valid node ids are: {valid_ids}.
For each broken edge, return a CORRECTED version: replace the invalid source/target with the correct existing node id. Keep the same edge id.
Return ONLY a JSON array with the corrected edges, no explanation, no code blocks.
Each element must follow this exact structure:
{{"id": "e1", "source": "source_node_id", "target": "target_node_id", "label": "Relationship Label", "edge_type": "{valid_edge_types}"}}"""
        else:
            # Pasada normal: prompt específico del tipo de diagrama (S6.6), que
            # nombra los edge_types propios de este tipo y da un ejemplo coherente.
            system = get_edge_prompt(state["diagram_type"], valid_ids)

        # Dedup: ids ya confirmados y streameados en pasadas previas. Si el LLM re-emite
        # una arista ya válida durante el feedback, no se vuelve a mandar al canvas.
        already_streamed = {e.id for e in state["edges"]}

        raw_stream = stream_llm(system=system, user=prompt, tier="capable", max_tokens=500)

        events = ijson.sendable_list()
        coro = ijson.items_coro(events, "item")

        edges: list[DiagramEdge] = []
        orphans: list[DiagramEdge] = []

        async def drain():
            while events:
                edge_dict = events.pop(0)
                try:
                    edge = DiagramEdge.model_validate(edge_dict)
                except Exception as e:
                    print(f"[extract_edges] validation error: {e} — skipping edge: {edge_dict}")
                    continue
                # Dedup: ya confirmada en una pasada anterior (o en esta misma) → no repetir.
                if edge.id in already_streamed:
                    continue
                # Validación inline: source y target deben existir entre los nodos ya extraídos.
                # Las huérfanas NO se descartan ni se streamean: se retienen para que
                # validate dispare la regeneración con feedback (S6.5c). Solo las válidas
                # llegan al canvas — invariante: lo que se streamea está confirmado.
                if edge.source not in node_ids or edge.target not in node_ids:
                    orphans.append(edge)
                    continue
                edges.append(edge)
                already_streamed.add(edge.id)
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

        return {"edges": edges, "orphan_edges": orphans}

    return extract_edges
