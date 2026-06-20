import asyncio
import ijson
from state import DiagramState
from llm import stream_llm, LLMError, JsonArrayStream
from schemas import DiagramNode, NodeType, ALLOWED_NODE_TYPES, node_type_allowed
from prompts import get_node_prompt


def make_extract_nodes(queue: asyncio.Queue | None = None):
    async def extract_nodes(state: DiagramState) -> DiagramState:
        prompt = state["prompt"]
        dt = state["diagram_type"]

        # El MODO se detecta por CONTENIDO del estado, no por contador (S6.8): el
        # contador es presupuesto, no señal de modo. Prioridad rellenar > corregir
        # > normal, porque venir de validate_schema (structural_gaps) implica que
        # el bucle local de nodos ya terminó; un invalid_nodes residual no debe
        # secuestrar el modo. Cada extractor filtra los gaps de SU scope.
        fill_gaps = [g for g in state["structural_gaps"] if g["type"] == "nodes"]
        allowed = ALLOWED_NODE_TYPES.get(dt) or set(NodeType)
        allowed_str = ", ".join(t.value for t in allowed)

        if fill_gaps:
            # Modo RELLENAR hueco estructural (S6.8): validate_schema detectó que
            # FALTA un nodo (no que haya uno mal). Se añade lo que falta, con los
            # nodos existentes como contexto para no repetirlos.
            missing = "\n".join(f'- {g["reason"]}' for g in fill_gaps)
            existing = ", ".join(f"{n.id} ({n.label})" for n in state["nodes"]) or "(ninguno)"
            system = f"""Estás AÑADIENDO los nodos que faltan en un diagrama de tipo {dt.value} ya parcialmente construido.
Faltan estos elementos estructurales:
{missing}
Los nodos que YA existen (NO los repitas): {existing}.
Los ÚNICOS node_type válidos para este tipo de diagrama son: {allowed_str}.
Añade SOLO los nodos que faltan. Devuelve ÚNICAMENTE un array JSON, sin texto adicional, sin markdown, sin bloques de código.
Cada elemento DEBE tener exactamente esta forma:
{{"id": "slug_sin_espacios", "label": "Nombre Legible", "node_type": "<uno de los permitidos>", "attributes": ["..."]}}"""
        elif state["invalid_nodes"]:
            # Modo CORREGIR (S6.7): quedaron nodos inválidos (Pydantic o semánticos).
            # Regenera SOLO los retenidos, con el motivo y los node_types permitidos.
            broken = "\n".join(
                f'- {item["raw"]}  ← {item["reason"]}'
                for item in state["invalid_nodes"]
            )
            system = f"""Estás CORRIGIENDO nodos inválidos de un diagrama de tipo {dt.value}.
Los siguientes nodos son inválidos:
{broken}
Los ÚNICOS node_type válidos para este tipo de diagrama son: {allowed_str}.
Corrige cada nodo: usa un node_type permitido y respeta el esquema. Mantén el mismo id si lo tenía.
Devuelve ÚNICAMENTE un array JSON con los nodos corregidos, sin texto adicional, sin markdown, sin bloques de código.
Cada elemento DEBE tener exactamente esta forma:
{{"id": "slug_sin_espacios", "label": "Nombre Legible", "node_type": "<uno de los permitidos>", "attributes": ["..."]}}"""
        else:
            # Pasada normal: prompt específico del tipo de diagrama (S6.6).
            system = get_node_prompt(dt)

        # Dedup: ids ya confirmados y streameados en pasadas previas. Si el LLM re-emite
        # un nodo ya válido durante el feedback, no se vuelve a mandar al canvas.
        already_streamed = {n.id for n in state["nodes"]}

        runtime = state.get("llm")
        kwargs = {"runtime": runtime} if runtime is not None else {}
        raw_stream = stream_llm(system=system, user=prompt, tier="capable", max_tokens=2048,
                                **kwargs)
        # Saneado: el modelo puede envolver el array en prosa o ```json; sin esto un
        # solo carácter no-JSON al principio aborta a ijson y el diagrama sale vacío.
        json_stream = JsonArrayStream(raw_stream)

        events = ijson.sendable_list()
        coro = ijson.items_coro(events, "item")

        nodes: list[DiagramNode] = []
        invalid: list[dict] = []

        async def drain():
            while events:
                node_dict = events.pop(0)
                # 1. Validación Pydantic. Un fallo NO se descarta en silencio (S6.7):
                # se retiene el dict crudo + motivo para alimentar el reintento.
                try:
                    node = DiagramNode.model_validate(node_dict)
                except Exception as e:
                    invalid.append({"raw": node_dict, "reason": f"schema inválido: {e}"})
                    continue
                # Dedup: ya confirmado en una pasada anterior → no repetir.
                if node.id in already_streamed:
                    continue
                # 2. Validación semántica por tipo: el node_type debe estar permitido para
                # este DiagramType. Pydantic-válido pero semánticamente inválido también
                # se retiene (no se streamea) para regenerar — invariante: lo que llega al
                # canvas está confirmado y no se retracta.
                if not node_type_allowed(dt, node.node_type):
                    invalid.append({
                        "raw": node_dict,
                        "reason": f'node_type "{node.node_type.value}" no permitido en {dt.value}',
                    })
                    continue
                nodes.append(node)
                already_streamed.add(node.id)
                if queue is not None:
                    await queue.put({"_type": "node", "data": node.model_dump()})

        try:
            async for chunk in json_stream:
                coro.send(chunk.encode())
                await drain()
            coro.close()
            await drain()
        except LLMError:
            raise
        except Exception as e:
            print(f"[extract_nodes] ijson parse error: {e}")

        # El modelo no devolvió ningún array JSON (rechazo o prosa pura). No es un
        # fallo del proveedor (no levantamos LLMError, que mandaría al usuario a la
        # config): se deja pasar con 0 nodos. Si tampoco hay nodos de pasadas
        # previas, classify_outcome lo cierra como `empty` con su mensaje accionable.
        if not json_stream.found and not nodes:
            print("[extract_nodes] el modelo no devolvió JSON (posible rechazo); 0 nodos")

        return {"nodes": nodes, "invalid_nodes": invalid}

    return extract_nodes
