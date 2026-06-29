import { describe, it, expect } from 'vitest';
import { cloudSwitchDiscardNote } from './accountMode';

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
