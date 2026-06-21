import { useState } from 'react'
import { Download, Upload, RefreshCw } from 'lucide-react'
import { toPng } from 'html-to-image'
import { useStore } from '../store/index'
import { Button, Menu, Spinner } from '../ui/primitives'
import {
  diagramFilename,
  triggerDownload,
  triggerTextDownload,
  getRenderedNodeBounds,
  getRenderedEdgeBounds,
  getRenderedLabelBounds,
  getRenderedEdges,
  drawArrowMarker,
  unionRects,
  loadImage,
} from '../ui/utils/download'
import { exportFormats } from '../ui/utils/formats'
import { toast } from '../store/toast'
import { ImportDiagramModal } from './ImportDiagramModal'

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
  const lastGenerationPrompt = useStore((s) => s.lastGenerationPrompt)
  // El rasterizado a PNG (diagramas grandes, hasta 4096px) puede tardar;
  // bloqueamos la acción y mostramos carga mientras corre.
  const [exporting, setExporting] = useState(false)
  // El import vive ahora en su propio modal multiformato (ImportDiagramModal).
  const [importOpen, setImportOpen] = useState(false)

  // No hay botón "Guardar": toda edición del canvas autoguarda sola (debounce en
  // el store) y los cambios de la IA persisten en el done. Aquí solo quedan
  // exportar/importar/regenerar.
  const canExport = uiState === 'ready'
  const canRegenerate = uiState === 'ready' && !!lastGenerationPrompt
  const canImport = uiState === 'idle' || uiState === 'ready' || uiState === 'error'

  async function handleExportPng() {
    if (exporting) return
    const viewportEl = document.querySelector<HTMLElement>('.react-flow__viewport')
    if (!viewportEl) {
      toast.error('No hay nada que exportar.')
      return
    }
    setExporting(true)
    // Encuadre del diagrama ENTERO: unión de los bounds de los nodos, de las
    // aristas y de las ETIQUETAS de arista. Las aristas se curvan o se enrutan a
    // los handles laterales, fuera del rectángulo de los nodos (sin ellas el PNG
    // recorta esas líneas — p. ej. las relaciones de un ERD con tablas apiladas en
    // vertical). Las etiquetas no son ni nodos ni paths, y algunas caen fuera de
    // las cajas: el texto de un self-message de secuencia se dibuja a la derecha de
    // la lifeline, más allá del actor, y sin esto sale recortado.
    const bounds = unionRects(
      unionRects(getRenderedNodeBounds(viewportEl), getRenderedEdgeBounds(viewportEl)),
      getRenderedLabelBounds(viewportEl),
    )
    if (!bounds) {
      // Diagrama sin nodos ni aristas renderizados: no hay rectángulo que capturar.
      toast.error('No hay nada que exportar.')
      setExporting(false)
      return
    }
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
      // Colores de las puntas de flecha (los <marker> SVG usan estas variables:
      // trazo --color-ink, relleno de la hueca --color-surface). Se resuelven una
      // vez desde el root para reproducirlos nativamente en el canvas.
      const rootStyle = getComputedStyle(document.documentElement)
      const inkColor = rootStyle.getPropertyValue('--color-ink').trim() || '#111111'
      const surfaceColor = rootStyle.getPropertyValue('--color-surface').trim() || '#ffffff'
      ctx.save()
      ctx.translate(offsetX, offsetY)
      ctx.scale(zoom, zoom)
      const edges = getRenderedEdges(viewportEl)
      for (const edge of edges) {
        ctx.strokeStyle = edge.stroke
        ctx.lineWidth = edge.strokeWidth
        ctx.setLineDash(edge.dash)
        ctx.stroke(new Path2D(edge.d))
      }
      // Las puntas se pintan con trazo continuo, sin heredar el dash de la línea.
      ctx.setLineDash([])
      for (const edge of edges) {
        for (const marker of edge.markers) {
          drawArrowMarker(ctx, marker, inkColor, surfaceColor)
        }
      }
      ctx.restore()
      ctx.drawImage(nodesImg, 0, 0, imageWidth, imageHeight)
      triggerDownload(
        canvas.toDataURL('image/png'),
        diagramFilename(currentDiagram?.title, 'png'),
      )
    } catch (err) {
      console.error('[export] fallo al exportar PNG:', err)
      toast.error('No se pudo exportar la imagen PNG.')
    } finally {
      setExporting(false)
    }
  }

  // Exporta el diagrama actual a un formato de TEXTO del registry (native .mdia,
  // Mermaid, draw.io, Excalidraw). El PNG NO pasa por aquí: es binario/canvas.
  // Envuelto en try/catch (igual que handleExportPng): si un serializador lanza
  // con un diagrama atípico, el fallo no debe ser silencioso.
  function handleExportText(fmtId: string) {
    if (!currentDiagram) return
    const fmt = exportFormats().find((f) => f.id === fmtId)
    if (!fmt || !fmt.toContent) return
    try {
      triggerTextDownload(
        fmt.toContent(currentDiagram),
        diagramFilename(currentDiagram.title, fmt.extension),
        fmt.id === 'native' ? 'application/json' : 'text/plain',
      )
    } catch (err) {
      console.error(`[export] fallo al exportar ${fmt.label}:`, err)
      toast.error(`No se pudo exportar a ${fmt.label}.`)
    }
  }

  // Items del menú: PNG (binario, fijo) + un item por cada formato de texto
  // exportable del registry. Así añadir un formato nuevo lo añade al menú solo.
  const exportItems = [
    {
      label: exporting ? 'Exportando PNG…' : 'Exportar PNG',
      icon: exporting ? <Spinner size={14} label="Exportando" /> : <Download size={14} />,
      onClick: handleExportPng,
      disabled: !canExport || exporting,
    },
    ...exportFormats()
      .filter((f) => f.toContent)
      .map((f) => ({
        label: `Exportar ${f.label}`,
        icon: <Download size={14} />,
        onClick: () => handleExportText(f.id),
        disabled: !canExport || exporting,
      })),
  ]

  return (
    <div className="flex items-center gap-1.5">
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
            {exporting ? <Spinner size={14} label="Exportando" /> : <Download size={14} />}
          </Button>
        }
        items={exportItems}
      />
      <Button
        variant="secondary"
        onClick={() => setImportOpen(true)}
        disabled={!canImport}
        title="Importar diagrama"
        aria-label="Importar diagrama"
        className="text-xs p-1.5 flex items-center"
      >
        <Upload size={14} />
      </Button>
      <ImportDiagramModal open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  )
}
