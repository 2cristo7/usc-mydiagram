import type { NodeProps, Node } from '@xyflow/react'
import type { FragmentKind } from '../../types'
import { GroupResizeControls } from './GroupResizeControls'

type OperandLayout = { guard: string; topOffset: number }
type FragmentData = {
  kind: FragmentKind
  operands: OperandLayout[]
  width: number
  height: number
}
type SequenceFragmentNodeType = Node<FragmentData, 'sequenceFragment'>

const MIN_W = 80
const MIN_H = 60

/**
 * S10.4 — Marco de un fragmento combinado UML (alt/opt/loop/par) en un diagrama
 * de secuencia. Caja con una pestaña pentagonal arriba-izquierda que muestra el
 * `kind`, la guarda del primer operando junto a la pestaña, y —para alt/par con
 * varios operandos— un divisor punteado con la guarda de cada operando siguiente.
 *
 * Es decoración estructural: no interactúa (pointer-events desactivados) para no
 * robar clics a los mensajes/lifelines que envuelve. sequenceLayout lo coloca por
 * detrás (zIndex bajo) con su geometría ya calculada.
 */
export function SequenceFragmentNode({ id, data, selected }: NodeProps<SequenceFragmentNodeType>) {
  const { kind, operands } = data

  return (
    <div
      className="relative pointer-events-none"
      style={{ width: '100%', height: '100%' }}
    >
      <GroupResizeControls id={id} selected={selected} minWidth={MIN_W} minHeight={MIN_H} />

      {/* Caja del fragmento */}
      <div
        className="absolute inset-0 border-[1.5px] border-[var(--color-ink)] opacity-80"
        style={{
          boxShadow: selected ? '0 0 0 2px color-mix(in srgb, var(--color-accent) 40%, transparent)' : 'none',
        }}
      />

      {/* Pestaña pentagonal con el tipo de fragmento */}
      <div
        className="absolute top-0 left-0 bg-[var(--color-surface)] border-r-[1.5px] border-b-[1.5px] border-[var(--color-ink)] px-2 py-0.5 text-[10px] font-mono font-bold uppercase tracking-wide text-[var(--color-ink)]"
        style={{ clipPath: 'polygon(0 0, 100% 0, 100% 60%, 80% 100%, 0 100%)' }}
      >
        {kind}
      </div>

      {/* Guarda del primer operando, junto a la pestaña */}
      {operands[0]?.guard && (
        <div className="absolute top-0 left-[44px] py-0.5 text-[10px] font-mono italic text-[var(--color-ink)]">
          {operands[0].guard}
        </div>
      )}

      {/* Operandos siguientes: divisor punteado + guarda (alt/par) */}
      {operands.slice(1).map((op, i) => (
        <div key={i} style={{ position: 'absolute', top: op.topOffset, left: 0, width: '100%' }}>
          <div className="border-t-[1.5px] border-dashed border-[var(--color-ink)] opacity-70" />
          {op.guard && (
            <div className="text-[10px] font-mono italic text-[var(--color-ink)] px-1">
              {op.guard}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
