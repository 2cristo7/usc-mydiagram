import type { DiagramSchema, DiagramType, EdgeType, EdgeVisualData } from '../../types'

// Forma "nativa" de un edge según el tipo de diagrama, usada SOLO como fallback
// cuando el diagrama aún no tiene aristas de las que aprender. Coincide con lo
// que ya renderiza cada diagrama hoy: mindmap dibuja ramas curvas; casos de uso
// usan líneas RECTAS (asociaciones actor→caso e include/extend, estilo UML
// clásico); el resto (erd, flowchart, architecture) usan codo ortogonal.
export function defaultEdgeShape(type: DiagramType | undefined): NonNullable<EdgeVisualData['shape']> {
  if (type === 'mindmap') return 'curved'
  if (type === 'use_case') return 'straight'
  return 'elbow'
}

// Estilo visual coherente con la semántica de un edge_type, según el tipo de
// diagrama. Fuente ÚNICA de verdad compartida por:
//  - buildFlowEdges: defaults al construir las aristas para el render.
//  - EdgeContextMenu: reaplica el estilo cuando el usuario cambia el tipo.
// Devuelve SIEMPRE los cinco campos de estilo (trazo, ambas flechas y ambos
// markers) de forma explícita, de modo que aplicarlo deja el aspecto totalmente
// determinado: al pasar de 'inherits' a otro tipo, p. ej., el triángulo hueco se
// limpia en lugar de quedar pegado. Los valores base coinciden con los defaults
// de render de EditableEdge (trazo normal, flecha solo al destino, sin markers).
export function edgeTypeStyle(
  edgeType: EdgeType | undefined,
  diagramType: DiagramType | undefined,
): Partial<EdgeVisualData> {
  const base: Partial<EdgeVisualData> = {
    strokeStyle: 'normal',
    sourceArrow: false,
    targetArrow: true,
    markerEndId: undefined,
    markerStartId: undefined,
  }
  // Arquitectura: 'calls' es sólida; cualquier otra relación (dependencia) va
  // discontinua. Aquí el edge_type concreto importa menos que ese binario.
  if (diagramType === 'architecture') {
    return { ...base, strokeStyle: (edgeType ?? 'calls') === 'calls' ? 'normal' : 'dashed' }
  }
  switch (edgeType) {
    // Casos de uso UML:
    case 'include':
    case 'extend':
      // Discontinua con flecha abierta hacia el destino.
      return { ...base, strokeStyle: 'dashed' }
    case 'inherits':
      // Generalización: triángulo hueco apuntando al padre, sin flecha simple.
      return { ...base, targetArrow: false, markerEndId: 'arrowHollow' }
    case 'association':
      // Sólida sin flecha (asociación / rama de mapa mental).
      return { ...base, targetArrow: false }
    default:
      return base
  }
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
