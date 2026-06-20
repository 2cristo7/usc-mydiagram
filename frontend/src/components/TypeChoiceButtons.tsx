// Bandeja de selección de tipo que aparece cuando el backend detecta que la
// petición encaja con VARIOS tipos de diagrama y emite `diagram:type_clarification`
// (S10.3 generalizada). Ya no se limita al par secuencia/casos de uso: muestra una
// card por cada candidato que el clasificador no supo desempatar, con la misma
// miniatura (DiagramThumb) y etiqueta que el selector manual de la TopBar, para que
// el usuario reconozca al instante entre qué tipos está la duda.
//
// Panel adherido al chat (mismo patrón que ToolTray), visible solo mientras haya
// pendingTypeChoice. Al pulsar una card se llama a chooseDiagramType(value), que
// re-lanza la generación por `message:regenerate` y limpia este estado.

import { Sparkles } from 'lucide-react'
import { useStore } from '../store/index'
import { DIAGRAM_TYPE_OPTIONS } from '../types'
import { DiagramThumb } from './DiagramThumb'

interface TypeChoiceButtonsProps {
    /** Callback proporcionado por useWebSocket; no se importa el hook aquí para
     *  evitar duplicar el socket — el padre lo pasa como prop. */
    onChoose: (diagramTypeValue: string) => void
}

// Etiqueta corta y coherente con el selector manual; si el backend manda un valor
// desconocido, caemos a la etiqueta que él propuso.
const LABELS: Record<string, string> = Object.fromEntries(
    DIAGRAM_TYPE_OPTIONS.map((o) => [o.value, o.label]),
)

export function TypeChoiceButtons({ onChoose }: TypeChoiceButtonsProps) {
    const pendingTypeChoice = useStore((s) => s.pendingTypeChoice)

    // Solo se renderiza cuando hay una elección pendiente de tipo
    if (!pendingTypeChoice) return null

    return (
        <div className="border-t-[3px] border-[var(--color-ink)] bg-[var(--color-surface)] px-3 py-3">
            {/* Pregunta de contexto (la que mandó el agente) */}
            <p className="mb-2.5 flex items-start gap-1.5 text-xs font-semibold text-[var(--color-ink)]">
                <Sparkles
                    size={14}
                    strokeWidth={2.5}
                    className="mt-px shrink-0 text-[var(--color-accent)]"
                />
                {pendingTypeChoice.question || 'Elige el tipo de diagrama'}
            </p>

            {/* Una card por candidato, en rejilla fluida */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {pendingTypeChoice.options.map((opt) => (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => onChoose(opt.value)}
                        title={LABELS[opt.value] ?? opt.label}
                        className="
                            group relative flex h-[58px] flex-col items-center justify-center gap-1
                            overflow-hidden border-[3px] border-[var(--color-ink)] rounded-[var(--radius)]
                            bg-[var(--color-surface)] text-[var(--color-ink)]
                            transition-all duration-100 cursor-pointer select-none
                            hover:-translate-y-px hover:bg-[var(--color-accent)] hover:text-white
                            hover:shadow-[var(--shadow-brutal)]
                            active:translate-y-0 active:shadow-none
                        "
                    >
                        {/* Miniatura del tipo (stroke = currentColor → hereda el color del hover) */}
                        <span
                            aria-hidden="true"
                            className="pointer-events-none h-6 w-11 opacity-70 group-hover:opacity-100"
                        >
                            <DiagramThumb type={opt.value} />
                        </span>
                        {/* Etiqueta */}
                        <span className="px-1 text-center text-[11px] font-bold leading-tight">
                            {LABELS[opt.value] ?? opt.label}
                        </span>
                    </button>
                ))}
            </div>
        </div>
    )
}
