import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import type { NodeType } from '../../types'
import { useInlineEdit } from '../../hooks/useInlineEdit'
import { useStore } from '../../store'

type ArchIconData = { label: string; nodeType: NodeType; attributes: string[] }
type ArchIconNodeType = Node<ArchIconData, 'archIcon'>

// Paleta de colores por tipo
const PALETTE: Partial<Record<NodeType, { bg: string; stroke: string; accent: string }>> = {
  database:  { bg: '#dbeafe', stroke: '#1e3a8a', accent: '#1e40af' },
  service:   { bg: '#d1fae5', stroke: '#065f46', accent: '#059669' },
  queue:     { bg: '#fef3c7', stroke: '#92400e', accent: '#d97706' },
  gateway:   { bg: '#ede9fe', stroke: '#4c1d95', accent: '#7c3aed' },
  person:    { bg: '#dcfce7', stroke: '#14532d', accent: '#16a34a' },
  system:    { bg: '#dbeafe', stroke: '#1e3a8a', accent: '#2563eb' },
  container: { bg: '#cffafe', stroke: '#164e63', accent: '#0891b2' },
  component: { bg: '#e0e7ff', stroke: '#312e81', accent: '#4f46e5' },
}

const DEFAULT_PALETTE = { bg: '#f1f5f9', stroke: '#334155', accent: '#475569' }

// Labels legibles para el subtítulo
const TYPE_LABELS: Partial<Record<NodeType, string>> = {
  database:  'database',
  service:   'service',
  queue:     'queue',
  gateway:   'gateway',
  person:    'person',
  system:    'system',
  container: 'container',
  component: 'component',
}

// ── SVG icons (64×64 viewBox) ───────────────────────────────────────────────

function DatabaseIcon({ color }: { color: typeof DEFAULT_PALETTE }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* body */}
      <rect x="10" y="18" width="44" height="32" fill={color.accent} />
      {/* bottom ellipse */}
      <ellipse cx="32" cy="50" rx="22" ry="7" fill={color.stroke} />
      {/* middle ring */}
      <ellipse cx="32" cy="34" rx="22" ry="7" fill={color.stroke} />
      <ellipse cx="32" cy="34" rx="22" ry="7" fill={color.accent} fillOpacity="0.5" />
      {/* top ellipse (lid) */}
      <ellipse cx="32" cy="18" rx="22" ry="7" fill={color.stroke} />
      {/* highlight on top */}
      <ellipse cx="28" cy="16" rx="8" ry="3" fill="white" fillOpacity="0.25" />
    </svg>
  )
}

function ServiceIcon({ color }: { color: typeof DEFAULT_PALETTE }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* server rack body */}
      <rect x="10" y="10" width="44" height="44" rx="4" fill={color.accent} stroke={color.stroke} strokeWidth="2" />
      {/* rack units */}
      <rect x="14" y="15" width="36" height="9" rx="2" fill={color.stroke} />
      <rect x="14" y="28" width="36" height="9" rx="2" fill={color.stroke} />
      <rect x="14" y="41" width="36" height="9" rx="2" fill={color.stroke} />
      {/* status LEDs */}
      <circle cx="46" cy="19.5" r="2.5" fill="#4ade80" />
      <circle cx="46" cy="32.5" r="2.5" fill="#4ade80" />
      <circle cx="46" cy="45.5" r="2.5" fill="#fbbf24" />
    </svg>
  )
}

function QueueIcon({ color }: { color: typeof DEFAULT_PALETTE }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* three message bars */}
      <rect x="8"  y="10" width="42" height="12" rx="3" fill={color.stroke} />
      <rect x="8"  y="26" width="42" height="12" rx="3" fill={color.accent} />
      <rect x="8"  y="42" width="42" height="12" rx="3" fill={color.stroke} fillOpacity="0.6" />
      {/* arrow indicating flow */}
      <path d="M 53 10 L 62 32 L 53 54" stroke={color.stroke} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}

function GatewayIcon({ color }: { color: typeof DEFAULT_PALETTE }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* diamond */}
      <polygon points="32,6 58,32 32,58 6,32" fill={color.accent} stroke={color.stroke} strokeWidth="2.5" />
      {/* inner diamond */}
      <polygon points="32,16 48,32 32,48 16,32" fill={color.stroke} opacity="0.3" />
      {/* center dot */}
      <circle cx="32" cy="32" r="5" fill="white" />
    </svg>
  )
}

function PersonIcon({ color }: { color: typeof DEFAULT_PALETTE }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* head */}
      <circle cx="32" cy="20" r="12" fill={color.accent} stroke={color.stroke} strokeWidth="2" />
      {/* face highlight */}
      <circle cx="28" cy="18" r="4" fill="white" fillOpacity="0.3" />
      {/* body */}
      <path d="M 10 58 C 10 42 54 42 54 58 Z" fill={color.stroke} />
      <path d="M 14 58 C 14 44 50 44 50 58 Z" fill={color.accent} />
    </svg>
  )
}

function SystemIcon({ color }: { color: typeof DEFAULT_PALETTE }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* monitor frame */}
      <rect x="6" y="8" width="52" height="36" rx="4" fill={color.stroke} />
      {/* screen */}
      <rect x="10" y="12" width="44" height="28" rx="2" fill={color.accent} />
      {/* screen shine */}
      <rect x="10" y="12" width="44" height="8" rx="2" fill="white" fillOpacity="0.15" />
      {/* stand */}
      <rect x="26" y="44" width="12" height="8" fill={color.stroke} />
      {/* base */}
      <rect x="18" y="52" width="28" height="5" rx="2.5" fill={color.stroke} />
    </svg>
  )
}

