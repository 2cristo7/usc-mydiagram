import { useEffect, useRef } from 'react'
import { ChatMessage } from './ChatMessage'
import { ToolTray } from './ToolTray'
import type { ConnectionState } from '../types'
import { useStore } from '../store/index'

interface ChatPanelProps {
  connectionState: ConnectionState
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

function Spinner() {
  return (
    <span
      className="inline-block h-3.5 w-3.5 border-[2px] border-[var(--color-accent)] border-t-transparent animate-spin rounded-full"
      role="status"
      aria-label="trabajando"
    />
  )
}

export function ChatPanel({ connectionState }: ChatPanelProps) {
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
          <p className="text-center text-sm text-[var(--color-ink)]/40 py-8">Sin mensajes aún</p>
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

      {/* ToolTray */}
      <ToolTray />
    </div>
  )
}
