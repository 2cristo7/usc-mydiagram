import ipaddress
import json
import os
import socket
import httpx

from pydantic import BaseModel
from typing import Optional
from urllib.parse import urlparse

# ---------------------------------------------------------------------------
# Excepción pública para fallos del LLM
# ---------------------------------------------------------------------------

class LLMError(Exception):
    """Excepción que representa un fallo conocido de cualquier backend LLM.

    Atributos:
        category (str): siempre 'llm_error' — identifica la categoría de error
            para el cliente (mismo esquema que las categorías de outcome.py).
        message (str): mensaje en español accionable, listo para mostrar al usuario.
    """
    def __init__(self, message: str):
        super().__init__(message)
        self.category: str = "llm_error"
        self.message: str = message


# ---------------------------------------------------------------------------
# Timeouts granulares por env (S10.x)
# ---------------------------------------------------------------------------
# Un único timeout total (httpx.AsyncClient(timeout=N)) no distingue «el servicio
# está caído» (se nota en el connect) de «el modelo tarda en generar» (read largo
# legítimo). Separamos ambos: un connect-timeout corto detecta rápido un proveedor
# inalcanzable; un read-timeout largo tolera la generación. Configurables por env
# con defaults sensatos (connect 10s; read distinto para Ollama local, que puede
# cargar el modelo en la primera petición, vs las APIs comerciales).

def _llm_timeout(default_read: float) -> "httpx.Timeout":
    """Construye un httpx.Timeout granular configurable por env.

    `default_read` es el read-timeout por defecto si no hay env var (más alto para
    backends locales que cargan el modelo en frío). connect/write/pool comparten un
    connect-timeout corto para detectar pronto un servicio caído."""
    connect = float(os.environ.get("LLM_CONNECT_TIMEOUT", "10"))
    read = float(os.environ.get("LLM_READ_TIMEOUT", str(default_read)))
    return httpx.Timeout(connect=connect, read=read, write=connect, pool=connect)


# Mensaje uniforme para un fallo de red genérico (corte de stream, reset de
# conexión, error de protocolo…): todos los backends lo reutilizan. httpx.HTTPError
# es la clase base que cubre ConnectError/TimeoutException/RemoteProtocolError/
# ReadError/NetworkError/etc.; los except específicos (connect/timeout/status) van
# ANTES para dar un mensaje más fino, y este captura el resto.
def _network_llm_error(provider: str, exc: Exception) -> "LLMError":
    return LLMError(
        f"Se interrumpió la conexión con el proveedor LLM ({provider}). "
        "Revisa que el servicio esté disponible y vuelve a intentarlo."
    )


def _require_non_empty(content: str, provider: str) -> str:
    """Garantiza que el contenido devuelto por el modelo no esté vacío.

    Una respuesta vacía o solo whitespace (truncado, cuota agotada, o qwen3 que gastó
    todo el presupuesto en el bloque de razonamiento) NO debe propagarse como "" —
    aguas abajo se confundiría con «0 nodos» perdiendo la causa real. Se convierte en
    un LLMError accionable."""
    if not content or not content.strip():
        raise LLMError(
            f"El proveedor LLM ({provider}) devolvió una respuesta vacía "
            "(posible truncado, cuota agotada o límite de tokens). Vuelve a intentarlo."
        )
    return content


# ---------------------------------------------------------------------------
# Filtro de tokens de razonamiento (<think>...</think>) para modelos locales
# ---------------------------------------------------------------------------

_THINK_OPEN = "<think>"
_THINK_CLOSE = "</think>"
_TAIL = max(len(_THINK_OPEN), len(_THINK_CLOSE)) - 1  # margen por si el tag llega partido


async def _strip_think(stream):
    """Elimina bloques <think>...</think> de un stream de texto, con estado
    entre chunks para tolerar tags partidos en la frontera de dos chunks."""
    buf = ""
    in_think = False
    async for content in stream:
        buf += content
        out = ""
        while True:
            if in_think:
                i = buf.find(_THINK_CLOSE)
                if i == -1:
                    # seguimos dentro: descartamos, retenemos cola por si es media etiqueta
                    if len(buf) > _TAIL:
                        buf = buf[-_TAIL:]
                    break
                buf = buf[i + len(_THINK_CLOSE):]
                in_think = False
            else:
                i = buf.find(_THINK_OPEN)
                if i == -1:
                    # fuera de think: emitimos todo menos la posible media etiqueta de cola
                    if len(buf) > _TAIL:
                        out += buf[:-_TAIL]
                        buf = buf[-_TAIL:]
                    break
                out += buf[:i]
                buf = buf[i + len(_THINK_OPEN):]
                in_think = True
        if out:
            yield out
    if not in_think and buf:
        yield buf


