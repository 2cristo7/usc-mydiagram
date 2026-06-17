"""S7.3 — Grafo del agente ReAct (think → tool_call → observation → think).

Cierra el loop que 7.1 (contrato /refine) y 7.2 (tools puras) dejaron preparado:
un chat-model con `bind_tools()` decide qué tools invocar sobre el diagrama, un
`ToolNode` las ejecuta contra el `DiagramWorkspace` de ESTA petición, y el bucle
repite hasta que el LLM responde sin tool_calls (= "he terminado").

Topología:

    agent ──tools_condition──> END            (sin tool_calls → fin)
      ^         │
      │         └──> tools ──route_after_tools──> agent      (observación → seguir)
      │                          │
      │                          ├──> regenerate ──> END      (escape hatch)
      │                          └──> clarify ──> agent       (interrupt() → pausa S7.4)
      └─────────────────────────────┘

`regenerate` es el único caso especial: regenerate_from_scratch no edita el
workspace incrementalmente — tira el diagrama y corre el pipeline de generación
S6 entero (build_graph, que arranca en guard). Por eso sale del loop por su propia
rama y su resultado REEMPLAZA el workspace (no vuelve al agente).

S7.4: ask_clarification PAUSA de verdad. Su marcador _interrupt se enruta (igual
que _regenerate) a un nodo `clarify` dedicado que llama a interrupt() de LangGraph:
el grafo se congela, /refine/stream emite la pregunta y termina, y /refine/resume
reanuda con la respuesta del usuario vía Command(resume=...). El nodo `clarify` es
deliberadamente LIBRE DE EFECTOS: al reanudar, LangGraph re-ejecuta el nodo
interrumpido desde su inicio — si el interrupt viviera en ToolNode, las tools
hermanas del mismo turno (p. ej. un add_node) se ejecutarían DOS veces (duplicado
silencioso). Separadas en nodos distintos, las hermanas quedan checkpointeadas y
solo se re-ejecuta el interrupt, que es idempotente (la 2ª vez devuelve la
respuesta en vez de pausar).

S7.5: streaming visual de tool calls. `tool_events` traduce cada update de
`astream(stream_mode="updates")` a eventos NDJSON `tool_call`/`tool_result` —
el nodo del grafo es la unidad de evento (agent completa → tool_calls; tools
completa → observaciones), sin granularidad sub-nodo (astream_events). Los
eventos en vivo son UX efímera; el `done` sigue llevando el diagrama completo +
refinement_history como verdad que se aplica SIEMPRE (reconciliación
incondicional en el frontend).
"""

import json
from typing import Optional

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.tools import StructuredTool
from langgraph.graph import StateGraph, MessagesState, END
from langgraph.prebuilt import ToolNode, tools_condition
from langgraph.types import interrupt

from llm import get_chat_model
from schemas import (
    NodeType, EdgeType, ALLOWED_NODE_TYPES, ALLOWED_EDGE_TYPES,
)
from tools import (
    DiagramWorkspace,
    FindNodeArgs, AddNodeArgs, UpdateNodeArgs, DeleteNodeArgs,
    AddEdgeArgs, DeleteEdgeArgs, ApplyLayoutArgs, AskClarificationArgs, RegenerateArgs,
)


# ---------------------------------------------------------------------------
# Puente tools ↔ workspace (por petición)
# ---------------------------------------------------------------------------
# El contrato que ve el LLM (nombre + descripción + args_schema) es ESTÁTICO; la
# EJECUCIÓN apunta al workspace de esta petición. Por eso build_tools se llama por
# petición y cada tool cierra (closure) sobre `ws`: no hay workspace global y dos
# refinamientos concurrentes deben mutar diagramas distintos. Cada tool devuelve su
# observación como JSON-string: es lo que el LLM lee y razona en ReAct, y lo que el
# router parsea para detectar el marcador _regenerate.

