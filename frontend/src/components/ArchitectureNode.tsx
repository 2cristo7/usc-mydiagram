import type { NodeType } from '../types';
import { Handle, Position } from "@xyflow/react";

interface ArchitectureNodeProps {
    data: {
            label: string;
            nodeType: NodeType;
        };
}

export function ArchitectureNode({ data }: ArchitectureNodeProps) {
    const { label, nodeType } = data;
    
    const getNodeStyle = () => {
        switch (nodeType) {
            case 'service':
                return 'bg-blue-100 border-blue-500';
            case 'database':
                return 'bg-green-100 border-green-500';
            case 'queue':
                return 'bg-yellow-100 border-yellow-500';
            case 'gateway':
                return 'bg-purple-100 border-purple-500';
            default:
                return 'bg-gray-100 border-gray-300';
        }
    };

    const getNodeSymbol = () => {
        switch (nodeType) {
            case 'service':
                return '⚙️ ';
            case 'database':
                return '🗄️ ';
            case 'queue':
                return '📬 ';
            case 'gateway':
                return '🚪 ';
            default:
                return '❓ ';
        }
    };
    
    return (
        <div
            className={`p-4 border-2 rounded ${getNodeStyle()}`}
        >
            {getNodeSymbol()}
            {label}
            <Handle type="target" position={Position.Top} />
            <Handle type="source" position={Position.Bottom} />
        </div>
    );
}