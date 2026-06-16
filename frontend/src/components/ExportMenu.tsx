import { useRef, useState } from 'react'
import { Download, Upload, RefreshCw, Save, Check } from 'lucide-react'
import { toPng } from 'html-to-image'
import { useStore } from '../store/index'
import { useAuthStore } from '../store/auth'
import { diagramImportSchema } from '../types'
import { Button, Menu } from '../ui/primitives'
import {
  diagramFilename,
  triggerDownload,
  triggerJsonDownload,
  getRenderedNodeBounds,
  getRenderedEdgeBounds,
  getRenderedEdges,
  unionRects,
  loadImage,
} from '../ui/utils/download'
import { persistCurrentDiagram } from '../lib/api'

const IMAGE_PADDING = 40
// Tope del lado mayor de la imagen (en px de flujo, antes de PIXEL_RATIO).
// El diagrama se exporta a escala natural (zoom 1.0, igual que el tope de
// "Ajustar vista"); solo si a esa escala superara este tope se reduce el zoom lo
// justo para que el diagrama ENTERO quepa en la imagen. Es la excepción a fitView:
// un diagrama tan grande que en pantalla no cabría a su minZoom, aquí cabe entero
// (escalado) en lugar de salir recortado.
const MAX_IMAGE_DIM = 4096
const PIXEL_RATIO = 2

interface ExportMenuProps {
  onRegenerate: () => void
}

