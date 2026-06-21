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

import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useStore } from '../store/index'
import { DIAGRAM_TYPE_OPTIONS } from '../types'
import { DiagramThumb } from './DiagramThumb'
import { Spinner } from '../ui/primitives'

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

    // Tipo ya elegido: bloquea TODOS los botones en cuanto se pulsa uno (cierra la
    // ventana de doble-submit: elegir dos tipos seguidos antes de pasar a
    // 'generating') y marca visualmente el elegido con su spinner. Si llega una
    // clarificación NUEVA (cambia la pregunta sin desmontar), se reinicia.
    const [chosen, setChosen] = useState<string | null>(null)
    useEffect(() => {
        setChosen(null)
    }, [pendingTypeChoice?.question])

    function handleChoose(value: string) {
        // Guard local: ignora clics posteriores al primero (el callback re-lanza la
        // generación de forma asíncrona; sin esto, dos clics rápidos emitirían dos
        // regeneraciones antes de que el panel cambie a 'En curso…').
        if (chosen) return
        setChosen(value)
        onChoose(value)
    }

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
                {pendingTypeChoice.options.map((opt) => {
                    // El elegido se resalta (fondo de acento, marca seleccionada);
                    // el resto, una vez hay elección, se atenúa y se bloquea.
                    const isChosen = chosen === opt.value
                    const isLocked = chosen != null
                    return (
                    <button
                        key={opt.value}
                        type="button"
                        onClick={() => handleChoose(opt.value)}
                        disabled={isLocked}
                        aria-pressed={isChosen}
                        title={LABELS[opt.value] ?? opt.label}
                        className={`
                            group relative flex h-[58px] flex-col items-center justify-center gap-1
                            overflow-hidden border-[3px] border-[var(--color-ink)] rounded-[var(--radius)]
                            transition-all duration-100 select-none
                            ${isChosen
                                ? 'bg-[var(--color-accent)] text-white shadow-[var(--shadow-brutal)]'
                                : 'bg-[var(--color-surface)] text-[var(--color-ink)]'}
                            ${isLocked
                                ? 'cursor-default'
                                : `cursor-pointer hover:-translate-y-px hover:bg-[var(--color-accent)]
                                   hover:text-white hover:shadow-[var(--shadow-brutal)]
                                   active:translate-y-0 active:shadow-none`}
                            ${isLocked && !isChosen ? 'opacity-50' : ''}
                        `}
                    >
                        {/* Elegido: spinner de "re-lanzando…"; resto: la miniatura del tipo
                            (stroke = currentColor → hereda el color del hover/seleccionado). */}
                        {isChosen ? (
                            <Spinner size={20} className="border-white border-t-white/40" label="Generando" />
                        ) : (
                            <span
                                aria-hidden="true"
                                className="pointer-events-none h-6 w-11 opacity-70 group-hover:opacity-100"
                            >
                                <DiagramThumb type={opt.value} />
                            </span>
                        )}
                        {/* Etiqueta */}
                        <span className="px-1 text-center text-[11px] font-bold leading-tight">
                            {LABELS[opt.value] ?? opt.label}
                        </span>
                    </button>
                    )
                })}
            </div>
        </div>
    )
}
