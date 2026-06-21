from dotenv import load_dotenv
load_dotenv()

import asyncio
import json
import time
import uuid
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional
from graph import build_graph, initial_generation_state, GENERATION_RECURSION_LIMIT
from outcome import classify_outcome, llm_error_event
from schemas import CompactDiagram, DiagramType
from llm import LLMConfig, LLMRuntime, LLMError

app = FastAPI()

# S9.3b — El rate limiter se trasladó al BACKEND (Node): el agente queda con solo
# lógica de agente (generación + tools). El control de admisión (rate limit,
# caché) vive en el backend, que es el único punto de entrada. Ver
# backend/src/rateLimit.ts y backend/src/cache.ts.

_SENTINEL = object()

# ---------------------------------------------------------------------------
# S7.4 — Estado de sesión de clarificaciones (entre /refine/stream y /resume)
# ---------------------------------------------------------------------------
# interrupt() EXIGE checkpointer: al pausar, LangGraph guarda los messages (el
# "cerebro a medio pensar" del agente) por thread_id y los restaura al reanudar.
# Round-tripear ese estado por el cliente expondría internals del LLM y abriría
# manipulación → vive en memoria del proceso, acotado: un MemorySaver singleton +
# el workspace pendiente por thread_id. La statelessness plena (checkpointer
# Postgres sobre Supabase) sigue pendiente; mientras tanto un TTL en memoria acota
# el crecimiento: una clarificación que el usuario nunca responde (cierra la
# pestaña, abandona) caduca y se purga junto al thread del checkpointer.
_checkpointer = None  # lazy: import de langgraph solo si se usa /refine
# thread_id -> (DiagramWorkspace pausado, deadline monotónico de expiración)
_pending_clarifications: dict = {}
# TTL de una clarificación pendiente: pasado este margen sin /resume, se considera
# abandonada y se purga en el siguiente barrido perezoso.
_CLARIFICATION_TTL_SECONDS = 30 * 60


def _get_checkpointer():
    global _checkpointer
    if _checkpointer is None:
        from langgraph.checkpoint.memory import InMemorySaver
        _checkpointer = InMemorySaver()
    return _checkpointer


async def _forget_thread(thread_id: str) -> None:
    """Olvida el estado retenido por el checkpointer para un thread (best-effort).

    Tanto las clarificaciones caducadas como los refinamientos ya cerrados dejan de
    necesitar su checkpoint; sin esto los threads del InMemorySaver crecen sin cota.
    Defensivo: si el checkpointer no está inicializado o no expone adelete_thread se
    ignora (no es un error crítico, solo deja de liberar memoria)."""
    cp = _checkpointer
    if cp is None:
        return
    deleter = getattr(cp, "adelete_thread", None)
    if deleter is None:
        return
    try:
        await deleter(thread_id)
    except Exception as e:  # noqa: BLE001 — limpieza best-effort, nunca debe romper la respuesta
        print(f"[refine] no se pudo purgar el thread {thread_id}: {e!r}")


async def _sweep_expired_clarifications() -> None:
    """Purga las clarificaciones cuyo TTL expiró (usuario que nunca respondió).

    Barrido PEREZOSO: se ejecuta al registrar una nueva clarificación y al reanudar,
    no en un timer de fondo (no hay loop propio que mantener y el coste es O(n) sobre
    un dict pequeño). Cada entrada caducada se borra del dict y su thread del
    checkpointer también."""
    now = time.monotonic()
    expired = [tid for tid, (_ws, deadline) in _pending_clarifications.items() if deadline <= now]
    for tid in expired:
        _pending_clarifications.pop(tid, None)
        await _forget_thread(tid)


def _build_runtime(llm_config: Optional[LLMConfig]) -> Optional[LLMRuntime]:
    """Construye un LLMRuntime desde llm_config. None → None (env-based)."""
    if llm_config is None:
        return None
    return LLMRuntime(config=llm_config)