# ---------------------------------------------------------------------------
# Saneado a array JSON para el parser ijson de extract_nodes/edges/fragments
# ---------------------------------------------------------------------------

class JsonArrayStream:
    """Envuelve un stream de texto del LLM y reemite SOLO el array JSON de nivel
    superior: descarta lo que venga ANTES del primer '[' (prosa, una disculpa del
    modelo, una valla ```json…) y todo lo que venga DESPUÉS del ']' que lo cierra.

    Motivo: extract_nodes/edges/fragments alimentan los chunks CRUDOS a ijson, que
    aborta con «lexical error: invalid char in json text» en cuanto ve un carácter
    no-JSON. Los modelos locales (qwen3) a menudo envuelven el array en
    explicaciones o vallas markdown, así que un solo carácter de prosa al principio
    tiraba abajo todo el parseo y el diagrama salía vacío aunque el JSON estuviera
    ahí. Este filtro lo recupera.

    Rastrea la profundidad de '['/'{' respetando las cadenas (un '[' o '"' dentro
    de un string NO cuenta), de modo que recorta el cierre exacto del array aunque
    el modelo siga escribiendo texto a continuación. El estado persiste entre
    chunks: tolera arrays partidos en cualquier punto (incluso a mitad de cadena).

    `found` queda en True si se llegó a ver el '[' de apertura. False ⇒ el modelo
    no devolvió ningún array (rechazo o prosa pura): el llamante lo trata como
    «cero elementos» sin que ijson haya tenido que fallar.

    Limitación conocida: si aparece un '[' suelto en la prosa ANTES del array real
    (p. ej. "el diagrama [borrador]: [...]"), empezaría a capturar ahí y el parseo
    fallaría igual. Los prompts exigen array JSON puro, así que el caso real es
    prosa/valla sin corchetes sueltos; se asume ese riesgo a cambio de simplicidad.
    """

    def __init__(self, stream):
        self._stream = stream
        self.found = False

    async def __aiter__(self):
        depth = 0
        in_string = False
        escape = False
        done = False
        async for content in self._stream:
            if done:
                # El array de nivel superior ya cerró: seguimos consumiendo el
                # stream hasta agotarlo (cierre limpio de la conexión) sin emitir.
                continue
            out = []
            for ch in content:
                if not self.found:
                    if ch == "[":
                        self.found = True
                        depth = 1
                        out.append(ch)
                    # cualquier carácter previo al array (prosa, ```json) se descarta
                    continue
                out.append(ch)
                if in_string:
                    if escape:
                        escape = False
                    elif ch == "\\":
                        escape = True
                    elif ch == '"':
                        in_string = False
                    continue
                if ch == '"':
                    in_string = True
                elif ch in "[{":
                    depth += 1
                elif ch in "]}":
                    depth -= 1
                    if depth == 0:
                        done = True
                        break
            if out:
                yield "".join(out)


# ---------------------------------------------------------------------------
# Backends (raw HTTP, sin LangChain)
# ---------------------------------------------------------------------------

