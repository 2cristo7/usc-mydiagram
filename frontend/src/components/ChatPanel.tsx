import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { ChevronDown, Sparkles, Wand2, RotateCcw, Undo2 } from 'lucide-react'
import { ToolTray } from './ToolTray'
import { TypeChoiceButtons } from './TypeChoiceButtons'
import type { ConnectionState, VersionMeta, VersionOrigin, OpSummary } from '../types'
import { useStore } from '../store/index'
import { useHistoryNav } from '../hooks/useHistoryNav'
import { EmptyState, Spinner } from '../ui/primitives'

interface ChatPanelProps {
  connectionState: ConnectionState
  /** Callback de useWebSocket para re-lanzar la generación con el tipo elegido */
  onChooseDiagramType: (diagramTypeValue: string) => void
}

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  connecting: 'Conectando...',
  connected: 'Conectado',
  disconnected: 'Desconectado',
  error: 'Error',
}

const CONNECTION_COLORS: Record<ConnectionState, string> = {
  connecting: 'var(--color-warn)',
  connected: 'var(--color-accent-3)',
  disconnected: 'var(--color-danger)',
  error: 'var(--color-danger)',
}

const ORIGIN_META: Record<VersionOrigin, { label: string; icon: typeof Sparkles }> = {
  generate: { label: 'Generación', icon: Sparkles },
  refine: { label: 'Refinamiento', icon: Wand2 },
  restore: { label: 'Versión restaurada', icon: RotateCcw },
  manual_edit: { label: 'Edición manual', icon: Wand2 },
}

// Linealiza el ÁRBOL de versiones para la lista: el CAMINO VIVO (cadena de padres
// desde la versión actual hasta la raíz) va abajo, en orden raíz→actual; las RAMAS
// MUERTAS (todo lo que quedó fuera de ese camino al ramificar) van arriba. Así, al
// volver a una versión anterior y crear una nueva, las versiones abandonadas suben
// y el camino explorado queda abajo (con la actual al final → scroll al fondo).
export function orderByTree(versions: VersionMeta[], currentId: string | null): VersionMeta[] {
  if (versions.length === 0) return []
  const byId = new Map(versions.map((v) => [v.id, v]))
  const pathIds = new Set<string>()
  let node = currentId ? byId.get(currentId) : undefined
  while (node) {
    pathIds.add(node.id)
    node = node.parent_version_id ? byId.get(node.parent_version_id) : undefined
  }
  const bySeq = (a: VersionMeta, b: VersionMeta) => a.seq - b.seq
  const dead = versions.filter((v) => !pathIds.has(v.id)).sort(bySeq)
  const path = versions.filter((v) => pathIds.has(v.id)).sort(bySeq)
  return [...dead, ...path]
}

// "Recibo" legible del delta de una operación a partir de op_summary.
function summaryText(s: OpSummary | null): string {
  if (!s) return ''
  const p: string[] = []
  if (s.added?.length) p.push(`+${s.added.length} nodo${s.added.length > 1 ? 's' : ''}`)
  if (s.updated?.length) p.push(`✎ ${s.updated.length}`)
  if (s.deleted?.length) p.push(`−${s.deleted.length} nodo${s.deleted.length > 1 ? 's' : ''}`)
  if (s.addedEdges) p.push(`+${s.addedEdges} arista${s.addedEdges > 1 ? 's' : ''}`)
  if (s.deletedEdges) p.push(`−${s.deletedEdges} arista${s.deletedEdges > 1 ? 's' : ''}`)
  return p.join(' · ')
}