def build_tools(ws: DiagramWorkspace) -> list[StructuredTool]:
    def _find_node(query: str) -> str:
        return json.dumps(ws.find_node(query), ensure_ascii=False)

    def _add_node(node_type: NodeType, label: str,
                  attributes: Optional[list[str]] = None, methods: Optional[list[str]] = None) -> str:
        return json.dumps(ws.add_node(node_type, label, attributes, methods), ensure_ascii=False)

    def _update_node(id: str, label: Optional[str] = None,
                     node_type: Optional[NodeType] = None, attributes: Optional[list[str]] = None) -> str:
        return json.dumps(ws.update_node(id, label, node_type, attributes), ensure_ascii=False)

    def _delete_node(id: str) -> str:
        return json.dumps(ws.delete_node(id), ensure_ascii=False)

    def _add_edge(source: str, target: str, edge_type: EdgeType, label: str = "") -> str:
        return json.dumps(ws.add_edge(source, target, edge_type, label), ensure_ascii=False)

    def _delete_edge(id: Optional[str] = None,
                     source: Optional[str] = None, target: Optional[str] = None) -> str:
        return json.dumps(ws.delete_edge(id, source, target), ensure_ascii=False)

    def _apply_layout() -> str:
        return json.dumps(ws.apply_layout(), ensure_ascii=False)

    def _ask_clarification(question: str, options: Optional[list[str]] = None) -> str:
        return json.dumps(ws.ask_clarification(question, options), ensure_ascii=False)

    def _regenerate_from_scratch(prompt: str, diagram_type=None) -> str:
        return json.dumps(ws.regenerate_from_scratch(prompt, diagram_type), ensure_ascii=False)

    return [
        StructuredTool.from_function(
            func=_find_node, name="find_node", args_schema=FindNodeArgs,
            description="Resuelve un texto al/los nodo(s) existentes por nombre (substring o fuzzy). Úsalo ANTES de referenciar un nodo por id."),
        StructuredTool.from_function(
            func=_add_node, name="add_node", args_schema=AddNodeArgs,
            description="Crea un nodo nuevo que representa una ENTIDAD o PARTICIPANTE (tabla, clase, servicio, actor…). "
                        "NUNCA uses add_node para una acción, proceso, fase, mensaje, handshake o transferencia: "
                        "esos conceptos son ARISTAS (add_edge), no nodos. "
                        "OJO: el nodo nace DESCONECTADO — si debe relacionarse con otros, llama después a add_edge."),
        StructuredTool.from_function(
            func=_update_node, name="update_node", args_schema=UpdateNodeArgs,
            description="Modifica parcialmente un nodo existente (label, tipo o atributos)."),
        StructuredTool.from_function(
            func=_delete_node, name="delete_node", args_schema=DeleteNodeArgs,
            description="Borra un nodo; sus aristas conectadas se borran en cascada."),
        StructuredTool.from_function(
            func=_add_edge, name="add_edge", args_schema=AddEdgeArgs,
            description="Crea una arista tipada entre dos nodos que YA existen. No crea nodos. "
                        "Úsala para toda INTERACCIÓN, MENSAJE, LLAMADA, RELACIÓN o PROCESO entre nodos: "
                        "en secuencia, cosas como 'handshake', 'login', 'transferencia de datos', "
                        "'SYN', 'ACK', 'validar', 'enviar' son aristas, no nodos."),
        StructuredTool.from_function(
            func=_delete_edge, name="delete_edge", args_schema=DeleteEdgeArgs,
            description="Borra una arista. Indica su id, o bien source y target (ids de los nodos extremos); "
                        "si hay varias aristas entre esos nodos devuelve los candidatos para que elijas."),
        StructuredTool.from_function(
            func=_apply_layout, name="apply_layout", args_schema=ApplyLayoutArgs,
            description="Re-aplica el layout automático del diagrama."),
        StructuredTool.from_function(
            func=_ask_clarification, name="ask_clarification", args_schema=AskClarificationArgs,
            description="Pregunta al usuario cuando la instrucción es ambigua; opcionalmente con opciones cerradas."),
        StructuredTool.from_function(
            func=_regenerate_from_scratch, name="regenerate_from_scratch", args_schema=RegenerateArgs,
            description="Escape hatch para cambios estructurales masivos (cambiar el tipo de diagrama, rehacerlo entero): regenera el diagrama desde cero a partir de una descripción."),
    ]


# ---------------------------------------------------------------------------
# System prompt del agente
# ---------------------------------------------------------------------------

