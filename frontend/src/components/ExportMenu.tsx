import { useRef, useState } from 'react'
import { Download, Upload, RefreshCw, Save } from 'lucide-react'
import { getViewportForBounds } from '@xyflow/react'
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
  getRenderedEdges,
  loadImage,
} from '../ui/utils/download'
import { persistCurrentDiagram } from '../lib/api'

const IMAGE_PADDING = 40
const MIN_ZOOM = 0.5
const MAX_ZOOM = 2
const FIT_PADDING = 0.1
const PIXEL_RATIO = 2

interface ExportMenuProps {
  onRegenerate: () => void
}

export function ExportMenu({ onRegenerate }: ExportMenuProps) {
  const uiState = useStore((s) => s.uiState)
  const currentDiagram = useStore((s) => s.currentDiagram)
  const setCurrentDiagram = useStore((s) => s.setCurrentDiagram)
  const setCurrentDiagramId = useStore((s) => s.setCurrentDiagramId)
  const setLastGenerationPrompt = useStore((s) => s.setLastGenerationPrompt)
  const setUiState = useStore((s) => s.setUiState)
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
    const bounds = getRenderedNodeBounds(viewportEl)
    if (!bounds) return
    const imageWidth = Math.round(bounds.width) + IMAGE_PADDING * 2
    const imageHeight = Math.round(bounds.height) + IMAGE_PADDING * 2
    const viewport = getViewportForBounds(
      bounds,
      imageWidth,
      imageHeight,
      MIN_ZOOM,
      MAX_ZOOM,
      FIT_PADDING,
    )
    const transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})`
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
      ctx.translate(viewport.x, viewport.y)
      ctx.scale(viewport.zoom, viewport.zoom)
      for (const edge of getRenderedEdges(viewportEl)) {
        ctx.strokeStyle = edge.stroke
        ctx.lineWidth = edge.strokeWidth
        ctx.stroke(new Path2D(edge.d))
      }
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
    triggerJsonDownload(currentDiagram, diagramFilename(currentDiagram.title, 'json'))
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
      setCurrentDiagram(parsed.data)
      setCurrentDiagramId(null)
      setLastGenerationPrompt(null)
      setUiState('ready')
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
        className="text-xs px-2 py-1 flex items-center gap-1"
      >
        <Save size={12} />
        {saving ? 'Guardando…' : savedTick ? 'Guardado ✓' : 'Guardar'}
      </Button>
      <Button
        variant="secondary"
        onClick={onRegenerate}
        disabled={!canRegenerate}
        className="text-xs px-2 py-1 flex items-center gap-1"
      >
        <RefreshCw size={12} />
        Regenerar
      </Button>
      <Menu
        trigger={
          <Button variant="secondary" className="text-xs px-2 py-1 flex items-center gap-1">
            <Download size={12} />
            Exportar
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
            label: 'Exportar JSON',
            icon: <Download size={14} />,
            onClick: handleExportJson,
            disabled: !canExport,
          },
          {
            label: 'Importar JSON',
            icon: <Upload size={14} />,
            onClick: () => fileInputRef.current?.click(),
            disabled: !canImport,
          },
        ]}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        onChange={handleImportFile}
        className="hidden"
      />
    </div>
  )
}
