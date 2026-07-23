import { describe, it, expect, beforeEach } from 'vitest';
import { DEMO_EVENTS, FIRE_ALL_IDS, demoEventById, runDemoEvent, runAllDemoEvents } from './demoEvents';
import { getDemoOverride } from './demoOverrides';

const T0 = 1_800_000_000_000;

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

const readLog = (deviceId: string) => JSON.parse(localStorage.getItem(`lt_event_log_${deviceId}`) || '[]');

describe('demo event catalog', () => {
  it('every event has a unique id, a matching override key, and a log target', () => {
    const ids = DEMO_EVENTS.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of DEMO_EVENTS) {
      expect(e.overrideKey.length).toBeGreaterThan(0);
      expect(Object.keys(e.overrideDoc).length).toBeGreaterThan(0);
      expect(e.logDeviceId.length).toBeGreaterThan(0);
    }
  });

  it('FIRE_ALL_IDS all resolve to real events', () => {
    for (const id of FIRE_ALL_IDS) expect(demoEventById(id), id).toBeDefined();
  });
});

describe('runDemoEvent', () => {
  it('pins the override and writes a log entry', () => {
    const ev = demoEventById('house-low')!;
    runDemoEvent(ev, T0);
    expect(getDemoOverride(ev.overrideKey, T0 + 1000)).toEqual(ev.overrideDoc);
    const log = readLog(ev.logDeviceId);
    expect(log[0]).toMatchObject({ ts: T0, type: 'danger' });
    expect(log[0].message).toContain('11.6');
  });

  it('flood-on sets a flood-active override that the valve seam recognizes', () => {
    const ev = demoEventById('flood-on')!;
    runDemoEvent(ev, T0);
    const ov = getDemoOverride('demo-flood', T0 + 1000)!;
    expect(/alarm on|flood/i.test(ov.event)).toBe(true);
    expect(/off|clear|inactive/i.test(ov.event)).toBe(false);
  });
});

describe('runAllDemoEvents', () => {
  it('fires one alarm per device with staggered, ordered timestamps', () => {
    runAllDemoEvents(T0);
    // an override exists for each fired event's key
    for (const id of FIRE_ALL_IDS) {
      const ev = demoEventById(id)!;
      expect(getDemoOverride(ev.overrideKey, T0 + 1000), id).not.toBeNull();
    }
    // the flood log got its entry at exactly the flood event's stagger offset
    const floodIdx = FIRE_ALL_IDS.indexOf('flood-on');
    expect(readLog('demo-flood')[0].ts).toBe(T0 + floodIdx);
  });
});
