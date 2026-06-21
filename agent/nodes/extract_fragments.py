import asyncio
import ijson
from state import DiagramState
from llm import stream_llm, LLMError, JsonArrayStream
from schemas import DiagramType, Fragment, validate_fragment
from prompts import get_fragment_prompt


def make_extract_fragments(queue: asyncio.Queue | None = None):
    """Tercera pasada de extracción (S10.4), EXCLUSIVA de diagramas de secuencia:
    agrupa los mensajes ya extraídos en fragmentos combinados (alt/opt/loop/par).

    A diferencia de extract_nodes/extract_edges NO tiene bucle de feedback: los
    fragmentos son decoración estructural, así que un fragmento inválido se
    descarta (degradación limpia) en vez de reintentarse. Para cualquier tipo que
    no sea secuencia, o sin mensajes, es un no-op que devuelve fragments=[]."""
    async def extract_fragments(state: DiagramState) -> DiagramState:
        dt = state["diagram_type"]
        edges = state["edges"]

        # Solo secuencia, y solo si hay mensajes que agrupar.
        if dt != DiagramType.SEQUENCE or not edges:
            return {"fragments": []}

        message_lines = [
            f'{e.id}: {e.source} -> {e.target} "{e.label}"' for e in edges
        ]
        valid_edge_ids = {e.id for e in edges}

        system = get_fragment_prompt(message_lines)
        runtime = state.get("llm")
        kwargs = {"runtime": runtime} if runtime is not None else {}
        raw_stream = stream_llm(system=system, user=state["prompt"], tier="capable",
                                max_tokens=2048, **kwargs)
        # Saneado: descarta prosa/```json alrededor del array (gemelo de extract_nodes).
        json_stream = JsonArrayStream(raw_stream)

        events = ijson.sendable_list()
        coro = ijson.items_coro(events, "item")
        raw_frags: list[dict] = []
        truncated = False  # ijson abortó a mitad de stream (respuesta cortada)

        async def drain():
            while events:
                raw_frags.append(events.pop(0))

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
            # seguimos con los fragmentos parseados hasta aquí (raw_frags) y registramos
            # la degradación (S6.9) en vez de descartar todo en silencio.
            print(f"[extract_fragments] ijson parse error: {e}")
            truncated = True

        # Dos pasadas: primero Pydantic-parsea todos (para conocer el universo de
        # ids de fragmento válidos), luego valida referencias cruzadas y descarta
        # los incoherentes. No se streamea live: van en el diagrama final.
        parsed: list[Fragment] = []
        for fd in raw_frags:
            try:
                parsed.append(Fragment.model_validate(fd))
            except Exception as e:
                print(f"[extract_fragments] fragmento inválido (schema): {e}")
        valid_fragment_ids = {f.id for f in parsed}

        fragments: list[Fragment] = []
        for frag in parsed:
            ok, reason = validate_fragment(frag, valid_edge_ids, valid_fragment_ids)
            if ok:
                fragments.append(frag)
            else:
                print(f"[extract_fragments] descartado {frag.id}: {reason}")

        result: DiagramState = {"fragments": fragments}
        # Degradación de parseo (category "structure"): el array de fragmentos quedó
        # incompleto al cortarse la respuesta. Se acumula en `degradations` (reducer
        # operator.add) para sobrevivir al END y avisar al usuario.
        if truncated:
            result["degradations"] = [{
                "category": "structure",
                "reasons": ["parseo JSON incompleto al extraer fragmentos de secuencia: la respuesta del modelo se cortó (truncada)"],
            }]
        return result

    return extract_fragments
