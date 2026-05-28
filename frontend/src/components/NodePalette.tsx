import type { NodeType } from '../types';

const PALETTE_ITEMS: NodeType[] = ['table', 'class', 'service', 'actor', 'step', 'person'];

export function NodePalette() {
    return (
        <div className="w-48 bg-gray-100 p-4 border-r">
            <h3 className="text-lg font-semibold mb-4">Paleta de nodos</h3>
            <div className="space-y-2">
                {PALETTE_ITEMS.map((type) => (
                    <div key={type} 
                    className="p-2 bg-white border rounded cursor-pointer text-center"
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData('nodeType', type)}
                    >
                        {type.charAt(0).toUpperCase() + type.slice(1)}
                    </div>
                ))}
            </div>
        </div>
    );
}