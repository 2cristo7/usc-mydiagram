import asyncio
import ijson
from state import DiagramState
from llm import stream_llm, LLMError, JsonArrayStream
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

        # Sin nodos no puede existir ninguna arista válida (toda referencia sería
        # huérfana): cortocircuito para no gastar una llamada al LLM en un diagrama
        # ya inviable. Pasa, p. ej., cuando extract_nodes recibió prosa/rechazo y
        # devolvió 0 nodos; classify_outcome lo cerrará como `empty`.
        if not nodes:
            return {"edges": [], "invalid_edges": []}

        # El MODO se detecta por CONTENIDO del estado, no por contador (S6.8): el
        # contador es presupuesto, no señal de modo. Prioridad rellenar > corregir
        # > normal (gemelo de extract_nodes). Cada extractor filtra los gaps de SU
        # scope: aquí, los structural_gaps de type "edges".
        fill_gaps = [g for g in state["structural_gaps"] if g["type"] == "edges"]
        allowed = ALLOWED_EDGE_TYPES.get(dt) or set(EdgeType)
        allowed_str = ", ".join(e.value for e in allowed)

        if fill_gaps:
            # Modo RELLENAR hueco estructural (S6.8): validate_schema detectó que
            # FALTAN aristas (p. ej. un terminator recién creado sin conectar). Se
            # pasa el contexto de nodos CON SU node_type para que el LLM identifique
            # cuál conectar (p. ej. "el terminator de inicio"), y las aristas ya
            # existentes para no repetirlas.
            missing = "\n".join(f'- {g["reason"]}' for g in fill_gaps)
            node_ctx = ", ".join(f"{n.id} ({n.label}, {n.node_type.value})" for n in nodes)
            existing = ", ".join(f"{e.source}->{e.target}" for e in state["edges"]) or "(ninguna)"
            system = f"""Estás AÑADIENDO las aristas que faltan en un diagrama de tipo {diagram_type} ya parcialmente construido.
Faltan estas conexiones:
{missing}
Los nodos disponibles (id, label, tipo) son: {node_ctx}.
Las aristas que YA existen (NO las repitas): {existing}.
Los ÚNICOS edge_type válidos para este tipo de diagrama son: {allowed_str}.
Añade SOLO las aristas que faltan. Usa únicamente ids de nodo de la lista de arriba. Devuelve ÚNICAMENTE un array JSON, sin texto adicional, sin markdown, sin bloques de código.
Cada elemento DEBE tener exactamente esta forma:
{{"id": "e1", "source": "id_nodo_origen", "target": "id_nodo_destino", "label": "Etiqueta", "edge_type": "<uno de los permitidos>"}}"""
        elif state["invalid_edges"]:
            # Modo CORREGIR (S6.5c/S6.7): quedaron aristas inválidas (huérfanas,
            # semánticas o Pydantic). Regenera SOLO las retenidas, con su motivo.
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

        runtime = state.get("llm")
        kwargs = {"runtime": runtime} if runtime is not None else {}
        raw_stream = stream_llm(system=system, user=prompt, tier="capable", max_tokens=2048,
                                **kwargs)
        # Saneado: descarta prosa/```json alrededor del array (gemelo de extract_nodes).
        json_stream = JsonArrayStream(raw_stream)

        events = ijson.sendable_list()
        coro = ijson.items_coro(events, "item")

        edges: list[DiagramEdge] = []
        invalid: list[dict] = []
        truncated = False  # ijson abortó a mitad de stream (respuesta cortada)

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
            async for chunk in json_stream:
                coro.send(chunk.encode())
                await drain()
            coro.close()
            await drain()
        except LLMError:
            raise
        except Exception as e:
            # ijson abortó a mitad de stream (respuesta truncada/cortada). NO rompemos:
            # conservamos lo parseado, pero registramos la degradación (S6.9) para que
            # el usuario sepa que el diagrama puede estar incompleto.
            print(f"[extract_edges] ijson parse error: {e}")
            truncated = True

        result: DiagramState = {"edges": edges, "invalid_edges": invalid}
        # Degradación de parseo (category "structure"): el array de aristas quedó
        # incompleto. Se acumula en `degradations` (reducer operator.add) para
        # sobrevivir al END y avisar al usuario.
        if truncated:
            result["degradations"] = [{
                "category": "structure",
                "reasons": ["parseo JSON incompleto al extraer aristas: la respuesta del modelo se cortó (truncada)"],
            }]
        return result

    return extract_edges
