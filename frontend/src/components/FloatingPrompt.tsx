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
  const { currentDiagram, pendingClarification, uiState, generationPhase } = useStore()

  // El minimapa (footprint ~140px abajo a la derecha) solo se renderiza en las
  // fases 'assembling' y 'done'; durante el streaming ('staging') no existe. Por
  // eso reservamos su hueco siguiendo la fase, no la mera existencia de
  // currentDiagram (que se puebla antes, con los node_ready del streaming).
  const minimapVisible = generationPhase === 'assembling' || generationPhase === 'done'

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
        minimapVisible ? 'right-[140px]' : 'right-0'
      }`}
    >
      {/* translate-x nudges the box right so it reads as centered once the 4px brutal drop-shadow (which sits on the right) is discounted */}
      <div className="flex items-end gap-3 w-full max-w-[680px] translate-x-[12px]">
        <div className="relative flex-1 border-[3px] border-[var(--color-ink)] bg-[var(--color-surface)] shadow-[var(--shadow-brutal)] focus-within:shadow-[var(--shadow-brutal-lg)] focus-within:-translate-y-px transition-all duration-75 rounded-[var(--radius)]">
          <textarea
            ref={textareaRef}
            value={value}
            rows={1}
            placeholder={placeholder}
            disabled={disabled}
            onChange={(e) => { setValue(e.target.value); autoResize() }}
            onKeyDown={handleKeyDown}
            className="scrollbar-brutal block w-full resize-none bg-transparent px-3 py-2 text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink)]/40 focus:outline-none disabled:opacity-50 overflow-y-auto"
            style={{ maxHeight: `${24 * 8}px` }}
          />
        </div>
        <button
          onClick={send}
          disabled={disabled || !value.trim()}
          className="flex-shrink-0 flex items-center justify-center border-[3px] border-[var(--color-ink)] bg-[var(--color-accent)] text-white rounded-[var(--radius)] shadow-[var(--shadow-brutal)] hover:shadow-[var(--shadow-brutal-lg)] hover:-translate-y-px disabled:opacity-40 disabled:pointer-events-none transition-all duration-75"
          style={{ height: '42px', width: '42px' }}
        >
          <Send size={14} className="-ml-px" />
        </button>
      </div>
    </div>
  )
}
