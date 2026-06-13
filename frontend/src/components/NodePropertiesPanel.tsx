import { useState } from 'react';
import type { DiagramNode } from "../types";
import { useStore } from '../store';
import { Button } from '../ui/primitives';

interface NodePropertiesPanelProps {
  node: DiagramNode | null;
}

export function NodePropertiesPanel({ node }: NodePropertiesPanelProps) {
  const { updateNode } = useStore();
  const [prevNodeId, setPrevNodeId] = useState(node?.id)
  const [label, setLabel] = useState(node?.label || '');
  const [attributes, setAttributes] = useState(node?.attributes.join('\n') || '');

  if (node?.id !== prevNodeId) {
    setPrevNodeId(node?.id)
    setLabel(node?.label || '')
    setAttributes(node?.attributes.join('\n') || '')
  }

  function handleSave() {
    if (node) {
      const updatedNode: DiagramNode = {
        ...node,
        label,
        attributes: attributes.split('\n').map(attr => attr.trim()).filter(attr => attr.length > 0),
      };
      updateNode(updatedNode.id, updatedNode);
    }
  }

  if (!node) return null;

  return (
    <div className="absolute right-0 top-0 z-10 w-72 bg-[var(--color-surface)] border-l-[3px] border-t-[3px] border-[var(--color-ink)] shadow-[var(--shadow-brutal-lg)]">
      <div className="flex justify-between items-center px-3 py-2 border-b-[3px] border-[var(--color-ink)]">
        <span className="font-semibold text-sm">Propiedades</span>
      </div>
      <div className="px-3 py-2">
        <p className="text-xs font-semibold mb-1">Etiqueta</p>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSave()}
          className="border-[3px] border-[var(--color-ink)] p-1.5 w-full text-sm font-mono bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
        />
        <p className="text-xs font-semibold mb-1 mt-3">Atributos (uno por línea)</p>
        <textarea
          value={attributes}
          onChange={(e) => setAttributes(e.target.value)}
          rows={5}
          className="border-[3px] border-[var(--color-ink)] p-1.5 w-full text-sm font-mono bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] resize-none"
        />
        <Button variant="primary" className="w-full mt-3" onClick={handleSave}>
          Guardar
        </Button>
      </div>
    </div>
  );
}
