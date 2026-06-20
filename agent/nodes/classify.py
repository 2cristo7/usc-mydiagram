import asyncio

from state import DiagramState
from llm import call_llm
from schemas import DiagramType

# Etiquetas legibles por tipo, para construir las opciones de la pregunta de
# desambiguación. El frontend puede sustituirlas por las suyas, pero el agente
# manda labels usables por si acaso. Deriva del MISMO enum que el contrato.
_TYPE_LABELS: dict[str, str] = {
    DiagramType.ERD.value:          "Entidad-Relación",
    DiagramType.SEQUENCE.value:     "Diagrama de secuencia",
    DiagramType.FLOWCHART.value:    "Diagrama de flujo",
    DiagramType.ARCHITECTURE.value: "Arquitectura",
    DiagramType.MINDMAP.value:      "Mapa mental",
    DiagramType.USE_CASE.value:     "Casos de uso",
}


def make_classify(queue: asyncio.Queue | None = None):
    """Factory que devuelve el nodo `classify` con acceso a la queue del stream.

    La queue es necesaria para emitir el evento `type_clarification` cuando el
    LLM detecta ambigüedad UML (S10.3). El patrón es el mismo que make_extract_nodes:
    el nodo se instancia en build_graph pasando la queue capturada en el closure.
    """

    async def classify(state: DiagramState) -> DiagramState:
        # S10.2 — Si el usuario preseleccionó el tipo en la UI, ya viaja en el estado
        # (parseado a DiagramType por GenerateRequest). Entonces NOS SALTAMOS la
        # llamada LLM de clasificación de tipo, pero conservamos la del título: el
        # tipo lo fija el usuario, el título sigue derivándose del prompt. None =
        # automático. No se añade rama al grafo: la bifurcación es un `if` sobre el
        # contenido del estado, no una arista condicional (decisión 10.2 P1).
        #
        # Las dos llamadas son INDEPENDIENTES (el título no necesita el tipo), así que
        # en modo automático se lanzan CONCURRENTES con asyncio.gather (latencia
        # ≈ max(tipo, título) en vez de la suma). Esto, y no el ahorro de llamadas, es
        # la razón de mantenerlas en un solo nodo: dos nodos secuenciales no podrían
        # paralelizar sin un fan-out/fan-in explícito en LangGraph (decisión 10.2 P1,
        # reabierta).
        #
        # S10.3 (reabierta) — Desambiguación GENERALIZADA: el clasificador ya no se
        # limita al par secuencia/casos de uso. Si la petición encaja por igual con
        # VARIOS tipos, el LLM devuelve los candidatos (2-4) separados por comas; en
        # ese caso NO generamos título ni continuamos: emitimos `type_clarification`
        # por la queue con UNA opción por candidato (el usuario ve exactamente entre
        # qué tipos está la duda) y activamos `needs_type_clarification`. El grafo
        # corta a END limpiamente (route_after_classify). Nunca se pregunta si el tipo
        # viene preseleccionado (el usuario ya eligió).
        preset = state.get("diagram_type")
        runtime = state.get("llm")
        rt_kwargs = {"runtime": runtime} if runtime is not None else {}
        valid_types = [t.value for t in DiagramType]

        async def classify_type() -> str:
            """Devuelve UN valor del enum, o VARIOS separados por comas si hay
            ambigüedad real entre tipos. El parseo posterior decide si preguntar."""
            llm_response_type = await call_llm(
                system=(
                    f"You are a diagram type classifier. "
                    f"The valid diagram types are: {valid_types}. "
                    f"Pick the SINGLE type that best matches the user's request and reply "
                    f"with exactly that value, no explanation. "
                    f"ONLY if the request genuinely fits several types equally well and you "
                    f"truly cannot decide, reply with the 2 to 4 candidate values separated "
                    f"by commas (e.g. 'sequence,use_case'). Prefer a single type whenever "
                    f"possible; use multiple values only for real ambiguity."
                ),
                user=state["prompt"],
                tier="fast",
                max_tokens=20,
                **rt_kwargs,
            )
            return llm_response_type.strip().lower()

        async def generate_title() -> str:
            llm_response_title = await call_llm(
                system="Reply with a concise title for the diagram, no explanation.",
                user=state["prompt"],
                tier="fast",
                max_tokens=20,
                **rt_kwargs,
            )
            return llm_response_title.strip()

        if preset is not None:
            # Tipo preseleccionado por el usuario → solo generamos título, nunca preguntamos.
            diagram_title_str = await generate_title()
            _emit_type(queue, preset, diagram_title_str)
            return {"diagram_type": preset, "title": diagram_title_str, "needs_type_clarification": False}

        # Modo automático: lanzamos tipo y título en paralelo.
        raw_type, diagram_title_str = await asyncio.gather(classify_type(), generate_title())

        # Parseo de candidatos: el LLM puede devolver uno o varios valores (coma o
        # punto y coma). Nos quedamos con los reconocidos, sin duplicar y en orden.
        candidates: list[str] = []
        for piece in raw_type.replace(";", ",").split(","):
            t = piece.strip().lower()
            if t in valid_types and t not in candidates:
                candidates.append(t)

        # Rama de ambigüedad GENERALIZADA (S10.3 reabierta): 2+ candidatos válidos →
        # preguntar CUÁLES, con una opción por candidato.
        if len(candidates) >= 2:
            if queue is not None:
                await queue.put({
                    "_type": "type_clarification",
                    "question": "Tu petición encaja con varios tipos de diagrama. ¿Cuál quieres?",
                    "options": [
                        {"label": _TYPE_LABELS[t], "value": t}
                        for t in candidates
                    ],
                })
            # NO asignamos diagram_type ni title: el grafo corta a END limpiamente.
            return {"needs_type_clarification": True}

        # Un único candidato (o ninguno reconocido → fallback a erd).
        if not candidates:
            print(f"Warning: LLM returned unrecognized diagram type '{raw_type}'. Defaulting to 'erd'.")
        resolved_type = DiagramType(candidates[0] if candidates else "erd")
        _emit_type(queue, resolved_type, diagram_title_str)
        return {
            "diagram_type": resolved_type,
            "title": diagram_title_str,
            "needs_type_clarification": False,
        }

    return classify


def _emit_type(queue: asyncio.Queue | None, diagram_type: DiagramType, title: str) -> None:
    """Puente del tipo de diagrama al frontend (S10.3).

    El tipo se decide aquí, ANTES de que se streamee el primer nodo. Sin este
    puente el frontend no lo conoce hasta el `done` final, así que en modo
    automático monta el diagrama en vivo con el layout genérico y luego "flashea"
    al tipo real. Emitiendo el tipo en cuanto se resuelve, el montaje en vivo usa
    ya el layout correcto (mindmap radial, ERD…) y el header muestra título+tipo
    desde el principio. Los eventos incrementales node/edge NO llevan diagram_type
    (ver outcome.py); este evento es el único canal incremental del tipo.
    """
    if queue is not None:
        queue.put_nowait({
            "_type": "diagram_type",
            "diagram_type": diagram_type.value,
            "title": title,
        })
