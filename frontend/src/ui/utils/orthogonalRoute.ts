// Ruteo ortogonal con esquiva de obstáculos (estilo draw.io/libavoid).
//
// Construye una rejilla dispersa a partir de las coordenadas "interesantes" —los
// bordes de cada nodo inflados por un margen, más los extremos de la arista— y
// corre A* sobre las intersecciones, prohibiendo los tramos que cruzan el interior
// de un nodo y penalizando los giros. El resultado es una polilínea ortogonal que
// rodea los nodos en lugar de atravesarlos. Solo se usa para el layout por defecto;
// las ediciones del usuario prevalecen.

export type Pt = { x: number; y: number };
export type Rect = { x: number; y: number; w: number; h: number }; // esquina sup-izq
export type Side = 'T' | 'B' | 'L' | 'R';

// Margen alrededor de cada nodo para colocar las líneas de la rejilla: las aristas
// no se pegan al borde. Holgado para que quepa la etiqueta de la arista sin pisar
// el nodo cuando la ruta corre junto a él.
const OBSTACLE_MARGIN = 40;
// Distancia a la que el extremo abandona el nodo (codo perpendicular). DEBE coincidir
// con ENDPOINT_STUB de useEdgeEditing para que ese punto se funda con el stub que
// añade el renderer y no quede un escaloncito al final de la arista.
const STUB_OUT = 22;
// Coste extra por cada giro de 90°, en px equivalentes. Favorece rutas con pocos
// codos sin sacrificar demasiado la longitud.
const BEND_COST = 40;
// Tope de seguridad: si la rejilla es enorme (muchísimos nodos), abortamos y que
// el render caiga al elbow simple. Evita un A* patológico.
const MAX_GRID = 90;

function stub(p: Pt, side: Side, d: number): Pt {
  switch (side) {
    case 'T': return { x: p.x, y: p.y - d };
    case 'B': return { x: p.x, y: p.y + d };
    case 'L': return { x: p.x - d, y: p.y };
    default: return { x: p.x + d, y: p.y };
  }
}

// ¿El segmento axis-aligned A→B cruza el INTERIOR (abierto) del rectángulo?
// Correr justo por el borde inflado no cuenta como colisión.
function segHitsRect(a: Pt, b: Pt, r: Rect): boolean {
  const left = r.x, right = r.x + r.w, top = r.y, bottom = r.y + r.h;
  if (Math.abs(a.y - b.y) < 0.01) {
    // horizontal en y = a.y
    const y = a.y;
    if (y <= top || y >= bottom) return false;
    const x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
    return Math.max(x1, left) < Math.min(x2, right) - 0.01;
  }
  // vertical en x = a.x
  const x = a.x;
  if (x <= left || x >= right) return false;
  const y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
  return Math.max(y1, top) < Math.min(y2, bottom) - 0.01;
}

function blocked(a: Pt, b: Pt, obstacles: Rect[]): boolean {
  for (const r of obstacles) if (segHitsRect(a, b, r)) return true;
  return false;
}

// ¿La ruta "Z" simple y centrada (la que dibuja el renderer SIN waypoints) llega
// limpia, sin atravesar ningún otro nodo? Si es así no hace falta el A*: dejamos la
// arista sin waypoints y queda una Z recta y centrada (sin escaloncitos). Solo se
// considera para lados opuestos y paralelos (B↔T, L↔R), que es cuando la Z aplica.
export function simpleZClear(
  start: Pt,
  startSide: Side,
  end: Pt,
  endSide: Side,
  allObstacles: Rect[],
  srcRect: Rect,
  tgtRect: Rect,
): boolean {
  const opposite =
    (startSide === 'B' && endSide === 'T') || (startSide === 'T' && endSide === 'B') ||
    (startSide === 'L' && endSide === 'R') || (startSide === 'R' && endSide === 'L');
  if (!opposite) return false;

  const obstacles = allObstacles.filter((r) => r !== srcRect && r !== tgtRect);
  const vertical = startSide === 'T' || startSide === 'B';
  const pts: Pt[] = vertical
    ? [start, { x: start.x, y: (start.y + end.y) / 2 }, { x: end.x, y: (start.y + end.y) / 2 }, end]
    : [start, { x: (start.x + end.x) / 2, y: start.y }, { x: (start.x + end.x) / 2, y: end.y }, end];

  for (let i = 0; i < pts.length - 1; i++) {
    if (blocked(pts[i], pts[i + 1], obstacles)) return false;
  }
  return true;
}

function uniqSorted(vals: number[]): number[] {
  const s = [...vals].sort((p, q) => p - q);
  const out: number[] = [];
  for (const v of s) if (out.length === 0 || Math.abs(v - out[out.length - 1]) > 1) out.push(v);
  return out;
}

