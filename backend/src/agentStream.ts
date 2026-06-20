// S7.6 — extraído de index.ts para poder testearlo: importar index.ts arranca
// el servidor (app.listen) como efecto secundario, lo que impide cargar el
// módulo desde un test runner. Aquí solo vive la función, sin efectos al importar.

// Interfaz mínima del socket: de Socket.io solo se usa .emit. Depender de esta
// firma estructural (y no de la clase Socket completa) hace el doble de test
// trivial — un objeto literal que acumula los emits.
export interface SocketLike {
  emit(event: string, payload?: unknown): unknown
}

// Reenvía la petición al agente Python y re-emite su stream NDJSON por Socket.io.
// El gateway solo enruta: no interpreta la lógica del agente (antipatrón de la
// visión global). Compartido por generación y refinamiento (S7.1): ambos hablan
// el mismo protocolo NDJSON, solo cambian la URL del agente y el cuerpo.
// S9.3b — onDone: callback opcional con el evento `done` del agente. La
// generación lo usa para cachear el diagrama recién generado (miss); el
// refinamiento no lo pasa (no se cachea). El backend NO interpreta el diagrama
// (sigue sin lógica de agente): solo entrega el snapshot tal cual para guardarlo.
export interface DoneEvent {
  title?: string | null
  diagram?: unknown
  degraded?: boolean
}

// Evento emitido por el agente cuando el tipo de diagrama UML es ambiguo.
// El gateway lo reenvía al frontend como `diagram:type_clarification`.
// NO confundir con `clarification` (S7.4): ese lleva thread_id y reanuda
// una ejecución pausada; este es una pregunta previa a la generación.
export interface TypeClarificationOption {
  label: string
  value: string
}

export interface TypeClarificationItem {
  _type: 'type_clarification'
  question: string
  options: TypeClarificationOption[]
}

// Configuración LLM opcional que el gateway añade al body cuando el usuario
// tiene una fila en llm_configs. El agente Python la usa para elegir
// proveedor/modelo; si no se incluye, el agente usa sus propias variables de env.
export interface LlmConfig {
  provider: string
  transport: string
  model_fast: string
  model_capable: string
  api_key?: string | null
  base_url?: string | null
  // Para transport=="browser": socket.id del cliente que actuará de proxy LLM.
  proxy_session?: string | null
}

