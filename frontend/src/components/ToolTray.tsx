import { useStore } from '../store/index'
import { useUiStore } from '../store/ui'
import { Badge, Spinner } from '../ui/primitives'

const TOOL_LABELS: Record<string, string> = {
  find_node: 'Buscando nodo',
  add_node: 'Añadiendo nodo',
  update_node: 'Actualizando nodo',
  delete_node: 'Eliminando nodo',
  add_edge: 'Añadiendo relación',
  delete_edge: 'Eliminando relación',
  apply_layout: 'Reorganizando el diagrama',
  ask_clarification: 'Pidiendo aclaración',
  regenerate_from_scratch: 'Regenerando desde cero',
}

export function ToolTray() {
  const toolTrace = useStore((s) => s.toolTrace)
  const { toolTrayExpanded, setToolTrayExpanded } = useUiStore()

  if (toolTrace.length === 0) return null

  // Solo el toggle del usuario decide si está abierta (arranca cerrada). Antes se
  // forzaba abierta mientras alguna tool corría (`hasRunning`), pero como los
  // tool_call/tool_result llegan intercalados muy rápido el estado oscilaba y la
  // lista parpadeaba durante el refinamiento. El detalle por nodo ya se ve en la
  // tarjeta En curso; este panel es la traza CRUDA, ahora silenciosa por defecto.
  const isExpanded = toolTrayExpanded

  return (
    <div className="border-t-[3px] border-[var(--color-ink)] bg-[var(--color-surface)]">
      <button
        onClick={() => setToolTrayExpanded(!isExpanded)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-xs font-semibold text-[var(--color-ink)] hover:bg-[var(--color-accent)]/10"
      >
        <span>Herramientas</span>
        <Badge color="var(--color-accent)" className="text-white">{toolTrace.length}</Badge>
        <span className="ml-auto">{isExpanded ? '▲' : '▾'}</span>
      </button>
      {isExpanded && (
        <div className="px-3 pb-2 space-y-0.5 max-h-56 overflow-y-auto scrollbar-brutal">
          {toolTrace.map((entry) => {
            const label = TOOL_LABELS[entry.tool] ?? entry.tool
            const detail = [entry.args?.label, entry.args?.query, entry.args?.id]
              .find((v): v is string => typeof v === 'string' && v.length > 0)
            const text = detail ? `${label} «${detail}»` : label
            return (
              <div key={entry.id} className="flex items-center gap-2 py-0.5 text-xs text-[var(--color-ink)]">
                {entry.status === 'running' && <Spinner size={14} label="ejecutando" />}
                {entry.status === 'ok' && <span className="text-[var(--color-accent-3)]">✓</span>}
                {entry.status === 'error' && <span className="text-[var(--color-warn)]">⚠</span>}
                <span>{text}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
