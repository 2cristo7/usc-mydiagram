import { useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../store/index'
import type { DiagramType } from '../types'
import { DIAGRAM_TYPE_OPTIONS } from '../types'
import { DiagramTypeCards } from './DiagramTypeCards'
import { DiagramThumb } from './DiagramThumb'

// Etiqueta legible por tipo, derivada de la misma lista que alimenta el selector.
const TYPE_LABELS = Object.fromEntries(
  DIAGRAM_TYPE_OPTIONS.map((o) => [o.value, o.label]),
) as Record<DiagramType, string>

/**
 * DiagramTypeBar — contenido central de la TopBar.
 *
 * Antes de empezar una sesión muestra el selector de tipos (carrusel de cards).
 * En cuanto se envía el primer mensaje la sesión queda ligada a un tipo, así que
 * el selector se sustituye (animado) por un título grande:
 *   - tipo concreto elegido        → "Arquitectura"
 *   - Auto, aún sin respuesta       → "Generando…"
 *   - diagrama ya con título real   → "Título — Tipo"
 * El cambio entre selector/título es un crossfade; el cambio de texto del título
 * (tipo → título-tipo) reproduce una animación de entrada vía `key`.
 */
export function DiagramTypeBar() {
  const uiState = useStore((s) => s.uiState)
  const currentDiagram = useStore((s) => s.currentDiagram)

  // La sesión arranca al enviar el primer mensaje (generating) o cuando ya hay
  // un diagrama vivo (generado, refinándose o cargado del historial). En idle/
  // error sin diagrama volvemos al selector para poder reelegir el tipo.
  const sessionStarted =
    currentDiagram !== null ||
    uiState === 'generating' ||
    uiState === 'awaiting_clarification'

  return (
    <div className="relative h-14">
      <Layer active={!sessionStarted} from="up">
        <DiagramTypeCards />
      </Layer>
      <Layer active={sessionStarted} from="down">
        <SessionTitle />
      </Layer>
    </div>
  )
}

// Capa apilada con crossfade. La inactiva se desplaza ligeramente (arriba/abajo)
// y queda sin eventos para no interceptar clics.
function Layer({
  active,
  from,
  children,
}: {
  active: boolean
  from: 'up' | 'down'
  children: React.ReactNode
}) {
  const hidden = from === 'up' ? '-translate-y-2' : 'translate-y-2'
  return (
    <div
      className={`
        absolute inset-0 flex items-center
        transition-[opacity,transform] duration-300 ease-out
        ${active ? 'opacity-100 translate-y-0' : `pointer-events-none opacity-0 ${hidden}`}
      `}
    >
      <div className="h-full w-full min-w-0">{children}</div>
    </div>
  )
}

function SessionTitle() {
  const currentDiagram = useStore((s) => s.currentDiagram)
  const selectedDiagramType = useStore((s) => s.selectedDiagramType)
  const streamingType = useStore((s) => s.streamingType)
  const streamingTitle = useStore((s) => s.streamingTitle)
  const uiState = useStore((s) => s.uiState)
  const renameCurrentDiagram = useStore((s) => s.renameCurrentDiagram)

  // Edición inline del título (doble clic). Solo cuando hay un diagrama vivo y la
  // sesión está en reposo: durante la generación el título lo manda el streaming.
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const editable = currentDiagram !== null && uiState === 'ready'

  // Cerrar el input (Enter/Escape) lo desmonta y eso dispara su `blur`, que
  // volvería a entrar en finish(). El flag garantiza que cada edición se resuelve
  // una sola vez (y que un Escape no acabe confirmando vía el blur posterior).
  const finishedRef = useRef(false)

  // Ancho del input ceñido al texto: un <span> espejo invisible con la MISMA
  // tipografía mide el ancho real del borrador y se lo trasladamos al input en
  // cada carácter (mucho más fiel que `ch`, que ignora el ancho real de cada glifo).
  const [inputW, setInputW] = useState(0)
  const mirrorRef = useRef<HTMLSpanElement>(null)
  useLayoutEffect(() => {
    // +22px ≈ padding (12) + borde (6) + holgura del cursor; box-border ya incluye
    // padding/borde en el width, así que basta sumar la holgura sobre el texto.
    if (editing && mirrorRef.current) setInputW(mirrorRef.current.offsetWidth + 22)
  }, [editing, draft])

  function startEdit() {
    if (!editable) return
    finishedRef.current = false
    setDraft(currentDiagram?.title ?? '')
    setEditing(true)
  }
  function finishEdit(commit: boolean) {
    if (finishedRef.current) return
    finishedRef.current = true
    setEditing(false)
    if (!commit) return
    const next = draft.trim()
    if (next && next !== (currentDiagram?.title ?? '').trim()) {
      renameCurrentDiagram(next)
    }
  }

  // El tipo real (del diagrama) manda; si aún no llegó, el resuelto por el agente
  // durante el streaming (diagram:type_ready) y, en último término, el
  // preseleccionado en la UI. En Auto, el puente de streaming es lo que evita el
  // placeholder "Generando…" hasta el done.
  const resolvedType = currentDiagram?.diagram_type ?? streamingType ?? selectedDiagramType ?? null
  const typeLabel = resolvedType ? TYPE_LABELS[resolvedType] : null
  const title = (currentDiagram?.title?.trim() || streamingTitle?.trim()) ?? ''

  // Texto principal: el título real si existe; si no, el tipo es el protagonista;
  // y en Auto sin respuesta, el placeholder de carga. El tipo solo es subtítulo
  // cuando ya hay un título real que encabeza.
  const mainText = title || typeLabel || 'Generando…'
  const subtitle = title ? typeLabel : null
  const isPlaceholder = !title && !typeLabel

  // Auto-ajuste: el título largo envuelve a varias líneas y la fuente se reduce
  // hasta caber en el alto disponible. La key reproduce la animación de entrada.
  // `editing` fuerza un reajuste al volver del modo edición (el <span> remonta).
  const { ref: fitRef } = useFitText(mainText, !!subtitle, editing)

  return (
    <div className="flex h-full items-center gap-2.5 pl-0.5">
      {resolvedType && (
        <span
          key={`thumb-${resolvedType}`}
          className="animate-title-swap flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius)] border-[3px] border-[var(--color-ink)] bg-[var(--color-surface)] text-[var(--color-accent)]"
        >
          <span className="h-7 w-7">
            <DiagramThumb type={resolvedType} />
          </span>
        </span>
      )}
      <div key={mainText} className="animate-title-swap flex h-full min-w-0 flex-1 flex-col justify-center overflow-hidden">
        {editing ? (
          <>
            <span
              ref={mirrorRef}
              aria-hidden
              className="invisible absolute -z-10 whitespace-pre text-lg font-bold leading-tight"
            >
              {draft || 'Nombre del diagrama'}
            </span>
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={(e) => e.target.select()}
              onBlur={() => finishEdit(true)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  finishEdit(true)
                } else if (e.key === 'Escape') {
                  e.preventDefault()
                  finishEdit(false)
                }
              }}
              placeholder="Nombre del diagrama"
              style={{ width: inputW || undefined }}
              className="box-border block max-w-full border-[3px] border-[var(--color-ink)] bg-[var(--color-bg)] px-1.5 py-0.5 text-lg font-bold leading-tight text-[var(--color-ink)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
            />
          </>
        ) : (
          <span
            ref={fitRef}
            onDoubleClick={startEdit}
            title={editable ? 'Doble clic para renombrar' : undefined}
            className={`block font-bold leading-[1.12] break-words ${editable ? 'cursor-text' : ''} ${isPlaceholder ? 'animate-pulse text-[var(--color-ink)]/50' : 'text-[var(--color-ink)]'}`}
          >
            {mainText}
          </span>
        )}
        {subtitle && (
          <span className="mt-0.5 shrink-0 truncate text-xs font-semibold uppercase tracking-wide text-[var(--color-accent)]">
            {subtitle}
          </span>
        )}
      </div>
    </div>
  )
}

