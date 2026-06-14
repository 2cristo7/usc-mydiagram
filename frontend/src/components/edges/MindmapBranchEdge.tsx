import type { EdgeProps, Node } from '@xyflow/react'
import { useInternalNode } from '@xyflow/react'
import { getFloatingAnchor } from '../../ui/utils/getFloatingAnchor'

// Grosor de línea decreciente por nivel (gruesa junto a la raíz, fina en hojas)
function strokeWidth(level: number): number {
  return Math.max(1.5, 5 - level * 0.9)
}

export function MindmapBranchEdge({ source, target }: EdgeProps) {
  const sourceInternal = useInternalNode(source)
  const targetInternal = useInternalNode(target)

  if (!sourceInternal || !targetInternal) return null

  // Casting seguro: InternalNode es compatible con Node para getFloatingAnchor
  const sNode = sourceInternal as unknown as Node
  const tNode = targetInternal as unknown as Node

  const srcAnchor = getFloatingAnchor(sNode, tNode)
  const tgtAnchor = getFloatingAnchor(tNode, sNode)

  const sx = srcAnchor.x
  const sy = srcAnchor.y
  const tx = tgtAnchor.x
  const ty = tgtAnchor.y

  const dx = tx - sx
  const dy = ty - sy
  const dist = Math.sqrt(dx * dx + dy * dy)

  // Curva suave tipo S: puntos de control con ligero offset perpendicular
  const curveFactor = dist > 0 ? Math.min(dist * 0.15, 50) : 0
  const perpX = dist > 0 ? -dy / dist : 0
  const perpY = dist > 0 ? dx / dist : 0

  const cp1x = sx + dx * 0.35 + perpX * curveFactor
  const cp1y = sy + dy * 0.35 + perpY * curveFactor
  const cp2x = tx - dx * 0.35 - perpX * curveFactor
  const cp2y = ty - dy * 0.35 - perpY * curveFactor

  const d = `M ${sx} ${sy} C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${tx} ${ty}`

  // Color y grosor desde los datos del nodo hijo
  const tData = targetInternal.data as Record<string, unknown>
  const color = (tData?.branchColor as string | undefined) ?? '#3b82f6'
  const level = (tData?.level as number | undefined) ?? 1
  const sw = strokeWidth(level)

  return (
    <path
      d={d}
      fill="none"
      stroke={color}
      strokeWidth={sw}
      strokeLinecap="round"
    />
  )
}
