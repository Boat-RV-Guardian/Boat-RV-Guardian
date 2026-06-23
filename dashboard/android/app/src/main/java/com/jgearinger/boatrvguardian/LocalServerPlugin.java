package com.jgearinger.boatrvguardian;

import android.content.Context;
import android.content.Intent;
import android.net.wifi.WifiManager;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Capacitor bridge for the local sensor listener.
 *
 * - background=false: run the listener in-process (alive while the app is). No notification.
 * - background=true:  run it inside a foreground service (LocalServerService) so it survives the app
 *   being backgrounded, at the cost of a persistent notification. The service alerts natively even
 *   when the WebView/JS is suspended, and forwards events to JS when the app is alive.
 *
 * The Settings "Local Server Options" toggles (lt_local_server / lt_local_server_bg) drive start/stop
 * from useSensorBridge.
 */
@CapacitorPlugin(name = "LocalServer")
public class LocalServerPlugin extends Plugin {

    static LocalServerPlugin instance; // lets the foreground service reach JS while the app is alive
    private LocalHttpServer server;

    @Override
    public void load() {
        instance = this;
    }

    @PluginMethod
    public void start(PluginCall call) {
        int port = call.getInt("port", 3030);
        boolean background = Boolean.TRUE.equals(call.getBoolean("background", false));
        try {
            if (background) {
                stopInProcess(); // avoid two binds on the same port
                Intent i = new Intent(getContext(), LocalServerService.class);
                i.putExtra("port", port);
                ContextCompat.startForegroundService(getContext(), i);
            } else {
                getContext().stopService(new Intent(getContext(), LocalServerService.class));
                if (server == null) {
                    server = new LocalHttpServer(port, this::emit);
                    server.startSafe();
                }
            }
            call.resolve();
        } catch (Exception ex) {
            call.reject(ex.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        stopInProcess();
        getContext().stopService(new Intent(getContext(), LocalServerService.class));
        call.resolve();
    }

    /** The app's current LAN IPv4 (for building the local webhook URL registered on the device). */
    @PluginMethod
    public void getLocalIp(PluginCall call) {
        try {
            WifiManager wm = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            int ipInt = wm.getConnectionInfo().getIpAddress(); // little-endian
            String ip = String.format("%d.%d.%d.%d", ipInt & 0xff, (ipInt >> 8) & 0xff, (ipInt >> 16) & 0xff, (ipInt >> 24) & 0xff);
            JSObject ret = new JSObject();
            ret.put("ip", ip);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    private void stopInProcess() {
        if (server != null) {
            server.stop();
            server = null;
        }
    }

    void emit(String device, String event, String ip) {
        JSObject ret = new JSObject();
        ret.put("device", device);
        ret.put("event", event);
        ret.put("ip", ip);
        notifyListeners("shellyLocalEvent", ret);
    }

    /** Called by LocalServerService (background mode) to forward an event to JS when the app is alive. */
    static void dispatchFromService(String device, String event, String ip) {
        if (instance != null) instance.emit(device, event, ip);
    }
}
