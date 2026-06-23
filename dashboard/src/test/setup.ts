// Test setup: guarantee a working localStorage.
//
// The utils under test use the bare `localStorage` global. jsdom's Storage is gated behind a
// non-opaque origin and isn't reliably exposed as a global across jsdom/vitest versions, so we
// install a deterministic Map-backed Storage on both globalThis and window. Behaviour matches the
// Web Storage API for the methods the app uses (getItem/setItem/removeItem/clear/key/length).
class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() { return this.store.size; }
  clear() { this.store.clear(); }
  getItem(key: string) { return this.store.has(key) ? this.store.get(key)! : null; }
  setItem(key: string, value: string) { this.store.set(key, String(value)); }
  removeItem(key: string) { this.store.delete(key); }
  key(index: number) { return Array.from(this.store.keys())[index] ?? null; }
}

const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
}
