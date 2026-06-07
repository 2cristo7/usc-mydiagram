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
export async function streamAgentToSocket(url: string, body: object, socket: SocketLike) {
  try {
    const agentRes = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const decoder = new TextDecoder()
    const reader = agentRes.body!.getReader()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
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
            case 'error':
              // Propaga la categoría del fallo además del mensaje accionable.
              console.log(`❌ error         → [${item.category}] ${item.message}`)
              socket.emit('diagram:error', { error: item.message, category: item.category })
              break
            default:
              // Un 422 del agente llega aquí: el cuerpo es {"detail": [...]} de
              // FastAPI, sin _type. Loguear la línea entera hace visible el
              // motivo exacto de la validación fallida.
              console.warn('Tipo de evento NDJSON desconocido:', item._type, '·', line.slice(0, 500))
          }
        } catch {
          console.warn('Línea NDJSON inválida ignorada:', line)
        }
      }
    }
  } catch (err) {
    console.error('Error llamando al agente:', err)
    socket.emit('diagram:error', { error: 'Error generando el diagrama' })
  }
}
