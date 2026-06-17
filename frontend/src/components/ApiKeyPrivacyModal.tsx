import { useEffect, useState } from 'react'
import { X, ShieldAlert } from 'lucide-react'
import { useLlmSettingsStore } from '../store/llmSettings'
import { Button } from '../ui/primitives'

// S10.3b — Modal de CONSENTIMIENTO para guardar la API key de forma permanente.
//
// Aparece automáticamente la primera vez que el usuario guarda una configuración
// con una key (lo dispara LlmSettingsModal). No es un panel de gestión: solo
// explica las consecuencias y recoge el consentimiento explícito. El borrado /
// revocación de una key ya guardada vive en el modal de configuración.
//
// Layout en dos columnas: a la izquierda las consecuencias, a la derecha la frase
// de consentimiento y el botón de confirmación.

const CONSENT_PHRASE = 'doy mi consentimiento'

interface ApiKeyPrivacyModalProps {
  open: boolean
  // Cerrar SIN consentir: el padre cae al modo transitorio (key solo esta sesión).
  onClose: () => void
  providerLabel: string
  // ¿Hay una key escrita lista para persistir? (siempre true al abrirse, guarda).
  hasTypedKey: boolean
  // Consentimiento dado: el padre persiste la key y recuerda el consentimiento.
  onConfirm: () => void
}

export function ApiKeyPrivacyModal({
  open,
  onClose,
  providerLabel,
  hasTypedKey,
  onConfirm,
}: ApiKeyPrivacyModalProps) {
  const loading = useLlmSettingsStore((s) => s.loading)
  // El componente se monta solo al abrirse (el padre lo condiciona): estado limpio.
  const [consent, setConsent] = useState('')

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const consentOk = consent.trim().toLowerCase() === CONSENT_PHRASE
  const canConfirm = consentOk && hasTypedKey && !loading

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center"
      onMouseDown={onClose}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Guardar tu API key de forma permanente"
        onMouseDown={(e) => e.stopPropagation()}
        className="relative w-[820px] max-w-[95vw] bg-[var(--color-surface)] border-[3px] border-[var(--color-ink)] rounded-[var(--radius)] shadow-[var(--shadow-brutal-lg)] p-6 flex flex-col gap-5 max-h-[90vh] overflow-y-auto scrollbar-brutal"
      >
        <button
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center border-[2px] border-[var(--color-ink)] rounded-[var(--radius)] bg-[var(--color-surface)] text-[var(--color-ink)] transition-all duration-75 hover:translate-x-[-1px] hover:translate-y-[-1px] active:translate-x-[1px] active:translate-y-[1px]"
        >
          <X size={14} />
        </button>

        <div className="flex items-start gap-3">
          <ShieldAlert size={24} className="text-[var(--color-ink)] shrink-0 mt-0.5" />
          <div>
            <h2 className="text-lg font-bold text-[var(--color-ink)] mb-0">
              Guardar tu API key de forma permanente
            </h2>
            <p className="text-sm text-[var(--color-ink)] opacity-70">
              Por defecto tu key no se guarda. Léelo antes de cambiarlo.
            </p>
          </div>
        </div>

        {/* Dos columnas: consecuencias (izq) · consentimiento (der) */}
        <div className="flex flex-col md:flex-row gap-5">
          {/* Izquierda — consecuencias */}
          <div className="flex-1 text-sm text-[var(--color-ink)] flex flex-col gap-2 border-[2px] border-[var(--color-ink)] rounded-[var(--radius)] p-4">
            <p className="font-bold uppercase text-xs tracking-wide">Qué implica guardarla</p>
            <ul className="list-disc pl-5 flex flex-col gap-1.5 opacity-90">
              <li>
                Tu API key se almacenará <strong>cifrada</strong> en nuestra base de datos
                (Supabase Vault), asociada a tu cuenta.
              </li>
              <li>
                Se usará para generar diagramas en tu nombre, lo que{' '}
                <strong>puede consumir crédito</strong> de tu cuenta del proveedor.
              </li>
              <li>
                Aunque va cifrada, almacenar una credencial siempre conlleva un riesgo: si tu
                cuenta de MydIAgram se viera comprometida, la key podría quedar expuesta.
              </li>
              <li>
                Puedes <strong>borrarla en cualquier momento</strong> desde la configuración.
              </li>
              <li>
                Si no la guardas, la introduces una vez por sesión y se olvida al cerrar la pestaña.
              </li>
            </ul>
          </div>

          {/* Derecha — consentimiento */}
          <div className="flex-1 flex flex-col gap-2">
            <label className="text-xs font-bold uppercase tracking-wide text-[var(--color-ink)]">
              Consentimiento
            </label>
            <p className="text-sm text-[var(--color-ink)] opacity-90">
              Para guardar tu key de <strong>{providerLabel}</strong>, escribe exactamente la frase:{' '}
              <span className="font-mono font-bold">«{CONSENT_PHRASE}»</span>
            </p>
            <input
              type="text"
              value={consent}
              onChange={(e) => setConsent(e.target.value)}
              placeholder={CONSENT_PHRASE}
              autoCapitalize="off"
              autoCorrect="off"
              className="px-3 py-2 text-sm border-[3px] border-[var(--color-ink)] rounded-[var(--radius)] bg-[var(--color-surface)] text-[var(--color-ink)] outline-none focus:shadow-[var(--shadow-brutal)]"
            />
            <Button
              variant="primary"
              onClick={onConfirm}
              disabled={!canConfirm}
              className="w-full justify-center mt-1"
            >
              {loading ? 'Guardando…' : 'Guardar mi API key de forma permanente'}
            </Button>
            <button
              type="button"
              onClick={onClose}
              className="text-xs underline text-[var(--color-ink)] opacity-70 hover:opacity-100 mt-1 self-start"
            >
              No guardar — usarla solo esta sesión
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