class GenerateRequest(BaseModel):
    prompt: str
    # S10.2 — Tipo preseleccionado desde la UI (opcional). Ausente/None =
    # automático: el agente clasifica el tipo como hasta ahora. Pydantic valida
    # el valor contra el enum DiagramType en el BORDE: un tipo forzado fuera del
    # enum da 422 explícito, no fallo silencioso (tipos en los bordes, §2).
    diagram_type: Optional[DiagramType] = None
    # S10.x — Configuración LLM por petición (opcional; None → env-based).
    llm_config: Optional[LLMConfig] = None


# S7.1 — Refinamiento sobre un diagrama existente. `diagram` es la versión
# compacta (sin title) que el frontend serializa con diagramToJson. Pydantic lo
# valida al parsear: un diagrama malformado da 422 explícito, no fallo silencioso.
class RefineRequest(BaseModel):
    prompt: str
    diagram: CompactDiagram
    # S10.x — Configuración LLM por petición (opcional; None → env-based).
    llm_config: Optional[LLMConfig] = None


# S7.4 — Reanudación tras una clarificación. Endpoint SEPARADO de /refine/stream:
# sus campos obligatorios son otros (thread_id+answer, sin prompt ni diagram) y un
# modelo único con campos "obligatorios según flag" no es expresable en Pydantic
# declarativo. La validación aquí es de BORDE, no semántica: interpretar si la
# respuesta contesta la pregunta o pide otra cosa es trabajo del AGENTE en el loop
# (tiene el contexto y las tools para pivotar), no de un validador previo.
class ResumeRequest(BaseModel):
    thread_id: str
    answer: str = Field(min_length=1)
    # S10.x — Configuración LLM por petición (opcional; None → env-based).
    llm_config: Optional[LLMConfig] = None

@app.get("/health")
def health():
    return {"status": "ok", "service": "agent"}


@app.post("/generate/stream")
async def generate_stream(req: GenerateRequest):
    queue: asyncio.Queue = asyncio.Queue()
    graph = build_graph(queue)

    runtime = _build_runtime(req.llm_config)
    initial_state = initial_generation_state(req.prompt, req.diagram_type, llm_runtime=runtime)

    async def run_graph():
        # La taxonomía de desenlaces vive en classify_outcome (S6.9): main.py es el
        # único punto que ve los tres casos (final limpio, guard-reject y crash).
        try:
            # recursion_limit explícito y coherente con los tres bucles de feedback
            # (ver GENERATION_RECURSION_LIMIT en graph.py): sin él, el default de
            # LangGraph (25) dispararía GraphRecursionError enmascarado como
            # internal_error en cuanto los reintentos se acumulan.
            result = await graph.ainvoke(
                initial_state,
                config={"recursion_limit": GENERATION_RECURSION_LIMIT},
            )
            event = classify_outcome(result)
        except LLMError as e:
            # Incluimos provider y si la key llegó: un HTTP 401 con
            # api_key_present=False NO es una key inválida, sino una key que no
            # llegó al agente (race de reconexión o Vault transitorio en el
            # gateway). Distinguirlo en el log evita perseguir credenciales que
            # en realidad son correctas.
            cfg = req.llm_config
            print(
                f"[generate_stream] llm error: {e!r} "
                f"provider={cfg.provider if cfg else 'env'} "
                f"api_key_present={bool(cfg and cfg.api_key)}"
            )
            event = llm_error_event(e.message, cfg.provider if cfg else None)
        except Exception as e:
            print(f"[generate_stream] graph error: {e!r}")
            event = classify_outcome(None, crashed=True)
        try:
            # S10.3 — classify_outcome devuelve None cuando el grafo cortó por
            # `type_clarification`: el evento ya fue emitido directamente por la
            # queue desde classify.py, así que no añadimos ningún evento terminal
            # adicional (ni done ni error).
            if event is not None:
                await queue.put(event)
        finally:
            await queue.put(_SENTINEL)

    async def node_stream():
        graph_task = asyncio.create_task(run_graph())
        try:
            while True:
                item = await queue.get()
                if item is _SENTINEL:
                    break
                yield json.dumps(item) + "\n"
        finally:
            await graph_task

    return StreamingResponse(node_stream(), media_type="application/x-ndjson")


