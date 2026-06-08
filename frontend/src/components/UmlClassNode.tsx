import { Handle, Position, type NodeProps, type Node } from "@xyflow/react";

export type UmlClassData = {
      label: string;
      stereotype?: string;
      attributes: string[];
};

type UmlClassNode = Node<UmlClassData, 'umlClass'>;

export function UmlClassNode({ data }: NodeProps<UmlClassNode>) {
    const { label, stereotype, attributes } = data;
    const methods = attributes?.filter((a: string) => a.match(/\(.*\)\s*:\s*\w+$/)) ?? [];
    const attrs   = attributes?.filter((a: string) => !a.match(/\(.*\)\s*:\s*\w+$/)) ?? [];

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