export function ExportMenu({ onRegenerate }: ExportMenuProps) {
  const uiState = useStore((s) => s.uiState)
  const currentDiagram = useStore((s) => s.currentDiagram)
  const importDiagram = useStore((s) => s.importDiagram)
  const lastGenerationPrompt = useStore((s) => s.lastGenerationPrompt)
  const user = useAuthStore((s) => s.user)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [savedTick, setSavedTick] = useState(false)

  const canExport = uiState === 'ready'
  const canSave = !!user && !!currentDiagram && uiState === 'ready' && !saving
  const canRegenerate = uiState === 'ready' && !!lastGenerationPrompt
  const canImport = uiState === 'idle' || uiState === 'ready' || uiState === 'error'

  async function handleSave() {
    setSaving(true)
    setSavedTick(false)
    const r = await persistCurrentDiagram()
    setSaving(false)
    if (r.ok) {
      setSavedTick(true)
      setTimeout(() => setSavedTick(false), 1500)
    } else if (r.error !== 'no-session') {
      window.alert(`No se pudo guardar: ${r.error}`)
    }
  }

  async function handleExportPng() {
    const viewportEl = document.querySelector<HTMLElement>('.react-flow__viewport')
    if (!viewportEl) return
    // Encuadre del diagrama ENTERO: unión de los bounds de los nodos y de las
    // aristas (estas se curvan o se enrutan a los handles laterales, fuera del
    // rectángulo de los nodos; sin ellas el PNG recorta esas líneas — p. ej. las
    // relaciones de un ERD con tablas apiladas en vertical).
    const bounds = unionRects(
      getRenderedNodeBounds(viewportEl),
      getRenderedEdgeBounds(viewportEl),
    )
    if (!bounds) return
    // Escala natural (1.0) como en el tope de "Ajustar vista". Si a 1.0 el lado
    // mayor superara MAX_IMAGE_DIM, se reduce el zoom lo justo para que el
    // diagrama entero quepa: la excepción para diagramas enormes.
    const maxContent = MAX_IMAGE_DIM - IMAGE_PADDING * 2
    const zoom = Math.min(1, maxContent / bounds.width, maxContent / bounds.height)
    const imageWidth = Math.round(bounds.width * zoom) + IMAGE_PADDING * 2
    const imageHeight = Math.round(bounds.height * zoom) + IMAGE_PADDING * 2
    const offsetX = IMAGE_PADDING - bounds.x * zoom
    const offsetY = IMAGE_PADDING - bounds.y * zoom
    const transform = `translate(${offsetX}px, ${offsetY}px) scale(${zoom})`
    try {
      const nodesUrl = await toPng(viewportEl, {
        width: imageWidth,
        height: imageHeight,
        pixelRatio: PIXEL_RATIO,
        style: { width: `${imageWidth}px`, height: `${imageHeight}px`, transform },
      })
      const nodesImg = await loadImage(nodesUrl)
      const canvas = document.createElement('canvas')
      canvas.width = imageWidth * PIXEL_RATIO
      canvas.height = imageHeight * PIXEL_RATIO
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.scale(PIXEL_RATIO, PIXEL_RATIO)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, imageWidth, imageHeight)
      ctx.save()
      ctx.translate(offsetX, offsetY)
      ctx.scale(zoom, zoom)
      for (const edge of getRenderedEdges(viewportEl)) {
        ctx.strokeStyle = edge.stroke
        ctx.lineWidth = edge.strokeWidth
        ctx.setLineDash(edge.dash)
        ctx.stroke(new Path2D(edge.d))
      }
      ctx.setLineDash([])
      ctx.restore()
      ctx.drawImage(nodesImg, 0, 0, imageWidth, imageHeight)
      triggerDownload(
        canvas.toDataURL('image/png'),
        diagramFilename(currentDiagram?.title, 'png'),
      )
    } catch (err) {
      console.error('[export] fallo al exportar PNG:', err)
    }
  }

  function handleExportJson() {
    if (!currentDiagram) return
    triggerJsonDownload(currentDiagram, diagramFilename(currentDiagram.title, 'mdia'))
  }

  async function handleImportFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      const parsed = diagramImportSchema.safeParse(JSON.parse(await file.text()))
      if (!parsed.success) {
        window.alert('El archivo no es un diagrama MydIAgram válido.')
        return
      }
      // Importar como diagrama NUEVO: no sobreescribe la sesión viva, arranca
      // una limpia con el contenido importado (currentDiagramId null → POST).
      importDiagram(parsed.data)
      // Guardado automático como fila nueva en BD. Sin sesión, doSave devuelve
      // 'no-session' y el diagrama queda importado pero sin persistir.
      const r = await persistCurrentDiagram()
      if (!r.ok && r.error !== 'no-session') {
        window.alert(`Diagrama importado, pero no se pudo guardar: ${r.error}`)
      }
    } catch {
      window.alert('No se pudo leer el archivo: no es un JSON válido.')
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="secondary"
        onClick={handleSave}
        disabled={!canSave}
        title={saving ? 'Guardando…' : savedTick ? 'Guardado' : 'Guardar'}
        aria-label="Guardar diagrama"
        className="text-xs p-1.5 flex items-center"
      >
        {savedTick ? <Check size={14} /> : <Save size={14} />}
      </Button>
      <Button
        variant="secondary"
        onClick={onRegenerate}
        disabled={!canRegenerate}
        title="Regenerar"
        aria-label="Regenerar diagrama"
        className="text-xs p-1.5 flex items-center"
      >
        <RefreshCw size={14} />
      </Button>
      <Menu
        trigger={
          <Button
            variant="secondary"
            title="Exportar"
            aria-label="Exportar diagrama"
            className="text-xs p-1.5 flex items-center"
          >
            <Download size={14} />
          </Button>
        }
        items={[
          {
            label: 'Exportar PNG',
            icon: <Download size={14} />,
            onClick: handleExportPng,
            disabled: !canExport,
          },
          {
            label: 'Exportar .mdia',
            icon: <Download size={14} />,
            onClick: handleExportJson,
            disabled: !canExport,
          },
        ]}
      />
      <Button
        variant="secondary"
        onClick={() => fileInputRef.current?.click()}
        disabled={!canImport}
        title="Importar diagrama"
        aria-label="Importar diagrama (.mdia o .json)"
        className="text-xs p-1.5 flex items-center"
      >
        <Upload size={14} />
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".mdia,application/json,.json"
        onChange={handleImportFile}
        className="hidden"
      />
    </div>
  )
}