async def _run_refine_agent(ws, graph_input, thread_id: str,
                            llm_config: Optional[LLMConfig] = None):
    """Corre (o reanuda) el loop ReAct sobre `ws` emitiendo eventos NDJSON en vivo
    (generador async). S7.5: astream(stream_mode="updates") en vez de ainvoke —
    cada nodo completado yielda su aporte al estado y tool_events lo traduce a
    eventos `tool_call`/`tool_result` (con el delta del servidor) que el frontend
    pinta sin esperar al final. El desenlace terminal sigue siendo único:
    `clarification` si el grafo quedó pausado en interrupt() (el workspace se
    retiene en sesión para la reanudación), `done` con el snapshot completo +
    refinement_history si terminó (verdad que el frontend aplica SIEMPRE,
    reconciliando cualquier evento perdido). Compartido por /refine/stream y
    /refine/resume: ambos desenlaces pueden darse en cualquiera de los dos (una
    reanudación puede volver a pedir aclaración)."""
    from agent_graph import build_agent_graph, extract_history, tool_events

    agent_graph = build_agent_graph(ws, checkpointer=_get_checkpointer(),
                                    llm_config=llm_config)
    # recursion_limit acota el loop ReAct: cada vuelta agent→tools cuenta; un tope
    # evita que un modelo que no converge gire indefinidamente.
    config = {"configurable": {"thread_id": thread_id}, "recursion_limit": 50}

    interrupt_payload = None
    async for update in agent_graph.astream(graph_input, config, stream_mode="updates"):
        if "__interrupt__" in update:
            # El interrupt aparece como chunk propio del stream; el evento
            # clarification se emite al final (tras agotar el stream) para
            # mantener un único desenlace terminal por respuesta HTTP.
            interrupt_payload = update["__interrupt__"][0].value
            continue
        for event in tool_events(update, ws):
            yield event

    if interrupt_payload is not None:
        # Grafo pausado en clarify: retenemos el workspace (ya mutado por las
        # tools previas al interrupt) hasta que llegue la respuesta del usuario.
        # Aprovechamos para purgar clarificaciones abandonadas y anotamos el deadline.
        await _sweep_expired_clarifications()
        _pending_clarifications[thread_id] = (ws, time.monotonic() + _CLARIFICATION_TTL_SECONDS)
        yield {
            "_type": "clarification",
            "thread_id": thread_id,
            "question": interrupt_payload.get("question", ""),
            "options": interrupt_payload.get("options", []),
        }
        return

    # astream no devuelve el estado final como ainvoke: se recupera del
    # checkpointer (aget_state) — de ahí salen los messages para derivar la traza.
    # refinement_history se DERIVA de los messages finales (extract_history): la
    # traza ya existe en el estado del grafo, no se construye en paralelo.
    state = await agent_graph.aget_state(config)
    yield {
        "_type": "done",
        "title": None,
        "diagram": ws.to_compact().model_dump(mode="json"),
        "refinement_history": extract_history(state.values.get("messages", [])),
        "degraded": False,
        "degradations": [],
    }
    # Refinamiento cerrado: el checkpoint de este thread ya no se necesita. Lo
    # purgamos para que los threads del InMemorySaver no crezcan por cada /refine.
    await _forget_thread(thread_id)


def _log_refine_event(event: dict) -> None:
    """Log de transmisión del agente (espejo del ⏩ del gateway): una línea por
    evento NDJSON emitido por el loop ReAct."""
    t = event.get("_type")
    if t == "tool_call":
        print(f"[refine] tool_call   → {event['tool']}({json.dumps(event.get('args', {}), ensure_ascii=False)})")
    elif t == "tool_result":
        extra = f" +node {event['node']['id']}" if "node" in event else f" +edge {event['edge']['id']}" if "edge" in event else ""
        print(f"[refine] tool_result → {event['tool']}: {json.dumps(event.get('result'), ensure_ascii=False)[:200]}{extra}")
    elif t == "clarification":
        print(f"[refine] clarification → \"{event.get('question', '')}\" opciones={event.get('options', [])}")
    elif t == "done":
        d = event.get("diagram") or {}
        print(f"[refine] done → {len(d.get('nodes', []))} nodos, {len(d.get('edges', []))} aristas · "
              f"history: {[h['tool'] for h in event.get('refinement_history', [])]}")


