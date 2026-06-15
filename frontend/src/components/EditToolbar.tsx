import { SquarePen, Plus, GitBranch, Undo2, Redo2, Maximize2, ZoomIn, ZoomOut, Lock, Unlock, Grid3x3, LayoutGrid } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { IconButton } from '../ui/primitives/IconButton';
import { useHistoryStore } from '../store/history';
import { useStore } from '../store/index';
import { useUiStore } from '../store/ui';
import { NodePalette } from './NodePalette';

export function EditToolbar() {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
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
      <div className="flex flex-col items-center border-r-[3px] border-[var(--color-ink)] bg-[var(--color-surface)] py-2 gap-1" style={{ width: 64 }}>
        <IconButton
          icon={<SquarePen size={16} />}
          tooltip="Nuevo diagrama"
          onClick={handleNewDiagram}
          aria-label="Crear un diagrama nuevo"
        />
        <div className="my-1 h-px w-8 bg-[var(--color-ink)]" />
        <IconButton
          icon={<Plus size={16} />}
          tooltip="Añadir nodo"
          disabled={!currentDiagram}
          onClick={toggleNodePalette}
          aria-pressed={nodePaletteOpen}
          aria-label="Abrir paleta de nodos"
        />
        <IconButton
          icon={<GitBranch size={16} />}
          tooltip="Añadir relación"
          disabled={!currentDiagram}
        />
        <div className="my-1 h-px w-8 bg-[var(--color-ink)]" />
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
        <IconButton
          icon={<LayoutGrid size={16} />}
          tooltip="Recalcular layout"
          disabled={!currentDiagram}
          onClick={() => {
            relayout();
            // Tras reposicionar todo, encuadramos la vista al nuevo layout.
            setTimeout(() => fitView({ padding: 0.1 }), 0);
          }}
          aria-label="Recalcular el layout automático del diagrama"
        />
        <div className="my-1 h-px w-8 bg-[var(--color-ink)]" />
        <IconButton
          icon={<Maximize2 size={16} />}
          tooltip="Ajustar vista"
          onClick={() => fitView({ padding: 0.1 })}
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
      </div>

      {/* Paleta de nodos: se muestra como columna inline a la derecha del toolbar */}
      {nodePaletteOpen && currentDiagram && <NodePalette />}
    </div>
  );
}
