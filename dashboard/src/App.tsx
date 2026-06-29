import { useState, useEffect } from 'react';
import Home from './pages/Home';
import Systems from './pages/Systems';
import Alerts from './pages/Alerts';
import Settings from './pages/Settings';
import Account from './pages/Account';
import { usePushNotifications } from './hooks/usePushNotifications';
import { useSensorBridge } from './hooks/useSensorBridge';
import { auth, onAuthStateChanged, signOut, db, doc, setDoc, getDoc } from './services/firebase';
import { buildLoginProfile } from './utils/userProfile';
import SyncModal from './components/SyncModal';
import GlobalBar from './components/GlobalBar';
import CreateVehicleForm from './components/CreateVehicleForm';
import Login from './pages/Login';
import { hasActiveVehicle, createLocalVehicle } from './utils/VehicleManager';
import { migrateAllVehiclesThresholds } from './utils/configSync';
import { applyUserScope, enterLocalMode, exitLocalMode, isLocalMode } from './utils/userScope';
import { parseViewTarget, sectionForCategory, type AppView, type SystemsSection } from './utils/navTargets';

export default function App() {
  usePushNotifications();
  useSensorBridge(); // app-level: handle sleepy-sensor local webhooks regardless of active page
  // Deep link (web): app.boatrvguardian.com/?view=account lands on the subscription portal. The
  // native app's Plan "Upgrade/Manage" button opens that URL in the system browser.
  const initialTarget = (() => {
    try { return parseViewTarget(new URLSearchParams(window.location.search).get('view')); }
    catch { return null; }
  })();
  const [currentView, setCurrentView] = useState<AppView>(initialTarget?.view ?? 'overview');
  const [systemsSection, setSystemsSection] = useState<SystemsSection>(initialTarget?.section ?? 'water');
  // Navigate to a destination (view + optional Systems section) from one place.
  const goTo = (view: AppView, section?: SystemsSection) => { if (section) setSystemsSection(section); setCurrentView(view); };
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // Onboarding gate: with no vehicle the app is locked until the user signs in (cloud vehicles
  // get adopted) or explicitly creates a local vehicle. We no longer auto-create a vehicle.
  const [hasVehicle, setHasVehicle] = useState(() => hasActiveVehicle());
  // Local-only mode: a no-account session (synthetic owner) that NEVER syncs to the cloud. Either this
  // or cloud mode — see the "Configuration sync model" in CLAUDE.md.
  const [localMode, setLocalMode] = useState(() => isLocalMode(localStorage));

  // One-time: pull pre-refresh vehicles onto the new marine/RV default thresholds (untouched values
  // only — customized ones are preserved). The active vehicle is also re-checked on every cloud pull.
  useEffect(() => { migrateAllVehiclesThresholds(); }, []);

  useEffect(() => {
    const sync = () => setHasVehicle(hasActiveVehicle());
    window.addEventListener('settings_updated', sync);
    window.addEventListener('role_updated', sync);
    return () => { window.removeEventListener('settings_updated', sync); window.removeEventListener('role_updated', sync); };
  }, []);

  // In-app navigation requests (e.g. the Plan badge's "Upgrade" button → Account view).
  useEffect(() => {
    const go = (e: Event) => {
      const v = (e as CustomEvent).detail;
      if (typeof v !== 'string') return;
      const t = parseViewTarget(v);
      if (t) goTo(t.view, t.section);
    };
    window.addEventListener('navigate_view', go);
    return () => window.removeEventListener('navigate_view', go);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      // Per-user data isolation: if the signed-in identity changed (different user, or sign-out),
      // wipe the prior user's cached vehicles + secrets and hard-reload so no in-memory state from
      // the previous session survives. Same-user restore (incl. offline relaunch) is a no-op.
      const { wiped } = applyUserScope(currentUser?.uid ?? null, localStorage);
      if (wiped) { window.location.reload(); return; }
      setUser(currentUser);
      setLoading(false);
      setHasVehicle(hasActiveVehicle());
      // Register the signed-in user so the operator console can see every account (not just ones with
      // vehicle membership). Best-effort, additive merge; a Firestore failure here is non-fatal.
      if (currentUser) {
        const ref = doc(db, 'users', currentUser.uid);
        getDoc(ref)
          .then((snap) => setDoc(ref, buildLoginProfile(currentUser, snap.exists(), Date.now()), { merge: true }))
          .catch((e: any) => {
            // Surface a registry-write failure so a broken Firestore connection is visible, not silent.
            window.dispatchEvent(new CustomEvent('cloud_sync_error', { detail: `Account sync failed: ${e?.message || e}` }));
          });
      }
    });
    return () => unsubscribe();
  }, []);

  if (loading) {
    return <div style={{ display: 'flex', height: '100vh', justifyContent: 'center', alignItems: 'center', color: 'var(--accent)' }}>Loading...</div>;
  }

  // No vehicle yet → block the app with an onboarding screen (sign in or create a local vehicle).
  // SyncModal stays mounted so that signing in here still adopts the user's cloud vehicles.
  if (!hasVehicle) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%', width: '100%', alignItems: 'center', justifyContent: 'center', padding: '24px', gap: '20px', overflowY: 'auto' }}>
        <SyncModal />
        <div style={{ width: '60px', height: '60px', backgroundImage: 'url(/app_icon.jpg)', backgroundSize: 'cover', borderRadius: '14px', boxShadow: '0 0 14px rgba(0,242,254,0.4)' }} />
        <h1 style={{ margin: 0, fontSize: '1.5rem', textAlign: 'center', background: 'linear-gradient(90deg,#fff,#00f2fe)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Boat &amp; RV Guardian</h1>
        {(user || localMode) ? (
          <div style={{ width: '100%', maxWidth: '420px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
            <p style={{ color: 'var(--text-secondary)', textAlign: 'center', margin: 0 }}>
              {localMode
                ? 'Local-only mode — this device only, nothing syncs to the cloud. Create your first vehicle to get started.'
                : 'Setting up your vehicles… create your first vehicle to get started.'}
            </p>
            <CreateVehicleForm onCreate={(name, type) => { createLocalVehicle(name, type); setHasVehicle(true); }} />
            {localMode ? (
              <button className="btn-secondary" onClick={() => { exitLocalMode(localStorage); setLocalMode(false); setHasVehicle(false); }}>Use a cloud account instead</button>
            ) : (
              <button className="btn-secondary" onClick={() => { signOut(auth).catch(() => {}); }}>Sign out</button>
            )}
          </div>
        ) : (
          <div style={{ width: '100%', maxWidth: '440px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p style={{ color: 'var(--text-secondary)', textAlign: 'center', margin: 0 }}>
              Sign in to access your vehicles. Your data is tied to your account and synced to the cloud,
              so it’s available on any device — and never shared with anyone else on this one.
            </p>
            <Login />
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)' }}>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} /><span style={{ fontSize: '0.8rem' }}>OR</span><div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
            </div>
            <button className="btn-secondary" onClick={() => { enterLocalMode(Math.random().toString(36).slice(2, 11), localStorage); setLocalMode(true); }}>
              📱 Use this device only (local mode, no account)
            </button>
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', margin: 0, fontSize: '0.75rem' }}>
              Local mode keeps everything on this device and never syncs to the cloud. Switch to a cloud
              account any time to sync across devices.
            </p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden' }}>
      <SyncModal />
      <header style={{ padding: '14px 20px', background: 'var(--bg-secondary)', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexShrink: 0, zIndex: 11 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
          <div style={{
            width: '45px',
            height: '45px',
            flexShrink: 0,
            backgroundImage: 'url(/app_icon.jpg)',
            backgroundSize: 'cover',
            borderRadius: '10px',
            boxShadow: '0 0 10px rgba(0, 242, 254, 0.4)'
          }} />
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.02em', background: 'linear-gradient(90deg, #fff, #00f2fe)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', whiteSpace: 'nowrap' }}>
              BOAT AND RV GUARDIAN
            </h1>
            <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Monitor and control critical systems on your Boat or RV
            </p>
          </div>
        </div>
        <GlobalBar onOpenAccount={() => setCurrentView('account')} />
      </header>
      <nav style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '10px', padding: '15px', background: 'rgba(0,0,0,0.5)', borderBottom: '1px solid rgba(255,255,255,0.1)', flexShrink: 0, zIndex: 10 }}>
        {([
          { v: 'overview', label: '📊 Overview' },
          { v: 'systems', label: '🛰 Systems' },
          { v: 'alerts', label: '🔔 Alerts' },
          { v: 'settings', label: '⚙️ Settings' },
        ] as { v: AppView; label: string }[]).map((tab) => (
          <button
            key={tab.v}
            className={currentView === tab.v ? 'btn-primary' : 'btn-secondary'}
            onClick={() => setCurrentView(tab.v)}
            style={{ padding: '8px 16px', fontSize: '0.9rem', boxShadow: 'none' }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
        {currentView === 'overview' && <Home onNavigate={(cat) => goTo('systems', sectionForCategory(cat))} />}
        {/* Systems stays mounted (display:none when inactive) so the valve's Flooding Sentry keeps running. */}
        <div style={{ display: currentView === 'systems' ? 'block' : 'none', height: '100%' }}>
          <Systems active={currentView === 'systems'} section={systemsSection} onSection={setSystemsSection} />
        </div>
        {currentView === 'alerts' && <Alerts />}
        {currentView === 'settings' && <Settings user={user} />}
        {currentView === 'account' && <Account user={user} />}
      </div>
    </div>
  );
}
