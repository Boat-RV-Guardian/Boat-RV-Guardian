// In-app Tauri auto-update (open-tasks Task 13, part 3). Desktop-only: the updater plugin is only
// registered on desktop (see the #[cfg(desktop)] guard in src-tauri/src/lib.rs — Android ships via
// Capacitor, not the Tauri updater, and this app doesn't ship a Tauri iOS build). On web/Capacitor,
// `check()` is never called; Settings.tsx's existing GitHub-releases-tag check is the fallback there.
//
// Lazy-imports `@tauri-apps/plugin-updater`/`plugin-process` (same pattern as the other Tauri-gated
// modules in this codebase, e.g. utils/linktapHttp.ts) so non-Tauri builds never pull them in.
import { useCallback, useState } from 'react';
import { isTauriEnv } from '../utils/linktapHttp';
import { formatUpdateProgress } from '../utils/appUpdate';

export type UpdaterStatus = 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error' | 'unsupported';

export interface AppUpdaterState {
  status: UpdaterStatus;
  version: string | null;
  progressText: string | null;
  error: string | null;
}

export interface UseAppUpdater extends AppUpdaterState {
  checkForUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
}

export function useAppUpdater(): UseAppUpdater {
  const [state, setState] = useState<AppUpdaterState>({
    status: 'idle', version: null, progressText: null, error: null,
  });
  // Holds the live Update handle between check() and downloadAndInstall() — not state, since it's
  // an opaque plugin object with methods, not data to re-render on.
  const pendingUpdate = useState<{ current: any }>(() => ({ current: null }))[0];

  const checkForUpdate = useCallback(async () => {
    if (!isTauriEnv()) { setState((s) => ({ ...s, status: 'unsupported' })); return; }
    setState((s) => ({ ...s, status: 'checking', error: null }));
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const update = await check();
      if (update) {
        pendingUpdate.current = update;
        setState({ status: 'available', version: update.version, progressText: null, error: null });
      } else {
        pendingUpdate.current = null;
        setState({ status: 'idle', version: null, progressText: null, error: null });
      }
    } catch (e: any) {
      // A real desktop build with no network / GitHub unreachable / no release published yet all land
      // here — not fatal, Settings.tsx's GitHub-tag check still gives the user *something*.
      setState({ status: 'error', version: null, progressText: null, error: e?.message || 'Update check failed' });
    }
  }, [pendingUpdate]);

  const installUpdate = useCallback(async () => {
    const update = pendingUpdate.current;
    if (!update) return;
    setState((s) => ({ ...s, status: 'downloading', progressText: 'Starting download…', error: null }));
    try {
      let downloaded = 0;
      let total: number | null = null;
      await update.downloadAndInstall((event: any) => {
        if (event.event === 'Started') total = event.data?.contentLength ?? null;
        else if (event.event === 'Progress') {
          downloaded += event.data?.chunkLength ?? 0;
          setState((s) => ({ ...s, progressText: formatUpdateProgress(downloaded, total) }));
        }
      });
      setState((s) => ({ ...s, status: 'ready', progressText: 'Update installed — restart to finish.' }));
      const { relaunch } = await import('@tauri-apps/plugin-process');
      await relaunch();
    } catch (e: any) {
      setState((s) => ({ ...s, status: 'error', error: e?.message || 'Update install failed' }));
    }
  }, [pendingUpdate]);

  return { ...state, checkForUpdate, installUpdate };
}
