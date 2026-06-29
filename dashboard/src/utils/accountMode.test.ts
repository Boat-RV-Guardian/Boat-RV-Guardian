import { describe, it, expect } from 'vitest';
import { cloudSwitchDiscardNote, accountModeLabel } from './accountMode';

describe('accountModeLabel', () => {
  it('reports local-only, cloud, or signed-out', () => {
    expect(accountModeLabel(false, true)).toMatch(/local-only/i);
    expect(accountModeLabel(true, true)).toMatch(/local-only/i); // local mode wins
    expect(accountModeLabel(true, false)).toMatch(/cloud/i);
    expect(accountModeLabel(false, false)).toMatch(/signed out/i);
  });
});

describe('cloudSwitchDiscardNote', () => {
  it('says nothing is lost when there are no local vehicles', () => {
    const note = cloudSwitchDiscardNote(0);
    expect(note).toMatch(/nothing is lost/i);
    expect(note).not.toMatch(/vehicle/i);
  });

  it('treats a negative/garbage count as the empty case', () => {
    expect(cloudSwitchDiscardNote(-1)).toMatch(/nothing is lost/i);
  });

  it('uses the singular for one local vehicle', () => {
    const note = cloudSwitchDiscardNote(1);
    expect(note).toMatch(/\b1 vehicle\b/);
    expect(note).not.toMatch(/1 vehicles/);
  });

  it('pluralizes and warns that local data is not uploaded', () => {
    const note = cloudSwitchDiscardNote(3);
    expect(note).toMatch(/\b3 vehicles\b/);
    expect(note).toMatch(/not uploaded automatically/i);
  });
});
