import { Plus, GitBranch, Undo2, Redo2, Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { useReactFlow } from '@xyflow/react';
import { IconButton } from '../ui/primitives/IconButton';
import { useHistoryStore } from '../store/history';
import { useStore } from '../store/index';

export function EditToolbar() {
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const { undo, redo, canUndo, canRedo } = useHistoryStore();
  const currentDiagram = useStore((s) => s.currentDiagram);

  return (
    <div className="flex flex-col items-center border-r-[3px] border-[var(--color-ink)] bg-[var(--color-surface)] py-2 gap-1" style={{ width: 64 }}>
      <IconButton
        icon={<Plus size={16} />}
        tooltip="Añadir nodo"
        disabled={!currentDiagram}
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
    </div>
  );
}
