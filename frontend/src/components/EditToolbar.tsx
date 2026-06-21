import { SquarePen, SquarePlus, Undo2, Redo2, Maximize2, ZoomIn, ZoomOut, Lock, Unlock, Grid3x3, LayoutGrid } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { IconButton } from '../ui/primitives/IconButton';
import { useHistoryStore } from '../store/history';
import { useStore } from '../store/index';
import { useUiStore } from '../store/ui';
import { NodePalette } from './NodePalette';
import { AuthButton } from './AuthButton';
import { FIT_VIEW_DURATION, useFitDiagramView } from '../ui/utils/fitView';

// Retardo entre relayout() y el fitView de centrado. Debe cubrir la animación de
// "Recalcular layout" (LAYOUT_ANIM_MS = 400 ms en DiagramCanvas) más el margen del
// refinamiento ELK, para que el encuadre mida ya las posiciones finales.
const RELAYOUT_FIT_DELAY_MS = 450;

export function EditToolbar() {
  const { zoomIn, zoomOut } = useReactFlow();
  const fitDiagramView = useFitDiagramView();
  const { undo, redo, canUndo, canRedo, reset: resetHistory } = useHistoryStore();
  const currentDiagram = useStore((s) => s.currentDiagram);
  const newDiagram = useStore((s) => s.newDiagram);
  const relayout = useStore((s) => s.relayout);
  const { nodePaletteOpen, toggleNodePalette, canvasLocked, toggleCanvasLock, gridEnabled, toggleGrid } = useUiStore();

  // Nuevo diagrama: limpia el workspace vivo (canvas + chat) y resetea el
  // historial undo/redo. No borra nada de la BD; el próximo prompt genera desde
  // cero. Cierra la paleta si estaba abierta para no dejar UI huérfana.
  function handleNewDiagram() {
    newDiagram();
    resetHistory();
    if (nodePaletteOpen) toggleNodePalette();
  }

  return (
    // El wrapper es flex-row para que la paleta se expanda a la derecha del toolbar.
    <div className="flex flex-row h-full">
      {/* Columna de botones */}
      <div className="flex flex-col items-center border-r-[3px] border-[var(--color-ink)] bg-[var(--color-surface)] py-2 gap-2" style={{ width: 64 }}>
        {/* Grupo 1 — acciones de diagrama: nuevo, añadir nodo, recalcular layout */}
        <IconButton
          icon={<SquarePen size={16} />}
          tooltip="Nuevo diagrama"
          onClick={handleNewDiagram}
          aria-label="Crear un diagrama nuevo"
        />
        <IconButton
          icon={<SquarePlus size={16} />}
          tooltip="Añadir nodo"
          disabled={!currentDiagram}
          onClick={toggleNodePalette}
          aria-pressed={nodePaletteOpen}
          aria-label="Abrir paleta de nodos"
        />
        <IconButton
          icon={<LayoutGrid size={16} />}
          tooltip="Recalcular layout"
          disabled={!currentDiagram}
          onClick={() => {
            relayout();
            // Tras reposicionar todo, encuadramos la vista al nuevo layout con
            // las MISMAS opciones que el resto (holgura inferior + tope 1.0).
            // Esperamos a que los nodos lleguen a sus posiciones (animación de
            // layout + refinamiento ELK async) antes de encuadrar; si no, el
            // fitView mediría el layout viejo y centraría mal.
            setTimeout(() => fitDiagramView({ duration: FIT_VIEW_DURATION }), RELAYOUT_FIT_DELAY_MS);
          }}
          aria-label="Recalcular el layout automático del diagrama"
        />
        <div className="my-1 h-px w-8 bg-[var(--color-ink)]" />
        {/* Grupo 2 — historial: deshacer / rehacer */}
        <IconButton
          icon={<Undo2 size={16} />}
          tooltip="Deshacer"
          disabled={!canUndo}
          onClick={() => undo()}
        />
        <IconButton
          icon={<Redo2 size={16} />}
          tooltip="Rehacer"
          disabled={!canRedo}
          onClick={() => redo()}
        />
        <div className="my-1 h-px w-8 bg-[var(--color-ink)]" />
        {/* Grupo 3 — vista: ajustar, zoom, rejilla, bloqueo */}
        <IconButton
          icon={<Maximize2 size={16} />}
          tooltip="Ajustar vista"
          onClick={() => fitDiagramView({ duration: FIT_VIEW_DURATION })}
        />
        <IconButton
          icon={<ZoomIn size={16} />}
          tooltip="Acercar"
          onClick={() => zoomIn()}
        />
        <IconButton
          icon={<ZoomOut size={16} />}
          tooltip="Alejar"
          onClick={() => zoomOut()}
        />
        <IconButton
          icon={<Grid3x3 size={16} />}
          tooltip={gridEnabled ? 'Desactivar rejilla' : 'Activar rejilla'}
          onClick={toggleGrid}
          aria-pressed={gridEnabled}
          aria-label={gridEnabled ? 'Desactivar rejilla de ajuste' : 'Activar rejilla de ajuste'}
        />
        <IconButton
          icon={canvasLocked ? <Lock size={16} /> : <Unlock size={16} />}
          tooltip={canvasLocked ? 'Desbloquear lienzo' : 'Bloquear lienzo'}
          onClick={toggleCanvasLock}
          aria-pressed={canvasLocked}
          aria-label={canvasLocked ? 'Desbloquear lienzo' : 'Bloquear lienzo'}
        />
        {/* Perfil al fondo de la barra: mt-auto lo empuja al pie */}
        <div className="mt-auto pt-2">
          <AuthButton />
        </div>
      </div>

      {/* Paleta de nodos: se muestra como columna inline a la derecha del toolbar */}
      {nodePaletteOpen && currentDiagram && <NodePalette />}
    </div>
  );
}
