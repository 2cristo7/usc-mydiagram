import asyncio

from state import DiagramState
from llm import call_llm
from schemas import DiagramType

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
    preset = state.get("diagram_type")
    valid_types = [t.value for t in DiagramType]

    async def classify_type() -> DiagramType:
        llm_response_type = await call_llm(
          system=f"Reply with exactly one of these values, no explanation: {valid_types}.",
          user=state["prompt"],
          tier="fast",
          max_tokens=10,
        )
        diagram_type_str = llm_response_type.strip().lower()
        if diagram_type_str not in valid_types:
            # Log warning about unrecognized type
            print(f"Warning: LLM returned unrecognized diagram type '{diagram_type_str}'. Defaulting to 'erd'.")
            diagram_type_str = "erd"
        return DiagramType(diagram_type_str)

    async def generate_title() -> str:
        llm_response_title = await call_llm(
          system="Reply with a concise title for the diagram, no explanation.",
          user=state["prompt"],
          tier="fast",
          max_tokens=20,
        )
        return llm_response_title.strip()

    if preset is None:
        diagram_type, diagram_title_str = await asyncio.gather(classify_type(), generate_title())
    else:
        diagram_type = preset
        diagram_title_str = await generate_title()

    return {"diagram_type": diagram_type, "title": diagram_title_str}
