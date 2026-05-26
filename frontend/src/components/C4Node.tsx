import type { NodeType } from '../types';
import { Handle, Position } from "@xyflow/react";

interface C4NodeProps {
    data: {
        label: string;
        nodeType: NodeType;
    };
}

export function C4Node({ data }: C4NodeProps) {
    const { label, nodeType } = data;

    const getNodeStyle = () => {
        switch (nodeType) {
            case 'person':
                return 'bg-blue-100 border-blue-500';
            case 'system':
                return 'bg-green-100 border-green-500';
            case 'container':
                return 'bg-yellow-100 border-yellow-500';
            case 'component':
                return 'bg-purple-100 border-purple-500';
            default:
                return 'bg-gray-100 border-gray-300';
        }
    };

    const getNodeSymbol = () => {
        switch (nodeType) {
            case 'person':
                return '👤 ';
            case 'actor':
                return '👤 ';
            case 'system':
                return '💻 ';
            case 'container':
                return '📦 ';
            case 'component':
                return '⚙️ ';
            default:
                return '';
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
