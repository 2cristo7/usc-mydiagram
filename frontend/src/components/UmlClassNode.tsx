import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";
import type { UmlClassData } from "../types";

type UmlClassNode = Node<UmlClassData, 'umlClass'>;

export function UmlClassNode({ data, selected }: NodeProps<UmlClassNode>) {
    const { label, stereotype, attributes } = data;
    const methods = attributes?.filter((a: string) => a.includes('(')) ?? [];
    const attrs   = attributes?.filter((a: string) => !a.includes('(')) ?? [];

    return (
        <div className="bg-white border border-gray-300 rounded shadow p-4 w-48">
            <div className="text-center font-bold">
                {stereotype && <span className="text-sm text-gray-500">&laquo;{stereotype}&raquo;</span>}
                <div>{label}</div>
            </div>
            <hr className="my-2" />
            <div>
                {attrs.map((attr: string, idx: number) => (
                    <div key={idx} className="text-sm">{attr}</div>
                ))}
            </div>
            {methods.length > 0 && <hr className="my-2" />}
            <div>
                {methods.map((method: string, idx: number) => (
                    <div key={idx} className="text-sm">{method}</div>
                ))}
            </div>
            {/* Conectores */}
            <Handle type="target" position={Position.Top} />
            <Handle type="source" position={Position.Bottom} /> 
        </div>
    );
}