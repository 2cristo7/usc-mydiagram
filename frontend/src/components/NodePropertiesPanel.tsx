import type { DiagramNode } from "../types";

interface NodePropertiesPanelProps {
  node: DiagramNode | null;
}

// Label editing is handled by inline edit (useInlineEdit); this panel is now empty.
export function NodePropertiesPanel(_props: NodePropertiesPanelProps) {
  return null;
}
