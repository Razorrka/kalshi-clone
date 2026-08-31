import { describe, expect, it } from 'vitest';
import { smoothSegments, type Point } from './curve';

const pts = (...ys: number[]): Point[] => ys.map((y, i) => ({ x: i * 10, y }));

describe('smoothSegments', () => {
  it('ends every segment exactly on its data point', () => {
    const input = pts(50, 20, 80, 30, 60);
    const segs = smoothSegments(input);
    expect(segs).toHaveLength(input.length - 1);
    segs.forEach((s, i) => {
      expect(s.x).toBe(input[i + 1].x);
      expect(s.y).toBe(input[i + 1].y);
    });
  });

  it('never lets a control point leave its segment, so the line cannot overshoot into a price that never traded', () => {
    // A sharp spike is where plain Catmull-Rom bulges past the data.
    const input = pts(100, 100, 20, 100, 100, 180, 100);
    smoothSegments(input).forEach((s, i) => {
      const lo = Math.min(input[i].y, input[i + 1].y);
      const hi = Math.max(input[i].y, input[i + 1].y);
      expect(s.cp1y).toBeGreaterThanOrEqual(lo);
      expect(s.cp1y).toBeLessThanOrEqual(hi);
      expect(s.cp2y).toBeGreaterThanOrEqual(lo);
      expect(s.cp2y).toBeLessThanOrEqual(hi);
    });
  });

  it('stays flat through flat data', () => {
    for (const s of smoothSegments(pts(40, 40, 40, 40, 40))) {
      expect(s.cp1y).toBeCloseTo(40, 10);
      expect(s.cp2y).toBeCloseTo(40, 10);
      expect(s.y).toBeCloseTo(40, 10);
    }
  });

  it('keeps control points between their endpoints horizontally', () => {
    const input = pts(10, 90, 20, 70, 30);
    smoothSegments(input).forEach((s, i) => {
      expect(s.cp1x).toBeGreaterThanOrEqual(input[i].x);
      expect(s.cp2x).toBeLessThanOrEqual(input[i + 1].x);
    });
  });

  it('handles degenerate input', () => {
    expect(smoothSegments([])).toEqual([]);
    expect(smoothSegments([{ x: 0, y: 0 }])).toEqual([]);
    expect(smoothSegments(pts(5, 9))).toHaveLength(1);
  });

  it('rounds corners more at higher tension, and not at all at zero', () => {
    // A sloped series: a perfect zigzag has flat tangents by symmetry, so the
    // controls sit level with their points there no matter the tension.
    const input = pts(0, 20, 60, 100);
    const none = smoothSegments(input, 0);
    // Zero tension puts both controls on the endpoints: a straight line.
    none.forEach((s, i) => {
      expect(s.cp1y).toBeCloseTo(input[i].y, 10);
      expect(s.cp2y).toBeCloseTo(input[i + 1].y, 10);
    });
    // Segment 1 runs 20 -> 60 with neighbours 0 and 100, so the tangent lifts
    // its first control to 20 + (60 - 0)/6 = 30.
    const some = smoothSegments(input, 1);
    expect(some[1].cp1y).toBeCloseTo(30, 10);
    expect(some[1].cp1y).toBeGreaterThan(none[1].cp1y);
  });
});
