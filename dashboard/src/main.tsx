import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Error boundary to show crash details instead of blank screen
class ErrorBoundary extends Component<{children: any}, {error: Error | null}> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, background: '#0a0f1d', color: '#ff4444', fontFamily: 'monospace', minHeight: '100vh' }}>
          <h2 style={{ color: '#ff6666' }}>⚠️ App Error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12 }}>
            {this.state.error.message}{'\n'}{this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// Auto-connect LinkTap on app open: if cloud creds and/or a gateway IP are configured, activate
// polling so the widgets connect on startup without a manual click. Skipped only when LinkTap
// devices exist AND every one of them is disabled. Runs before render so the widgets' initial
// state already reflects the connected flags. Disable a device to opt it out of auto-connect.
try {
  const devs = JSON.parse(localStorage.getItem('lt_devices') || '[]');
  const linktaps = Array.isArray(devs) ? devs.filter((d: any) => d?.type === 'linktap_valve') : [];
  const anyEnabled = linktaps.length === 0 || linktaps.some((d: any) => d?.enabled !== false);
  if (anyEnabled) {
    if (localStorage.getItem('lt_cloud_user') && localStorage.getItem('lt_cloud_key')) {
      localStorage.setItem('lt_is_cloud_polling', 'true');
    }
    if (localStorage.getItem('lt_gateway_ip')) {
      localStorage.setItem('lt_is_local_polling', 'true');
    }
  }
} catch (e) {
  /* non-fatal: fall back to the widget's own auto-connect heuristic */
}

let root = (window as any)._reactRoot;
if (!root) {
  root = createRoot(document.getElementById('root')!);
  (window as any)._reactRoot = root;
}
root.render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

// In the native (Tauri/Capacitor) app a service worker caches stale chunks across updates, so we
// actively remove any previously-registered SW and clear its caches to always load fresh local
// assets. The web build (__WEB_PWA__) registers a real SW for offline/installability — the
// vite-plugin-pwa auto-injected registration handles that — so skip the teardown there.
if (!__WEB_PWA__) {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => regs.forEach((r) => r.unregister()))
      .catch(() => {});
  }
  if (typeof caches !== 'undefined') {
    caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
  }
}
