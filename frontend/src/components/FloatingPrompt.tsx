import { useEffect, useRef, useState } from 'react'
import { Send, HelpCircle } from 'lucide-react'
import { useStore, selectPromptDraft } from '../store/index'
import { useUiStore } from '../store/ui'
import { useLlmSettingsStore } from '../store/llmSettings'
import { toast } from '../store/toast'

// El transporte Ollama 'browser' (modelo en el navegador) no soporta el
// tool-calling de LangChain que usa el agente ReAct de refinamiento, así que el
// backend rechaza esas peticiones. Lo replicamos en el cliente: con un diagrama
// ya creado y este transporte, el input de refinamiento se deshabilita en vez de
// dejar enviar una petición condenada a error. La sección de ayuda lo explica.
const REFINE_HELP_ANCHOR = '/help.html#llm-refinar-navegador'

// Límite razonable para que el agente no reciba prompts desproporcionados.
// 2000 caracteres cubre cualquier descripción detallada de diagrama real.
const MAX_PROMPT_LENGTH = 2000
// Umbral a partir del cual mostramos el contador (> 90 % del máximo).
const COUNTER_THRESHOLD = Math.floor(MAX_PROMPT_LENGTH * 0.9)

interface FloatingPromptProps {
  onSendMessage: (msg: string) => void
  onSendClarificationAnswer: (answer: string) => void
}

