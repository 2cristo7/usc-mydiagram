import { useEffect, useState } from 'react'
import { Download, ShieldAlert, Trash2, X } from 'lucide-react'
import { deleteAccount, exportAccountData } from '../lib/api'
import { signOut } from '../hooks/useAuth'
import { useStore } from '../store/index'
import { useHistoryStore } from '../store/history'
import { useAuthStore } from '../store/auth'
import { toast } from '../store/toast'
import { Spinner } from '../ui/primitives'

interface AccountDataModalProps {
  open: boolean
  onClose: () => void
}

// S10.4 — Centro de privacidad: ejercicio en autoservicio de los derechos RGPD.
//
// Dos acciones, deliberadamente asimétricas en fricción:
//   · Exportar (acceso/portabilidad, art. 15/20): un clic, no destructiva.
//   · Eliminar cuenta (supresión, art. 17): destructiva e irreversible, así que
//     exige escribir "ELIMINAR" para confirmar — el patrón de "confirmación por
//     escritura" evita borrados accidentales por un clic de más.
const CONFIRM_WORD = 'ELIMINAR'

export function AccountDataModal({ open, onClose }: AccountDataModalProps) {
  const email = useAuthStore((s) => s.user?.email)
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  // Reset del campo de confirmación cada vez que se abre/cierra: que no quede
  // "ELIMINAR" escrito de una apertura anterior.
  useEffect(() => {
    if (!open) setConfirmText('')
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !deleting && !exporting) onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, deleting, exporting, onClose])

  if (!open) return null

  async function handleExport() {
    setExporting(true)
    try {
      await exportAccountData()
      toast.success('Datos exportados: revisa tu carpeta de descargas')
    } catch (err) {
      toast.error((err as Error).message)
    } finally {
      setExporting(false)
    }
  }

  async function handleDelete() {
    if (confirmText.trim() !== CONFIRM_WORD) return
    setDeleting(true)
    try {
      await deleteAccount()
      // La cuenta ya no existe en el servidor: cerramos sesión y limpiamos el
      // workspace vivo para no dejar restos de la sesión anterior en pantalla.
      await signOut()
      useStore.getState().newDiagram()
      useHistoryStore.getState().reset()
      onClose()
      toast.info('Tu cuenta y todos tus datos han sido eliminados')
    } catch (err) {
      toast.error((err as Error).message)
      setDeleting(false)
    }
  }

  const busy = exporting || deleting
  const canDelete = confirmText.trim() === CONFIRM_WORD && !busy

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      onMouseDown={() => !busy && onClose()}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Mis datos y privacidad"
        onMouseDown={(e) => e.stopPropagation()}
        className="relative w-[520px] max-w-[92vw] bg-[var(--color-surface)] border-[3px] border-[var(--color-ink)] rounded-[var(--radius)] shadow-[var(--shadow-brutal-lg)] p-6 flex flex-col gap-5"
      >
        <button
          onClick={() => !busy && onClose()}
          aria-label="Cerrar"
          className="absolute top-3 right-3 flex h-7 w-7 items-center justify-center border-[2px] border-[var(--color-ink)] rounded-[var(--radius)] bg-[var(--color-surface)] text-[var(--color-ink)] transition-all duration-75 hover:translate-x-[-1px] hover:translate-y-[-1px] active:translate-x-[1px] active:translate-y-[1px] disabled:opacity-50"
          disabled={busy}
        >
          <X size={14} />
        </button>

        <div>
          <h2 className="text-lg font-bold text-[var(--color-ink)]">Mis datos y privacidad</h2>
          <p className="text-sm text-[var(--color-ink)] opacity-70">
            {email ?? 'Tu cuenta'} · derechos RGPD en autoservicio
          </p>
        </div>

        {/* Exportar — acceso y portabilidad (art. 15 y 20) */}
        <section className="flex flex-col gap-2 border-[3px] border-[var(--color-ink)] rounded-[var(--radius)] p-4">
          <div className="flex items-center gap-2 font-semibold text-[var(--color-ink)]">
            <Download size={16} />
            Exportar mis datos
          </div>
          <p className="text-sm text-[var(--color-ink)] opacity-75">
            Descarga un JSON con tu perfil, tu configuración (sin la API key) y todos tus
            diagramas, incluidos los de la papelera. Derecho de acceso y portabilidad.
          </p>
          <button
            onClick={handleExport}
            disabled={busy}
            className="self-start mt-1 flex items-center gap-2 px-4 py-2 text-sm font-semibold border-[3px] border-[var(--color-ink)] rounded-[var(--radius)] bg-[var(--color-surface)] text-[var(--color-ink)] shadow-[var(--shadow-brutal)] transition-all duration-75 hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[var(--shadow-brutal-lg)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-60 disabled:pointer-events-none"
          >
            {exporting ? <Spinner size={16} label="Exportando" /> : <Download size={16} />}
            {exporting ? 'Exportando…' : 'Descargar JSON'}
          </button>
        </section>

        {/* Eliminar — supresión / derecho al olvido (art. 17) */}
        <section className="flex flex-col gap-2 border-[3px] border-[var(--color-danger)] rounded-[var(--radius)] p-4 bg-[var(--color-danger)]/5">
          <div className="flex items-center gap-2 font-semibold text-[var(--color-danger)]">
            <ShieldAlert size={16} />
            Eliminar mi cuenta
          </div>
          <p className="text-sm text-[var(--color-ink)] opacity-75">
            Borra de forma <strong>irreversible</strong> tu cuenta y todos tus datos: diagramas,
            configuración y la API key guardada. No se puede deshacer.
          </p>
          <label className="text-xs font-semibold text-[var(--color-ink)] mt-1">
            Escribe <span className="font-mono">{CONFIRM_WORD}</span> para confirmar
          </label>
          <input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            disabled={deleting}
            placeholder={CONFIRM_WORD}
            aria-label={`Escribe ${CONFIRM_WORD} para confirmar el borrado`}
            className="w-full px-3 py-2 text-sm font-mono border-[3px] border-[var(--color-ink)] rounded-[var(--radius)] bg-[var(--color-surface)] text-[var(--color-ink)] focus:outline-none focus:shadow-[var(--shadow-brutal)] disabled:opacity-60"
          />
          <button
            onClick={handleDelete}
            disabled={!canDelete}
            className="self-start mt-1 flex items-center gap-2 px-4 py-2 text-sm font-semibold border-[3px] border-[var(--color-ink)] rounded-[var(--radius)] bg-[var(--color-danger)] text-white shadow-[var(--shadow-brutal)] transition-all duration-75 hover:translate-x-[-1px] hover:translate-y-[-1px] hover:shadow-[var(--shadow-brutal-lg)] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-50 disabled:pointer-events-none"
          >
            {deleting ? <Spinner size={16} label="Eliminando" /> : <Trash2 size={16} />}
            {deleting ? 'Eliminando…' : 'Eliminar cuenta'}
          </button>
        </section>
      </div>
    </div>
  )
}