// Ruta ortogonal de `start` (sale por `startSide`) a `end` (entra por `endSide`)
// esquivando `allObstacles`. `start`/`end` deben estar sobre el borde de sus nodos;
// `srcRect`/`tgtRect` son esos nodos, que se excluyen como obstáculos (la arista
// nace dentro de su margen). Devuelve la polilínea completa [start, …, end], o null
// si no encuentra ruta (el caller cae al elbow simple).
export function routeOrthogonal(
  start: Pt,
  startSide: Side,
  end: Pt,
  endSide: Side,
  allObstacles: Rect[],
  srcRect: Rect,
  tgtRect: Rect,
): Pt[] | null {
  const obstacles = allObstacles.filter((r) => r !== srcRect && r !== tgtRect);

  // Empujamos los extremos fuera del nodo (stub) y ruteamos entre esos puntos.
  const p1 = stub(start, startSide, STUB_OUT);
  const q1 = stub(end, endSide, STUB_OUT);

  // Líneas candidatas: bordes inflados de cada obstáculo + los stubs.
  const xs = uniqSorted([
    p1.x, q1.x,
    ...obstacles.flatMap((r) => [r.x - OBSTACLE_MARGIN, r.x + r.w + OBSTACLE_MARGIN]),
  ]);
  const ys = uniqSorted([
    p1.y, q1.y,
    ...obstacles.flatMap((r) => [r.y - OBSTACLE_MARGIN, r.y + r.h + OBSTACLE_MARGIN]),
  ]);

  if (xs.length > MAX_GRID || ys.length > MAX_GRID) return null;

  const xi = (x: number) => xs.findIndex((v) => Math.abs(v - x) < 0.5);
  const yi = (y: number) => ys.findIndex((v) => Math.abs(v - y) < 0.5);
  const key = (ix: number, iy: number) => iy * xs.length + ix;

  const startIx = xi(p1.x), startIy = yi(p1.y);
  const goalIx = xi(q1.x), goalIy = yi(q1.y);
  if (startIx < 0 || startIy < 0 || goalIx < 0 || goalIy < 0) return null;

  // A* sobre la rejilla. Estado = celda; el coste de giro usa la dirección de
  // llegada, así que guardamos también de qué dirección venimos.
  type Node = { ix: number; iy: number; dir: number; g: number; f: number; parent: Node | null };
  const goalKey = key(goalIx, goalIy);
  const h = (ix: number, iy: number) => Math.abs(xs[ix] - xs[goalIx]) + Math.abs(ys[iy] - ys[goalIy]);

  // dir: 0 horizontal, 1 vertical, -1 inicial.
  const startNode: Node = { ix: startIx, iy: startIy, dir: -1, g: 0, f: h(startIx, startIy), parent: null };
  const open: Node[] = [startNode];
  const best = new Map<string, number>(); // (cellKey|dir) -> mejor g
  best.set(`${key(startIx, startIy)}|-1`, 0);

  const neighbors = [
    { dx: 1, dy: 0, dir: 0 }, { dx: -1, dy: 0, dir: 0 },
    { dx: 0, dy: 1, dir: 1 }, { dx: 0, dy: -1, dir: 1 },
  ];

  let goalNode: Node | null = null;
  let guard = 0;
  while (open.length > 0) {
    if (guard++ > 200000) break;
    // extrae el de menor f (lista pequeña; lineal basta para diagramas reales)
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open.splice(bi, 1)[0];
    if (key(cur.ix, cur.iy) === goalKey) { goalNode = cur; break; }

    const a = { x: xs[cur.ix], y: ys[cur.iy] };
    for (const nb of neighbors) {
      const nix = cur.ix + nb.dx, niy = cur.iy + nb.dy;
      if (nix < 0 || niy < 0 || nix >= xs.length || niy >= ys.length) continue;
      const b = { x: xs[nix], y: ys[niy] };
      if (blocked(a, b, obstacles)) continue;
      const len = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
      const bend = cur.dir !== -1 && cur.dir !== nb.dir ? BEND_COST : 0;
      const g = cur.g + len + bend;
      const stateKey = `${key(nix, niy)}|${nb.dir}`;
      const prev = best.get(stateKey);
      if (prev !== undefined && prev <= g) continue;
      best.set(stateKey, g);
      open.push({ ix: nix, iy: niy, dir: nb.dir, g, f: g + h(nix, niy), parent: cur });
    }
  }

  if (!goalNode) return null;

  // Reconstruye y arma la polilínea completa.
  const grid: Pt[] = [];
  for (let n: Node | null = goalNode; n; n = n.parent) grid.unshift({ x: xs[n.ix], y: ys[n.iy] });
  const full = [start, ...grid, end];
  return dedupe(full);
}

// Quita puntos duplicados y colineales consecutivos.
function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.5) continue;
    if (out.length >= 2) {
      const a = out[out.length - 2], b = last;
      const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      if (Math.abs(cross) < 0.5) out.pop();
    }
    out.push(p);
  }
  return out;
}