# Nombre legible + URL de gestión de la API key por proveedor, para construir
# mensajes accionables ("revisa tu key de OpenAI en …").
_PROVIDER_INFO: dict[str, dict[str, str]] = {
    "openai": {"label": "OpenAI", "keys_url": "https://platform.openai.com/api-keys"},
    "anthropic": {"label": "Anthropic", "keys_url": "https://console.anthropic.com/settings/keys"},
    "gemini": {"label": "Gemini", "keys_url": "https://aistudio.google.com/app/apikey"},
    "ollama": {"label": "Ollama", "keys_url": ""},
}


def _classify_provider_exception(e: Exception, provider: Optional[str] = None) -> Optional[str]:
    """Mapea una excepción del proveedor LLM (lanzada por LangChain durante el loop
    ReAct de /refine) a un mensaje accionable en español, o None si no es un fallo
    reconocible del proveedor.

    El loop ReAct usa los chat models de LangChain (ChatOpenAI/ChatAnthropic/…), que
    NO levantan nuestro LLMError sino las excepciones nativas del SDK
    (openai.AuthenticationError, anthropic.AuthenticationError, …). Sin esto, un 401
    por API key inválida caía en el `except Exception` genérico y el usuario veía
    «vuelve a intentarlo» — un consejo inútil: reintentar con la misma key vuelve a
    fallar. Detectamos por status_code / nombre de clase / texto para no acoplarnos a
    los SDKs (que pueden no estar instalados según el proveedor activo)."""
    status = getattr(e, "status_code", None) or getattr(
        getattr(e, "response", None), "status_code", None
    )
    name = type(e).__name__
    text = str(e).lower()

    info = _PROVIDER_INFO.get(provider or "", {"label": "LLM", "keys_url": ""})
    label = info["label"]
    keys_url = info["keys_url"]

    is_auth = (
        status == 401
        or "authenticationerror" in name.lower()
        or "permissiondenied" in name.lower()
        or "invalid_api_key" in text
        or "incorrect api key" in text
        or "invalid x-api-key" in text
        or "api key not valid" in text
    )
    if is_auth:
        where = f" Genera o copia una válida en {keys_url} y" if keys_url else " La key correcta y"
        return (
            f"La API key de {label} no es válida o ha caducado.{where} pégala en "
            f"«Configuración del modelo de lenguaje» para el proveedor {label}."
        )

    is_rate = status == 429 or "ratelimit" in name.lower() or "rate limit" in text
    if is_rate:
        return (
            f"Has superado el límite de uso (o la cuota) de {label}. Espera un momento "
            f"o revisa tu plan en el panel de {label}."
        )

    # Conexión rechazada / timeout: el proveedor está caído o inalcanzable. El loop
    # ReAct usa LangChain, que envuelve los errores httpx/SDK con nombres y mensajes
    # distintos (APIConnectionError, ConnectError, ConnectTimeout, ReadTimeout…); sin
    # esto caían en el `except Exception` genérico ("vuelve a intentarlo"), inútil si
    # el servicio no responde. Detectamos por nombre de clase / texto para no
    # acoplarnos a un SDK concreto (pueden no estar instalados).
    name_l = name.lower()
    is_conn = (
        "connecterror" in name_l
        or "connectionerror" in name_l
        or "connecttimeout" in name_l
        or "apiconnectionerror" in name_l
        or "remoteprotocolerror" in name_l
        or "connection refused" in text
        or "connection error" in text
        or "failed to connect" in text
        or "max retries exceeded" in text
        or "name or service not known" in text
    )
    is_timeout = (
        "timeout" in name_l
        or "timedout" in name_l
        or "timed out" in text
        or "timeout" in text
    )
    if is_conn or is_timeout:
        return (
            f"No se pudo conectar con el proveedor LLM ({label}) o tardó demasiado en "
            f"responder. Revisa que el servicio esté disponible (si es local, que "
            f"Ollama esté corriendo) y vuelve a intentarlo."
        )

    return None


