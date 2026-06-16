import { useRef, useState } from 'react'
import { Send } from 'lucide-react'
import { useStore } from '../store/index'

interface FloatingPromptProps {
  onSendMessage: (msg: string) => void
  onSendClarificationAnswer: (answer: string) => void
}

export function FloatingPrompt({ onSendMessage, onSendClarificationAnswer }: FloatingPromptProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { currentDiagram, pendingClarification, uiState } = useStore()

  const disabled = uiState === 'generating'

  const placeholder = pendingClarification
    ? 'Responde a la pregunta del agente...'
    : currentDiagram
    ? 'Refina el diagrama...'
    : 'Describe un diagrama...'

  function autoResize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 24 * 8) + 'px'
  }

  function send() {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    if (pendingClarification) {
      onSendClarificationAnswer(trimmed)
    } else {
      onSendMessage(trimmed)
    }
    setValue('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  }

  return (
    // Centered in the gap between the left toolbar and the canvas right edge.
    // Once a diagram exists the bottom-right minimap appears (~140px footprint at
    // half size), so we reserve that space on the right and animate into place.
    <div
      className={`absolute bottom-6 left-0 z-20 flex justify-center px-6 transition-[right] duration-300 ease-out ${
        currentDiagram ? 'right-[140px]' : 'right-0'
      }`}
    >
      {/* -translate-x-[2px] offsets the 4px brutal drop-shadow so the box reads as centered */}
      <div className="relative w-full max-w-[560px] -translate-x-[2px] border-[3px] border-[var(--color-ink)] bg-[var(--color-surface)] shadow-[var(--shadow-brutal)] focus-within:shadow-[var(--shadow-brutal-lg)] focus-within:-translate-y-px transition-all duration-75 rounded-[var(--radius)]">
        <textarea
          ref={textareaRef}
          value={value}
          rows={1}
          placeholder={placeholder}
          disabled={disabled}
          onChange={(e) => { setValue(e.target.value); autoResize() }}
          onKeyDown={handleKeyDown}
          className="block w-full resize-none bg-transparent px-3 py-2 pr-12 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink)]/40 focus:outline-none disabled:opacity-50"
          style={{ maxHeight: `${24 * 8}px` }}
        />
        <button
          onClick={send}
          disabled={disabled || !value.trim()}
          className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center border-[2px] border-[var(--color-ink)] bg-[var(--color-accent)] text-white rounded-[var(--radius)] hover:shadow-[var(--shadow-brutal)] disabled:opacity-40 disabled:pointer-events-none transition-all duration-75"
        >
          <Send size={12} className="-ml-px" />
        </button>
      </div>
    </div>
  )
}
