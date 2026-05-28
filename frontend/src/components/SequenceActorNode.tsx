import type { NodeType } from '../types';
import { Handle, Position } from "@xyflow/react";

interface SequenceActorNodeProps {
    data: {
        label: string;
        nodeType: NodeType;
    };
}

export function SequenceActorNode({ data }: SequenceActorNodeProps) {
    const { label, nodeType } = data;

    const getNodeStyle = () => {
        switch (nodeType) {
            case 'actor':
                return 'bg-green-100 border-green-500';
            default:
                return 'bg-gray-100 border-gray-300';
        }
    };

    const getNodeSymbol = () => {
        switch (nodeType) {
            case 'actor':
                return '👤 ';
            default:
                return '? ';
        }
    };

    return (
        <div
            className={`p-4 border-2 rounded ${getNodeStyle()}`}
        >
            {getNodeSymbol()}
            {label}
            <Handle type="target" position={Position.Left} />
            <Handle type="source" position={Position.Right} />
        </div>
    );
}
