import { Plus, Pencil, Minus } from 'lucide-react'
import type { NodeOp, NodeOpKind } from '../types'

// S10.3 — lista por nodo de las operaciones de un run (icono según el tipo de
// cambio + nombre del nodo). Fuente ÚNICA reutilizada por la tarjeta En curso
// (alimentada por liveOps, "va saliendo") y por la tarjeta de versión persistida
// (derivada de op_summary). No incluye aristas (op_summary no guarda su nombre)
// ni el find. El estilo deriva del MISMO mapa para que vivo y persistido coincidan.
const OP_META: Record<NodeOpKind, { Icon: typeof Plus; color: string }> = {
  add: { Icon: Plus, color: 'var(--color-accent-3)' },
  update: { Icon: Pencil, color: 'var(--color-accent)' },
  delete: { Icon: Minus, color: 'var(--color-danger)' },
}

export function NodeOpList({ ops, className = '' }: { ops: NodeOp[]; className?: string }) {
  if (ops.length === 0) return null
  return (
    <ul className={`space-y-0.5 ${className}`}>
      {ops.map((op, i) => {
        const { Icon, color } = OP_META[op.kind]
        return (
          // El índice como key es seguro: la lista solo CRECE por el final (append),
          // nunca se reordena ni se borran items en medio dentro de un mismo run.
          <li key={i} className="flex items-center gap-1.5 text-xs text-[var(--color-ink)]">
            <Icon size={13} strokeWidth={2.5} style={{ color }} className="flex-shrink-0" />
            <span className="truncate">{op.label}</span>
          </li>
        )
      })}
    </ul>
  )
}
