package com.jgearinger.boatrvguardian;

import fi.iki.elonen.NanoHTTPD;

import java.io.IOException;
import java.util.List;
import java.util.Map;

/**
 * Tiny local HTTP listener so sleepy Shelly sensors can push events straight to this device over the
 * LAN (no internet / no Bluetooth). Mirrors the desktop Tauri axum listener on :3030, route
 * /api/shelly?vid=&device=&event=. The source IP is captured so the app can strike Shelly.GetStatus
 * back at the awake device for full telemetry.
 */
public class LocalHttpServer extends NanoHTTPD {

    public interface Listener {
        void onShellyEvent(String device, String event, String ip);
    }

    private final Listener listener;

    public LocalHttpServer(int port, Listener listener) {
        super(port);
        this.listener = listener;
    }

    public void startSafe() throws IOException {
        start(NanoHTTPD.SOCKET_READ_TIMEOUT, false);
    }

    @Override
    public Response serve(IHTTPSession session) {
        if ("/api/shelly".equals(session.getUri())) {
            Map<String, List<String>> p = session.getParameters();
            String device = firstParam(p, "device");
            String event = firstParam(p, "event");
            String ip = session.getRemoteIpAddress();
            try {
                if (listener != null) listener.onShellyEvent(device, event, ip);
            } catch (Exception ignored) { /* never fail the response */ }
        }
        return newFixedLengthResponse(Response.Status.OK, "text/plain", "OK");
    }

    private static String firstParam(Map<String, List<String>> p, String key) {
        List<String> v = p.get(key);
        return (v != null && !v.isEmpty() && v.get(0) != null) ? v.get(0) : "";
    }
}
