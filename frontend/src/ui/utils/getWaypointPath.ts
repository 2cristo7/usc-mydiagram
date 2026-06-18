type Point = { x: number; y: number };
type Side = 'left' | 'right' | 'top' | 'bottom';

export function getWaypointPath(
  source: Point,
  target: Point,
  waypoints: Point[],
  shape: 'curved' | 'elbow' | 'straight' | 'radial',
  srcSide?: Side,
  tgtSide?: Side
): [path: string, labelX: number, labelY: number] {
  if (shape === 'straight') return buildStraight(source, target, waypoints);
  if (shape === 'elbow') return buildElbow(source, target, waypoints);
  // 'radial': bezier con manijas orientadas al lado de salida del nodo (como el
  // getBezierPath de React Flow). Solo sin waypoints; con waypoints cae a la curva
  // Catmull-Rom estándar (buildCurved), que ya pasa por los puntos intermedios.
  if (shape === 'radial' && waypoints.length === 0 && srcSide && tgtSide) {
    return buildRadial(source, target, srcSide, tgtSide);
  }
  return buildCurved(source, target, waypoints);
}

// Offset de la manija según la distancia con signo (idéntico a React Flow): si los
// nodos están "de cara", crece con la mitad de la distancia; si están cruzados,
// usa una raíz para no exagerar el lazo.
function controlOffset(distance: number, curvature = 0.25): number {
  if (distance >= 0) return 0.5 * distance;
  return curvature * 25 * Math.sqrt(-distance);
}

function controlPoint(side: Side, x1: number, y1: number, x2: number, y2: number): Point {
  switch (side) {
    case 'left': return { x: x1 - controlOffset(x1 - x2), y: y1 };
    case 'right': return { x: x1 + controlOffset(x2 - x1), y: y1 };
    case 'top': return { x: x1, y: y1 - controlOffset(y1 - y2) };
    case 'bottom': return { x: x1, y: y1 + controlOffset(y2 - y1) };
  }
}

// Devuelve los puntos de control del bezier radial (también lo usa el layout para
// detectar cruces con la MISMA geometría que se dibuja).
export function radialControlPoints(
  source: Point,
  target: Point,
  srcSide: Side,
  tgtSide: Side
): [Point, Point] {
  const c1 = controlPoint(srcSide, source.x, source.y, target.x, target.y);
  const c2 = controlPoint(tgtSide, target.x, target.y, source.x, source.y);
  return [c1, c2];
}

function buildRadial(
  source: Point,
  target: Point,
  srcSide: Side,
  tgtSide: Side
): [string, number, number] {
  const [c1, c2] = radialControlPoints(source, target, srcSide, tgtSide);
  const d = `M ${source.x} ${source.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${target.x} ${target.y}`;
  const [lx, ly] = bezierMid(source, c1, c2, target);
  return [d, lx, ly];
}

// ---------------------------------------------------------------------------
// straight
// ---------------------------------------------------------------------------

function buildStraight(
  source: Point,
  target: Point,
  waypoints: Point[]
): [string, number, number] {
  const pts = [source, ...waypoints, target];
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i].x} ${pts[i].y}`;
  }

  // Etiqueta en el medio del segmento más largo (no en un codo): queda centrada a
  // lo largo de un tramo recto en vez de pisar un vértice.
  const [lx, ly] = midOfLongestSegment(pts);
  return [d, lx, ly];
}

// ---------------------------------------------------------------------------
// elbow (Manhattan routing)
// ---------------------------------------------------------------------------

const ELBOW_RADIUS = 8;

// Vértices reales (esquinas) de la ruta ortogonal que dibuja el elbow, incluidos
// los extremos: [source, ...esquinas, target]. Cada par consecutivo es
// axis-aligned (solo varía en un eje). Es la fuente de verdad para colocar las
// píldoras de segmento y mover tramos enteros: el editor opera sobre estas
// esquinas, no sobre los waypoints crudos (que el L-bend puede reinterpretar).
export function getElbowCorners(
  source: Point,
  target: Point,
  waypoints: Point[]
): Point[] {
  const pts = [source, ...waypoints, target];
  const segments: Point[] = [pts[0]];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    // horizontal then vertical L-bend
    segments.push({ x: b.x, y: a.y });
    segments.push(b);
  }
  // Quitar vértices colineales/duplicados: el L-bend genera puntos repetidos
  // cuando los extremos ya están alineados, y redondear sobre ellos daría
  // longitudes cero (NaN).
  return dedupeCollinear(segments);
}

function buildElbow(
  source: Point,
  target: Point,
  waypoints: Point[]
): [string, number, number] {
  // Tras limpiar, redondeamos cada esquina (look MIRO).
  const clean = getElbowCorners(source, target, waypoints);
  const d = roundedPath(clean, ELBOW_RADIUS);

  // Etiqueta en el medio del segmento recto más largo: a lo largo del tramo, nunca
  // sobre un codo (donde queda fea y tapa el giro).
  const [lx, ly] = midOfLongestSegment(clean);
  return [d, lx, ly];
}

// Elimina puntos consecutivos coincidentes o colineales (mismo eje), dejando
// solo los vértices reales de la polilínea ortogonal.
function dedupeCollinear(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.01) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2];
      const b = last;
      // si a, b, p están alineados (colineales), b es redundante
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (Math.abs(cross) < 0.01) out.pop();
    }
    out.push(p);
  }
  return out;
}

function pointAlong(from: Point, to: Point, d: number): Point {
  const len = dist(from, to) || 1;
  const t = Math.min(1, d / len);
  return { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t };
}

// Convierte una polilínea en un path con esquinas redondeadas: en cada vértice
// interior recorta `radius` por ambos lados y une con una curva cuadrática que
// usa el vértice como punto de control.
function roundedPath(pts: Point[], radius: number): string {
  if (pts.length < 3) {
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${pts[i].y}`;
    return d;
  }
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const r1 = Math.min(radius, dist(p0, p1) / 2);
    const r2 = Math.min(radius, dist(p1, p2) / 2);
    const a = pointAlong(p1, p0, r1);
    const b = pointAlong(p1, p2, r2);
    d += ` L ${a.x} ${a.y} Q ${p1.x} ${p1.y} ${b.x} ${b.y}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${last.y}`;
  return d;
}

