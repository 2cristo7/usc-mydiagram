type Point = { x: number; y: number };

export function getWaypointPath(
  source: Point,
  target: Point,
  waypoints: Point[],
  shape: 'curved' | 'elbow' | 'straight'
): [path: string, labelX: number, labelY: number] {
  if (shape === 'straight') return buildStraight(source, target, waypoints);
  if (shape === 'elbow') return buildElbow(source, target, waypoints);
  return buildCurved(source, target, waypoints);
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

  // label at mid-length
  const [lx, ly] = midOfPolyline(pts);
  return [d, lx, ly];
}

// ---------------------------------------------------------------------------
// elbow (Manhattan routing)
// ---------------------------------------------------------------------------

function buildElbow(
  source: Point,
  target: Point,
  waypoints: Point[]
): [string, number, number] {
  const pts = [source, ...waypoints, target];
  const segments: Point[] = [pts[0]];

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    // horizontal then vertical L-bend
    segments.push({ x: b.x, y: a.y });
    segments.push(b);
  }

  let d = `M ${segments[0].x} ${segments[0].y}`;
  for (let i = 1; i < segments.length; i++) {
    d += ` L ${segments[i].x} ${segments[i].y}`;
  }

  const [lx, ly] = midOfPolyline(segments);
  return [d, lx, ly];
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

function midOfPolyline(pts: Point[]): [number, number] {
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const l = dist(pts[i], pts[i + 1]);
    lengths.push(l);
    total += l;
  }
  const half = total / 2;
  let acc = 0;
  for (let i = 0; i < lengths.length; i++) {
    if (acc + lengths[i] >= half) {
      const t = (half - acc) / lengths[i];
      return [
        pts[i].x + t * (pts[i + 1].x - pts[i].x),
        pts[i].y + t * (pts[i + 1].y - pts[i].y),
      ];
    }
    acc += lengths[i];
  }
  const last = pts[pts.length - 1];
  return [last.x, last.y];
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
