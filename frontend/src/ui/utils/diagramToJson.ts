import type { DiagramSchema, DiagramNode, DiagramEdge, DiagramType, Fragment } from "../../types";

// S7.1 — Representación compacta del diagrama que se envía al agente al refinar.
// El DiagramSchema ya carece de coordenadas (dagre las recalcula en cada render
// desde currentDiagram), así que "compactar" no es quitar posiciones —no las
// hay— sino quitar lo que el agente no necesita para razonar sobre el grafo:
//   - diagram_type: IMPRESCINDIBLE. Determina qué node_type/edge_type son válidos
//     (un ERD admite `table`, un flowchart `decision`…). Sin él el agente no puede
//     proponer tipos coherentes.
//   - nodes/edges: el estado sobre el que operan las tools de refinamiento
//     (update_node(id, …), delete_node(id), add_edge(source, target, …)). Los `id`
//     son imprescindibles para esa cirugía dirigida.
//   - title: se OMITE. Es human-facing; el agente no lo necesita para refinar e
//     inflaría el contexto sin aportar. Si un refinamiento debe cambiar el título,
//     es trabajo de una tool, no contexto de entrada.
// Espejo del CompactDiagram de Pydantic en el agente (schemas.py): el contrato que
// cruza el proceso es el compacto, no el DiagramSchema completo.
export interface CompactDiagram {
    diagram_type: DiagramType;
    nodes: DiagramNode[];
    edges: DiagramEdge[];
    // S10.4 — fragmentos combinados (solo secuencia). Viajan al refinar para que el
    // agente los conserve. Se omite cuando no hay ninguno (resto de tipos).
    fragments?: Fragment[];
}

export function diagramToJson(diagram: DiagramSchema): CompactDiagram {
    return {
        diagram_type: diagram.diagram_type,
        // Se stripea `position` antes de enviar al agente Python: el schema
        // Pydantic (DiagramNode en agent/schemas.py) no incluye ese campo y un
        // extra podría ensuciar el contexto del LLM o romper la validación.
        nodes: diagram.nodes.map(({ position: _pos, ...rest }) => rest as DiagramNode),
        // Se stripea `data` (visual-only: waypoints, forma, flechas…) por la misma
        // razón que `position`: no es parte del contrato Pydantic del agente.
        edges: diagram.edges.map(({ data: _data, ...rest }) => rest as DiagramEdge),
        // Los fragmentos no llevan datos visuales que stripear (su geometría se
        // recalcula en el layout); van tal cual si los hay.
        ...(diagram.fragments?.length ? { fragments: diagram.fragments } : {}),
    };
}