export function FloatingPrompt({ onSendMessage, onSendClarificationAnswer }: FloatingPromptProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { currentDiagram, pendingClarification, uiState, generationPhase } = useStore()
  // El borrador vive en el store y es POR DIAGRAMA (memoria de input): al cambiar de
  // diagrama, selectPromptDraft resuelve el slot del diagrama abierto, así que el
  // input muestra lo que se dejó escrito-sin-enviar en cada uno. Además, un envío
  // fallido lo repone para que "Reintentar" reenvíe justo lo que hay escrito.
  const value = useStore(selectPromptDraft)
  const setValue = useStore((s) => s.setPromptDraft)
  const promptFocusNonce = useUiStore((s) => s.promptFocusNonce)
  const transport = useLlmSettingsStore((s) => s.config?.transport)
  // Guard transitorio para la respuesta de clarificación: entre el primer Enter y
  // el cambio de estado del hook (limpia pendingClarification / pasa a 'generating')
  // hay una ventana en la que dos Enter muy seguidos enviarían dos veces. Lo
  // marcamos al enviar y lo liberamos cuando la clarificación deja de estar
  // pendiente (éxito) — análogo al guard de 'generating'.
  const [answeringClarification, setAnsweringClarification] = useState(false)

  // El CTA del canvas vacío incrementa promptFocusNonce: enfocamos el textarea.
  // Ignoramos el valor inicial (0) para no robar foco al montar.
  useEffect(() => {
    if (promptFocusNonce === 0) return
    textareaRef.current?.focus()
  }, [promptFocusNonce])

  // El minimapa (footprint ~140px abajo a la derecha) se renderiza durante el
  // montaje en vivo ('live') y en interactivo ('done'). Reservamos su hueco
  // siguiendo la fase, no la mera existencia de currentDiagram.
  const minimapVisible = generationPhase === 'live' || generationPhase === 'done'

  // Libera el guard de clarificación en cuanto la pregunta deja de estar pendiente:
  // el hook limpió pendingClarification (la respuesta se cursó) o llegó otra. Si el
  // envío no progresó (p. ej. sin conexión: el hook hace early return y la
  // clarificación sigue pendiente), el guard queda activo y el efecto lo libera al
  // siguiente render con pendingClarification aún presente → permitimos reintentar.
  useEffect(() => {
    if (answeringClarification && !pendingClarification) setAnsweringClarification(false)
  }, [answeringClarification, pendingClarification])

  // Refinar (= ya hay un diagrama) con el transporte 'browser' no es posible: el
  // agente ReAct depende de tool-calling que el puente con el navegador no ofrece.
  // Bloqueamos el input en ese caso para no cursar una petición que el backend
  // rechazaría. La generación inicial (sin diagrama) sí funciona en 'browser'.
  //
  // Es derivado del store, así que se reevalúa solo en los dos momentos en que el
  // estado cambia: al ENTRAR a un diagrama (setCurrentDiagram desde el historial o
  // la papelera) y al COMPLETAR una generación (currentDiagram queda poblado). Se
  // excluye 'generating' para que el aviso no parpadee mientras el diagrama aún se
  // está montando en streaming (durante ese tramo el input ya está disabled).
  const refineBlocked =
    currentDiagram !== null && transport === 'browser' && uiState !== 'generating'

  // Deshabilita el envío mientras se genera o mientras se procesa una respuesta de
  // clarificación (estado transitorio): cierra la ventana de doble envío del Enter.
  const disabled = uiState === 'generating' || answeringClarification || refineBlocked

  const placeholder = refineBlocked
    ? 'Introduce una API Key o pasa a servidor directo para poder refinar'
    : pendingClarification
    ? 'Responde a la pregunta del agente...'
    : currentDiagram
    ? 'Refina el diagrama...'
    : 'Describe un diagrama...'

  function openRefineHelp() {
    window.open(REFINE_HELP_ANCHOR, '_blank', 'noopener,noreferrer')
  }

  function autoResize() {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 24 * 8) + 'px'
  }

  // Re-mide la altura cuando el valor cambia POR FUERA del onChange: al cambiar de
  // diagrama (carga el borrador de ese diagrama), al reponer un prompt fallido o al
  // vaciarse tras emitir. Sin esto el textarea no crecería con texto multilínea ni
  // encogería al limpiarse.
  useEffect(() => { autoResize() }, [value])

  function send() {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    // Bloqueamos mensajes excesivamente largos: el agente no los necesita y
    // podrían saturar el contexto del LLM con texto irrelevante.
    if (trimmed.length > MAX_PROMPT_LENGTH) {
      toast.warning(`El mensaje es demasiado largo (máximo ${MAX_PROMPT_LENGTH} caracteres).`)
      return
    }
    if (pendingClarification) {
      // Activa el guard ANTES de llamar al callback: cualquier Enter posterior en
      // este mismo tick ya verá disabled === true y no reenviará.
      setAnsweringClarification(true)
      onSendClarificationAnswer(trimmed)
      // Salvaguarda para el fallo silencioso del hook (sin conexión: hace early
      // return y deja pendingClarification intacta, así que el efecto de liberación
      // no dispararía). Tras el tick, si la respuesta no se cursó, liberamos el
      // guard para que el usuario pueda reintentar.
      queueMicrotask(() => {
        if (useStore.getState().pendingClarification) setAnsweringClarification(false)
      })
    } else {
      onSendMessage(trimmed)
    }
    // El vaciado del input ya NO se hace aquí: lo hace el punto de emisión real
    // (sendMessage / sendClarificationAnswer, tras pasar el guard de conexión). Así,
    // si el envío no progresa (sin conexión) o falla luego, el texto no se pierde.
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
      <div className="flex flex-col items-stretch gap-2 w-full max-w-[680px] translate-x-[12px]">
        {refineBlocked && (
          <div className="flex items-center gap-2 border-[3px] border-[var(--color-ink)] bg-[var(--color-warn,#fde68a)] text-[var(--color-ink)] shadow-[var(--shadow-brutal)] rounded-[var(--radius)] px-3 py-2 text-xs">
            <span className="flex-1">
              El modo <strong>«En mi navegador»</strong> solo permite generar. Para refinar este
              diagrama, usa una API Key o cambia a servidor directo.
            </span>
            <button
              onClick={openRefineHelp}
              className="flex-shrink-0 inline-flex items-center gap-1 border-[3px] border-[var(--color-ink)] bg-[var(--color-surface)] rounded-[var(--radius)] px-2 py-1 font-semibold shadow-[var(--shadow-brutal)] hover:-translate-y-px hover:shadow-[var(--shadow-brutal-lg)] active:translate-x-[1px] active:translate-y-[1px] active:shadow-none transition-all duration-75"
            >
              <HelpCircle size={13} />
              Cómo refinar
            </button>
          </div>
        )}
        <div className="flex items-end gap-3 w-full">
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
          {/* Contador discreto: aparece solo cuando el usuario supera el 90 % del
              límite, para no distraer durante el uso normal. Rojo cuando excede. */}
          {value.length > COUNTER_THRESHOLD && (
            <span
              className={`absolute bottom-1.5 right-2 text-[10px] font-mono pointer-events-none select-none transition-colors ${
                value.length > MAX_PROMPT_LENGTH
                  ? 'text-red-500'
                  : 'text-[var(--color-ink)]/40'
              }`}
            >
              {value.length}/{MAX_PROMPT_LENGTH}
            </span>
          )}
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
    </div>
  )
}