// ---------------------------------------------------------------------------
// curved (Catmull-Rom → cubic bezier)
// ---------------------------------------------------------------------------

function buildCurved(
  source: Point,
  target: Point,
  waypoints: Point[]
): [string, number, number] {
  const pts = [source, ...waypoints, target];

  if (pts.length === 2) {
    // standard cubic bezier fallback (React Flow style)
    const dx = (pts[1].x - pts[0].x) * 0.5;
    const c1x = pts[0].x + dx;
    const c1y = pts[0].y;
    const c2x = pts[1].x - dx;
    const c2y = pts[1].y;
    const d = `M ${pts[0].x} ${pts[0].y} C ${c1x} ${c1y} ${c2x} ${c2y} ${pts[1].x} ${pts[1].y}`;
    const [lx, ly] = bezierMid(pts[0], { x: c1x, y: c1y }, { x: c2x, y: c2y }, pts[1]);
    return [d, lx, ly];
  }

  // Catmull-Rom to cubic bezier conversion
  // virtual control points at both ends
  const extended = [
    { x: 2 * pts[0].x - pts[1].x, y: 2 * pts[0].y - pts[1].y },
    ...pts,
    { x: 2 * pts[pts.length - 1].x - pts[pts.length - 2].x, y: 2 * pts[pts.length - 1].y - pts[pts.length - 2].y },
  ];

  let d = `M ${pts[0].x} ${pts[0].y}`;
  const cubics: { p0: Point; c1: Point; c2: Point; p1: Point }[] = [];

  for (let i = 1; i < extended.length - 2; i++) {
    const p0 = extended[i - 1];
    const p1 = extended[i];
    const p2 = extended[i + 1];
    const p3 = extended[i + 2];

    const alpha = 1 / 6;
    const c1 = { x: p1.x + alpha * (p2.x - p0.x), y: p1.y + alpha * (p2.y - p0.y) };
    const c2 = { x: p2.x - alpha * (p3.x - p1.x), y: p2.y - alpha * (p3.y - p1.y) };

    d += ` C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${p2.x} ${p2.y}`;
    cubics.push({ p0: p1, c1, c2, p1: p2 });
  }

  const [lx, ly] = midOfCubics(cubics);
  return [d, lx, ly];
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function dist(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// Punto medio del segmento más largo de la polilínea. Para una arista en codo,
// coloca la etiqueta centrada a lo largo del tramo recto dominante (estilo
// dbdiagram/draw.io) en vez de en el punto a media longitud, que suele caer en una
// esquina.
function midOfLongestSegment(pts: Point[]): [number, number] {
  if (pts.length < 2) return [pts[0]?.x ?? 0, pts[0]?.y ?? 0];
  let best = 0;
  let bestLen = -1;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = dist(pts[i], pts[i + 1]);
    if (l > bestLen) {
      bestLen = l;
      best = i;
    }
  }
  return [(pts[best].x + pts[best + 1].x) / 2, (pts[best].y + pts[best + 1].y) / 2];
}

function bezierPoint(p0: Point, c1: Point, c2: Point, p1: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
  };
}

function bezierMid(p0: Point, c1: Point, c2: Point, p1: Point): [number, number] {
  const m = bezierPoint(p0, c1, c2, p1, 0.5);
  return [m.x, m.y];
}

function cubicLen(p0: Point, c1: Point, c2: Point, p1: Point, steps = 10): number {
  let len = 0;
  let prev = p0;
  for (let i = 1; i <= steps; i++) {
    const cur = bezierPoint(p0, c1, c2, p1, i / steps);
    len += dist(prev, cur);
    prev = cur;
  }
  return len;
}

function midOfCubics(
  cubics: { p0: Point; c1: Point; c2: Point; p1: Point }[]
): [number, number] {
  const lengths = cubics.map((c) => cubicLen(c.p0, c.c1, c.c2, c.p1));
  const total = lengths.reduce((a, b) => a + b, 0);
  const half = total / 2;
  let acc = 0;
  for (let i = 0; i < cubics.length; i++) {
    if (acc + lengths[i] >= half) {
      const t = (half - acc) / lengths[i];
      const m = bezierPoint(cubics[i].p0, cubics[i].c1, cubics[i].c2, cubics[i].p1, t);
      return [m.x, m.y];
    }
    acc += lengths[i];
  }
  const last = cubics[cubics.length - 1].p1;
  return [last.x, last.y];
}
