// Export al formato draw.io (mxGraph XML, sin comprimir).
//
// draw.io guarda los .drawio como un <mxGraphModel> donde cada elemento del
// diagrama es un <mxCell>: los nodos son vertex="1" con una <mxGeometry> propia,
// y las aristas son edge="1" con source/target apuntando a ids de nodos. El
// fichero "real" de draw.io suele venir envuelto en <mxfile><diagram> y, encima,
// comprimido con deflate+base64; aquí emitimos el XML PLANO (mxGraphModel a pelo,
// sin deflate) que draw.io también acepta al abrir/importar y que es legible y
// diffeable. Decisión: round-trip sin dependencias de compresión.
//
// El modelo interno lleva más semántica que mxGraph (node_type/edge_type,
// attributes, fragments…). Lo que mxGraph entiende lo mapeamos a `style` para que
// draw.io lo PINTE reconociblemente; lo que no (node_type exacto, attributes), lo
// serializamos en atributos data-* propios para poder recuperarlo en el import sin
// depender de la heurística de formas.

import type { DiagramSchema, DiagramNode, DiagramEdge, NodeType, EdgeType } from '../../../../types';

// Geometría por defecto de un vertex cuando el nodo no trae posición.
const NODE_W = 120;
const NODE_H = 60;
const GRID_COLS = 5;
const GRID_DX = 200;
const GRID_DY = 120;

// Escapado XML para atributos y valores. mxGraph mete el value como atributo del
// mxCell, así que hay que escapar también comillas. Las saltos de línea dentro del
// value los codifica draw.io como &#10; (HTML), no como \n literal.
function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// El value de un nodo en draw.io es una sola cadena; los atributos del modelo se
// pintan como líneas extra debajo del label (separador HTML &#10;) para que en el
// canvas de draw.io se vean. El import los recupera del atributo data-attrs, no de
// aquí, para no perder fidelidad por el parseo del salto de línea.
function nodeValue(node: DiagramNode): string {
  if (node.attributes && node.attributes.length > 0) {
    return [node.label, ...node.attributes].join('\n');
  }
  return node.label;
}

// El value, ya escapado, con los \n convertidos a la entidad que draw.io usa para
// multilínea dentro de un atributo.
function encodedValue(raw: string): string {
  return escapeXml(raw).replace(/\n/g, '&#10;');
}

// style de mxGraph por node_type. El objetivo es que draw.io pinte una forma
// reconocible (rombo para decisión, cilindro para BD, actor UML para personas…).
// Para los tipos sin forma natural en mxGraph caemos a un rectángulo.
function styleForNode(nodeType: NodeType): string {
  const base = 'whiteSpace=wrap;html=1;';
  switch (nodeType) {
    case 'decision':
    case 'gateway':
      return `rhombus;${base}`;
    case 'terminator':
      return `rounded=1;arcSize=50;${base}`;
    case 'database':
      return `shape=cylinder3;${base}boundedLbl=1;backgroundOutline=1;`;
    case 'queue':
    case 'topic':
      return `shape=process;${base}`;
    case 'actor':
    case 'person':
      return `shape=umlActor;verticalLabelPosition=bottom;verticalAlign=top;${base}`;
    case 'use_case':
      return `ellipse;${base}`;
    case 'table':
      return `rounded=0;${base}`;
    case 'system':
    case 'container':
      return `rounded=0;dashed=0;${base}`;
    case 'service':
    case 'component':
    case 'step':
    default:
      return `rounded=0;${base}`;
  }
}

// style de mxGraph por edge_type. mxGraph no tiene una semántica de relación, así
// que solo decoramos el trazo: las condicionales/inheritance se distinguen visualmente
// (discontinua) y el edge_type exacto se serializa en data-edge-type para el round-trip.
function styleForEdge(edgeType: EdgeType | undefined): string {
  const base = 'edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;';
  switch (edgeType) {
    case 'conditional':
    case 'extend':
    case 'include':
    case 'depends_on':
      return `${base}dashed=1;`;
    case 'inherits':
      return `${base}endArrow=block;endFill=0;`;
    default:
      return base;
  }
}

// Posición del nodo: la suya si la tiene; si no, autoposicionado en grid para que
// el diagrama no salga apilado en (0,0) al abrirlo en draw.io.
function nodePosition(node: DiagramNode, index: number): { x: number; y: number } {
  if (node.position) return node.position;
  return {
    x: (index % GRID_COLS) * GRID_DX,
    y: Math.floor(index / GRID_COLS) * GRID_DY,
  };
}

function vertexCell(node: DiagramNode, index: number): string {
  const { x, y } = nodePosition(node, index);
  const style = styleForNode(node.node_type);
  // data-* propios para recuperar la semántica exacta en el import sin heurística.
  // El separador va como entidad &#10; porque la normalización de atributos de XML
  // colapsa los saltos de línea LITERALES a espacios al parsear (se perderían).
  const attrsData = node.attributes && node.attributes.length > 0
    ? ` data-attrs="${escapeXml(node.attributes.join('\n')).replace(/\n/g, '&#10;')}"`
    : '';
  return (
    `        <mxCell id="${escapeXml(node.id)}" value="${encodedValue(nodeValue(node))}" ` +
    `style="${escapeXml(style)}" vertex="1" parent="1" ` +
    `data-node-type="${escapeXml(node.node_type)}"${attrsData}>\n` +
    `          <mxGeometry x="${x}" y="${y}" width="${NODE_W}" height="${NODE_H}" as="geometry"/>\n` +
    `        </mxCell>`
  );
}

function edgeCell(edge: DiagramEdge): string {
  const style = styleForEdge(edge.edge_type);
  const typeData = edge.edge_type
    ? ` data-edge-type="${escapeXml(edge.edge_type)}"`
    : '';
  return (
    `        <mxCell id="${escapeXml(edge.id)}" value="${encodedValue(edge.label)}" ` +
    `style="${escapeXml(style)}" edge="1" parent="1" ` +
    `source="${escapeXml(edge.source)}" target="${escapeXml(edge.target)}"${typeData}>\n` +
    `          <mxGeometry relative="1" as="geometry"/>\n` +
    `        </mxCell>`
  );
}

export function toDrawio(diagram: DiagramSchema): string {
  const vertices = diagram.nodes.map((n, i) => vertexCell(n, i)).join('\n');
  const edges = diagram.edges.map((e) => edgeCell(e)).join('\n');
  const body = [vertices, edges].filter(Boolean).join('\n');

  // El title del modelo interno no tiene hueco nativo en mxGraphModel; lo guardamos
  // como atributo data-title propio para el round-trip (draw.io lo ignora).
  return (
    `<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" ` +
    `connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" ` +
    `pageHeight="1100" math="0" shadow="0" data-title="${escapeXml(diagram.title)}" ` +
    `data-diagram-type="${escapeXml(diagram.diagram_type)}">\n` +
    `  <root>\n` +
    `    <mxCell id="0"/>\n` +
    `    <mxCell id="1" parent="0"/>\n` +
    (body ? `${body}\n` : '') +
    `  </root>\n` +
    `</mxGraphModel>\n`
  );
}
