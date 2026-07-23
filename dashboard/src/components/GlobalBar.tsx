import { useState, useEffect, useRef } from 'react';
import { getVehiclesMap, getActiveVehicleId, switchVehicle } from '../utils/VehicleManager';
import { vehicleSwitcherItems, activeVehicleLabel, vehicleTypeIcon, type VehicleSwitcherItem } from '../utils/vehicleSwitcher';

// Global context bar (Task 16 IA migration, step 1): the active-vehicle switcher + an account button.
// The active vehicle is the most important piece of global context in this per-vehicle product, so it
// lives here rather than buried in Settings → Vehicles. Logic is the pure utils/vehicleSwitcher; this
// owns the dropdown + reacts to settings_updated (switchVehicle dispatches it).

export default function GlobalBar() {
  const [items, setItems] = useState<VehicleSwitcherItem[]>(() => vehicleSwitcherItems(getVehiclesMap(), getActiveVehicleId()));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const refresh = () => setItems(vehicleSwitcherItems(getVehiclesMap(), getActiveVehicleId()));
    window.addEventListener('settings_updated', refresh);
    window.addEventListener('tier_updated', refresh);
    return () => { window.removeEventListener('settings_updated', refresh); window.removeEventListener('tier_updated', refresh); };
  }, []);

  // Close the dropdown on an outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (id: string) => {
    setOpen(false);
    if (id !== getActiveVehicleId()) switchVehicle(id); // backs up current, loads target, fires settings_updated
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      {/* Vehicle switcher — ALWAYS opens on click (owner request 2026-07-22: a single-vehicle chip
          used to be a silent dead click). With one vehicle the menu still shows it (with the ✓) plus
          a "Manage vehicles" entry into Settings, so the click always does something. */}
      <div ref={ref} style={{ position: 'relative' }}>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label="Switch vehicle"
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={items.length === 0}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: '#fff', borderRadius: '8px', padding: '6px 12px', cursor: 'pointer', fontSize: '0.85rem', maxWidth: '220px' }}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeVehicleLabel(items)}</span>
          <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>▾</span>
        </button>
        {open && (
          <div role="listbox" style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, minWidth: '220px', background: 'var(--bg-secondary, #11161c)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)', zIndex: 50, overflow: 'hidden' }}>
            {items.map((it) => (
              <button
                key={it.id}
                role="option"
                aria-selected={it.active}
                onClick={() => pick(it.id)}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', textAlign: 'left', background: it.active ? 'rgba(0,242,254,0.12)' : 'transparent', border: 'none', color: '#fff', padding: '10px 12px', cursor: 'pointer', fontSize: '0.85rem' }}
              >
                <span>{vehicleTypeIcon(it.type)}</span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.name}</span>
                {it.active && <span style={{ color: 'var(--accent-cyan)', fontSize: '0.8rem' }}>✓</span>}
              </button>
            ))}
            {items.length === 1 && (
              <div style={{ padding: '4px 12px 8px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                Only one vehicle is assigned to this account.
              </div>
            )}
            <button
              onClick={() => { setOpen(false); window.dispatchEvent(new CustomEvent('navigate_view', { detail: 'settings' })); }}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderTop: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-secondary)', padding: '10px 12px', cursor: 'pointer', fontSize: '0.82rem' }}
            >
              <span>⚙️</span><span>Manage vehicles…</span>
            </button>
          </div>
        )}
      </div>

    </div>
  );
}
