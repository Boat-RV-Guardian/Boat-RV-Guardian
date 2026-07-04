import { describe, it, expect } from 'vitest';
import { isDemoMode } from './demoMode';

describe('isDemoMode', () => {
  it('is false in a normal (non-demo) build', () => {
    // Tests run without VITE_DEMO set, i.e. exactly like a production build.
    expect(isDemoMode()).toBe(false);
  });
});