_SEQUENCE_AGENT_GUIDE = """
Guía específica para diagramas de SECUENCIA:
- Los NODOS son ÚNICAMENTE participantes (actores, servicios, objetos que intercambian mensajes).
  NUNCA crees un nodo para una acción, proceso, fase, mensaje, handshake o transferencia.
- Las ARISTAS son los mensajes/interacciones entre participantes, en orden cronológico.
  Acciones como "handshake", "transferencia de datos", "login", "validar", "SYN/ACK",
  "enviar", "recibir" son SIEMPRE aristas (add_edge) entre participantes ya existentes.
  Una respuesta es otra arista con source/target intercambiados.
- Solo es legítimo crear un nodo nuevo si la petición introduce un participante que aún
  no existe en el diagrama (p. ej. "añade una caché Redis" → nuevo nodo Redis). Un proceso
  o fase entre participantes ya presentes es siempre una arista, nunca un nodo nuevo.

Ejemplos correctos:
  Petición: "Añade un handshake inicial entre Cliente TCP y Servidor TCP"
  → add_edge(source=cliente_tcp, target=servidor_tcp, label="SYN", edge_type="sequence")
  → add_edge(source=servidor_tcp, target=cliente_tcp, label="SYN-ACK", edge_type="sequence")
  → add_edge(source=cliente_tcp, target=servidor_tcp, label="ACK", edge_type="sequence")
  NO crear nodo "Handshake inicial".

  Petición: "Simula una transferencia de datos"
  → add_edge(source=cliente_tcp, target=servidor_tcp, label="DATA", edge_type="sequence")
  → add_edge(source=servidor_tcp, target=cliente_tcp, label="ACK datos", edge_type="sequence")
  NO crear nodo "Transferencia de datos"."""


def build_system_prompt(ws: DiagramWorkspace) -> str:
    from schemas import DiagramType
    dt = ws.diagram_type
    allowed_nodes = ", ".join(sorted(t.value for t in (ALLOWED_NODE_TYPES.get(dt) or set(NodeType))))
    allowed_edges = ", ".join(sorted(t.value for t in (ALLOWED_EDGE_TYPES.get(dt) or set(EdgeType))))
    diagram_json = ws.to_compact().model_dump_json(indent=2)
    sequence_guide = _SEQUENCE_AGENT_GUIDE if dt == DiagramType.SEQUENCE else ""
    return f"""Eres un agente que REFINA un diagrama de software existente usando tools.

Diagrama actual (tipo «{dt.value}»):
{diagram_json}

node_type válidos para este diagrama: {allowed_nodes}
edge_type válidos para este diagrama: {allowed_edges}
{sequence_guide}
Reglas:
- Cumple la petición COMPLETA antes de terminar. «Añade X entre A y B» significa: crear el nodo X con add_node Y conectarlo a A y a B con add_edge. Crear un nodo NO lo conecta a nada.
- No dejes nodos nuevos desconectados salvo que el usuario lo pida explícitamente. Antes de dar tu respuesta final, repasa si la petición implicaba relaciones que aún no has creado.
- Resuelve los nombres a ids con find_node ANTES de update_node, delete_node o add_edge.
- delete_edge acepta el id de la arista, o source+target (ids de nodos) si no lo conoces.
- add_edge NO crea nodos: ambos extremos deben existir; si falta uno, créalo con add_node primero.
- Si una tool devuelve un {{"error": ...}}, léelo y corrige (otro tipo, crear el nodo que falta…) o pregunta con ask_clarification si es ambiguo.
- Para cambios estructurales masivos (cambiar el tipo de diagrama, rehacerlo entero) usa regenerate_from_scratch en vez de muchas ediciones.
- Si la respuesta del usuario a una aclaración pide algo DISTINTO a lo preguntado, atiende la nueva petición; deshaz con tools lo que ya no aplique.
- Cuando hayas terminado, responde con un texto BREVE describiendo lo que hiciste y NO llames a más tools."""


# ---------------------------------------------------------------------------
# Detección de marcadores (escape hatch y clarificación)
# ---------------------------------------------------------------------------

def _last_marker(messages: list, key: str) -> Optional[dict]:
    """Busca el marcador `key` en los ToolMessage del último turno de tools.

    Se recorre desde el final mientras haya ToolMessage (los que ToolNode acaba de
    añadir tras la AIMessage con tool_calls); el primer no-ToolMessage corta. Así
    solo miramos las observaciones de ESTE paso, no las de turnos anteriores."""
    for msg in reversed(messages):
        if not isinstance(msg, ToolMessage):
            break
        try:
            data = json.loads(msg.content)
        except (json.JSONDecodeError, TypeError):
            continue
        if isinstance(data, dict) and data.get(key):
            return data
    return None


