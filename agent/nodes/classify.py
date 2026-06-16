import asyncio

from state import DiagramState
from llm import call_llm
from schemas import DiagramType

# Centinela que el LLM devuelve cuando el usuario pide un diagrama UML/de
# comportamiento de forma GENÉRICA sin especificar secuencia vs casos de uso.
_AMBIGUOUS_UML = "ambiguous_uml"


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
        # S10.3 — Desambiguación: si el LLM devuelve el centinela `ambiguous_uml` en
        # modo automático, NO generamos título ni continuamos. Emitimos el evento
        # `type_clarification` por la queue y activamos el flag `needs_type_clarification`.
        # El grafo corta a END limpiamente (route_after_classify). Nunca se pregunta si
        # el tipo viene preseleccionado (el usuario ya eligió).
        preset = state.get("diagram_type")
        valid_types = [t.value for t in DiagramType]
        # El sistema de tipo incluye el centinela para que el LLM pueda indicar
        # ambigüedad sin forzar una clasificación errónea.
        valid_types_with_sentinel = valid_types + [_AMBIGUOUS_UML]

        async def classify_type() -> str:
            """Devuelve un valor del enum O el centinela `ambiguous_uml`."""
            llm_response_type = await call_llm(
                system=(
                    f"You are a diagram type classifier. "
                    f"Reply with exactly one of these values, no explanation: {valid_types_with_sentinel}. "
                    f"Use '{_AMBIGUOUS_UML}' ONLY when the user asks for a generic UML or behavioral diagram "
                    f"without specifying whether they want a sequence diagram or a use case diagram "
                    f"(e.g. 'make a UML diagram', 'a behavioral diagram', 'diagrama UML'). "
                    f"If the prompt mentions sequences/interactions/messages between objects/actors, "
                    f"use 'sequence'. If it mentions actors, goals, system boundaries or use cases, "
                    f"use 'use_case'. Only use '{_AMBIGUOUS_UML}' when the intent is truly ambiguous."
                ),
                user=state["prompt"],
                tier="fast",
                max_tokens=10,
            )
            return llm_response_type.strip().lower()

        async def generate_title() -> str:
            llm_response_title = await call_llm(
                system="Reply with a concise title for the diagram, no explanation.",
                user=state["prompt"],
                tier="fast",
                max_tokens=20,
            )
            return llm_response_title.strip()

        if preset is not None:
            # Tipo preseleccionado por el usuario → solo generamos título, nunca preguntamos.
            diagram_title_str = await generate_title()
            return {"diagram_type": preset, "title": diagram_title_str, "needs_type_clarification": False}

        # Modo automático: lanzamos tipo y título en paralelo.
        raw_type, diagram_title_str = await asyncio.gather(classify_type(), generate_title())

        # Rama de ambigüedad UML (S10.3).
        if raw_type == _AMBIGUOUS_UML:
            # Emitimos el evento de clarificación por la queue del stream.
            if queue is not None:
                await queue.put({
                    "_type": "type_clarification",
                    "question": "¿Qué tipo de diagrama UML quieres?",
                    "options": [
                        {"label": "Diagrama de secuencia", "value": "sequence"},
                        {"label": "Diagrama de casos de uso", "value": "use_case"},
                    ],
                })
            # NO asignamos diagram_type ni title: el grafo corta a END limpiamente.
            return {"needs_type_clarification": True}

        # Clasificación normal: validar y aplicar fallback si no se reconoce.
        if raw_type not in valid_types:
            print(f"Warning: LLM returned unrecognized diagram type '{raw_type}'. Defaulting to 'erd'.")
            raw_type = "erd"

        return {
            "diagram_type": DiagramType(raw_type),
            "title": diagram_title_str,
            "needs_type_clarification": False,
        }

    return classify
