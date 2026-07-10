import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Stub the network + auth seams so we can assert routing/gating without a backend.
const mocks = vi.hoisted(() => ({
  auth: { currentUser: null as null | { getIdToken: () => Promise<string> } },
  sendLinkTapControl: vi.fn(async () => ({ ok: true } as { ok: boolean; error?: string })),
  unifiedFetch: vi.fn(async () => ({ ok: true, status: 200 })),
  getActiveVehicleId: vi.fn(() => 'v_test'),
}));

vi.mock('../services/firebase', () => ({ auth: mocks.auth }));
vi.mock('../utils/linktapControl', () => ({ sendLinkTapControl: mocks.sendLinkTapControl }));
vi.mock('../utils/linktapHttp', () => ({ unifiedFetch: mocks.unifiedFetch }));
vi.mock('../utils/VehicleManager', () => ({ getActiveVehicleId: mocks.getActiveVehicleId }));

import { useLinkTapCommands, type LinkTapCommandsConfig } from './useLinkTapCommands';

function makeCfg(over: Partial<LinkTapCommandsConfig> = {}): LinkTapCommandsConfig & { addLog: ReturnType<typeof vi.fn> } {
  return {
    gatewayIp: '172.31.0.244',
    gatewayId: 'GW1',
    deviceId: 'DEV1',
    effectiveIntervalSecs: 5,
    canControl: true,
    canRemoteControl: true,
    addLog: vi.fn(),
    setErrorMsg: vi.fn(),
    setTargetDuration: vi.fn(),
    setTargetVolume: vi.fn(),
    setVolume: vi.fn(),
    setVolumeOffset: vi.fn(),
    setDurationOffset: vi.fn(),
    requestRefresh: vi.fn(),
    ...over,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.currentUser = null;
  localStorage.clear();
});

