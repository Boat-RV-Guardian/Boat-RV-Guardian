// Map a worker-cached sensorState doc ({v,vraw,tC,rh,batt,event}) to the internal Shelly status
// shape the widgets read (same keys a local Shelly poll produces). Shared by ShellyWidget (detail),
// the Overview tile's status hook, and the DEMO generator so all render identically. Extracted from
// ShellyWidget so the Home tile can reuse it without importing a component into a hook.
export function mapCloudSensorDoc(role: string, d: Record<string, any>): Record<string, any> {
  const n = (x: any) => { const v = Number(x); return Number.isFinite(v) ? v : undefined; };
  const remote: any = {};
  if (d.v != null || d.vraw != null) {
    // Same `v` field, mapped to the shape each role's display reads: shore power → pm1:0.voltage,
    // DC battery/voltmeter → voltmeter:100.
    if (role === 'High Power Sensor') remote['pm1:0'] = { voltage: n(d.v) ?? n(d.vraw) };
    else remote['voltmeter:100'] = { id: 100, voltage: n(d.vraw), xvoltage: n(d.v) };
  }
  if (d.tC != null) remote['temperature:0'] = { tC: n(d.tC) };
  if (d.rh != null) remote['humidity:0'] = { rh: n(d.rh) };
  if (d.batt != null) remote['devicepower:0'] = { battery: { percent: n(d.batt) } };
  const ev = String(d.event || '');
  if (/flood|alarm|leak/i.test(ev)) remote['flood:0'] = { alarm: !/off|clear|inactive|dry/i.test(ev) };
  return remote;
}