// Reduce el tamaño de fuente del nodo hasta que su contenido (envolviendo a
// varias líneas) cabe en el alto disponible de su columna. Re-mide al cambiar el
// texto, al alternar el subtítulo o al redimensionar el contenedor.
const MAX_FONT = 18 // px (~text-lg)
const MIN_FONT = 11 // px

function useFitText(text: string, hasSubtitle: boolean, editing: boolean) {
  const ref = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    const col = el?.parentElement
    // En modo edición el <span> no está montado; al volver, el cambio de `editing`
    // re-dispara el efecto y reajusta la fuente del span recién remontado.
    if (!el || !col) return

    const fit = () => {
      // Alto disponible para el título = alto de la columna menos lo que ocupan
      // sus otros hijos (el subtítulo).
      const others = Array.from(col.children)
        .filter((c) => c !== el)
        .reduce((h, c) => h + (c as HTMLElement).offsetHeight, 0)
      const availH = col.clientHeight - others
      if (availH <= 0) return

      let size = MAX_FONT
      el.style.fontSize = `${size}px`
      while (size > MIN_FONT && el.scrollHeight > availH) {
        size -= 1
        el.style.fontSize = `${size}px`
      }
    }

    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(col)
    return () => ro.disconnect()
  }, [text, hasSubtitle, editing])

  return { ref }
}
