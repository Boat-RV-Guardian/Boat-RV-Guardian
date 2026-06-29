import { describe, it, expect } from 'vitest';
import { vehiclesToPrune } from './vehiclePrune';

const S = (...xs: string[]) => new Set(xs);

describe('vehiclesToPrune', () => {
  it('prunes local vehicles the cloud no longer lists', () => {
    // local has v1 (in cloud) + v2, v3 (deleted in cloud) → prune v2, v3
    expect(vehiclesToPrune(['v1', 'v2', 'v3'], S('v1'), S())).toEqual(['v2', 'v3']);
  });

  it('keeps everything when the cloud lists them all', () => {
    expect(vehiclesToPrune(['v1', 'v2'], S('v1', 'v2'), S())).toEqual([]);
  });

  it('protects vehicles created this session (not yet pushed)', () => {
    // v2 is brand-new (not in cloud yet) but created this session → must NOT be pruned
    expect(vehiclesToPrune(['v1', 'v2'], S('v1'), S('v2'))).toEqual([]);
  });

  it('does not prune tombstoned ids (already being removed)', () => {
    expect(vehiclesToPrune(['v1', 'v2'], S('v1'), S(), ['v2'])).toEqual([]);
  });

  it('prunes all local when the cloud has none (e.g. user fully deleted elsewhere)', () => {
    expect(vehiclesToPrune(['v1', 'v2'], S(), S())).toEqual(['v1', 'v2']);
  });
});
