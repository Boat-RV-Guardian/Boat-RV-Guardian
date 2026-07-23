import { describe, it, expect } from 'vitest';
import { sparkPaths } from './Sparkline';

describe('sparkPaths', () => {
  it('returns empty paths for fewer than 2 points', () => {
    expect(sparkPaths([], 200, 44)).toEqual({ line: '', area: '' });
    expect(sparkPaths([5], 200, 44)).toEqual({ line: '', area: '' });
  });

  it('normalizes min→bottom and max→top within padding', () => {
    const { line } = sparkPaths([0, 10], 100, 50, 2);
    // first point at min → y = 48 (h - pad); last at max → y = 2 (pad)
    expect(line).toBe('M2.00,48.00 L98.00,2.00');
  });

  it('centers a flat series instead of dividing by zero', () => {
    const { line } = sparkPaths([7, 7, 7], 100, 50, 2);
    expect(line).toContain('25.00'); // vertical middle
    expect(line).not.toContain('NaN');
  });

  it('closes the area path to the baseline', () => {
    const { area } = sparkPaths([0, 10], 100, 50, 2);
    expect(area).toBe('M2.00,48.00 L98.00,2.00 L98.00,50 L2,50 Z');
  });
});