# ---------------------------------------------------------------------------
# refinement_history (S7.4)
# ---------------------------------------------------------------------------

def extract_history(messages: list) -> list[dict]:
    """Deriva la traza de tool calls del refinamiento desde los messages finales.

    La traza YA existe en el estado (cada AIMessage.tool_calls emparejado con su
    ToolMessage por tool_call_id): se EXTRAE al final con una función pura en vez
    de construir una lista paralela durante el loop, que sería una segunda fuente
    de verdad capaz de desincronizarse (mismo principio que classify_outcome S6.9).
    """
    results: dict[str, object] = {}
    for msg in messages:
        if isinstance(msg, ToolMessage):
            try:
                results[msg.tool_call_id] = json.loads(msg.content)
            except (json.JSONDecodeError, TypeError):
                results[msg.tool_call_id] = msg.content
    history = []
    for msg in messages:
        if isinstance(msg, AIMessage):
            for tc in msg.tool_calls or []:
                history.append({
                    "tool": tc["name"],
                    "args": tc["args"],
                    "result": results.get(tc["id"]),
                })
    return history


# ---------------------------------------------------------------------------
# Streaming de tool calls (S7.5)
# ---------------------------------------------------------------------------

def _result_effect(ws: DiagramWorkspace, tool: Optional[str], result) -> dict:
    """Delta explícito declarado por el SERVIDOR (decisión P4 de S7.5).

    Para las tools que crean/modifican, el evento adjunta la pieza COMPLETA leída
    del workspace (no solo el id del result): el cliente la aplica literal, sin
    reimplementar semántica del servidor (slugs, methods→attributes, etc.). Los
    borrados no necesitan enriquecerse: su result ya declara el efecto entero
    (deleted_node + deleted_edges del cascade, deleted_edge)."""
    if not isinstance(result, dict) or result.get("error"):
        return {}
    if tool in ("add_node", "update_node"):
        node = next((n for n in ws.nodes if n.id == result.get("id")), None)
        return {"node": node.model_dump(mode="json")} if node else {}
    if tool == "add_edge":
        edge = next((e for e in ws.edges if e.id == result.get("id")), None)
        return {"edge": edge.model_dump(mode="json")} if edge else {}
    return {}


def tool_events(update: dict, ws: DiagramWorkspace) -> list[dict]:
    """Traduce un update de astream(stream_mode="updates") a eventos NDJSON.

    El mapeo nodo→evento es 1:1 con la topología del grafo: el nodo `agent`
    completa con la AIMessage que PIDE tools (→ eventos `tool_call`, emitidos
    antes de que corran), y el nodo `tools` completa con los ToolMessage de sus
    observaciones (→ eventos `tool_result`, con el delta del servidor). Los nodos
    `clarify` y `regenerate` no emiten: sus desenlaces viajan como eventos
    propios (`clarification`/`done`).

    Función pura sobre (update, ws): testeable sin grafo ni LLM, mismo principio
    que extract_history/classify_outcome."""
    events: list[dict] = []
    for node_name, output in update.items():
        if node_name not in ("agent", "tools"):
            continue
        for msg in (output or {}).get("messages", []):
            if isinstance(msg, AIMessage):
                for tc in msg.tool_calls or []:
                    events.append({
                        "_type": "tool_call",
                        "id": tc["id"],
                        "tool": tc["name"],
                        "args": tc["args"],
                    })
            elif isinstance(msg, ToolMessage):
                try:
                    result = json.loads(msg.content)
                except (json.JSONDecodeError, TypeError):
                    result = msg.content
                events.append({
                    "_type": "tool_result",
                    "id": msg.tool_call_id,
                    "tool": msg.name,
                    "result": result,
                    **_result_effect(ws, msg.name, result),
                })
    return events


# ---------------------------------------------------------------------------
# Construcción del grafo (por petición)
# ---------------------------------------------------------------------------

