import { useEffect, useRef } from 'react'
import { MessageSquareText } from 'lucide-react'
import { ChatMessage } from './ChatMessage'
import { ToolTray } from './ToolTray'
import { TypeChoiceButtons } from './TypeChoiceButtons'
import type { ConnectionState } from '../types'
import { useStore } from '../store/index'
import { EmptyState, Spinner } from '../ui/primitives'

interface ChatPanelProps {
  connectionState: ConnectionState
  /** Callback de useWebSocket para re-lanzar la generación con el tipo elegido */
  onChooseDiagramType: (diagramTypeValue: string) => void
}

const CONNECTION_LABELS: Record<ConnectionState, string> = {
  connecting: 'Conectando...',
  connected: 'Conectado',
  disconnected: 'Desconectado',
  error: 'Error',
}

const CONNECTION_COLORS: Record<ConnectionState, string> = {
  connecting: 'var(--color-warn)',
  connected: 'var(--color-accent-3)',
  disconnected: 'var(--color-danger)',
  error: 'var(--color-danger)',
}

export function ChatPanel({ connectionState, onChooseDiagramType }: ChatPanelProps) {
  const { messages, uiState } = useStore()
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex flex-col h-full min-h-0 bg-[var(--color-bg)] border-l-[3px] border-[var(--color-ink)]">
      {/* Header */}
      <div className="px-4 py-3 border-b-[3px] border-[var(--color-ink)] bg-[var(--color-surface)] flex items-center gap-2">
        <span className="font-bold text-sm text-[var(--color-ink)]">Chat</span>
        <span
          className="ml-auto text-xs font-mono"
          style={{ color: CONNECTION_COLORS[connectionState] }}
        >
          ● {CONNECTION_LABELS[connectionState]}
        </span>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-2">
        {messages.length === 0 && (
          <EmptyState
            className="py-10"
            icon={<MessageSquareText size={40} />}
            title="Aún no hay mensajes"
            description="Escribe abajo lo que quieres modelar. Aquí verás la conversación con el agente y podrás pedir refinamientos."
          />
        )}
        {messages.map((msg) => (
          <ChatMessage
            key={msg.id}
            text={msg.text}
            sender={msg.sender}
            timestamp={msg.timestamp}
          />
        ))}
        {uiState === 'generating' && (
          <div className="flex items-center gap-2 px-3 py-1 text-sm text-[var(--color-ink)]/60">
            <Spinner />
            <span>Generando…</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* TypeChoiceButtons — visible solo al recibir diagram:type_clarification */}
      <TypeChoiceButtons onChoose={onChooseDiagramType} />

      {/* ToolTray */}
      <ToolTray />
    </div>
  )
}
