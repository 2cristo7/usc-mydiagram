import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useStore } from '../store/index'
import type { DiagramType } from '../types'
import { DIAGRAM_TYPE_OPTIONS } from '../types'
import { DiagramThumb } from './DiagramThumb'

export function DiagramTypeCards() {
  const { selectedDiagramType, setSelectedDiagramType } = useStore()

  const options: { value: DiagramType | null; label: string }[] = [
    { value: null, label: 'Auto' },
    ...DIAGRAM_TYPE_OPTIONS,
  ]

  const scrollRef = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  // Recalcula si quedan cards ocultas a izquierda/derecha para mostrar las flechas.
  const updateArrows = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 2)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  useEffect(() => {
    updateArrows()
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(updateArrows)
    ro.observe(el)
    return () => ro.disconnect()
  }, [updateArrows])

  const scrollByCards = (dir: 1 | -1) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  return (
    <div className="relative h-full">
      {/* Desvanecido + flecha izquierda (siempre montados; se animan con `visible`) */}
      <EdgeFade side="left" visible={canLeft} />
      <Arrow side="left" visible={canLeft} onClick={() => scrollByCards(-1)} />

      <div
        ref={scrollRef}
        onScroll={updateArrows}
        className="no-scrollbar flex h-full items-center gap-2 overflow-x-auto scroll-smooth"
      >
        {options.map((opt) => {
          const key = opt.value ?? 'auto'
          const isSelected = opt.value === selectedDiagramType
          return (
            <button
              key={key}
              onClick={() => setSelectedDiagramType(opt.value)}
              aria-pressed={isSelected}
              title={opt.label}
              className={`
                group relative h-12 w-[136px] shrink-0 overflow-hidden
                border-[3px] border-[var(--color-ink)] rounded-[var(--radius)]
                transition-all duration-100 cursor-pointer select-none
                ${
                  isSelected
                    ? 'bg-[var(--color-accent)] text-white shadow-[var(--shadow-brutal)] -translate-y-px'
                    : 'bg-[var(--color-surface)] text-[var(--color-ink)] hover:shadow-[var(--shadow-brutal)] hover:-translate-y-px active:translate-y-0 active:shadow-none'
                }
              `}
            >
              {/* Miniatura difuminada de fondo */}
              <span
                aria-hidden="true"
                className={`
                  pointer-events-none absolute inset-0 flex items-center justify-center
                  blur-[1.5px] transition-opacity duration-100
                  ${isSelected ? 'text-white/60 opacity-100' : 'text-[var(--color-ink)]/25 opacity-100 group-hover:text-[var(--color-accent)]/40'}
                `}
              >
                <span className="h-[120%] w-[120%]">
                  <DiagramThumb type={key} />
                </span>
              </span>

              {/* Velo para legibilidad del título */}
              <span
                aria-hidden="true"
                className={`absolute inset-0 ${isSelected ? 'bg-[var(--color-accent)]/35' : 'bg-[var(--color-surface)]/45'}`}
              />

              {/* Título centrado */}
              <span className="relative z-10 flex h-full items-center justify-center px-2 text-center text-xs font-bold leading-tight">
                {opt.label}
              </span>
            </button>
          )
        })}
      </div>

      {/* Desvanecido + flecha derecha */}
      <EdgeFade side="right" visible={canRight} />
      <Arrow side="right" visible={canRight} onClick={() => scrollByCards(1)} />
    </div>
  )
}

function EdgeFade({ side, visible }: { side: 'left' | 'right'; visible: boolean }) {
  const isLeft = side === 'left'
  return (
    <span
      aria-hidden="true"
      className={`
        pointer-events-none absolute inset-y-0 z-10 w-12 transition-opacity duration-200
        ${isLeft ? 'left-0 bg-gradient-to-r' : 'right-0 bg-gradient-to-l'}
        from-[var(--color-surface)] to-transparent
        ${visible ? 'opacity-100' : 'opacity-0'}
      `}
    />
  )
}

function Arrow({ side, visible, onClick }: { side: 'left' | 'right'; visible: boolean; onClick: () => void }) {
  const isLeft = side === 'left'
  return (
    <button
      type="button"
      onClick={onClick}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      aria-label={isLeft ? 'Desplazar a la izquierda' : 'Desplazar a la derecha'}
      className={`
        absolute top-1/2 z-20 -translate-y-1/2 ${isLeft ? 'left-0.5' : 'right-0.5'}
        flex h-9 w-9 items-center justify-center
        border-[3px] border-[var(--color-ink)] rounded-full bg-[var(--color-surface)]
        shadow-[var(--shadow-brutal)] cursor-pointer
        transition-[opacity,transform] duration-200
        ${visible
          ? 'opacity-100 scale-100 hover:scale-110 active:scale-95'
          : 'pointer-events-none opacity-0 scale-75'}
      `}
    >
      {isLeft ? <ChevronLeft size={16} strokeWidth={3} /> : <ChevronRight size={16} strokeWidth={3} />}
    </button>
  )
}
