import { describe, it, expect } from 'vitest';
import { formatUpdateProgress } from './appUpdate';

describe('formatUpdateProgress', () => {
  it('reports a starting message before any bytes arrive', () => {
    expect(formatUpdateProgress(0, null)).toBe('Starting download…');
  });

  it('shows a percentage once the total size is known', () => {
    const fiveMb = 5 * 1024 * 1024;
    expect(formatUpdateProgress(fiveMb / 2, fiveMb)).toBe('Downloading… 50% (2.5 / 5.0 MB)');
  });

  it('falls back to a raw MB count when the total is unknown (no Content-Length)', () => {
    const twoMb = 2 * 1024 * 1024;
    expect(formatUpdateProgress(twoMb, null)).toBe('Downloading… 2.0 MB');
  });

  it('clamps the percentage at 100 (a chunked total can overshoot slightly)', () => {
    const oneMb = 1024 * 1024;
    expect(formatUpdateProgress(oneMb * 1.1, oneMb)).toBe('Downloading… 100% (1.1 / 1.0 MB)');
  });
});
