import { describe, it, expect, beforeEach } from 'vitest';
import {
  emptyLayout, orderDevices, isHidden, visibleDevices, hiddenDevices,
  toggleHidden, moveDevice, loadLayout, saveLayout, clearLayout, STORAGE_KEY,
} from './dashboardLayout';

const IDS = ['a', 'b', 'c', 'd'];

beforeEach(() => localStorage.clear());

describe('orderDevices', () => {
  it('keeps natural order with an empty layout', () => {
    expect(orderDevices(IDS, emptyLayout())).toEqual(IDS);
  });

  it('applies the saved order', () => {
    expect(orderDevices(IDS, { order: ['c', 'a'], hidden: [] })).toEqual(['c', 'a', 'b', 'd']);
  });

  it('skips saved ids for devices that no longer exist', () => {
    expect(orderDevices(['a', 'b'], { order: ['gone', 'b', 'a'], hidden: [] })).toEqual(['b', 'a']);
  });

  it('appends devices added since the layout was saved (never drops a new sensor)', () => {
    expect(orderDevices(['a', 'b', 'new'], { order: ['b', 'a'], hidden: [] })).toEqual(['b', 'a', 'new']);
  });

  it('ignores duplicate ids in a saved order', () => {
    expect(orderDevices(IDS, { order: ['b', 'b', 'a'], hidden: [] })).toEqual(['b', 'a', 'c', 'd']);
  });
});

describe('hiding', () => {
  it('splits visible from hidden, both ordered', () => {
    const l = { order: ['d', 'c', 'b', 'a'], hidden: ['c'] };
    expect(visibleDevices(IDS, l)).toEqual(['d', 'b', 'a']);
    expect(hiddenDevices(IDS, l)).toEqual(['c']);
  });

  it('toggles on and back off', () => {
    let l = emptyLayout();
    l = toggleHidden('b', l);
    expect(isHidden('b', l)).toBe(true);
    l = toggleHidden('b', l);
    expect(isHidden('b', l)).toBe(false);
  });

  it('a newly added device is never hidden by an old layout', () => {
    const l = { order: ['a'], hidden: ['a'] };
    expect(visibleDevices(['a', 'brand-new'], l)).toEqual(['brand-new']);
  });
});

describe('moveDevice', () => {
  it('moves a tile earlier and later among visible tiles', () => {
    const up = moveDevice('c', -1, IDS, emptyLayout());
    expect(visibleDevices(IDS, up)).toEqual(['a', 'c', 'b', 'd']);
    const down = moveDevice('a', 1, IDS, emptyLayout());
    expect(visibleDevices(IDS, down)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('is a no-op at either end', () => {
    const l = emptyLayout();
    expect(visibleDevices(IDS, moveDevice('a', -1, IDS, l))).toEqual(IDS);
    expect(visibleDevices(IDS, moveDevice('d', 1, IDS, l))).toEqual(IDS);
  });

  it('skips over a hidden tile instead of wasting the press', () => {
    // visible = a, c, d  (b hidden). Moving c up should swap it with a, not with b.
    const l = { order: [], hidden: ['b'] };
    const moved = moveDevice('c', -1, IDS, l);
    expect(visibleDevices(IDS, moved)).toEqual(['c', 'a', 'd']);
    expect(hiddenDevices(IDS, moved)).toEqual(['b']); // b stays hidden, still present
  });

  it('is a no-op for an unknown id', () => {
    expect(moveDevice('nope', 1, IDS, emptyLayout()).order).toEqual([]);
  });
});

describe('storage', () => {
  it('round-trips per vehicle and keeps vehicles independent', () => {
    saveLayout('v1', { order: ['b', 'a'], hidden: ['c'] });
    saveLayout('v2', { order: ['d'], hidden: [] });
    expect(loadLayout('v1')).toEqual({ order: ['b', 'a'], hidden: ['c'] });
    expect(loadLayout('v2')).toEqual({ order: ['d'], hidden: [] });
  });

  it('returns an empty layout for an unknown vehicle, a blank id, or corrupt storage', () => {
    expect(loadLayout('nope')).toEqual(emptyLayout());
    expect(loadLayout('')).toEqual(emptyLayout());
    localStorage.setItem(STORAGE_KEY, '{not json');
    expect(loadLayout('v1')).toEqual(emptyLayout());
  });

  it('drops non-string junk from a hand-edited layout', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ v1: { order: ['a', 3, null], hidden: 'nope' } }));
    expect(loadLayout('v1')).toEqual({ order: ['a'], hidden: [] });
  });

  it('clearLayout resets one vehicle and leaves the others', () => {
    saveLayout('v1', { order: ['b'], hidden: [] });
    saveLayout('v2', { order: ['d'], hidden: [] });
    clearLayout('v1');
    expect(loadLayout('v1')).toEqual(emptyLayout());
    expect(loadLayout('v2')).toEqual({ order: ['d'], hidden: [] });
  });
});
