interface ChatMessageProps {
  text: string
  sender: 'user' | 'system'
  timestamp: Date
}

export function ChatMessage({ text, sender, timestamp }: ChatMessageProps) {
  const timeString = timestamp.toLocaleTimeString()
  const isUser = sender === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} m-2`}>
      <div
        className={`
          max-w-xs border-[3px] border-[var(--color-ink)] p-3 rounded-[var(--radius)]
          shadow-[var(--shadow-brutal)]
          ${isUser
            ? 'bg-[var(--color-accent)] text-white'
            : 'bg-[var(--color-surface)] text-[var(--color-ink)]'
          }
        `}
      >
        <p className="break-words text-sm">{text}</p>
        <span className="text-xs opacity-60 font-[family-name:var(--font-mono)]">{timeString}</span>
      </div>
    </div>
  )
}
