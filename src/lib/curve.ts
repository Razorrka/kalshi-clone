export interface Point {
  x: number;
  y: number;
}

export interface CurveSegment {
  cp1x: number;
  cp1y: number;
  cp2x: number;
  cp2y: number;
  x: number;
  y: number;
}

/**
 * Catmull-Rom through the given points, expressed as cubic béziers.
 *
 * The curve passes exactly through every point, so the line still reports the
 * prices it was given — this rounds the corners between samples, it does not
 * smooth the data.
 *
 * Control points are clamped to each segment's own vertical range. Plain
 * Catmull-Rom overshoots on a sharp reversal, which on a price chart would
 * draw a high the market never traded.
 */
export function smoothSegments(points: Point[], tension = 0.62): CurveSegment[] {
  const out: CurveSegment[] = [];
  if (points.length < 2) return out;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;

    const lo = Math.min(p1.y, p2.y);
    const hi = Math.max(p1.y, p2.y);
    const clamp = (v: number) => (v < lo ? lo : v > hi ? hi : v);

    out.push({
      cp1x: p1.x + ((p2.x - p0.x) / 6) * tension,
      cp1y: clamp(p1.y + ((p2.y - p0.y) / 6) * tension),
      cp2x: p2.x - ((p3.x - p1.x) / 6) * tension,
      cp2y: clamp(p2.y - ((p3.y - p1.y) / 6) * tension),
      x: p2.x,
      y: p2.y,
    });
  }
  return out;
}

/** Traces a smoothed path onto a canvas, starting at the first point. */
export function traceSmooth(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  tension?: number,
): void {
  if (points.length === 0) return;
  ctx.moveTo(points[0].x, points[0].y);
  if (points.length === 1) return;
  for (const s of smoothSegments(points, tension)) {
    ctx.bezierCurveTo(s.cp1x, s.cp1y, s.cp2x, s.cp2y, s.x, s.y);
  }
}
