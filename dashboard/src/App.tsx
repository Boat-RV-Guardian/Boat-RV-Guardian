import { useState, useEffect } from 'react';
import Home from './pages/Home';
import Dashboard from './pages/Dashboard';
import Sensors from './pages/Sensors';
import Settings from './pages/Settings';
import { usePushNotifications } from './hooks/usePushNotifications';
import { useSensorBridge } from './hooks/useSensorBridge';
import { auth, onAuthStateChanged } from './services/firebase';
import SyncModal from './components/SyncModal';
import Login from './pages/Login';
import { hasActiveVehicle, createLocalVehicle } from './utils/VehicleManager';
import { migrateAllVehiclesThresholds } from './utils/configSync';

type AppView = 'home' | 'fresh_water' | 'high_water' | 'batteries' | 'shore_power' | 'settings';

export default function App() {
  usePushNotifications();
  useSensorBridge(); // app-level: handle sleepy-sensor local webhooks regardless of active page
  const [currentView, setCurrentView] = useState<AppView>('home');
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // Onboarding gate: with no vehicle the app is locked until the user signs in (cloud vehicles
  // get adopted) or explicitly creates a local vehicle. We no longer auto-create a vehicle.
  const [hasVehicle, setHasVehicle] = useState(() => hasActiveVehicle());

  // One-time: pull pre-refresh vehicles onto the new marine/RV default thresholds (untouched values
  // only — customized ones are preserved). The active vehicle is also re-checked on every cloud pull.
  useEffect(() => { migrateAllVehiclesThresholds(); }, []);

  useEffect(() => {
    const sync = () => setHasVehicle(hasActiveVehicle());
    window.addEventListener('settings_updated', sync);
    window.addEventListener('role_updated', sync);
    return () => { window.removeEventListener('settings_updated', sync); window.removeEventListener('role_updated', sync); };
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
      setHasVehicle(hasActiveVehicle());
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
        {user ? (
          <div className="card" style={{ width: '100%', maxWidth: '420px', padding: '24px', textAlign: 'center' }}>
            <p style={{ color: 'var(--text-secondary)' }}>Setting up your vehicles… If nothing appears, create your first vehicle to get started.</p>
            <button className="btn-primary" style={{ marginTop: '12px' }} onClick={() => { createLocalVehicle(); setHasVehicle(true); }}>Create a Vehicle</button>
          </div>
        ) : (
          <div style={{ width: '100%', maxWidth: '440px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <p style={{ color: 'var(--text-secondary)', textAlign: 'center', margin: 0 }}>
              Sign in to sync your vehicles across devices, or start a local vehicle with no account.
            </p>
            <Login />
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)' }}>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} /><span style={{ fontSize: '0.8rem' }}>OR</span><div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.1)' }} />
            </div>
            <button className="btn-secondary" onClick={() => { createLocalVehicle(); setHasVehicle(true); }}>
              📱 Create a Local Vehicle (no account)
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden' }}>
      <SyncModal />
      <header style={{ padding: '20px', background: 'var(--bg-secondary)', borderBottom: '1px solid rgba(255,255,255,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px', flexShrink: 0, zIndex: 11 }}>
        <div style={{
          width: '45px',
          height: '45px',
          backgroundImage: 'url(/app_icon.jpg)',
          backgroundSize: 'cover',
          borderRadius: '10px',
          boxShadow: '0 0 10px rgba(0, 242, 254, 0.4)'
        }} />
        <div>
          <h1 style={{ margin: 0, fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.02em', background: 'linear-gradient(90deg, #fff, #00f2fe)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
            BOAT AND RV GUARDIAN
          </h1>
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Monitor and control critical systems on your Boat or RV
          </p>
        </div>
      </header>
      <nav style={{ display: 'flex', justifyContent: 'center', flexWrap: 'wrap', gap: '10px', padding: '15px', background: 'rgba(0,0,0,0.5)', borderBottom: '1px solid rgba(255,255,255,0.1)', flexShrink: 0, zIndex: 10 }}>
        <button 
          className={currentView === 'home' ? 'btn-primary' : 'btn-secondary'} 
          onClick={() => setCurrentView('home')}
          style={{ padding: '8px 16px', fontSize: '0.9rem', boxShadow: 'none' }}
        >
          📊 Dashboard
        </button>
        <button 
          className={currentView === 'fresh_water' ? 'btn-primary' : 'btn-secondary'} 
          onClick={() => setCurrentView('fresh_water')}
          style={{ padding: '8px 16px', fontSize: '0.9rem', boxShadow: 'none' }}
        >
          Fresh Water
        </button>
        <button 
          className={currentView === 'high_water' ? 'btn-primary' : 'btn-secondary'} 
          onClick={() => setCurrentView('high_water')}
          style={{ padding: '8px 16px', fontSize: '0.9rem', boxShadow: 'none' }}
        >
          High Water/Flood
        </button>
        <button 
          className={currentView === 'batteries' ? 'btn-primary' : 'btn-secondary'} 
          onClick={() => setCurrentView('batteries')}
          style={{ padding: '8px 16px', fontSize: '0.9rem', boxShadow: 'none' }}
        >
          Batteries
        </button>
        <button 
          className={currentView === 'shore_power' ? 'btn-primary' : 'btn-secondary'} 
          onClick={() => setCurrentView('shore_power')}
          style={{ padding: '8px 16px', fontSize: '0.9rem', boxShadow: 'none' }}
        >
          Shore Power
        </button>
        <button 
          className={currentView === 'settings' ? 'btn-primary' : 'btn-secondary'} 
          onClick={() => setCurrentView('settings')}
          style={{ padding: '8px 16px', fontSize: '0.9rem', boxShadow: 'none', marginLeft: 'auto' }}
        >
          ⚙️ Settings
        </button>
      </nav>

      <div style={{ flex: 1, overflowY: 'auto', position: 'relative' }}>
        {currentView === 'home' && <Home onNavigate={setCurrentView} />}
        <div style={{ display: currentView === 'fresh_water' ? 'block' : 'none', height: '100%' }}>
          <Dashboard />
        </div>
        {currentView === 'high_water' && <Sensors category="flood" />}
        {currentView === 'batteries' && <Sensors category="batteries" />}
        {currentView === 'shore_power' && <Sensors category="shore_power" />}
        {currentView === 'settings' && <Settings user={user} />}
      </div>
    </div>
  );
}
