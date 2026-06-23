import { registerPlugin, Capacitor } from '@capacitor/core';

export interface ShellyLocalEvent {
  device: string;
  event: string;
  ip: string;
}

export interface LocalServerPluginApi {
  /** Start the local listener. background=true runs it as an Android foreground service. */
  start(opts: { port?: number; background?: boolean }): Promise<void>;
  stop(): Promise<void>;
  /** The app's current LAN IPv4 (Android), for building the local webhook URL. */
  getLocalIp(): Promise<{ ip: string }>;
  addListener(
    eventName: 'shellyLocalEvent',
    listenerFunc: (data: ShellyLocalEvent) => void,
  ): Promise<{ remove: () => void }>;
}

export const LocalServer = registerPlugin<LocalServerPluginApi>('LocalServer');

export const isAndroidNative = () =>
  Capacitor?.getPlatform?.() === 'android' && Capacitor?.isNativePlatform?.();
