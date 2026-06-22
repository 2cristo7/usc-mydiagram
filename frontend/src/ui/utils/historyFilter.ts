import { DIAGRAM_TYPE_OPTIONS, type DiagramType } from '../../types'

// Normaliza para comparar sin acentos ni mayúsculas (así "relación" casa con
// "relacion" y "ERD" con "erd").
const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim()

// Acepciones por tipo de diagrama, ADEMÁS del valor canónico y la etiqueta en
// español (que se añaden automáticamente). Permiten buscar un ERD escribiendo
// "base de datos", "tablas" o "entidad-relación"; un diagrama de flujo con
// "proceso"; etc. Lista deliberadamente generosa: en búsqueda, un falso positivo
// es barato y un término que no encuentra nada, frustrante.
const TYPE_SYNONYMS: Record<DiagramType, string[]> = {
  erd: [
    'erd', 'er', 'entidad relacion', 'entidad-relacion', 'entidad', 'relacion',
    'base de datos', 'bbdd', 'tablas', 'modelo de datos', 'modelo entidad relacion',
  ],
  sequence: ['secuencia', 'sequence', 'mensajes', 'interaccion'],
  flowchart: ['diagrama de flujo', 'flujo', 'flowchart', 'flow', 'proceso'],
  architecture: ['arquitectura', 'architecture', 'componentes', 'sistema', 'servicios'],
  mindmap: ['mapa mental', 'mindmap', 'mapa', 'ideas'],
  use_case: ['casos de uso', 'caso de uso', 'use case', 'use cases', 'use_case', 'actores'],
}

const LABELS: Record<string, string> = Object.fromEntries(
  DIAGRAM_TYPE_OPTIONS.map((o) => [o.value, o.label]),
)

// Términos buscables (normalizados) por tipo: valor canónico + etiqueta + sinónimos.
const TYPE_TERMS: Record<string, string[]> = Object.fromEntries(
  (Object.keys(TYPE_SYNONYMS) as DiagramType[]).map((t) => [
    t,
    [t, LABELS[t] ?? '', ...TYPE_SYNONYMS[t]].filter(Boolean).map(norm),
  ]),
)

export interface HistoryFilterable {
  title: string
  diagram_type: string
}

// ¿El tipo de un diagrama casa con la consulta? Casa si algún término del tipo
// (valor, etiqueta o sinónimo) contiene la consulta normalizada.
function typeMatches(diagramType: string, q: string): boolean {
  const terms = TYPE_TERMS[diagramType]
  return terms ? terms.some((term) => term.includes(q)) : false
}

// Filtra el historial por TÍTULO o por TIPO de diagrama (con acepciones). Consulta
// vacía o solo espacios → devuelve todo. Pieza pura, testeable sin DOM, compartida
// por el panel de historial y el de la papelera.
export function filterHistory<T extends HistoryFilterable>(items: T[], query: string): T[] {
  const q = norm(query)
  if (q === '') return items
  return items.filter(
    (item) => norm(item.title).includes(q) || typeMatches(item.diagram_type, q),
  )
}
