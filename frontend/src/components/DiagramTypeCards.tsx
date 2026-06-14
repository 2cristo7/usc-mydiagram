import { useStore } from '../store/index'
import type { DiagramType } from '../types'
import { DIAGRAM_TYPE_OPTIONS } from '../types'

const ICONS: Record<string, string> = {
  auto: '✦',
  erd: '⊞',
  uml_class: '⊡',
  sequence: '⇄',
  flowchart: '◇',
  architecture: '⬡',
  state_machine: '◎',
  mindmap: '❋',
}

export function DiagramTypeCards() {
  const { selectedDiagramType, setSelectedDiagramType } = useStore()

  const options: { value: DiagramType | null; label: string }[] = [
    { value: null, label: 'Auto' },
    ...DIAGRAM_TYPE_OPTIONS,
  ]

  return (
    <div className="flex flex-wrap gap-1.5 py-0.5">
      {options.map((opt) => {
        const key = opt.value ?? 'auto'
        const isSelected = opt.value === selectedDiagramType
        const icon = ICONS[key] ?? '◉'
        return (
          <button
            key={key}
            onClick={() => setSelectedDiagramType(opt.value)}
            aria-pressed={isSelected}
            title={opt.label}
            className={`
              shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs font-semibold
              border-[3px] border-[var(--color-ink)] rounded-[var(--radius)]
              transition-all duration-75 cursor-pointer select-none
              ${
                isSelected
                  ? 'bg-[var(--color-accent)] text-white shadow-[var(--shadow-brutal)] -translate-y-px'
                  : 'bg-[var(--color-surface)] text-[var(--color-ink)] hover:shadow-[var(--shadow-brutal)] hover:-translate-y-px active:translate-y-0 active:shadow-none'
              }
            `}
          >
            <span aria-hidden="true" className="text-sm leading-none">{icon}</span>
            <span>{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}
