import type { NodeType } from '../types';
import { Handle, Position } from "@xyflow/react";

interface FlowNodeProps {
    data: {
        label: string;
        nodeType: NodeType;
    };
}

export function FlowNode({ data }: FlowNodeProps) {
    const { label, nodeType } = data;

    if (nodeType === 'decision') {
        return (
            <div className="relative flex items-center justify-center w-32 h-32">
                <div className="absolute inset-0 bg-yellow-100 border-2 border-yellow-500 rotate-45" />
                <span className="relative z-10 text-center text-sm font-medium px-2 leading-tight">{label}</span>
                <Handle type="target" position={Position.Top} />
                <Handle type="source" position={Position.Bottom} />
            </div>
        );
    }

    if (nodeType === 'terminator') {
        return (
            <div className="px-6 py-3 bg-red-100 border-2 border-red-500 rounded-full flex items-center gap-1">
                <span>⬤</span>
                {label}
                <Handle type="target" position={Position.Top} />
                <Handle type="source" position={Position.Bottom} />
            </div>
        );
    }

    return (
        <div className="p-4 bg-green-100 border-2 border-green-500 rounded flex items-center gap-1">
            {label}
            <Handle type="target" position={Position.Top} />
            <Handle type="source" position={Position.Bottom} />
        </div>
    );
}
