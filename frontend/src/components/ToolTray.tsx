import { useStore } from '../store/index'
import { useUiStore } from '../store/ui'
import { Badge } from '../ui/primitives'

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

function Spinner() {
  return (
    <span
      className="inline-block h-3.5 w-3.5 border-[2px] border-[var(--color-ink)] border-t-transparent animate-spin rounded-full"
      role="status"
      aria-label="ejecutando"
    />
  )
}

export function ToolTray() {
  const toolTrace = useStore((s) => s.toolTrace)
  const { toolTrayExpanded, setToolTrayExpanded } = useUiStore()

  if (toolTrace.length === 0) return null

  const hasRunning = toolTrace.some((e) => e.status === 'running')
  const isExpanded = hasRunning || toolTrayExpanded

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
        <div className="px-3 pb-2 space-y-0.5">
          {toolTrace.map((entry) => {
            const label = TOOL_LABELS[entry.tool] ?? entry.tool
            const detail = [entry.args?.label, entry.args?.query, entry.args?.id]
              .find((v): v is string => typeof v === 'string' && v.length > 0)
            const text = detail ? `${label} «${detail}»` : label
            return (
              <div key={entry.id} className="flex items-center gap-2 py-0.5 text-xs text-[var(--color-ink)]">
                {entry.status === 'running' && <Spinner />}
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
