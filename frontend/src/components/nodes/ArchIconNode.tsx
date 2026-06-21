import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { useLayoutEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type { NodeType } from '../../types'
import { useStore } from '../../store'
import { useNodeAttrEditor } from '../../hooks/useNodeAttrEditor'
import { useArchGeom } from '../../store/archGeom'
import {
  archBottlePolygon,
  ARCH_GAP,
  ARCH_ICON_BOX,
  ARCH_ICON_VIS,
  ARCH_PAD,
} from '../../ui/utils/archBottle'

// Traza un polígono cerrado con las esquinas redondeadas (radio r, recortado a
// la mitad del lado más corto). Sirve tanto para esquinas convexas como
// cóncavas, así que vale para la silueta "botella" (unión de dos cajas).
type Pt = { x: number; y: number }
function roundedPolygonPath(pts: Pt[], r: number): string {
  const n = pts.length
  let d = ''
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]
    const curr = pts[i]
    const next = pts[(i + 1) % n]
    const v1x = curr.x - prev.x, v1y = curr.y - prev.y
    const v2x = next.x - curr.x, v2y = next.y - curr.y
    const l1 = Math.hypot(v1x, v1y) || 1
    const l2 = Math.hypot(v2x, v2y) || 1
    const r1 = Math.min(r, l1 / 2)
    const r2 = Math.min(r, l2 / 2)
    const p1x = curr.x - (v1x / l1) * r1, p1y = curr.y - (v1y / l1) * r1
    const p2x = curr.x + (v2x / l2) * r2, p2y = curr.y + (v2y / l2) * r2
    d += `${i === 0 ? 'M' : 'L'} ${p1x.toFixed(2)} ${p1y.toFixed(2)} `
    d += `Q ${curr.x.toFixed(2)} ${curr.y.toFixed(2)} ${p2x.toFixed(2)} ${p2y.toFixed(2)} `
  }
  return d + 'Z'
}

type ArchIconData = { label: string; nodeType: NodeType; attributes: string[] }
type ArchIconNodeType = Node<ArchIconData, 'archIcon'>

// Color del tipo para el label — acento pequeño que no rompe el estilo ink
const TYPE_COLOR: Partial<Record<NodeType, string>> = {
  database:  '#2563eb',
  service:   '#ff5c00',
  queue:     '#e11d48',
  gateway:   '#7c3aed',
  person:    '#16a34a',
  system:    '#0891b2',
  container: '#d97706',
  component: '#9333ea',
}

const TYPE_LABELS: Partial<Record<NodeType, string>> = {
  database: 'database', service: 'service', queue: 'queue', gateway: 'gateway',
  person: 'person',     system: 'system',   container: 'container', component: 'component',
}

// ── Iconos outline (trazo negro, sin relleno) ─────────────────────────────────

const INK = 'var(--color-ink)'
const SW  = 2.2   // strokeWidth base

function DatabaseIcon() {
  // Cilindro: tapa elíptica arriba + dos anillos frontales + base frontal.
  // Los anillos son solo el arco frontal (bombeo hacia abajo) y están espaciados
  // para que no se crucen entre sí ni con la base.
  return (
    <svg viewBox="0 0 56 56" fill="none">
      {/* tapa superior (elipse completa) */}
      <ellipse cx="28" cy="12" rx="18" ry="5" stroke={INK} strokeWidth={SW} />
      {/* lados */}
      <line x1="10" y1="12" x2="10" y2="44" stroke={INK} strokeWidth={SW} />
      <line x1="46" y1="12" x2="46" y2="44" stroke={INK} strokeWidth={SW} />
      {/* anillo 1 (arco frontal) */}
      <path d="M10 23 Q28 33 46 23" stroke={INK} strokeWidth={SW} fill="none" />
      {/* anillo 2 (arco frontal) */}
      <path d="M10 33 Q28 43 46 33" stroke={INK} strokeWidth={SW} fill="none" />
      {/* base (arco frontal cerrando los lados) */}
      <path d="M10 44 Q28 54 46 44" stroke={INK} strokeWidth={SW} fill="none" />
    </svg>
  )
}