describe('useLinkTapCommands — monitor-role gating (Task 2)', () => {
  it('blocks a monitor user from starting the valve (no command sent)', async () => {
    const cfg = makeCfg({ canControl: false });
    const { result } = renderHook(() => useLinkTapCommands(cfg));
    await act(async () => { result.current.executeStartCommand(15, 50); });
    expect(cfg.addLog).toHaveBeenCalledWith('warning', expect.stringContaining('Monitor-only'));
    expect(mocks.sendLinkTapControl).not.toHaveBeenCalled();
    expect(mocks.unifiedFetch).not.toHaveBeenCalled();
  });

  it('blocks a monitor user from a MANUAL stop', async () => {
    const cfg = makeCfg({ canControl: false });
    const { result } = renderHook(() => useLinkTapCommands(cfg));
    await act(async () => { await result.current.executeStopCommand('manual'); });
    expect(cfg.addLog).toHaveBeenCalledWith('warning', expect.stringContaining('Monitor-only'));
    expect(mocks.unifiedFetch).not.toHaveBeenCalled();
  });

  it("still allows a 'limit' (automation/safety) stop for a monitor user", async () => {
    const cfg = makeCfg({ canControl: false });
    const { result } = renderHook(() => useLinkTapCommands(cfg));
    await act(async () => { await result.current.executeStopCommand('limit'); });
    // local-only path (no signed-in user): straight to the LAN gateway, cmd 7
    expect(mocks.unifiedFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((mocks.unifiedFetch.mock.calls[0] as any)[1].body);
    expect(body.cmd).toBe(7);
  });
});

describe('useLinkTapCommands — command routing', () => {
  it('local-only start goes straight to the LAN gateway with duration+volume limits', async () => {
    const cfg = makeCfg();
    const { result } = renderHook(() => useLinkTapCommands(cfg));
    await act(async () => { await result.current.executeStartCommandRaw(15, 50); });
    expect(mocks.sendLinkTapControl).not.toHaveBeenCalled(); // signed out → no cloud attempt
    expect(mocks.unifiedFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mocks.unifiedFetch.mock.calls[0] as any;
    expect(url).toBe('http://172.31.0.244/api.shtml');
    const body = JSON.parse(init.body);
    // SAFETY: the open command must always carry the limits (never weaken this)
    expect(body).toMatchObject({ cmd: 6, gw_id: 'GW1', dev_id: 'DEV1', duration: 900, volume_limit: 50 });
  });

  it('signed-in start prefers the role-checked /api/control and skips the LAN when it succeeds', async () => {
    mocks.auth.currentUser = { getIdToken: async () => 'tok' };
    const cfg = makeCfg();
    const { result } = renderHook(() => useLinkTapCommands(cfg));
    await act(async () => { await result.current.executeStartCommandRaw(10, 30); });
    expect(mocks.sendLinkTapControl).toHaveBeenCalledTimes(1);
    const [, token, vid, action, secs] = mocks.sendLinkTapControl.mock.calls[0] as any;
    expect([token, vid, action, secs]).toEqual(['tok', 'v_test', 'open', 600]);
    expect(mocks.unifiedFetch).not.toHaveBeenCalled();
  });

  it('falls back to the LAN gateway when cloud control fails', async () => {
    mocks.auth.currentUser = { getIdToken: async () => 'tok' };
    mocks.sendLinkTapControl.mockResolvedValueOnce({ ok: false, error: 'nope' });
    const cfg = makeCfg();
    const { result } = renderHook(() => useLinkTapCommands(cfg));
    await act(async () => { await result.current.executeStopCommand('manual'); });
    expect(mocks.sendLinkTapControl).toHaveBeenCalledTimes(1);
    expect(mocks.unifiedFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse((mocks.unifiedFetch.mock.calls[0] as any)[1].body);
    expect(body.cmd).toBe(7);
  });

  it('Task 6: without canRemoteControl a signed-in start skips the cloud relay (LAN only)', async () => {
    mocks.auth.currentUser = { getIdToken: async () => 'tok' };
    const cfg = makeCfg({ canRemoteControl: false });
    const { result } = renderHook(() => useLinkTapCommands(cfg));
    await act(async () => { await result.current.executeStartCommandRaw(15, 50); });
    expect(mocks.sendLinkTapControl).not.toHaveBeenCalled();
    expect(cfg.addLog).toHaveBeenCalledWith('info', expect.stringContaining('Remote (off-LAN) control'));
    expect(mocks.unifiedFetch).toHaveBeenCalledTimes(1); // LAN path still works (local is free)
    expect(JSON.parse((mocks.unifiedFetch.mock.calls[0] as any)[1].body).cmd).toBe(6);
  });

  it('Task 6: without canRemoteControl a MANUAL stop skips the cloud relay (LAN only)', async () => {
    mocks.auth.currentUser = { getIdToken: async () => 'tok' };
    const cfg = makeCfg({ canRemoteControl: false });
    const { result } = renderHook(() => useLinkTapCommands(cfg));
    await act(async () => { await result.current.executeStopCommand('manual'); });
    expect(mocks.sendLinkTapControl).not.toHaveBeenCalled();
    expect(JSON.parse((mocks.unifiedFetch.mock.calls[0] as any)[1].body).cmd).toBe(7);
  });

  it("Task 6: a SAFETY 'limit' stop still uses the cloud relay even without canRemoteControl", async () => {
    mocks.auth.currentUser = { getIdToken: async () => 'tok' };
    const cfg = makeCfg({ canRemoteControl: false });
    const { result } = renderHook(() => useLinkTapCommands(cfg));
    await act(async () => { await result.current.executeStopCommand('limit'); });
    expect(mocks.sendLinkTapControl).toHaveBeenCalledTimes(1); // safety tries every channel
    const [, , , action] = mocks.sendLinkTapControl.mock.calls[0] as any;
    expect(action).toBe('close');
  });

  it('surfaces an error (and unlocks) when cloud fails and no gateway IP is configured', async () => {
    const cfg = makeCfg({ gatewayIp: '' });
    const { result } = renderHook(() => useLinkTapCommands(cfg));
    await act(async () => { await result.current.executeStartCommandRaw(5, 10); });
    expect(cfg.setErrorMsg).toHaveBeenCalledWith(expect.stringContaining('no Local Gateway IP'));
    expect(result.current.isCommandLoading).toBe(false);
    expect(result.current.expectedWateringStateRef.current).toBeNull();
  });
});
