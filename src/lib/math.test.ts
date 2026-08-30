import { describe, expect, it } from 'vitest';
import { clamp, erf, niceStep, normCdf } from './math';

describe('normCdf', () => {
  it('matches known values of the standard normal', () => {
    // Textbook values. The A&S 7.1.26 rational approximation is accurate to
    // ~1.5e-7 absolute, not to machine precision, so 6 places is the real
    // guarantee — its coefficients sum to 1 - 1e-9 at x = 0.
    expect(normCdf(0)).toBeCloseTo(0.5, 6);
    expect(normCdf(1)).toBeCloseTo(0.841344746, 6);
    expect(normCdf(-1)).toBeCloseTo(0.158655254, 6);
    expect(normCdf(1.96)).toBeCloseTo(0.975002105, 6);
    expect(normCdf(-2.5)).toBeCloseTo(0.006209665, 6);
    expect(normCdf(3)).toBeCloseTo(0.998650102, 6);
  });

  it('is symmetric about zero', () => {
    for (const x of [0.1, 0.5, 1.3, 2.2, 4]) {
      expect(normCdf(x) + normCdf(-x)).toBeCloseTo(1, 6);
    }
  });

  it('saturates without overshooting the unit interval', () => {
    expect(normCdf(-40)).toBeGreaterThanOrEqual(0);
    expect(normCdf(40)).toBeLessThanOrEqual(1);
    expect(normCdf(12)).toBeCloseTo(1, 6);
  });
});

describe('erf', () => {
  it('is odd and bounded', () => {
    expect(erf(0)).toBeCloseTo(0, 6);
    expect(erf(0.7)).toBeCloseTo(-erf(-0.7), 12);
    expect(Math.abs(erf(6))).toBeLessThanOrEqual(1);
  });
});

describe('niceStep', () => {
  it('rounds up to a 1/2/2.5/5/10 multiple', () => {
    expect(niceStep(0.8)).toBe(1);
    expect(niceStep(1.4)).toBe(2);
    expect(niceStep(2.2)).toBe(2.5);
    expect(niceStep(4)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(140)).toBe(200);
    expect(niceStep(0.03)).toBeCloseTo(0.05, 10);
  });

  it('never returns a step of zero, so axis loops terminate', () => {
    expect(niceStep(0)).toBeGreaterThan(0);
    expect(niceStep(-5)).toBeGreaterThan(0);
    expect(niceStep(Number.NaN)).toBeGreaterThan(0);
  });

  it('always covers the requested span', () => {
    for (const raw of [0.11, 1.9, 23, 456, 7890]) {
      expect(niceStep(raw)).toBeGreaterThanOrEqual(raw);
    }
  });
});

describe('clamp', () => {
  it('bounds on both sides', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });
});
