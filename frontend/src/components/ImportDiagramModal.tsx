import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Upload, FileText, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useStore } from '../store/index'
import { diagramImportSchema, DIAGRAM_TYPE_OPTIONS } from '../types'
import type { DiagramType } from '../types'
import { Button, Spinner, AlertBanner } from '../ui/primitives'
import { detectFormat, importFormats } from '../ui/utils/formats'
import { persistCurrentDiagram } from '../lib/api'
import { toast } from '../store/toast'

interface ImportDiagramModalProps {
  open: boolean
  onClose: () => void
}

// Modal de importación multiformato (S10.3). Toda la lógica de qué formatos hay y
// cómo se parsean vive en el registry (ui/utils/formats); aquí solo orquestamos la
// UI. El formato se AUTODETECTA del fichero (detectFormat); el usuario solo elige
// el TIPO de diagrama (la semántica no siempre está en el fichero). El registry
// NUNCA da un diagrama por válido: quien valida es diagramImportSchema, siempre,
// antes de tocar el canvas.
export function ImportDiagramModal({ open, onClose }: ImportDiagramModalProps) {
  const importDiagram = useStore((s) => s.importDiagram)
  const relayout = useStore((s) => s.relayout)

  const formats = importFormats()
  // Texto de formatos admitidos (derivado del registry: única fuente de verdad).
  const supportedLabels = formats.map((f) => f.label).join(', ')
  // accept del input: la unión de los accept de todos los formatos importables.
  const acceptAll = useMemo(
    () => Array.from(new Set(formats.flatMap((f) => f.accept.split(',')))).join(','),
    [formats],
  )

  const [diagramType, setDiagramType] = useState<DiagramType>(DIAGRAM_TYPE_OPTIONS[0].value)
  const [file, setFile] = useState<File | null>(null)
  // Contenido leído al seleccionar el fichero: sirve para autodetectar el formato
  // de inmediato (sin re-leerlo al importar).
  const [fileText, setFileText] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [importing, setImporting] = useState(false)
  // Error de selección (formato no admitido / fichero ilegible), mostrado DENTRO
  // del modal, no como toast.
  const [pickError, setPickError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Formato detectado a partir del nombre + contenido del fichero. undefined si
  // aún no hay fichero o no se reconoce.
  const detected = useMemo(
    () => (file && fileText !== null ? detectFormat(file.name, fileText) : undefined),
    [file, fileText],
  )

  // Resetea el estado interno cada vez que se abre: el modal nace limpio.
  useEffect(() => {
    if (open) {
      setDiagramType(DIAGRAM_TYPE_OPTIONS[0].value)
      setFile(null)
      setFileText(null)
      setDragOver(false)
      setImporting(false)
      setPickError(null)
    }
  }, [open])

  // ESC para cerrar (mismo patrón que el resto de modales del repo).
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  async function pickFile(f: File | undefined | null) {
    if (!f) return
    let text: string
    try {
      text = await f.text()
    } catch {
      setPickError('No se pudo leer el fichero.')
      return
    }
    // Rechazo en el momento de elegirlo: si el formato no se reconoce, ni siquiera
    // se selecciona (en vez de aceptarlo y fallar al pulsar Importar). El error se
    // muestra DENTRO del modal.
    const fmt = detectFormat(f.name, text)
    if (!fmt || !fmt.fromContent) {
      setPickError(`Formato no admitido. Admitidos: ${supportedLabels}.`)
      return
    }
    setPickError(null)
    setFile(f)
    setFileText(text)
  }

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    void pickFile(e.dataTransfer.files?.[0])
  }

  async function handleImport() {
    if (!file || fileText === null || importing) return
    if (!detected || !detected.fromContent) {
      toast.error(`No se reconoce el formato del fichero. Admitidos: ${supportedLabels}.`)
      return
    }
    const fmt = detected
    setImporting(true)
    try {
      // 1) Conversión a DiagramSchema CANDIDATO. Puede lanzar si el contenido está
      //    corrupto o no encaja con el tipo elegido.
      let raw
      try {
        raw = fmt.fromContent!(fileText, { diagramType })
      } catch {
        toast.error(
          `No se pudo interpretar el archivo como ${fmt.label}. Revisa el tipo de diagrama elegido.`,
        )
        return
      }
      // 2) Border de validación: forma, enums e integridad referencial. Ningún
      //    formato puede meter un diagrama roto en el canvas.
      const parsed = diagramImportSchema.safeParse(raw)
      if (!parsed.success) {
        const issue = parsed.error.issues[0]
        const detail = issue ? issue.message : 'estructura inválida'
        toast.error(`El archivo no produjo un diagrama válido (${detail}).`)
        return
      }
      // 3) Import como diagrama NUEVO (no sobreescribe la sesión viva).
      importDiagram(parsed.data)
      // 4) Recalcular layout (= pulsar "Recalcular layout") SALVO en el nativo: el
      //    .mdia conserva su layout manual a propósito (es nuestro guardado fiel).
      //    En los demás (draw.io/Excalidraw vienen desordenados; Mermaid no trae
      //    posición) se borran las posiciones y DiagramToFlow recalcula con el layout
      //    del tipo. El centrado (fitView) lo dispara el canvas al asignarse el id.
      if (fmt.id !== 'native') relayout()
      const r = await persistCurrentDiagram()
      if (!r.ok && r.error !== 'no-session') {
        // El diagrama ya está en el canvas; el fallo es solo de persistencia.
        toast.warning(`Diagrama importado, pero no se pudo guardar: ${r.error}`)
      } else {
        toast.success('Diagrama importado.')
      }
      onClose()
    } finally {
      setImporting(false)
    }
  }

  // El aviso de import experimental solo si ESTE fichero pierde semántica: un
  // round-trip fiel (todos nuestros marcadores presentes) no necesita asustar.
  const showExperimental =
    !!detected?.importExperimental &&
    fileText !== null &&
    !(detected.importIsFaithful?.(fileText) ?? false)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      onMouseDown={onClose}
    >
      <div className="absolute inset-0 bg-black/40" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Importar diagrama"
        onMouseDown={(e) => e.stopPropagation()}
        className="relative w-[860px] max-w-[95vw] bg-[var(--color-surface)] border-[3px] border-[var(--color-ink)] rounded-[var(--radius)] shadow-[var(--shadow-brutal-lg)] p-8 flex flex-col gap-6 max-h-[92vh] overflow-y-auto scrollbar-brutal"
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Cerrar"
          className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center border-[2px] border-[var(--color-ink)] rounded-[var(--radius)] bg-[var(--color-surface)] text-[var(--color-ink)] transition-all duration-75 hover:translate-x-[-1px] hover:translate-y-[-1px] active:translate-x-[1px] active:translate-y-[1px]"
        >
          <X size={16} />
        </button>

        <div>
          <h2 className="text-2xl font-bold text-[var(--color-ink)] mb-1">Importar diagrama</h2>
          <p className="text-sm text-[var(--color-ink)] opacity-70">
            Arrastra un fichero y elige el tipo de diagrama. El formato se detecta automáticamente.
          </p>
        </div>

        {/* Dos columnas: izquierda arrastrar, derecha formatos + tipos */}
        <div className="flex flex-col md:flex-row gap-6">
          {/* Columna izquierda: zona de arrastre */}
          <div className="md:w-1/2 flex flex-col gap-3">
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              className={`
                flex flex-1 flex-col items-center justify-center gap-3 px-6 py-12 text-center
                border-[3px] border-dashed rounded-[var(--radius)]
                transition-colors duration-75 min-h-[260px]
                ${dragOver
                  ? 'border-[var(--color-accent)] bg-[var(--color-accent)]/10'
                  : 'border-[var(--color-ink)] bg-[var(--color-surface)]'
                }
              `}
            >
              {file ? (
                <>
                  <p className="flex items-center gap-2 text-base font-semibold text-[var(--color-ink)] break-all">
                    <FileText size={20} /> {file.name}
                  </p>
                  {/* Solo se importa 1 diagrama a la vez: en vez de "Explorar" (que
                      invita a añadir otro), una acción para quitar el actual. */}
                  <Button
                    variant="secondary"
                    onClick={() => { setFile(null); setFileText(null) }}
                    className="text-sm py-2"
                  >
                    Quitar fichero
                  </Button>
                </>
              ) : (
                <>
                  <p className="flex flex-col items-center gap-2 text-base text-[var(--color-ink)] opacity-70">
                    <Upload size={28} /> Arrastra un fichero aquí
                  </p>
                  <Button
                    variant="secondary"
                    onClick={() => fileInputRef.current?.click()}
                    className="text-sm py-2"
                  >
                    Explorar…
                  </Button>
                </>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept={acceptAll}
                onChange={(e) => { void pickFile(e.target.files?.[0]); e.target.value = '' }}
                className="hidden"
              />
            </div>

            {/* Estado de detección del formato */}
            {detected && (
              <p className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
                <CheckCircle2 size={16} className="text-green-600" />
                Formato detectado: {detected.label}
              </p>
            )}
            {pickError && (
              <div className="flex items-start gap-2 px-3 py-2 text-sm font-semibold border-[3px] border-[var(--color-ink)] rounded-[var(--radius)] bg-[var(--color-danger)] text-white">
                <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                <span>{pickError}</span>
              </div>
            )}
          </div>

          {/* Columna derecha: formatos admitidos + grid de tipos */}
          <div className="md:w-1/2 flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold uppercase tracking-wide text-[var(--color-ink)]">
                Formatos admitidos
              </span>
              <p className="text-sm text-[var(--color-ink)] opacity-70">
                {supportedLabels}.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold uppercase tracking-wide text-[var(--color-ink)]">
                Tipo de diagrama
              </span>
              <div className="grid grid-cols-2 gap-2">
                {DIAGRAM_TYPE_OPTIONS.map((opt) => {
                  const selected = opt.value === diagramType
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setDiagramType(opt.value)}
                      aria-pressed={selected}
                      className={`
                        px-3 py-3 text-sm font-semibold text-left rounded-[var(--radius)]
                        border-[3px] transition-all duration-75
                        hover:translate-x-[-1px] hover:translate-y-[-1px]
                        active:translate-x-[1px] active:translate-y-[1px]
                        ${selected
                          ? 'border-[var(--color-ink)] bg-[var(--color-accent)] text-[var(--color-surface)] shadow-[var(--shadow-brutal)]'
                          : 'border-[var(--color-ink)] bg-[var(--color-surface)] text-[var(--color-ink)]'
                        }
                      `}
                    >
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Aviso experimental: solo cuando ESTE fichero pierde semántica. */}
        {showExperimental && (
          <AlertBanner
            variant="warning"
            message={`La forma del diagrama no se conserva con exactitud: al importar desde ${detected.label}, los elementos se adaptan a los tipos de nuestro editor y su aspecto puede cambiar.`}
          />
        )}

        {/* Botón importar */}
        <Button
          variant="primary"
          onClick={handleImport}
          disabled={!file || !detected || importing}
          className="w-full justify-center flex items-center gap-2 py-3 text-base"
        >
          {importing ? <Spinner size={16} label="Importando" /> : null}
          {importing ? 'Importando…' : 'Importar diagrama'}
        </Button>
      </div>
    </div>
  )
}