function OperationCard({
  version,
  ordinal,
  isCurrent,
  onRestore,
}: {
  version: VersionMeta
  // Número visible de la operación: su posición (1-based) entre las operaciones
  // del agente, NO el seq global en BD. El seq cuenta también las ediciones
  // manuales (ocultas de esta lista), así que usarlo dejaría huecos ("1" → "6").
  ordinal: number
  isCurrent: boolean
  onRestore: () => void
}) {
  const [open, setOpen] = useState(false)
  // ¿El prompt se corta en una línea? Solo entonces tiene sentido el desplegable
  // (si cabe entero, no se ofrece expandir). Se mide sobre el <p> truncado.
  const [overflows, setOverflows] = useState(false)
  const textRef = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    const el = textRef.current
    if (el && !open) setOverflows(el.scrollWidth > el.clientWidth)
  }, [version.instruction, open])

  const meta = ORIGIN_META[version.origin]
  const Icon = meta.icon
  const receipt = summaryText(version.op_summary)
  const expandable = overflows || open

  return (
    <div className="border-2 border-[var(--color-ink)] bg-[var(--color-surface)] rounded-[var(--radius)] overflow-hidden">
      {/* ── Sección 1: título (nº grande al principio + tipo en naranja) ───── */}
      <div className="flex items-center gap-2.5 px-2.5 pt-2 pb-1.5">
        {/* Número de versión bien visible: el usuario sabe por dónde va */}
        <span className="text-2xl font-black leading-none tabular-nums text-[var(--color-ink)] flex-shrink-0">
          {ordinal}
        </span>
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon size={14} className="text-[var(--color-accent)] flex-shrink-0" />
          <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-accent)] truncate">
            {meta.label}
          </span>
        </div>
        {receipt && (
          <span className="ml-auto text-[10px] font-mono text-[var(--color-ink)]/40 truncate flex-shrink-0">{receipt}</span>
        )}
      </div>

      {/* ── Sección 2: prompt (con desplegable si no cabe en la línea) ─────── */}
      {version.instruction && (
        <button
          onClick={() => expandable && setOpen((o) => !o)}
          className={`w-full flex items-start gap-1.5 px-2.5 pb-2 text-left ${expandable ? 'cursor-pointer' : 'cursor-default'}`}
        >
          <p
            ref={textRef}
            className={`flex-1 min-w-0 text-xs text-[var(--color-ink)] ${
              open ? 'whitespace-pre-wrap break-words max-h-40 overflow-y-auto scrollbar-brutal' : 'truncate'
            }`}
          >
            {version.instruction}
          </p>
          {expandable && (
            <ChevronDown
              size={14}
              className={`flex-shrink-0 mt-0.5 text-[var(--color-ink)]/40 transition-transform ${open ? 'rotate-180' : ''}`}
            />
          )}
        </button>
      )}

      {/* ── Sección 3: botón (con hover) ──────────────────────────────────── */}
      <button
        onClick={onRestore}
        disabled={isCurrent}
        className="group w-full flex items-center justify-center gap-1.5 px-2.5 py-2 border-t-2 border-[var(--color-ink)] text-[11px] font-bold transition-colors
          disabled:cursor-default disabled:bg-[var(--color-bg)] disabled:text-[var(--color-accent)]
          bg-[var(--color-accent)] text-white hover:brightness-110"
      >
        <span className={`flex items-center gap-1.5 transition-transform ${isCurrent ? '' : 'group-hover:scale-110'}`}>
          {!isCurrent && <Undo2 size={12} />}
          {isCurrent ? 'Versión actual' : 'Volver a esta versión'}
        </span>
      </button>
    </div>
  )
}

