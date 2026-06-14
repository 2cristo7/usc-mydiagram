const N = 100;

export function projectOntoPath(
  pathElement: SVGPathElement,
  point: { x: number; y: number }
): { t: number; point: { x: number; y: number } } {
  const totalLength = pathElement.getTotalLength();

  let closestDist = Infinity;
  let closestLength = 0;

  for (let i = 0; i <= N; i++) {
    const len = (i / N) * totalLength;
    const p = pathElement.getPointAtLength(len);
    const dx = p.x - point.x;
    const dy = p.y - point.y;
    const dist = dx * dx + dy * dy;
    if (dist < closestDist) {
      closestDist = dist;
      closestLength = len;
    }
  }

  const step = totalLength / N;
  let lo = Math.max(0, closestLength - step);
  let hi = Math.min(totalLength, closestLength + step);

  for (let iter = 0; iter < 32; iter++) {
    const mid1 = lo + (hi - lo) / 3;
    const mid2 = hi - (hi - lo) / 3;

    const p1 = pathElement.getPointAtLength(mid1);
    const p2 = pathElement.getPointAtLength(mid2);

    const d1 = (p1.x - point.x) ** 2 + (p1.y - point.y) ** 2;
    const d2 = (p2.x - point.x) ** 2 + (p2.y - point.y) ** 2;

    if (d1 < d2) {
      hi = mid2;
    } else {
      lo = mid1;
    }
  }

  const refinedLength = (lo + hi) / 2;
  const refined = pathElement.getPointAtLength(refinedLength);

  return {
    t: refinedLength / totalLength,
    point: { x: refined.x, y: refined.y },
  };
}

export function getPointAtT(
  pathElement: SVGPathElement,
  t: number
): { x: number; y: number } {
  const p = pathElement.getPointAtLength(t * pathElement.getTotalLength());
  return { x: p.x, y: p.y };
}