class OllamaBackend:
    def __init__(self, model: str, url: str):
        self.model = model
        self.url = url

    async def complete(self, system: str, user: str, max_tokens: int) -> str:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user",   "content": f"/no_think\n{user}"},
            ],
            "stream": False,
            "think": False,
            "options": {"num_predict": max_tokens},
        }
        print(f"\n[OLLAMA/{self.model}] system: {system[:80]}...")
        print(f"[OLLAMA/{self.model}] user:   {user[:120]}")
        try:
            async with httpx.AsyncClient(timeout=_llm_timeout(300)) as client:
                response = await client.post(self.url, json=payload)
                response.raise_for_status()
            content = response.json()["message"]["content"]
        except httpx.HTTPStatusError as exc:
            raise LLMError(f"Ollama respondió HTTP {exc.response.status_code}.") from exc
        except httpx.ConnectError as exc:
            raise LLMError(
                "No se pudo conectar con Ollama. ¿Está corriendo (`ollama serve`)?"
            ) from exc
        except httpx.TimeoutException as exc:
            raise LLMError("El proveedor LLM (Ollama) tardó demasiado en responder.") from exc
        except (json.JSONDecodeError, KeyError, IndexError) as exc:
            raise LLMError("El proveedor LLM (Ollama) devolvió una respuesta inesperada.") from exc
        except httpx.HTTPError as exc:
            # Corte de conexión / error de red genérico (RemoteProtocolError,
            # ReadError, NetworkError…): mensaje accionable, no internal_error.
            raise _network_llm_error("Ollama", exc) from exc
        if "<think>" in content and "</think>" in content:
            content = content.split("</think>")[-1].strip()
        content = _require_non_empty(content, "Ollama")
        print(f"[OLLAMA/{self.model}] reply:  {content[:200]}")
        return content

    async def stream(self, system: str, user: str, max_tokens: int):
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user",   "content": f"/no_think\n{user}"},
            ],
            "stream": True,
            "think": False,
            "options": {"num_predict": max_tokens},
        }
        print(f"\n[OLLAMA/{self.model}] stream system: {system[:80]}...")

        async def _raw():
            dropped = 0  # líneas de streaming malformadas descartadas
            try:
                async with httpx.AsyncClient(timeout=_llm_timeout(300)) as client:
                    async with client.stream("POST", self.url, json=payload) as response:
                        try:
                            response.raise_for_status()
                        except httpx.HTTPStatusError as exc:
                            raise LLMError(
                                f"Ollama respondió HTTP {exc.response.status_code}."
                            ) from exc
                        async for line in response.aiter_lines():
                            if line:
                                try:
                                    data = json.loads(line)
                                    content = data.get("message", {}).get("content", "")
                                    if content:
                                        yield content
                                except (json.JSONDecodeError, KeyError):
                                    dropped += 1
            except LLMError:
                raise
            except httpx.ConnectError as exc:
                raise LLMError(
                    "No se pudo conectar con Ollama. ¿Está corriendo (`ollama serve`)?"
                ) from exc
            except httpx.TimeoutException as exc:
                raise LLMError(
                    "El proveedor LLM (Ollama) tardó demasiado en responder."
                ) from exc
            except httpx.HTTPError as exc:
                # Corte a mitad de stream (RemoteProtocolError/ReadError) u otro
                # error de red genérico: mensaje accionable, no internal_error.
                raise _network_llm_error("Ollama", exc) from exc
            if dropped:
                # No tragar en silencio un formato de streaming sistemáticamente
                # inesperado: dejamos señal del número de líneas descartadas.
                print(f"[OLLAMA/{self.model}] stream: {dropped} línea(s) malformada(s) descartada(s)")

        async for chunk in _strip_think(_raw()):
            yield chunk


class OpenAIBackend:
    def __init__(self, model: str, api_key: str):
        self.model = model
        self.api_key = api_key
        self.url = "https://api.openai.com/v1/chat/completions"

    async def complete(self, system: str, user: str, max_tokens: int) -> str:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ],
            "max_tokens": max_tokens,
        }
        headers = {"Authorization": f"Bearer {self.api_key}"}
        print(f"\n[OPENAI/{self.model}] system: {system[:80]}...")
        print(f"[OPENAI/{self.model}] user:   {user[:120]}")
        try:
            async with httpx.AsyncClient(timeout=_llm_timeout(120)) as client:
                response = await client.post(self.url, json=payload, headers=headers)
                response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status == 401:
                raise LLMError(
                    "La API key del proveedor LLM no es válida o falta (HTTP 401)."
                ) from exc
            raise LLMError(f"El proveedor LLM (OpenAI) respondió HTTP {status}.") from exc
        except httpx.ConnectError as exc:
            raise LLMError("No se pudo conectar con el proveedor LLM (OpenAI).") from exc
        except httpx.TimeoutException as exc:
            raise LLMError("El proveedor LLM (OpenAI) tardó demasiado en responder.") from exc
        except (json.JSONDecodeError, KeyError, IndexError) as exc:
            raise LLMError("El proveedor LLM (OpenAI) devolvió una respuesta inesperada.") from exc
        except httpx.HTTPError as exc:
            # Error de red genérico (corte, reset, protocolo): accionable, no interno.
            raise _network_llm_error("OpenAI", exc) from exc
        content = _require_non_empty(content, "OpenAI")
        print(f"[OPENAI/{self.model}] reply:  {content[:200]}")
        return content

    async def stream(self, system: str, user: str, max_tokens: int):
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user",   "content": user},
            ],
            "max_tokens": max_tokens,
            "stream": True,
        }
        headers = {"Authorization": f"Bearer {self.api_key}"}
        print(f"\n[OPENAI/{self.model}] stream system: {system[:80]}...")
        dropped = 0  # líneas SSE malformadas descartadas
        try:
            async with httpx.AsyncClient(timeout=_llm_timeout(120)) as client:
                async with client.stream("POST", self.url, json=payload, headers=headers) as response:
                    try:
                        response.raise_for_status()
                    except httpx.HTTPStatusError as exc:
                        status = exc.response.status_code
                        if status == 401:
                            raise LLMError(
                                "La API key del proveedor LLM no es válida o falta (HTTP 401)."
                            ) from exc
                        raise LLMError(
                            f"El proveedor LLM (OpenAI) respondió HTTP {status}."
                        ) from exc
                    async for line in response.aiter_lines():
                        if line.startswith("data: ") and line != "data: [DONE]":
                            try:
                                data = json.loads(line[6:])
                                content = data["choices"][0]["delta"].get("content", "")
                                if content:
                                    yield content
                            except (json.JSONDecodeError, KeyError):
                                dropped += 1
        except LLMError:
            raise
        except httpx.ConnectError as exc:
            raise LLMError("No se pudo conectar con el proveedor LLM (OpenAI).") from exc
        except httpx.TimeoutException as exc:
            raise LLMError("El proveedor LLM (OpenAI) tardó demasiado en responder.") from exc
        except httpx.HTTPError as exc:
            # Corte a mitad de stream (RemoteProtocolError/ReadError) u otro error de
            # red genérico: mensaje accionable, no internal_error.
            raise _network_llm_error("OpenAI", exc) from exc
        if dropped:
            print(f"[OPENAI/{self.model}] stream: {dropped} línea(s) SSE malformada(s) descartada(s)")


