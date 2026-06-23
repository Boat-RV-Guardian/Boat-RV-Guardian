package com.jgearinger.boatrvguardian;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Foreground service that hosts the local sensor listener in "background" mode, so flood/leak alerts
 * arrive even when the app isn't open and there's no internet. It alerts natively on each event
 * (works while the WebView/JS is suspended) and forwards events to JS when the app is alive.
 *
 * Note: closing the valve from a fully-killed app is out of scope here — that is the cloud worker's
 * job (see followups: cloud-worker valve shutoff). This service guarantees the *alert*.
 */
public class LocalServerService extends Service {

    private static final String CHANNEL_ID = "brvg_local_server";
    private static final String ALERT_CHANNEL_ID = "brvg_sensor_alerts";
    private static final int NOTIF_ID = 4242;
    private LocalHttpServer server;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        int port = intent != null ? intent.getIntExtra("port", 3030) : 3030;
        ensureChannels();

        int type = Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0;
        ServiceCompat.startForeground(this, NOTIF_ID, buildOngoingNotification(), type);

        if (server == null) {
            try {
                server = new LocalHttpServer(port, (device, event, ip) -> {
                    notifyAlert(event);                                  // native alert (JS may be asleep)
                    LocalServerPlugin.dispatchFromService(device, event, ip); // strike via JS if alive
                });
                server.startSafe();
            } catch (Exception ignored) { /* port busy / already running */ }
        }
        return START_STICKY;
    }

    private void notifyAlert(String event) {
        String e = event == null ? "" : event.toLowerCase();
        boolean floodish = e.contains("flood") || e.contains("leak") || e.contains("alarm");
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, ALERT_CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_alert)
                .setContentTitle(floodish ? "🚨 Sensor Alarm" : "Sensor alert")
                .setContentText("Local sensor event: " + (event == null ? "" : event))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true);
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify((int) (System.currentTimeMillis() & 0x0fffffff), b.build());
    }

    private void ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        nm.createNotificationChannel(new NotificationChannel(CHANNEL_ID, "Local Sensor Server", NotificationManager.IMPORTANCE_LOW));
        nm.createNotificationChannel(new NotificationChannel(ALERT_CHANNEL_ID, "Sensor Alerts", NotificationManager.IMPORTANCE_HIGH));
    }

    private Notification buildOngoingNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_menu_compass)
                .setContentTitle("Boat & RV Guardian")
                .setContentText("Listening for local sensor alerts")
                .setOngoing(true)
                .build();
    }

    @Override
    public void onDestroy() {
        if (server != null) { server.stop(); server = null; }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
