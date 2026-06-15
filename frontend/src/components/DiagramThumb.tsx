/**
 * DiagramThumb — miniatura esquemática de cada tipo de diagrama.
 *
 * Se dibuja como SVG inline (sin assets), con `stroke="currentColor"` para que
 * el color lo controle el contenedor. En las cards se renderiza de fondo,
 * difuminada y a baja opacidad, como "textura" que insinúa el tipo de diagrama
 * detrás del título. El viewBox 0 0 160 80 es común a todas para que escalen
 * igual al rellenar la card.
 */

import type { ReactElement } from 'react'

interface ThumbProps {
  type: string
}

const VIEWBOX = '0 0 160 80'

// Props compartidas: trazo redondeado, sin relleno, color heredado del contenedor.
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 3,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function Auto() {
  // Mezcla de formas (rect, rombo, círculo) + destello: "deja que la IA elija".
  return (
    <svg viewBox={VIEWBOX} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      <rect x="14" y="20" width="34" height="22" rx="3" {...stroke} />
      <path d="M88 16 l16 16 -16 16 -16 -16 z" {...stroke} />
      <circle cx="126" cy="56" r="13" {...stroke} />
      <path d="M48 31 H64" {...stroke} />
      <path d="M104 40 L116 50" {...stroke} />
      {/* Destello */}
      <path d="M132 14 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3 z" {...stroke} strokeWidth={2.5} />
    </svg>
  )
}

function Erd() {
  // Dos "tablas" con cabecera, unidas por una relación.
  return (
    <svg viewBox={VIEWBOX} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      <rect x="12" y="18" width="46" height="44" rx="3" {...stroke} />
      <path d="M12 30 H58" {...stroke} />
      <path d="M22 42 H48 M22 52 H48" {...stroke} strokeWidth={2} />
      <rect x="102" y="18" width="46" height="44" rx="3" {...stroke} />
      <path d="M102 30 H148" {...stroke} />
      <path d="M112 42 H138 M112 52 H138" {...stroke} strokeWidth={2} />
      <path d="M58 40 H102" {...stroke} />
    </svg>
  )
}

function UmlClass() {
  // Caja de clase con 3 compartimentos + herencia hacia otra clase.
  return (
    <svg viewBox={VIEWBOX} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      <rect x="12" y="14" width="44" height="52" rx="2" {...stroke} />
      <path d="M12 28 H56 M12 46 H56" {...stroke} />
      <rect x="104" y="30" width="44" height="36" rx="2" {...stroke} />
      <path d="M104 44 H148" {...stroke} />
      {/* Flecha de herencia (triángulo hueco) */}
      <path d="M56 40 H88" {...stroke} />
      <path d="M88 32 l12 8 -12 8 z" {...stroke} />
    </svg>
  )
}

function Sequence() {
  // Tres lifelines verticales con cabecera + mensajes horizontales.
  return (
    <svg viewBox={VIEWBOX} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      <rect x="14" y="10" width="26" height="14" rx="2" {...stroke} />
      <rect x="68" y="10" width="26" height="14" rx="2" {...stroke} />
      <rect x="122" y="10" width="26" height="14" rx="2" {...stroke} />
      <path d="M27 24 V70 M81 24 V70 M135 24 V70" {...stroke} strokeWidth={2} strokeDasharray="4 4" />
      <path d="M27 36 H81" {...stroke} strokeWidth={2.5} />
      <path d="M81 52 H135" {...stroke} strokeWidth={2.5} />
      <path d="M135 64 H27" {...stroke} strokeWidth={2.5} />
    </svg>
  )
}

function Flowchart() {
  // Terminator -> rombo de decisión -> paso.
  return (
    <svg viewBox={VIEWBOX} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      <rect x="16" y="12" width="40" height="18" rx="9" {...stroke} />
      <path d="M36 30 V40 M36 40 L80 40" {...stroke} />
      <path d="M80 24 l18 16 -18 16 -18 -16 z" {...stroke} />
      <path d="M98 40 H124" {...stroke} />
      <rect x="124" y="30" width="22" height="20" rx="2" {...stroke} />
    </svg>
  )
}

function Architecture() {
  // Servicios (rect) + base de datos (cilindro) conectados.
  return (
    <svg viewBox={VIEWBOX} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      <rect x="12" y="16" width="38" height="22" rx="3" {...stroke} />
      <rect x="62" y="44" width="38" height="22" rx="3" {...stroke} />
      {/* Cilindro DB */}
      <path d="M116 22 a16 6 0 0 0 32 0 a16 6 0 0 0 -32 0 v24 a16 6 0 0 0 32 0 v-24" {...stroke} />
      <path d="M50 30 H62 M62 50 H40 M100 52 H116" {...stroke} />
      <path d="M50 27 L116 27" {...stroke} strokeWidth={2} strokeDasharray="3 4" />
    </svg>
  )
}

function StateMachine() {
  // Estados redondeados con transiciones.
  return (
    <svg viewBox={VIEWBOX} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      <rect x="10" y="30" width="36" height="22" rx="11" {...stroke} />
      <rect x="62" y="14" width="36" height="22" rx="11" {...stroke} />
      <rect x="114" y="44" width="36" height="22" rx="11" {...stroke} />
      <path d="M46 38 L62 28" {...stroke} />
      <path d="M98 30 L114 50" {...stroke} />
      <path d="M46 46 C 78 78, 110 70, 122 66" {...stroke} strokeWidth={2} />
    </svg>
  )
}

function Mindmap() {
  // Nodo central con ramas radiales.
  return (
    <svg viewBox={VIEWBOX} className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      <ellipse cx="80" cy="40" rx="24" ry="15" {...stroke} />
      <path d="M58 32 L30 18 M58 48 L30 62 M104 32 L132 18 M104 48 L132 62" {...stroke} strokeWidth={2.5} />
      <circle cx="24" cy="16" r="7" {...stroke} />
      <circle cx="24" cy="64" r="7" {...stroke} />
      <circle cx="136" cy="16" r="7" {...stroke} />
      <circle cx="136" cy="64" r="7" {...stroke} />
    </svg>
  )
}

const THUMBS: Record<string, () => ReactElement> = {
  auto: Auto,
  erd: Erd,
  uml_class: UmlClass,
  sequence: Sequence,
  flowchart: Flowchart,
  architecture: Architecture,
  state_machine: StateMachine,
  mindmap: Mindmap,
}

export function DiagramThumb({ type }: ThumbProps) {
  const Thumb = THUMBS[type] ?? Auto
  return <Thumb />
}
