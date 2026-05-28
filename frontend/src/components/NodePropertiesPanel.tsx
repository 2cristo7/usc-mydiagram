import { useEffect, useState } from 'react';
import type { DiagramNode } from "../types";
import { useStore } from '../store';

export function NodePropertiesPanel({ node }: NodePropertiesPanelProps) {
    const { updateNode } = useStore();
    const [label, setLabel] = useState(node?.label || '');
    const [attributes, setAttributes] = useState(node?.attributes.join('\n') || '');
    useEffect(() => {
      setLabel(node?.label || '');
      setAttributes(node?.attributes.join('\n') || '');
  }, [node]);

    function handleSave() {
        if (node) {
            const updatedNode: DiagramNode = {
                ...node,
                label,
                attributes: attributes.split('\n').map(attr => attr.trim()).filter(attr => attr.length > 0)
            };
            updateNode(updatedNode.id, updatedNode);
        }
    }
    
    if (!node) {
        return (
            <div className="p-4">
                <p className="text-gray-600">Selecciona un nodo para editar sus propiedades</p>
            </div>
        );
    }
    
    return (
        <div className="p-4">
            <h2 className="text-lg font-bold mb-2">Propiedades del Nodo</h2>
            <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700">Etiqueta</label>
                <input 
                    type="text"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                    onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                />
            </div>
            <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700">Atributos (uno por línea)</label>
                <textarea
                    value={attributes}
                    onChange={(e) => setAttributes(e.target.value)}
                    className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2"
                    rows={5}
                />
            </div>
            <button 
                onClick={handleSave}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
            >
                Guardar
            </button>
        </div>
    );
}

interface NodePropertiesPanelProps {
    node: DiagramNode | null;
}