export async function streamAgentToSocket(
  url: string,
  body: object,
  socket: SocketLike,
  onDone?: (done: DoneEvent) => void,
  llmConfig?: LlmConfig,
) {
  // [1] Timeout de inactividad: se reinicia con cada chunk recibido. Elegimos
  // inactividad (no tiempo total) porque los streams de generación pueden ser
  // largos pero siempre emiten chunks periódicos; el cuelgue real se detecta
  // cuando el agente acepta la conexión pero deja de escribir. 120 s es
  // suficiente margen para las respuestas más lentas sin dejar el spinner
  // indefinidamente si Python se congela.
  const INACTIVITY_TIMEOUT_MS = 120_000
  const controller = new AbortController()
  let inactivityTimer: ReturnType<typeof setTimeout> | null = null

  const resetInactivityTimer = () => {
    if (inactivityTimer !== null) clearTimeout(inactivityTimer)
    inactivityTimer = setTimeout(() => {
      controller.abort()
    }, INACTIVITY_TIMEOUT_MS)
  }

  const clearInactivityTimer = () => {
    if (inactivityTimer !== null) {
      clearTimeout(inactivityTimer)
      inactivityTimer = null
    }
  }

  try {
    // Arrancamos el timer antes del fetch: si la conexión tarda en
    // establecerse también cuenta como inactividad.
    resetInactivityTimer()

    // Si hay config LLM del usuario, se incluye en el body para que el agente
    // Python use el proveedor/modelo configurado en vez de sus defaults de env.
    const fullBody = llmConfig ? { ...body, llm_config: llmConfig } : body
    const agentRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fullBody),
      signal: controller.signal,
    })

    // [2] Comprobamos el status HTTP antes de intentar leer el stream.
    // Un 4xx/5xx del agente (p.ej. 422 de validación FastAPI o 500 interno)
    // no debe dejar el frontend en spinner infinito.
    if (!agentRes.ok) {
      let detail = ''
      try {
        detail = await agentRes.text()
      } catch {
        // best-effort: si no se puede leer el cuerpo, seguimos igual
      }
      console.error(`Agente devolvió HTTP ${agentRes.status}:`, detail.slice(0, 500))
      socket.emit('diagram:error', {
        error: 'El servidor de generación devolvió un error. Inténtalo de nuevo.',
        category: 'agent_http_error',
      })
      return
    }

    // Protección explícita frente a body null (edge case en algunos entornos
    // fetch de Node donde body puede ser null aunque status sea 2xx).
    if (!agentRes.body) {
      console.error('Agente devolvió respuesta sin body.')
      socket.emit('diagram:error', {
        error: 'El servidor de generación devolvió un error. Inténtalo de nuevo.',
        category: 'agent_http_error',
      })
      return
    }

    const decoder = new TextDecoder()
    const reader = agentRes.body.getReader()
    let buffer = ''

    // [3] Flag para emitir diagram:error por líneas desconocidas con shape de
    // error de FastAPI como máximo una vez por stream (evita spam si llegan
    // varias líneas extrañas seguidas).
    let validationErrorEmitted = false

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      // Reiniciamos el timer de inactividad en cada chunk: mientras el agente
      // siga escribiendo, no hay cuelgue.
      resetInactivityTimer()
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const item = JSON.parse(line)
          switch (item._type) {
            case 'node':
              console.log(`⏩ node_ready    → ${item.data?.id} (${item.data?.node_type}) "${item.data?.label}"`)
              socket.emit('diagram:node_ready', item.data)
              break
            case 'edge':
              console.log(`⏩ edge_ready    → ${item.data?.id}: ${item.data?.source} → ${item.data?.target} (${item.data?.edge_type})`)
              socket.emit('diagram:edge_ready', item.data)
              break
            case 'diagram_type':
              // El agente resolvió el tipo de diagrama (en classify, ANTES del
              // primer nodo). Puente para que el montaje en vivo use el layout
              // correcto desde el principio y el header muestre título+tipo, en
              // lugar de montar genérico y "flashear" al tipo real en el done.
              // Passthrough puro: el gateway no interpreta (antipatrón visión global).
              console.log(`⏩ diagram_type  → ${item.diagram_type} "${item.title}"`)
              socket.emit('diagram:type_ready', { diagram_type: item.diagram_type, title: item.title })
              break
            case 'done':
              // Propaga la bandera de degradación y los motivos por categoría
              // (S6.9); el frontend compone el aviso. degraded=false → done limpio.
              // refinement_history (S7.4): traza de tool calls de un refinamiento;
              // vacío en generación. diagram (S7.5): snapshot completo del
              // workspace — la verdad que el frontend aplica SIEMPRE, reconciliando
              // cualquier evento en vivo perdido (null en generación, que ya
              // streameó node/edge).
              console.log(`✅ done          → ${item.diagram ? `${item.diagram.nodes?.length ?? 0} nodos, ${item.diagram.edges?.length ?? 0} aristas` : 'generación (sin snapshot)'}${item.degraded ? ' [DEGRADADO]' : ''}`)
              socket.emit('diagram:done', {
                title: item.title,
                degraded: item.degraded ?? false,
                degradations: item.degradations ?? [],
                refinement_history: item.refinement_history ?? [],
                diagram: item.diagram ?? null,
              })
              // S9.3b — notifica el done para que la generación cachee (miss).
              onDone?.({ title: item.title, diagram: item.diagram ?? null, degraded: item.degraded ?? false })
              break
            case 'tool_call':
              // S7.5 — traza en vivo: el agente decidió invocar una tool (se
              // emite ANTES de que corra). Passthrough puro: el gateway no
              // interpreta tools (antipatrón de la visión global).
              console.log(`⏩ tool_call     → [${item.id}] ${item.tool}(${JSON.stringify(item.args ?? {})})`)
              socket.emit('agent:tool_call', {
                id: item.id,
                tool: item.tool,
                args: item.args ?? {},
              })
              break
            case 'tool_result':
              // S7.5 — la tool terminó: observación + delta declarado por el
              // SERVIDOR (node/edge completos para add/update; los borrados van
              // autodescritos en result.deleted_*). El frontend aplica literal.
              console.log(`⏩ tool_result   → [${item.id}] ${item.tool}: ${JSON.stringify(item.result ?? null)}${item.node ? ` +node ${item.node.id}` : ''}${item.edge ? ` +edge ${item.edge.id}` : ''}`)
              socket.emit('agent:tool_result', {
                id: item.id,
                tool: item.tool,
                result: item.result,
                node: item.node,
                edge: item.edge,
              })
              break
            case 'clarification':
              // S7.4 — el agente pausó en ask_clarification: pregunta + opciones
              // (botones) + thread_id, que el frontend debe devolver con la
              // respuesta para reanudar ESA ejecución.
              console.log(`⏸️ clarification → [${item.thread_id}] "${item.question}" opciones: ${JSON.stringify(item.options ?? [])}`)
              socket.emit('agent:clarification', {
                thread_id: item.thread_id,
                question: item.question,
                options: item.options ?? [],
              })
              break
            case 'type_clarification': {
              // El agente detectó ambigüedad en el tipo de diagrama UML y pide
              // al usuario que elija antes de generar. El frontend debe mostrar
              // las opciones y re-lanzar con `message:regenerate` + diagram_type.
              // NO lleva thread_id: no hay ejecución pausada que reanudar.
              const tcItem = item as TypeClarificationItem
              console.log(`⏸️ type_clarification → "${tcItem.question}" opciones: ${JSON.stringify(tcItem.options)}`)
              socket.emit('diagram:type_clarification', {
                question: tcItem.question,
                options: tcItem.options,
              })
              break
            }
            case 'error':
              // Propaga la categoría del fallo además del mensaje accionable.
              console.log(`❌ error         → [${item.category}] ${item.message}`)
              socket.emit('diagram:error', { error: item.message, category: item.category, provider: item.provider })
              break
            default:
              // [3] Línea sin _type reconocido. Si tiene `detail` es casi seguro
              // un error de validación de FastAPI (422); en ese caso informamos
              // al usuario una única vez para no spamear. Cualquier otra línea
              // rara se descarta en silencio (solo log) — no queremos emitir
              // diagram:error por eventos de traza u otros formatos futuros.
              console.warn('Tipo de evento NDJSON desconocido:', item._type, '·', line.slice(0, 500))
              if (!validationErrorEmitted && item.detail !== undefined) {
                validationErrorEmitted = true
                socket.emit('diagram:error', {
                  error: 'La petición no es válida.',
                  category: 'validation_error',
                })
              }
          }
        } catch {
          console.warn('Línea NDJSON inválida ignorada:', line)
        }
      }
    }

    // Stream terminado correctamente: cancelamos el timer para que no aborte
    // ninguna operación posterior que reutilice el controller.
    clearInactivityTimer()
  } catch (err) {
    clearInactivityTimer()
    // AbortError indica que saltó el timeout de inactividad (o una cancelación
    // explícita futura). Distinguimos el caso para dar un mensaje accionable.
    if (err instanceof Error && err.name === 'AbortError') {
      console.error('Timeout de inactividad alcanzado llamando al agente.')
      socket.emit('diagram:error', {
        error: 'El servidor tardó demasiado en responder. Inténtalo de nuevo.',
        category: 'timeout',
      })
    } else {
      console.error('Error llamando al agente:', err)
      socket.emit('diagram:error', { error: 'Error generando el diagrama' })
    }
  }
}
