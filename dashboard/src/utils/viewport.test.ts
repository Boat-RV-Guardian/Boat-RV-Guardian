import { describe, it, expect } from 'vitest';
import { isMobileWidth, MOBILE_BREAKPOINT } from './viewport';

describe('isMobileWidth', () => {
  it('treats widths at/below the breakpoint as mobile', () => {
    expect(isMobileWidth(320)).toBe(true);
    expect(isMobileWidth(MOBILE_BREAKPOINT)).toBe(true);
  });
  it('treats wider widths as desktop', () => {
    expect(isMobileWidth(MOBILE_BREAKPOINT + 1)).toBe(false);
    expect(isMobileWidth(1280)).toBe(false);
  });
});
