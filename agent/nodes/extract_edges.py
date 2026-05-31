import asyncio
import ijson
from state import DiagramState
from llm import stream_llm
from schemas import EdgeType, DiagramEdge, ALLOWED_EDGE_TYPES, edge_type_allowed
from prompts import get_edge_prompt


def make_extract_edges(queue: asyncio.Queue | None = None):
    async def extract_edges(state: DiagramState) -> DiagramState:
        prompt = state["prompt"]
        dt = state["diagram_type"]
        diagram_type = dt.value
        nodes = state["nodes"]
        node_ids = {n.id for n in nodes}
        valid_ids = [n.id for n in nodes]

        # Pasada de feedback (S6.5c/S6.7): retry_count > 0 significa que validate_edges
        # nos devolvió aquí porque quedaron aristas inválidas (huérfanas, semánticas o
        # Pydantic). Regeneramos SOLO las retenidas (no re-streamea las válidas), con su
        # motivo, los ids válidos y los edge_types permitidos como guía.
        is_feedback = state["retry_count"] > 0

        if is_feedback:
            allowed = ALLOWED_EDGE_TYPES.get(dt) or set(EdgeType)
            allowed_str = ", ".join(e.value for e in allowed)
            broken = "\n".join(
                f'- {item["raw"]}  ← {item["reason"]}'
                for item in state["invalid_edges"]
            )
            system = f"""Estás CORRIGIENDO aristas inválidas de un diagrama de tipo {diagram_type}.
Las siguientes aristas son inválidas, con el motivo de cada una:
{broken}
Los ÚNICOS ids de nodo válidos son: {valid_ids}.
Los ÚNICOS edge_type válidos para este tipo de diagrama son: {allowed_str}.
Corrige cada arista según su motivo: si referencia un nodo inexistente, reemplaza source/target por un id válido; si el edge_type no está permitido, usa uno permitido; si el esquema es inválido, corrige el formato. Mantén el mismo id.
Devuelve ÚNICAMENTE un array JSON con las aristas corregidas, sin texto adicional, sin markdown, sin bloques de código.
Cada elemento DEBE tener exactamente esta forma:
{{"id": "e1", "source": "id_nodo_origen", "target": "id_nodo_destino", "label": "Etiqueta", "edge_type": "<uno de los permitidos>"}}"""
        else:
            # Pasada normal: prompt específico del tipo de diagrama (S6.6).
            system = get_edge_prompt(dt, valid_ids)

        # Dedup: ids ya confirmados y streameados en pasadas previas. Si el LLM re-emite
        # una arista ya válida durante el feedback, no se vuelve a mandar al canvas.
        already_streamed = {e.id for e in state["edges"]}

        raw_stream = stream_llm(system=system, user=prompt, tier="capable", max_tokens=500)

        events = ijson.sendable_list()
        coro = ijson.items_coro(events, "item")

        edges: list[DiagramEdge] = []
        invalid: list[dict] = []

        async def drain():
            while events:
                edge_dict = events.pop(0)
                # 1. Validación Pydantic. Un fallo NO se descarta en silencio (S6.7):
                # se retiene el dict crudo + motivo para alimentar el reintento.
                try:
                    edge = DiagramEdge.model_validate(edge_dict)
                except Exception as e:
                    invalid.append({"raw": edge_dict, "reason": f"schema inválido: {e}"})
                    continue
                # Dedup: ya confirmada en una pasada anterior → no repetir.
                if edge.id in already_streamed:
                    continue
                # 2. Integridad referencial (huérfana): source y target deben existir
                # entre los nodos ya extraídos.
                if edge.source not in node_ids or edge.target not in node_ids:
                    invalid.append({
                        "raw": edge.model_dump(),
                        "reason": f'referencia a nodo inexistente: "{edge.source}" -> "{edge.target}"',
                    })
                    continue
                # 3. Validación semántica por tipo: el edge_type debe estar permitido
                # para este DiagramType.
                if not edge_type_allowed(dt, edge.edge_type):
                    invalid.append({
                        "raw": edge.model_dump(),
                        "reason": f'edge_type "{edge.edge_type.value}" no permitido en {diagram_type}',
                    })
                    continue
                # Válida y confirmada: invariante — lo que se streamea no se retracta.
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

        return {"edges": edges, "invalid_edges": invalid}

    return extract_edges