def build_agent_graph(ws: DiagramWorkspace, checkpointer=None, llm_config=None):
    """Compila el grafo ReAct para refinar `ws`. Se construye por petición porque
    las tools cierran sobre este workspace concreto (ver build_tools).

    `checkpointer` (S7.4): necesario para interrupt() — al pausar, LangGraph
    persiste el estado (messages) por thread_id y lo restaura al reanudar. Sin él,
    ask_clarification no puede pausar (el grafo fallaría al llamar interrupt()).

    `llm_config` (S10.x): si se proporciona, se usa ese provider/modelo en vez del
    env-based. Para transport='browser', get_chat_model lanzará NotImplementedError
    (el loop ReAct no es compatible con el proxy del navegador)."""
    tools = build_tools(ws)
    model = get_chat_model("capable", llm_config=llm_config).bind_tools(tools)
    tool_node = ToolNode(tools)

    async def agent(state: MessagesState) -> dict:
        # El LLM mira el historial (system + diálogo + observaciones) y decide:
        # devuelve tool_calls (seguir) o solo texto (terminar). tools_condition lee
        # esa decisión en el último mensaje.
        response = await model.ainvoke(state["messages"])
        return {"messages": [response]}

    async def regenerate(state: MessagesState) -> dict:
        # Escape hatch: el agente pidió rehacer el diagrama desde cero. Corremos el
        # pipeline de GENERACIÓN S6 completo (arranca en guard) con el prompt del
        # marcador, y su resultado REEMPLAZA el workspace → /refine/stream lo sirve
        # uniforme con ws.to_compact(). Sin streaming de nodos aquí (eso es 7.5):
        # build_graph(queue=None) corre silencioso y devolvemos solo el estado final.
        from graph import build_graph, initial_generation_state

        marker = _last_marker(state["messages"], "_regenerate") or {}
        prompt = marker.get("prompt", "")
        # diagram_type forzado (opcional): el pipeline lo clasifica solo, así que lo
        # honramos como pista en el prompt en vez de tocar el grafo de generación.
        if marker.get("diagram_type"):
            prompt = f"{prompt}\n(Genera un diagrama de tipo: {marker['diagram_type']})"

        result = await build_graph().ainvoke(initial_generation_state(prompt))
        diagram = result.get("diagram")
        if diagram is not None:
            ws.diagram_type = diagram.diagram_type
            ws.nodes = list(diagram.nodes)
            ws.edges = list(diagram.edges)
        return {"messages": [AIMessage(content="Diagrama regenerado desde cero.")]}

    async def clarify(state: MessagesState) -> dict:
        # S7.4 — pausa real. Este nodo SOLO interrumpe: cualquier otro efecto aquí
        # se ejecutaría dos veces, porque al reanudar LangGraph re-ejecuta el nodo
        # interrumpido desde su inicio (las tools hermanas del turno ya corrieron
        # en ToolNode y están checkpointeadas — no se repiten). La 2ª ejecución de
        # interrupt() no pausa: devuelve la respuesta del usuario, que entra al
        # historial como voz del usuario (HumanMessage) para el siguiente turno.
        marker = _last_marker(state["messages"], "_interrupt") or {}
        answer = interrupt({
            "question": marker.get("question", ""),
            "options": marker.get("options", []),
        })
        return {"messages": [HumanMessage(content=f"Respuesta del usuario a tu aclaración: {answer}")]}

    def route_after_tools(state: MessagesState) -> str:
        # Tras ejecutar tools: clarificación pausa (gana a regenerate si el turno
        # trajo ambos: preguntar antes de tirar el diagrama), regenerate sale por
        # su rama dedicada, y si no, de vuelta al agente con las observaciones.
        if _last_marker(state["messages"], "_interrupt"):
            return "clarify"
        return "regenerate" if _last_marker(state["messages"], "_regenerate") else "agent"

    builder = StateGraph(MessagesState)
    builder.add_node("agent", agent)
    builder.add_node("tools", tool_node)
    builder.add_node("regenerate", regenerate)
    builder.add_node("clarify", clarify)
    builder.set_entry_point("agent")
    builder.add_conditional_edges("agent", tools_condition)  # → "tools" | END
    builder.add_conditional_edges("tools", route_after_tools)  # → "clarify" | "regenerate" | "agent"
    builder.add_edge("clarify", "agent")
    builder.add_edge("regenerate", END)
    return builder.compile(checkpointer=checkpointer)
