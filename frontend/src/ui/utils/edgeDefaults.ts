import type { DiagramSchema, DiagramType, EdgeType, EdgeVisualData } from '../../types'

// Forma "nativa" de un edge según el tipo de diagrama, usada SOLO como fallback
// cuando el diagrama aún no tiene aristas de las que aprender. Coincide con lo
// que ya renderiza cada diagrama hoy: mindmap dibuja ramas curvas; el resto de
// tipos (erd, flowchart, architecture, use_case) usan codo ortogonal (el default
// de EditableEdge).
export function defaultEdgeShape(type: DiagramType | undefined): NonNullable<EdgeVisualData['shape']> {
  return type === 'mindmap' ? 'curved' : 'elbow'
}

// Valor más frecuente de una lista (moda). Devuelve undefined si está vacía.
function mode<T>(values: T[]): T | undefined {
  if (values.length === 0) return undefined
  const counts = new Map<T, number>()
  let best: T | undefined
  let bestCount = 0
  for (const v of values) {
    const c = (counts.get(v) ?? 0) + 1
    counts.set(v, c)
    if (c > bestCount) {
      bestCount = c
      best = v
    }
  }
  return best
}

export interface PredictedEdgeDefaults {
  shape: NonNullable<EdgeVisualData['shape']>
  edge_type: EdgeType
  strokeStyle: NonNullable<EdgeVisualData['strokeStyle']>
  sourceArrow: boolean
  targetArrow: boolean
}

// Predice cómo debe ser una arista creada a mano en el canvas (estilo Miro):
// como "solo hay un tipo de relación por diagrama", inferimos la forma y el tipo
// semántico de las aristas que ya existen (la moda), de modo que la nueva salga
// idéntica al resto. Si el diagrama está vacío, caemos al default por tipo.
export function predictEdgeDefaults(diagram: DiagramSchema | null): PredictedEdgeDefaults {
  const edges = diagram?.edges ?? []

  const shape =
    mode(edges.map((e) => e.data?.shape).filter((s): s is NonNullable<typeof s> => !!s)) ??
    defaultEdgeShape(diagram?.diagram_type)

  const edge_type =
    mode(edges.map((e) => e.edge_type).filter((t): t is EdgeType => !!t)) ?? 'association'

  const strokeStyle =
    mode(edges.map((e) => e.data?.strokeStyle).filter((s): s is NonNullable<typeof s> => !!s)) ??
    'normal'

  return { shape, edge_type, strokeStyle, sourceArrow: false, targetArrow: true }
}