export function ChatPanel({ connectionState, onChooseDiagramType }: ChatPanelProps) {
  const uiState = useStore((s) => s.uiState)
  const activeOperation = useStore((s) => s.activeOperation)
  const versions = useStore((s) => s.versions)
  const currentVersionSeq = useStore((s) => s.currentVersionSeq)
  const headVersionId = useStore((s) => s.headVersionId)
  const pendingClarification = useStore((s) => s.pendingClarification)
  const { restoreVersion } = useHistoryNav()
  const endRef = useRef<HTMLDivElement>(null)
  // Anima reordenamiento/alta/baja de las tarjetas (FLIP). La lista se reordena al
  // refinar/generar y las tarjetas "vuelan" a su nueva posición en vez de saltar.
  const [listRef] = useAutoAnimate<HTMLDivElement>()

  // Lista ordenada por el árbol (ramas muertas arriba, camino vivo abajo) y filtrada
  // a hitos del agente. Se ordena por el HEAD (última versión del agente), NO por la
  // posición de navegación: la lista solo se reordena al refinar/generar, no al
  // moverte por el histórico. Las ediciones manuales no se listan.
  const operations = orderByTree(versions, headVersionId).filter((v) => v.origin !== 'manual_edit')

  // Numeración visible 1..N de las operaciones por orden CRONOLÓGICO (seq), no por
  // el orden de pintado de orderByTree (que sube las ramas muertas). Así la N-ésima
  // operación que hizo el usuario muestra "N" aunque haya ediciones manuales (que
  // consumen seq pero no se listan) o ramas abandonadas de por medio.
  const ordinalById = new Map(
    [...operations]
      .sort((a, b) => a.seq - b.seq)
      .map((v, i) => [v.id, i + 1]),
  )

  // El scroll baja al fondo cuando se crea una versión nueva (reorden) o entra una
  // operación en vuelo; navegar no fuerza el scroll (la lista no se reordena).
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [operations.length, activeOperation, headVersionId])

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--color-bg)] border-l-[3px] border-[var(--color-ink)]">
      {/* Header */}
      <div className="px-4 py-3 border-b-[3px] border-[var(--color-ink)] bg-[var(--color-surface)] flex items-center gap-2">
        <span className="font-bold text-sm text-[var(--color-ink)]">Operaciones</span>
        <span
          className="ml-auto text-xs font-mono"
          style={{ color: CONNECTION_COLORS[connectionState] }}
        >
          ● {CONNECTION_LABELS[connectionState]}
        </span>
      </div>

      {/* Lista de operaciones (con animación de reordenamiento) */}
      <div ref={listRef} className="flex-1 overflow-y-auto p-2 space-y-2">
        {operations.length === 0 && !activeOperation && (
          <EmptyState
            className="py-10"
            icon={<Sparkles size={40} />}
            title="Aún no hay operaciones"
            description="Describe abajo lo que quieres modelar. Cada generación y cada refinamiento quedará aquí como una versión a la que podrás volver."
          />
        )}

        {operations.map((v) => (
          <OperationCard
            key={v.id}
            version={v}
            ordinal={ordinalById.get(v.id) ?? 0}
            isCurrent={v.seq === currentVersionSeq}
            onRestore={() => restoreVersion(v)}
          />
        ))}

        {/* Operación en vuelo: el comando enviado aún sin terminar */}
        {activeOperation && uiState === 'generating' && (
          <div className="border-2 border-dashed border-[var(--color-accent)] bg-[var(--color-accent)]/5 p-2.5 rounded-[var(--radius)]">
            <div className="flex items-center gap-2 mb-1">
              <Spinner />
              <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-accent)]">
                En curso…
              </span>
            </div>
            <p className="break-words text-xs text-[var(--color-ink)]">{activeOperation}</p>
          </div>
        )}

        {/* Clarificación pendiente del agente: la pregunta (la respuesta va por el
            input flotante, que ya enruta a sendClarificationAnswer). */}
        {pendingClarification && (
          <div className="border-2 border-[var(--color-warn)] bg-[var(--color-warn)]/10 p-2.5 rounded-[var(--radius)]">
            <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-warn)]">
              El agente pregunta
            </span>
            <p className="break-words text-xs text-[var(--color-ink)] mt-1">{pendingClarification.question}</p>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {/* TypeChoiceButtons — visible solo al recibir diagram:type_clarification */}
      <TypeChoiceButtons onChoose={onChooseDiagramType} />

      {/* ToolTray */}
      <ToolTray />
    </div>
  )
}
