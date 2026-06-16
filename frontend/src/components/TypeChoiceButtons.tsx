// Bandeja de botones para elegir el tipo de diagrama cuando el backend detecta
// ambigüedad UML y emite `diagram:type_clarification`. Patrón visual idéntico al
// de ToolTray: panel adherido al chat, visible solo mientras haya pendingTypeChoice.
// Al pulsar un botón se llama a chooseDiagramType(value), que re-lanza la
// generación por `message:regenerate` y limpia este estado.

import { useStore } from '../store/index'
import { Button } from '../ui/primitives/Button'

interface TypeChoiceButtonsProps {
    /** Callback proporcionado por useWebSocket; no se importa el hook aquí para
     *  evitar duplicar el socket — el padre lo pasa como prop. */
    onChoose: (diagramTypeValue: string) => void
}

export function TypeChoiceButtons({ onChoose }: TypeChoiceButtonsProps) {
    const pendingTypeChoice = useStore((s) => s.pendingTypeChoice)

    // Solo se renderiza cuando hay una elección pendiente de tipo
    if (!pendingTypeChoice) return null

    return (
        <div className="border-t-[3px] border-[var(--color-ink)] bg-[var(--color-surface)] px-3 py-2">
            {/* Etiqueta de contexto */}
            <p className="text-xs font-semibold text-[var(--color-ink)]/70 mb-2">
                Elige el tipo de diagrama:
            </p>
            {/* Botones en fila, uno por opción */}
            <div className="flex flex-wrap gap-2">
                {pendingTypeChoice.options.map((opt) => (
                    <Button
                        key={opt.value}
                        variant="secondary"
                        className="text-xs py-1.5 px-3"
                        onClick={() => onChoose(opt.value)}
                    >
                        {opt.label}
                    </Button>
                ))}
            </div>
        </div>
    )
}
