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
    <div
      className="flex gap-1.5 overflow-x-auto py-0.5"
      style={{ scrollbarWidth: 'none' }}
    >
      {options.map((opt) => {
        const key = opt.value ?? 'auto'
        const isSelected = opt.value === selectedDiagramType
        const icon = ICONS[key] ?? '◉'
        return (
          <button
            key={key}
            onClick={() => setSelectedDiagramType(opt.value)}
            className={`
              shrink-0 flex items-center gap-1 px-2.5 py-1 text-xs font-semibold
              border-[3px] border-[var(--color-ink)] rounded-[var(--radius)]
              transition-all duration-75
              ${
                isSelected
                  ? 'bg-[var(--color-accent)] text-white shadow-[var(--shadow-brutal)]'
                  : 'bg-[var(--color-surface)] text-[var(--color-ink)] hover:shadow-[var(--shadow-brutal)] hover:-translate-y-px'
              }
            `}
          >
            <span aria-hidden="true">{icon}</span>
            <span>{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}