class AnthropicBackend:
    """Backend HTTP crudo para la API de Anthropic (Messages API).

    El stream devuelve el texto completo en un único chunk (no requiere streaming
    incremental real — compatible con el parser ijson de extract_nodes/edges).
    """

    def __init__(self, model: str, api_key: str):
        self.model = model
        self.api_key = api_key
        self.url = "https://api.anthropic.com/v1/messages"

    def _headers(self) -> dict:
        return {
            "x-api-key": self.api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

    def _payload(self, system: str, user: str, max_tokens: int) -> dict:
        return {
            "model": self.model,
            "max_tokens": max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": user}],
        }

    async def complete(self, system: str, user: str, max_tokens: int) -> str:
        print(f"\n[ANTHROPIC/{self.model}] system: {system[:80]}...")
        print(f"[ANTHROPIC/{self.model}] user:   {user[:120]}")
        try:
            async with httpx.AsyncClient(timeout=_llm_timeout(120)) as client:
                response = await client.post(
                    self.url,
                    json=self._payload(system, user, max_tokens),
                    headers=self._headers(),
                )
                response.raise_for_status()
            content = response.json()["content"][0]["text"]
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status == 401:
                raise LLMError(
                    "La API key del proveedor LLM no es válida o falta (HTTP 401)."
                ) from exc
            raise LLMError(f"El proveedor LLM (Anthropic) respondió HTTP {status}.") from exc
        except httpx.ConnectError as exc:
            raise LLMError("No se pudo conectar con el proveedor LLM (Anthropic).") from exc
        except httpx.TimeoutException as exc:
            raise LLMError("El proveedor LLM (Anthropic) tardó demasiado en responder.") from exc
        except (json.JSONDecodeError, KeyError, IndexError) as exc:
            raise LLMError(
                "El proveedor LLM (Anthropic) devolvió una respuesta inesperada."
            ) from exc
        except httpx.HTTPError as exc:
            # Error de red genérico (corte, reset, protocolo): accionable, no interno.
            raise _network_llm_error("Anthropic", exc) from exc
        content = _require_non_empty(content, "Anthropic")
        print(f"[ANTHROPIC/{self.model}] reply:  {content[:200]}")
        return content

    async def stream(self, system: str, user: str, max_tokens: int):
        # Anthropic soporta streaming SSE, pero para la generación de JSON con
        # ijson basta con devolver el texto completo en un único chunk.
        content = await self.complete(system, user, max_tokens)
        yield content


class GeminiBackend:
    """Backend HTTP crudo para la API de Google Gemini (generateContent).

    El stream devuelve el texto completo en un único chunk.
    """

    def __init__(self, model: str, api_key: str):
        self.model = model
        self.api_key = api_key

    def _url(self) -> str:
        return (
            f"https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model}:generateContent?key={self.api_key}"
        )

    def _payload(self, system: str, user: str, max_tokens: int) -> dict:
        return {
            "system_instruction": {"parts": [{"text": system}]},
            "contents": [{"role": "user", "parts": [{"text": user}]}],
            "generationConfig": {"maxOutputTokens": max_tokens},
        }

    async def complete(self, system: str, user: str, max_tokens: int) -> str:
        print(f"\n[GEMINI/{self.model}] system: {system[:80]}...")
        print(f"\n[GEMINI/{self.model}] user:   {user[:120]}")
        try:
            async with httpx.AsyncClient(timeout=_llm_timeout(120)) as client:
                response = await client.post(
                    self._url(),
                    json=self._payload(system, user, max_tokens),
                )
                response.raise_for_status()
            content = response.json()["candidates"][0]["content"]["parts"][0]["text"]
        except httpx.HTTPStatusError as exc:
            status = exc.response.status_code
            if status == 401:
                raise LLMError(
                    "La API key del proveedor LLM no es válida o falta (HTTP 401)."
                ) from exc
            raise LLMError(f"El proveedor LLM (Gemini) respondió HTTP {status}.") from exc
        except httpx.ConnectError as exc:
            raise LLMError("No se pudo conectar con el proveedor LLM (Gemini).") from exc
        except httpx.TimeoutException as exc:
            raise LLMError("El proveedor LLM (Gemini) tardó demasiado en responder.") from exc
        except (json.JSONDecodeError, KeyError, IndexError) as exc:
            raise LLMError(
                "El proveedor LLM (Gemini) devolvió una respuesta inesperada."
            ) from exc
        except httpx.HTTPError as exc:
            # Error de red genérico (corte, reset, protocolo): accionable, no interno.
            raise _network_llm_error("Gemini", exc) from exc
        content = _require_non_empty(content, "Gemini")
        print(f"[GEMINI/{self.model}] reply:  {content[:200]}")
        return content

    async def stream(self, system: str, user: str, max_tokens: int):
        content = await self.complete(system, user, max_tokens)
        yield content


class BrowserBackend:
    """Backend que delega la llamada LLM al gateway via proxy HTTP interno.

    El cliente (browser) tiene una sesión WebSocket con el gateway. El agente
    no llama al modelo directamente; el gateway lo reenvía al browser que ejecuta
    Ollama localmente.

    Contrato del gateway (POST {GATEWAY_INTERNAL_URL}/internal/llm):
      Headers: X-Internal-Token: {INTERNAL_PROXY_SECRET}
      Body:    { proxy_session, model, messages: [{role, content}], options }
      200:     { content: str }
      409:     { error_code: "browser_disconnected" }
      502:     { error_code, detail }
      504:     { error_code: "timeout" }
    """

    def __init__(self, model: str, proxy_session: str):
        self.model = model
        self.proxy_session = proxy_session
        self.gateway_url = os.environ.get("GATEWAY_INTERNAL_URL", "http://localhost:3001")
        self.internal_token = os.environ.get("INTERNAL_PROXY_SECRET", "")

    def _messages(self, system: str, user: str) -> list:
        # Mismo trato que OllamaBackend: el prefijo /no_think desactiva el modo de
        # razonamiento de qwen3 (si no, gasta los tokens "pensando" y content sale
        # vacío). Se combina con "think": False en el payload.
        return [
            {"role": "system", "content": system},
            {"role": "user", "content": f"/no_think\n{user}"},
        ]

    async def complete(self, system: str, user: str, max_tokens: int) -> str:
        print(f"\n[BROWSER/{self.model}] proxy_session={self.proxy_session} system: {system[:80]}...")
        payload = {
            "proxy_session": self.proxy_session,
            "model": self.model,
            "messages": self._messages(system, user),
            # think: False viaja al navegador, que lo reenvía a Ollama. Imprescindible
            # para modelos de razonamiento (qwen3) o content vuelve vacío.
            "think": False,
            "options": {"num_predict": max_tokens},
        }
        headers = {"X-Internal-Token": self.internal_token}
        try:
            async with httpx.AsyncClient(timeout=_llm_timeout(300)) as client:
                response = await client.post(
                    f"{self.gateway_url}/internal/llm",
                    json=payload,
                    headers=headers,
                )
        except httpx.ConnectError as exc:
            raise LLMError(
                "No se pudo conectar con el proveedor LLM (BrowserProxy)."
            ) from exc
        except httpx.TimeoutException as exc:
            raise LLMError(
                "El proveedor LLM (BrowserProxy) tardó demasiado en responder."
            ) from exc
        except httpx.HTTPError as exc:
            # Error de red genérico (corte, reset, protocolo): accionable, no interno.
            raise _network_llm_error("BrowserProxy", exc) from exc
        if response.status_code == 401:
            raise LLMError(
                "La configuración del proxy interno del navegador es inválida (HTTP 401). "
                "Revisa INTERNAL_PROXY_SECRET."
            )
        if response.status_code == 409:
            raise LLMError(
                "El navegador se desconectó antes de que el modelo pudiera responder "
                "(browser_disconnected). Recarga la página y vuelve a intentarlo."
            )
        if response.status_code == 504:
            raise LLMError(
                "El navegador tardó demasiado en responder (timeout). "
                "Comprueba que Ollama está corriendo localmente y vuelve a intentarlo."
            )
        if response.status_code == 502:
            try:
                body = response.json()
            except Exception:
                body = {}
            detail = body.get("detail", response.text)
            raise LLMError(
                f"El proxy del navegador devolvió un error (502): {detail}"
            )
        try:
            response.raise_for_status()
            content = response.json()["content"]
        except httpx.HTTPStatusError as exc:
            raise LLMError(
                f"El proveedor LLM (BrowserProxy) respondió HTTP {exc.response.status_code}."
            ) from exc
        except (json.JSONDecodeError, KeyError, IndexError) as exc:
            raise LLMError(
                "El proveedor LLM (BrowserProxy) devolvió una respuesta inesperada."
            ) from exc
        content = _require_non_empty(content, "BrowserProxy")
        print(f"[BROWSER/{self.model}] reply:  {content[:200]}")
        return content

    async def stream(self, system: str, user: str, max_tokens: int):
        # El proxy no implementa streaming SSE; devolvemos el texto completo en
        # un único chunk (compatible con el parser ijson de extract_nodes/edges).
        content = await self.complete(system, user, max_tokens)
        yield content


# ---------------------------------------------------------------------------
# LLMConfig — configuración por petición (opcional; None → env-based)
# ---------------------------------------------------------------------------

def _validate_user_base_url(raw: str) -> str:
    """Valida una `base_url` SUMINISTRADA POR EL USUARIO antes de que el agente la
    use como destino de una petición HTTP (mitigación SSRF).

    El agente corre en la red interna; sin esta comprobación un usuario autenticado
    podría apuntar `base_url` a `http://169.254.169.254/...` (metadatos del cloud) o
    a servicios internos y forzar al agente a hacerles la petición desde dentro.
    Por eso solo se permiten URLs http/https hacia hosts PÚBLICOS: resolvemos el
    host y rechazamos cualquier IP loopback/privada/link-local/reservada.

    Si el operador necesita un Ollama en una IP privada, lo configura por env
    (`OLLAMA_URL`, valor de confianza), nunca por la `base_url` de un usuario.

    Limitación conocida: validamos la IP resuelta pero no la fijamos para la
    petición posterior, así que un DNS-rebinding determinado podría sortearlo.
    Para el alcance actual es defensa suficiente; el resolve-then-pin queda como
    endurecimiento pendiente.
    """
    try:
        parsed = urlparse(raw)
    except ValueError:
        raise LLMError("La URL del servidor LLM no es válida.")

    if parsed.scheme not in ("http", "https"):
        raise LLMError("La URL del servidor LLM debe usar http o https.")

    host = parsed.hostname
    if not host:
        raise LLMError("La URL del servidor LLM no tiene host.")

    try:
        infos = socket.getaddrinfo(host, parsed.port, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        raise LLMError(f"No se pudo resolver el host del servidor LLM: {host}")

    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (ip.is_private or ip.is_loopback or ip.is_link_local
                or ip.is_reserved or ip.is_multicast or ip.is_unspecified):
            raise LLMError(
                "La URL del servidor LLM apunta a una dirección interna no permitida."
            )

    return raw


class LLMConfig(BaseModel):
    """Configuración LLM por petición. Si ausente/None en el body → comportamiento
    histórico basado en env vars (LLM_PROFILE). Todos los campos son opcionales
    excepto provider y transport."""

    provider: str          # "openai" | "anthropic" | "gemini" | "ollama"
    transport: str         # "api" | "direct" | "browser"
    model_fast: str
    model_capable: str
    api_key: Optional[str] = None      # comercial; None para ollama
    base_url: Optional[str] = None     # override ollama-direct; None si no
    proxy_session: Optional[str] = None  # socket id para ollama-browser; None si no


# ---------------------------------------------------------------------------
# LLMRuntime — abstracción per-request que expone complete/stream por tier
# ---------------------------------------------------------------------------

class LLMRuntime:
    """Objeto per-request que encapsula la selección de modelo y backend.

    Expone complete(system, user, tier, max_tokens) y stream(system, user, tier,
    max_tokens) donde tier ∈ "fast" | "capable".

    Si se construye con config=None, resuelve desde env vars (comportamiento
    histórico). Así los nodos del grafo pueden usar siempre el runtime sin saber
    si viene de una petición con LLMConfig o de la configuración global.
    """

    def __init__(self, config: Optional[LLMConfig] = None):
        self._config = config  # None = resolver desde env en tiempo de llamada

    def _backend_for(self, tier: str):
        cfg = self._config
        if cfg is None:
            return _resolve_model(tier)

        model = cfg.model_fast if tier == "fast" else cfg.model_capable

        if cfg.provider == "ollama":
            if cfg.transport == "browser":
                if not cfg.proxy_session:
                    raise ValueError(
                        "transport='browser' requiere proxy_session para Ollama en el navegador."
                    )
                return BrowserBackend(model=model, proxy_session=cfg.proxy_session)
            # direct o "api" por compatibilidad
            if cfg.base_url:
                url = _validate_user_base_url(cfg.base_url)
            else:
                url = os.environ.get("OLLAMA_URL", "http://localhost:11434/api/chat")
            return OllamaBackend(model=model, url=url)

        if cfg.provider == "openai":
            api_key = cfg.api_key or os.environ.get("OPENAI_API_KEY", "")
            return OpenAIBackend(model=model, api_key=api_key)

        if cfg.provider == "anthropic":
            api_key = cfg.api_key or os.environ.get("ANTHROPIC_API_KEY", "")
            return AnthropicBackend(model=model, api_key=api_key)

        if cfg.provider == "gemini":
            api_key = cfg.api_key or os.environ.get("GEMINI_API_KEY", "")
            return GeminiBackend(model=model, api_key=api_key)

        raise ValueError(
            f"Proveedor desconocido: '{cfg.provider}'. "
            "Valores válidos: 'ollama', 'openai', 'anthropic', 'gemini'."
        )

    async def complete(self, system: str, user: str, tier: str = "capable",
                       max_tokens: int = 2048) -> str:
        backend = self._backend_for(tier)
        return await backend.complete(system, user, max_tokens)

    async def stream(self, system: str, user: str, tier: str = "capable",
                     max_tokens: int = 2048):
        backend = self._backend_for(tier)
        async for chunk in backend.stream(system, user, max_tokens):
            yield chunk


# ---------------------------------------------------------------------------
# Router basado en env (comportamiento histórico)
# ---------------------------------------------------------------------------

def _resolve_model(tier: str):
    profile = os.environ.get("LLM_PROFILE", "local")

    if profile == "local":
        url = os.environ.get("OLLAMA_URL", "http://localhost:11434/api/chat")
        if tier == "fast":
            model = os.environ.get("OLLAMA_MODEL_FAST", "qwen3:8b")
        else:
            model = os.environ.get("OLLAMA_MODEL_CAPABLE", "qwen3:8b")
        return OllamaBackend(model=model, url=url)

    if profile == "openai":
        api_key = os.environ.get("OPENAI_API_KEY", "")
        if tier == "fast":
            model = os.environ.get("OPENAI_MODEL_FAST", "gpt-4o-mini")
        else:
            model = os.environ.get("OPENAI_MODEL_CAPABLE", "gpt-4o")
        return OpenAIBackend(model=model, api_key=api_key)

    raise ValueError(f"Unknown LLM_PROFILE: '{profile}'. Use 'local' or 'openai'.")


# ---------------------------------------------------------------------------
# Public API (compatibilidad hacia atrás; los nodos prefieren LLMRuntime)
# ---------------------------------------------------------------------------

async def call_llm(system: str, user: str, tier: str = "capable",
                   max_tokens: int = 2048,
                   runtime: Optional["LLMRuntime"] = None) -> str:
    if runtime is not None:
        return await runtime.complete(system, user, tier, max_tokens)
    backend = _resolve_model(tier)
    return await backend.complete(system, user, max_tokens)


async def stream_llm(system: str, user: str, tier: str = "capable",
                     max_tokens: int = 2048,
                     runtime: Optional["LLMRuntime"] = None):
    if runtime is not None:
        async for chunk in runtime.stream(system, user, tier, max_tokens):
            yield chunk
        return
    backend = _resolve_model(tier)
    async for chunk in backend.stream(system, user, max_tokens):
        yield chunk


# ---------------------------------------------------------------------------
# Chat-model para el AGENTE (S7.3)
# ---------------------------------------------------------------------------
# El camino de GENERACIÓN (S6) usa call_llm/stream_llm (HTTP crudo, una sola
# completion): le basta texto plano. El camino del AGENTE (loop ReAct) necesita
# tool calling estructurado — `bind_tools()`/`ToolNode` —, que solo dan los
# BaseChatModel de LangChain. Por eso una API distinta, pero MISMO eje de routing
# (LLM_PROFILE) y mismos nombres de modelo por env: producción/local de la visión
# global se respeta, con Anthropic como tercer perfil para el agente.
#
# Imports LAZY: cada perfil solo importa su paquete provider; correr en `local`
# no exige tener instalado langchain-openai ni langchain-anthropic.

def get_chat_model(tier: str = "capable", llm_config: Optional[LLMConfig] = None):
    """Devuelve un BaseChatModel de LangChain con tool calling, según LLM_PROFILE
    o llm_config si se proporciona.

    `tier` espeja _resolve_model: "fast" usa el modelo ligero, cualquier otro el
    capaz (el agente usa "capable": el tool calling exige el modelo fiable).

    `llm_config` (per-request): si se proporciona, se respeta el provider y
    api_key/models. Para transport='browser', se lanza NotImplementedError ya que
    el loop ReAct de LangChain no puede delegarse al proxy del navegador sin
    implementar un BaseChatModel completo con soporte de tool-calling. Decisión
    consciente: error explícito antes que fallo silencioso o parcial.
    """
    fast = tier == "fast"

    # Si hay configuración por petición, usarla.
    if llm_config is not None:
        if llm_config.transport == "browser":
            raise NotImplementedError(
                "El refinamiento (loop ReAct) no está disponible con transport='browser'. "
                "El proxy del navegador no soporta tool-calling de LangChain. "
                "Usa transport='direct' con Ollama local o un proveedor comercial "
                "(openai, anthropic, gemini)."
            )

        model = llm_config.model_fast if fast else llm_config.model_capable

        if llm_config.provider == "ollama":
            from langchain_ollama import ChatOllama
            if llm_config.base_url:
                url = _validate_user_base_url(llm_config.base_url)
            else:
                url = os.environ.get("OLLAMA_URL", "http://localhost:11434/api/chat")
            base_url = url.split("/api/")[0]
            return ChatOllama(model=model, base_url=base_url, temperature=0,
                              reasoning=False, num_ctx=8192)

        if llm_config.provider == "openai":
            from langchain_openai import ChatOpenAI
            api_key = llm_config.api_key or os.environ.get("OPENAI_API_KEY", "")
            return ChatOpenAI(model=model, api_key=api_key, temperature=0)

        if llm_config.provider == "anthropic":
            from langchain_anthropic import ChatAnthropic
            api_key = llm_config.api_key or os.environ.get("ANTHROPIC_API_KEY", "")
            return ChatAnthropic(model=model, api_key=api_key, temperature=0)

        if llm_config.provider == "gemini":
            # langchain-google-genai es el paquete para Gemini con LangChain.
            from langchain_google_genai import ChatGoogleGenerativeAI
            api_key = llm_config.api_key or os.environ.get("GEMINI_API_KEY", "")
            return ChatGoogleGenerativeAI(model=model, google_api_key=api_key, temperature=0)

        raise ValueError(
            f"Proveedor desconocido en llm_config: '{llm_config.provider}'."
        )

    # Comportamiento histórico: resolver desde env (LLM_PROFILE).
    profile = os.environ.get("LLM_PROFILE", "local")

    if profile == "local":
        from langchain_ollama import ChatOllama
        model = os.environ.get("OLLAMA_MODEL_FAST" if fast else "OLLAMA_MODEL_CAPABLE", "qwen3:8b")
        # ChatOllama quiere la raíz del servidor, no el endpoint /api/chat que usa
        # el backend crudo. Derivamos una de la otra para no duplicar config.
        chat_url = os.environ.get("OLLAMA_URL", "http://localhost:11434/api/chat")
        base_url = chat_url.split("/api/")[0]
        # reasoning=False: qwen3 trae thinking activado por defecto y el camino del
        # agente NO pasa por el `think: false` del backend crudo — sin esto, cada
        # turno del loop ReAct razona minutos antes de responder. num_ctx=8192: el
        # default de Ollama (4096) se queda corto con el system prompt del agente
        # (diagrama completo + 9 schemas de tools + historial del loop).
        return ChatOllama(model=model, base_url=base_url, temperature=0,
                          reasoning=False, num_ctx=8192)

    if profile == "openai":
        from langchain_openai import ChatOpenAI
        model = os.environ.get("OPENAI_MODEL_FAST" if fast else "OPENAI_MODEL_CAPABLE",
                               "gpt-4o-mini" if fast else "gpt-4o")
        return ChatOpenAI(model=model, api_key=os.environ.get("OPENAI_API_KEY", ""), temperature=0)

    if profile == "anthropic":
        from langchain_anthropic import ChatAnthropic
        model = os.environ.get("ANTHROPIC_MODEL_FAST" if fast else "ANTHROPIC_MODEL_CAPABLE",
                               "claude-haiku-4-5" if fast else "claude-sonnet-4-6")
        return ChatAnthropic(model=model, api_key=os.environ.get("ANTHROPIC_API_KEY", ""), temperature=0)

    raise ValueError(f"Unknown LLM_PROFILE: '{profile}'. Use 'local', 'openai' or 'anthropic'.")