function ContainerIcon({ color }: { color: typeof DEFAULT_PALETTE }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* box body */}
      <rect x="10" y="22" width="44" height="34" rx="2" fill={color.accent} stroke={color.stroke} strokeWidth="2" />
      {/* lid */}
      <polygon points="10,22 32,10 54,22" fill={color.stroke} />
      {/* vertical lines on box (container look) */}
      <line x1="24" y1="22" x2="24" y2="56" stroke={color.stroke} strokeWidth="1.5" opacity="0.4" />
      <line x1="40" y1="22" x2="40" y2="56" stroke={color.stroke} strokeWidth="1.5" opacity="0.4" />
      {/* handle on lid */}
      <rect x="26" y="6" width="12" height="6" rx="3" fill={color.accent} stroke={color.stroke} strokeWidth="1.5" />
    </svg>
  )
}

function ComponentIcon({ color }: { color: typeof DEFAULT_PALETTE }) {
  return (
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* main block */}
      <rect x="20" y="12" width="36" height="40" rx="3" fill={color.accent} stroke={color.stroke} strokeWidth="2" />
      {/* interface plugs on left side */}
      <rect x="8"  y="20" width="14" height="10" rx="2" fill={color.stroke} />
      <rect x="8"  y="34" width="14" height="10" rx="2" fill={color.stroke} />
      {/* plug connection bars */}
      <rect x="20" y="23" width="4" height="4" fill={color.bg} />
      <rect x="20" y="37" width="4" height="4" fill={color.bg} />
      {/* inner detail lines */}
      <line x1="28" y1="22" x2="48" y2="22" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
      <line x1="28" y1="30" x2="48" y2="30" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
      <line x1="28" y1="38" x2="48" y2="38" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
      <line x1="28" y1="46" x2="48" y2="46" stroke="white" strokeWidth="2" strokeLinecap="round" opacity="0.4" />
    </svg>
  )
}

const ICON_MAP: Partial<Record<NodeType, (p: { color: typeof DEFAULT_PALETTE }) => JSX.Element>> = {
  database:  DatabaseIcon,
  service:   ServiceIcon,
  queue:     QueueIcon,
  gateway:   GatewayIcon,
  person:    PersonIcon,
  system:    SystemIcon,
  container: ContainerIcon,
  component: ComponentIcon,
}

// ── Component ────────────────────────────────────────────────────────────────

export function ArchIconNode({ id, data, selected }: NodeProps<ArchIconNodeType>) {
  const { label, nodeType, attributes = [] } = data
  const color   = PALETTE[nodeType] ?? DEFAULT_PALETTE
  const typeLabel = TYPE_LABELS[nodeType] ?? nodeType
  const updateNode = useStore((s) => s.updateNode)
  const IconComponent = ICON_MAP[nodeType]

  const { isEditing, inputProps, containerProps } = useInlineEdit({
    initialValue: label,
    onCommit: (newLabel) => updateNode(id, { label: newLabel }),
    selected,
    nodeId: id,
  })

  // Extract tech attribute for optional subtitle
  const techAttr = attributes.find((a) => /^tech\s*:/i.test(a))
  const tech = techAttr ? techAttr.replace(/^tech\s*:\s*/i, '').trim() : null

  return (
    <div
      {...containerProps}
      className={containerProps.className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        width: 120,
        cursor: 'default',
        userSelect: 'none',
      }}
    >
      {/* Icon area */}
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 16,
          backgroundColor: color.bg,
          border: selected ? `3px solid ${color.stroke}` : `2px solid ${color.stroke}`,
          boxShadow: selected
            ? `0 0 0 2px ${color.accent}44, 4px 4px 0 ${color.stroke}`
            : `3px 3px 0 ${color.stroke}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 8,
          transition: 'box-shadow 0.15s, border 0.15s',
        }}
      >
        {IconComponent ? (
          <IconComponent color={color} />
        ) : (
          <div style={{ fontSize: 28, lineHeight: 1 }}>◧</div>
        )}
      </div>

      {/* Label below icon */}
      <div
        style={{
          marginTop: 8,
          textAlign: 'center',
          maxWidth: 120,
          lineHeight: 1.3,
        }}
      >
        <div
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: color.accent,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: 2,
          }}
        >
          {typeLabel}
        </div>

        {isEditing ? (
          <input
            {...inputProps}
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: '#111',
              textAlign: 'center',
              background: 'white',
              border: `1px solid ${color.stroke}`,
              borderRadius: 4,
              outline: 'none',
              width: 110,
              padding: '2px 4px',
            }}
          />
        ) : (
          <div
            style={{
              fontSize: 12,
              fontWeight: 700,
              color: '#111',
              wordBreak: 'break-word',
              overflowWrap: 'break-word',
              whiteSpace: 'normal',
            }}
          >
            {label}
          </div>
        )}

        {tech && (
          <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{tech}</div>
        )}
      </div>

      {/* Handles */}
      <Handle type="target" position={Position.Top}    style={{ top: 4 }} />
      <Handle type="source" position={Position.Bottom} style={{ bottom: -44 }} />
      <Handle type="target" position={Position.Left}   style={{ left: 4 }} />
      <Handle type="source" position={Position.Right}  style={{ right: 4 }} />
    </div>
  )
}
