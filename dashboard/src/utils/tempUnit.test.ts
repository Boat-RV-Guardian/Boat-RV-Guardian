import { describe, it, expect, beforeEach } from 'vitest';
import { resolveTempUnit, cToDisplay, tempUnitLabel } from './tempUnit';

beforeEach(() => localStorage.clear());

describe('resolveTempUnit', () => {
  it('auto-follows the volume unit system by default (imperial → °F, metric → °C)', () => {
    expect(resolveTempUnit()).toBe('f'); // lt_unit defaults imperial
    localStorage.setItem('lt_unit', 'metric');
    expect(resolveTempUnit()).toBe('c');
  });

  it('honors the device-local lt_temp_unit preference over auto', () => {
    localStorage.setItem('lt_unit', 'imperial');
    localStorage.setItem('lt_temp_unit', 'c');
    expect(resolveTempUnit()).toBe('c');
  });

  it('per-device override wins over everything', () => {
    localStorage.setItem('lt_temp_unit', 'c');
    expect(resolveTempUnit({ tempUnit: 'f' })).toBe('f');
    expect(resolveTempUnit({ tempUnit: 'c' })).toBe('c');
  });

  it("treats 'auto'/unset device + pref values as auto", () => {
    localStorage.setItem('lt_temp_unit', 'auto');
    expect(resolveTempUnit({ tempUnit: 'auto' as any })).toBe('f');
  });
});

describe('cToDisplay / tempUnitLabel', () => {
  it('converts to °F only for f', () => {
    expect(cToDisplay(0, 'f')).toBe(32);
    expect(cToDisplay(100, 'f')).toBe(212);
    expect(cToDisplay(21.5, 'c')).toBe(21.5);
  });
  it('labels', () => {
    expect(tempUnitLabel('f')).toBe('°F');
    expect(tempUnitLabel('c')).toBe('°C');
  });
});