def _refine_response(ws, graph_input, thread_id: str,
                     llm_config: Optional[LLMConfig] = None) -> StreamingResponse:
    async def stream():
        try:
            async for event in _run_refine_agent(ws, graph_input, thread_id,
                                                 llm_config=llm_config):
                _log_refine_event(event)
                yield json.dumps(event) + "\n"
        except NotImplementedError as e:
            # Error explícito para transport='browser' en /refine (no soportado).
            print(f"[refine_stream] not implemented: {e!r}")
            yield json.dumps({
                "_type": "error",
                "category": "internal_error",
                "message": str(e),
            }) + "\n"
        except LLMError as e:
            print(
                f"[refine_stream] llm error: {e!r} "
                f"provider={llm_config.provider if llm_config else 'env'} "
                f"api_key_present={bool(llm_config and llm_config.api_key)}"
            )
            yield json.dumps(llm_error_event(
                e.message, llm_config.provider if llm_config is not None else None,
            )) + "\n"
        except Exception as e:
            print(f"[refine_stream] agent error: {e!r}")
            # Auth/cuota del proveedor → mensaje accionable (reintentar no sirve).
            prov = llm_config.provider if llm_config is not None else None
            provider_msg = _classify_provider_exception(e, prov)
            if provider_msg is not None:
                yield json.dumps(llm_error_event(provider_msg, prov)) + "\n"
            else:
                yield json.dumps({
                    "_type": "error",
                    "category": "internal_error",
                    "message": "Se produjo un error refinando el diagrama. Vuelve a intentarlo en unos segundos.",
                }) + "\n"

    return StreamingResponse(stream(), media_type="application/x-ndjson")


@app.post("/refine/stream")
async def refine_stream(req: RefineRequest):
    # S7.3 — Loop ReAct real. Construimos el workspace de ESTA petición desde el
    # diagrama compacto, y un grafo de agente cuyas tools cierran sobre él. El
    # workspace es la fuente de verdad: las tools lo mutan, y al terminar
    # ws.to_compact() es el diagrama refinado (incluido el caso regenerate, que lo
    # reemplaza por dentro). Imports locales para no acoplar el arranque del módulo
    # a langchain (solo se necesita en este endpoint).
    from langchain_core.messages import SystemMessage, HumanMessage
    from agent_graph import build_system_prompt
    from tools import DiagramWorkspace

    ws = DiagramWorkspace.from_compact(req.diagram)
    messages = [SystemMessage(content=build_system_prompt(ws)), HumanMessage(content=req.prompt)]
    thread_id = uuid.uuid4().hex
    return _refine_response(ws, {"messages": messages}, thread_id,
                            llm_config=req.llm_config)


@app.post("/refine/resume")
async def refine_resume(req: ResumeRequest):
    # S7.4 — La respuesta del usuario reanuda el grafo pausado: Command(resume=
    # answer) hace que el interrupt() del nodo clarify DEVUELVA ese texto, y el
    # checkpointer restaura los messages por thread_id. El workspace pendiente se
    # extrae de sesión (si vuelve a interrumpir, _run_refine_agent lo re-retiene).
    from langgraph.types import Command

    # Purga primero las abandonadas: si esta misma respuesta llega pasado el TTL, el
    # thread ya no estará y devolvemos 404 (mensaje ya contempla la expiración).
    await _sweep_expired_clarifications()
    entry = _pending_clarifications.pop(req.thread_id, None)
    if entry is None:
        raise HTTPException(
            status_code=404,
            detail="No hay ninguna clarificación pendiente para ese thread_id (¿expiró o ya fue respondida?).",
        )
    ws, _deadline = entry
    return _refine_response(ws, Command(resume=req.answer), req.thread_id,
                            llm_config=req.llm_config)
