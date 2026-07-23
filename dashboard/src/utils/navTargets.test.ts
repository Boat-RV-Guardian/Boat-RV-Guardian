import { describe, it, expect } from 'vitest';
import { parseViewTarget, sectionForCategory } from './navTargets';

describe('parseViewTarget', () => {
  it('maps the primary views (Systems-first IA, 2026-07-22)', () => {
    expect(parseViewTarget('systems')).toEqual({ view: 'systems', section: 'dashboard' });
    expect(parseViewTarget('dashboard')).toEqual({ view: 'systems', section: 'dashboard' });
    expect(parseViewTarget('alerts')).toEqual({ view: 'alerts' });
    expect(parseViewTarget('settings')).toEqual({ view: 'settings' });
    expect(parseViewTarget('account')).toEqual({ view: 'account' });
  });

  it('maps the legacy names forward (overview/home → Systems Dashboard)', () => {
    expect(parseViewTarget('overview')).toEqual({ view: 'systems', section: 'dashboard' });
    expect(parseViewTarget('home')).toEqual({ view: 'systems', section: 'dashboard' });
    expect(parseViewTarget('fresh_water')).toEqual({ view: 'systems', section: 'water' });
    expect(parseViewTarget('high_water')).toEqual({ view: 'systems', section: 'flood' });
    expect(parseViewTarget('batteries')).toEqual({ view: 'systems', section: 'power' });
    expect(parseViewTarget('shore_power')).toEqual({ view: 'systems', section: 'power' });
  });

  it('maps the environment category to its Systems section', () => {
    expect(parseViewTarget('environment')).toEqual({ view: 'systems', section: 'environment' });
  });

  it('returns null for unknown/empty', () => {
    expect(parseViewTarget(null)).toBeNull();
    expect(parseViewTarget('')).toBeNull();
    expect(parseViewTarget('bogus')).toBeNull();
  });
});

describe('sectionForCategory', () => {
  it('maps Overview cards to Systems sections', () => {
    expect(sectionForCategory('fresh_water')).toBe('water');
    expect(sectionForCategory('high_water')).toBe('flood');
    expect(sectionForCategory('batteries')).toBe('power');
    expect(sectionForCategory('shore_power')).toBe('power');
    expect(sectionForCategory('environment')).toBe('environment');
  });
});