function ServiceIcon() {
  return (
    <svg viewBox="0 0 56 56" fill="none">
      {/* rack — tres unidades */}
      <rect x="8"  y="7"  width="40" height="12" rx="2" stroke={INK} strokeWidth={SW} />
      <rect x="8"  y="22" width="40" height="12" rx="2" stroke={INK} strokeWidth={SW} />
      <rect x="8"  y="37" width="40" height="12" rx="2" stroke={INK} strokeWidth={SW} />
      {/* ventilación (3 líneas en cada unidad) */}
      <line x1="13" y1="11" x2="22" y2="11" stroke={INK} strokeWidth={SW} strokeLinecap="round" />
      <line x1="13" y1="26" x2="22" y2="26" stroke={INK} strokeWidth={SW} strokeLinecap="round" />
      <line x1="13" y1="41" x2="22" y2="41" stroke={INK} strokeWidth={SW} strokeLinecap="round" />
      {/* LED (círculo relleno pequeño) */}
      <circle cx="40" cy="13" r="2.5" fill={INK} />
      <circle cx="40" cy="28" r="2.5" fill={INK} />
      <circle cx="40" cy="43" r="2.5" fill={INK} />
    </svg>
  )
}

function QueueIcon() {
  // Cola de mensajes: sobre delantero + sobre apilado detrás (sólido, asomando
  // arriba-derecha) que sugiere "varios mensajes en cola" + flecha de salida.
  return (
    <svg viewBox="0 0 56 56" fill="none">
      {/* sobre apilado detrás (asoma) */}
      <rect x="14" y="11" width="28" height="18" rx="2" fill="var(--color-surface)" stroke={INK} strokeWidth={SW} />
      {/* sobre principal */}
      <rect x="8" y="18" width="28" height="20" rx="2" fill="var(--color-surface)" stroke={INK} strokeWidth={SW} />
      {/* solapa del sobre principal */}
      <polyline points="8,20 22,31 36,20" stroke={INK} strokeWidth={SW} strokeLinejoin="round" strokeLinecap="round" fill="none" />
      {/* flecha de salida */}
      <line x1="42" y1="28" x2="53" y2="28" stroke={INK} strokeWidth={SW} strokeLinecap="round" />
      <polyline points="48,23 53,28 48,33" stroke={INK} strokeWidth={SW} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

function GatewayIcon() {
  return (
    <svg viewBox="0 0 56 56" fill="none">
      {/* nodo central */}
      <circle cx="28" cy="28" r="7" stroke={INK} strokeWidth={SW} />
      {/* 4 ramas con nodo final */}
      <line x1="28" y1="21" x2="28" y2="9"  stroke={INK} strokeWidth={SW} />
      <circle cx="28" cy="7"  r="3" fill={INK} />
      <line x1="28" y1="35" x2="28" y2="47" stroke={INK} strokeWidth={SW} />
      <circle cx="28" cy="49" r="3" fill={INK} />
      <line x1="21" y1="28" x2="9"  y2="28" stroke={INK} strokeWidth={SW} />
      <circle cx="7"  cy="28" r="3" fill={INK} />
      <line x1="35" y1="28" x2="47" y2="28" stroke={INK} strokeWidth={SW} />
      <circle cx="49" cy="28" r="3" fill={INK} />
    </svg>
  )
}

function PersonIcon() {
  // Actor/usuario: cabeza + busto cerrado (hombros redondeados que rematan en la
  // base con una línea horizontal), proporciones equilibradas y trazo continuo.
  return (
    <svg viewBox="0 0 56 56" fill="none">
      {/* cabeza */}
      <circle cx="28" cy="17" r="8.5" stroke={INK} strokeWidth={SW} />
      {/* busto: hombros redondeados que cierran en la base */}
      <path
        d="M13 47 C13 36 18 31 28 31 C38 31 43 36 43 47 Z"
        stroke={INK}
        strokeWidth={SW}
        fill="none"
        strokeLinejoin="round"
      />
    </svg>
  )
}

function SystemIcon() {
  // Límite del sistema (caja) con un engranaje "ajustes" limpio dentro.
  // El engranaje es el path clásico (dientes redondeados) en coords 24×24,
  // escalado y centrado dentro de la caja.
  return (
    <svg viewBox="0 0 56 56" fill="none">
      {/* caja límite del sistema */}
      <rect x="5" y="5" width="46" height="46" rx="4" stroke={INK} strokeWidth={SW} />
      {/* engranaje (centrado en 28,28; escala 1.45 → stroke efectivo ≈ SW) */}
      <g
        transform="translate(28 28) scale(1.45) translate(-12 -12)"
        stroke={INK}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
        <circle cx="12" cy="12" r="3" />
      </g>
    </svg>
  )
}

function ContainerIcon() {
  return (
    <svg viewBox="0 0 56 56" fill="none">
      {/* grid 2×2 de contenedores */}
      <rect x="4"  y="4"  width="22" height="22" rx="2" stroke={INK} strokeWidth={SW} />
      <rect x="30" y="4"  width="22" height="22" rx="2" stroke={INK} strokeWidth={SW} />
      <rect x="4"  y="30" width="22" height="22" rx="2" stroke={INK} strokeWidth={SW} />
      <rect x="30" y="30" width="22" height="22" rx="2" stroke={INK} strokeWidth={SW} />
      {/* línea de detalle en cada caja */}
      <line x1="8"  y1="14" x2="22" y2="14" stroke={INK} strokeWidth={1.4} strokeLinecap="round" />
      <line x1="34" y1="14" x2="48" y2="14" stroke={INK} strokeWidth={1.4} strokeLinecap="round" />
      <line x1="8"  y1="40" x2="22" y2="40" stroke={INK} strokeWidth={1.4} strokeLinecap="round" />
      <line x1="34" y1="40" x2="48" y2="40" stroke={INK} strokeWidth={1.4} strokeLinecap="round" />
    </svg>
  )
}

function ComponentIcon() {
  // Icono UML clásico de componente: bloque con dos "tabs" enchufados a la izquierda.
  return (
    <svg viewBox="0 0 56 56" fill="none">
      {/* bloque principal */}
      <rect x="16" y="10" width="34" height="36" rx="1.5" stroke={INK} strokeWidth={SW} />
      {/* tabs (conectores) montados sobre el borde izquierdo del bloque */}
      <rect x="8" y="17" width="16" height="9" rx="1" fill="var(--color-surface)" stroke={INK} strokeWidth={SW} />
      <rect x="8" y="30" width="16" height="9" rx="1" fill="var(--color-surface)" stroke={INK} strokeWidth={SW} />
    </svg>
  )
}

const ICON_MAP: Partial<Record<NodeType, () => ReactElement>> = {
  database: DatabaseIcon, service: ServiceIcon,   queue:     QueueIcon,
  gateway:  GatewayIcon,  person:  PersonIcon,    system:    SystemIcon,
  container: ContainerIcon,                        component: ComponentIcon,
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ArchIconNode({ id, data, selected }: NodeProps<ArchIconNodeType>) {
  const { label, nodeType, attributes = [] } = data
  const typeColor = TYPE_COLOR[nodeType] ?? INK
  const typeLabel = TYPE_LABELS[nodeType] ?? nodeType
  const IconComponent = ICON_MAP[nodeType]

  // El atributo `group:` (pertenencia al grupo) NO está en data.attributes
  // —architectureLayoutSync lo filtra—, pero debe CONSERVARSE al guardar la edición.
  // Lo leemos de la fuente (currentDiagram) para reanexarlo en el commit.
  const fullAttrs = useStore((s) => s.currentDiagram?.nodes.find((n) => n.id === id)?.attributes)
  const hiddenAttrs = useMemo(
    () => (fullAttrs ?? []).filter((a) => /^group\s*:/i.test(a)),
    [fullAttrs],
  )
  const containerRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<(HTMLInputElement | null)[]>([])
  const ed = useNodeAttrEditor(id, label, attributes, {
    containerRef,
    rowRefs,
    hiddenAttributes: hiddenAttrs,
  })

  const techAttr = attributes.find((a) => /^tech\s*:/i.test(a))
  const tech = techAttr ? techAttr.replace(/^tech\s*:\s*/i, '').trim() : null

  // Medimos la caja real del texto para que el anillo de selección la abrace
  // ajustado (se adapta a 1 ó 2 líneas, a la presencia de `tech`, etc.) y lo
  // publicamos al store de geometría: las aristas lo leen para anclar sus
  // extremos sobre la silueta botella (icono 72×72 + texto debajo).
  const setArchSize = useArchGeom((s) => s.setSize)
  const removeArchSize = useArchGeom((s) => s.removeSize)
  const textRef = useRef<HTMLDivElement>(null)
  const [textSize, setTextSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = textRef.current
    if (!el) return
    const measure = () => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      setTextSize({ w, h })
      setArchSize(id, w, h)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [label, typeLabel, tech, id, setArchSize])

  // Limpia la entrada del store al desmontar el nodo.
  useLayoutEffect(() => () => removeArchSize(id), [id, removeArchSize])

  // ── Silueta "botella" (anillo de selección = hitbox de anclaje de aristas) ──
  // Misma geometría que consumen las utils de aristas (archBottle), en
  // ROOT-LOCAL: la caja del icono es [0,72]×[0,72] y el texto cuelga debajo
  // centrado en el eje X del icono.
  const Wt = textSize.w
  const Ht = textSize.h
  const bottlePath = roundedPolygonPath(archBottlePolygon(Wt, Ht), 12)

  return (
    <div
      ref={containerRef}
      className={ed.isEditing ? 'nodrag nowheel' : ''}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (!ed.isEditing) ed.start()
      }}
      style={{
        // La caja que mide React Flow (donde se anclan los edges) es el icono
        // MÁS la holgura PAD (ARCH_ICON_BOX = 72). El texto desborda hacia abajo
        // sin inflar esta caja; el anclaje real sobre la botella lo resuelven las
        // utils de aristas con la silueta completa (ver archBottle).
        position: 'relative',
        width: ARCH_ICON_BOX,
        height: ARCH_ICON_BOX,
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      {/* Anillo de selección: un único trazo "botella" (icono + texto) en
          ROOT-LOCAL, dibujado sobre la propia caja medida con overflow visible
          para que se extienda hacia el texto. Coincide exactamente con la hitbox
          de anclaje de las aristas. */}
      {selected && (
        <svg
          width={ARCH_ICON_BOX}
          height={ARCH_ICON_BOX}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            overflow: 'visible',
            pointerEvents: 'none',
          }}
        >
          <path d={bottlePath} fill="none" stroke={typeColor} strokeWidth={2.5} />
        </svg>
      )}

      {/* Contenido visual (icono + label) en un contenedor absoluto que NO infla
          la caja medida. Desplazado PAD hacia abajo para que el icono quede
          centrado dentro de la caja del icono. */}
      <div
        style={{
          position: 'absolute',
          top: ARCH_PAD,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <div
          style={{
            width: ARCH_ICON_VIS,
            height: ARCH_ICON_VIS,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {IconComponent ? (
            <IconComponent />
          ) : (
            <svg viewBox="0 0 56 56" fill="none">
              <rect x="8" y="8" width="40" height="40" rx="3" stroke={INK} strokeWidth={SW} />
            </svg>
          )}
        </div>

        {/* Label debajo del icono, en flujo normal dentro del contenedor visual. */}
        <div
          ref={textRef}
          style={{
            marginTop: ARCH_GAP,
            textAlign: 'center',
            width: ed.isEditing ? 180 : 'max-content',
            maxWidth: ed.isEditing ? 180 : 150,
            lineHeight: 1.35,
          }}
        >
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            color: typeColor,
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            marginBottom: 1,
          }}
        >
          {typeLabel}
        </div>

        {ed.isEditing ? (
          <>
            <input
              autoFocus
              value={ed.name}
              onChange={(e) => ed.setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (rowRefs.current[0]) rowRefs.current[0].focus()
                  else ed.addRow()
                }
              }}
              style={{
                fontSize: 12,
                fontWeight: 700,
                fontFamily: 'inherit',
                color: 'var(--color-ink)',
                textAlign: 'center',
                width: '100%',
                background: 'var(--color-surface)',
                border: '2px solid var(--color-ink)',
                borderRadius: 'var(--radius)',
                outline: 'none',
                padding: '1px 4px',
                boxSizing: 'border-box',
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 4 }}>
              {ed.attrs.map((attr, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <input
                    ref={(el) => {
                      rowRefs.current[i] = el
                    }}
                    value={attr}
                    onChange={(e) => ed.updateRow(i, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        ed.addRow()
                      }
                    }}
                    placeholder="atributo"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 10,
                      fontFamily: 'inherit',
                      color: 'var(--color-ink)',
                      background: 'var(--color-surface)',
                      border: '1px solid color-mix(in srgb, var(--color-ink) 40%, transparent)',
                      borderRadius: 4,
                      outline: 'none',
                      padding: '1px 3px',
                      boxSizing: 'border-box',
                    }}
                  />
                  <button
                    onClick={() => ed.deleteRow(i)}
                    title="Eliminar atributo"
                    style={{ flexShrink: 0, color: '#ef4444', display: 'flex', cursor: 'pointer' }}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
              <button
                onClick={ed.addRow}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 3,
                  marginTop: 1,
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'var(--color-ink)',
                  opacity: 0.7,
                  cursor: 'pointer',
                }}
              >
                <Plus size={11} /> Añadir
              </button>
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                color: 'var(--color-ink)',
                wordBreak: 'break-word',
                overflowWrap: 'break-word',
                whiteSpace: 'normal',
              }}
            >
              {label}
            </div>

            {tech && (
              <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{tech}</div>
            )}
          </>
        )}
        </div>
      </div>

      {/* Handles invisibles en los bordes del icono */}
      <Handle type="target" position={Position.Top}    style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
      <Handle type="target" position={Position.Left}   style={{ opacity: 0 }} />
      <Handle type="source" position={Position.Right}  style={{ opacity: 0 }} />
    </div>
  )
}
