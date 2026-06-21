import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useAutoAnimate } from '@formkit/auto-animate/react'
import { ChevronDown, ListTree, Sparkles, Wand2, RotateCcw, Undo2, Copy, Check } from 'lucide-react'
import { ToolTray } from './ToolTray'
import { NodeOpList } from './NodeOpList'
import { TypeChoiceButtons } from './TypeChoiceButtons'
import type { ConnectionState, NodeOp, VersionMeta, VersionOrigin, OpSummary } from '../types'
import { useStore } from '../store/index'
import { useHistoryNav } from '../hooks/useHistoryNav'
import { EmptyState, Spinner } from '../ui/primitives'
import { toast } from '../store/toast'

interface ChatPanelProps {
  connectionState: ConnectionState
  /** Callback de useWebSocket para re-lanzar la generación con el tipo elegido */
  onChooseDiagramType: (diagramTypeValue: string) => void
}

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  connecting: 'Conectando...',
  connected: 'Conectado',
  // Contrato 2: useWebSocket emite 'reconnecting' durante el ciclo de reconexión.
  reconnecting: 'Reconectando…',
  disconnected: 'Desconectado',
  error: 'Error',
}

const CONNECTION_COLORS: Record<ConnectionState, string> = {
  connecting: 'var(--color-warn)',
  connected: 'var(--color-accent-3)',
  // Ámbar (mismo color que 'connecting'): reconexión en curso, no es un fallo aún.
  reconnecting: 'var(--color-warn)',
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
  // Desplegable independiente (debajo del del prompt) con la lista por nodo del
  // delta. Arranca cerrado: es un "ver más", no la vista por defecto.
  const [opsOpen, setOpsOpen] = useState(false)
  // ¿El prompt se corta en una línea? Solo entonces tiene sentido el desplegable
  // (si cabe entero, no se ofrece expandir). Se mide sobre el <p> truncado.
  const [overflows, setOverflows] = useState(false)
  const textRef = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    const el = textRef.current
    if (el && !open) setOverflows(el.scrollWidth > el.clientWidth)
  }, [version.instruction, open])

  // Feedback de copia: el icono pasa a ✓ durante ~1.5s y vuelve a Copy. Inline,
  // sin toast de éxito, para no apilar avisos al copiar varios prompts seguidos.
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => {
    if (copyTimer.current) clearTimeout(copyTimer.current)
  }, [])

  const handleCopy = async () => {
    if (!version.instruction) return
    try {
      await navigator.clipboard.writeText(version.instruction)
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('No se pudo copiar el prompt')
    }
  }

  const meta = ORIGIN_META[version.origin]
  const Icon = meta.icon
  const receipt = summaryText(version.op_summary)
  const expandable = overflows || open

  // Lista por nodo derivada del resumen persistido: altas, ediciones y bajas, cada
  // una con su nombre. Agrupada por tipo (op_summary no guarda el orden cronológico,
  // solo tres arrays). Las aristas quedan fuera (solo hay conteo, no nombre).
  const ops = useMemo<NodeOp[]>(() => {
    const s = version.op_summary
    if (!s) return []
    return [
      ...(s.added ?? []).map((label): NodeOp => ({ kind: 'add', label })),
      ...(s.updated ?? []).map((label): NodeOp => ({ kind: 'update', label })),
      ...(s.deleted ?? []).map((label): NodeOp => ({ kind: 'delete', label })),
    ]
  }, [version.op_summary])

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

      {/* ── Sección 2: prompt (desplegable si no cabe) + copiar ──────────────
          El toggle y el botón de copiar son HERMANOS, no anidados: un <button>
          dentro de otro es HTML inválido. El copiar va pegado al texto que copia. */}
      {version.instruction && (
        <div className="flex items-start gap-1 px-2.5 pb-2">
          <button
            onClick={() => expandable && setOpen((o) => !o)}
            className={`flex-1 min-w-0 flex items-start gap-1.5 text-left ${expandable ? 'cursor-pointer' : 'cursor-default'}`}
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
          <button
            onClick={handleCopy}
            title={copied ? 'Copiado' : 'Copiar prompt'}
            aria-label="Copiar prompt"
            className="flex-shrink-0 mt-0.5 p-0.5 rounded text-[var(--color-ink)]/40 hover:text-[var(--color-accent)] transition-colors"
          >
            {copied ? (
              <Check size={14} className="text-[var(--color-accent-3)]" />
            ) : (
              <Copy size={14} />
            )}
          </button>
        </div>
      )}

      {/* ── Sección 2b: lista por nodo del delta (desplegable propio) ────────
          Debajo del desplegable del prompt. Solo si hubo cambios de nodo (las
          aristas no se listan: op_summary solo guarda su conteo). */}
      {ops.length > 0 && (
        <div className="px-2.5 pb-2">
          <button
            onClick={() => setOpsOpen((o) => !o)}
            className="flex w-full items-center gap-1.5 text-left text-[11px] font-semibold text-[var(--color-ink)]/60 hover:text-[var(--color-accent)] transition-colors"
          >
            <ListTree size={13} className="flex-shrink-0" />
            <span>{ops.length} nodo{ops.length > 1 ? 's' : ''}</span>
            <ChevronDown
              size={13}
              className={`ml-auto flex-shrink-0 transition-transform ${opsOpen ? 'rotate-180' : ''}`}
            />
          </button>
          {opsOpen && (
            <NodeOpList ops={ops} className="mt-1.5 max-h-40 overflow-y-auto scrollbar-brutal" />
          )}
        </div>
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
  const liveOps = useStore((s) => s.liveOps)
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

  // El scroll baja al fondo cuando se crea una versión nueva (reorden), entra una
  // operación en vuelo, o se revela una operación por nodo en vivo (así el item
  // recién aparecido queda visible). Navegar no fuerza el scroll (no se reordena).
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [operations.length, activeOperation, headVersionId, liveOps.length])

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

        {/* Operación en vuelo: el comando enviado aún sin terminar. Se muestra en
            cuanto uiState pasa a 'generating', AUNQUE activeOperation aún sea null:
            al elegir un tipo de diagrama (chooseDiagramType) la generación arranca
            sin fijar activeOperation, así que sin este fallback no habría feedback
            "En curso…" entre el clic y la llegada del primer evento. */}
        {uiState === 'generating' && (
          <div className="border-2 border-dashed border-[var(--color-accent)] bg-[var(--color-accent)]/5 p-2.5 rounded-[var(--radius)]">
            <div className="flex items-center gap-2 mb-1">
              <Spinner />
              <span className="text-[11px] font-bold uppercase tracking-wide text-[var(--color-accent)]">
                En curso…
              </span>
            </div>
            <p className="break-words text-xs text-[var(--color-ink)]">
              {activeOperation ?? 'Generando diagrama…'}
            </p>
          </div>
        )}

        {/* Lista por nodo EN VIVO: bloque propio justo DEBAJO de la tarjeta "En
            curso". Cada item va apareciendo según el agente trabaja —en generación
            al ritmo de la bomba de revelado, en refinamiento según llegan los
            tool_result—. Mismo componente (icono + nombre) que la tarjeta de versión
            persistida; aquí siempre visible (no desplegable): la idea es verla nacer.
            El -mt-1 la pega a la tarjeta de arriba para leerse como su continuación. */}
        {uiState === 'generating' && liveOps.length > 0 && (
          <div className="-mt-1 border-2 border-dashed border-t-0 border-[var(--color-accent)] bg-[var(--color-accent)]/5 rounded-b-[var(--radius)] overflow-hidden">
            <NodeOpList
              ops={liveOps}
              className="p-2.5 max-h-56 overflow-y-auto scrollbar-brutal"
            />
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
