package studio.sloom.slstapp;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

/**
 * Keeps the LAN app server alive while Sloom Studio is backgrounded or the screen is off.
 *
 * <p>Without this, Android freezes the app process minutes after it leaves the foreground and the
 * NanoHTTPD socket (plus the WebView that answers the relayed data-API calls) goes silent — a
 * served desktop browser mid-session just sees ERR_CONNECTION_REFUSED (docs/notes/821/822). The
 * serving toggle starts this service alongside the server and stops it when serving stops; the
 * notification doubles as the user-visible "your phone is hosting" indicator with the URL to type.
 *
 * <p>Declared as a data-sync foreground service: its entire job is keeping the cross-device
 * project-sync host reachable. Holds a partial wakelock + Wi-Fi lock so screen-off doesn't park
 * the radio between long-polls.
 */
public class LanServerForegroundService extends Service {

    public static final String EXTRA_URL = "url";
    private static final String CHANNEL_ID = "signal-loom-lan-server";
    private static final int NOTIFICATION_ID = 8723;

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        final String url = intent != null ? intent.getStringExtra(EXTRA_URL) : null;
        final Notification notification = buildNotification(url != null ? url : "your phone's address");
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
        acquireLocks();
        // Serving lifecycle is owned by the plugin — if the system kills us, don't resurrect a
        // service whose server object died with the process.
        return START_NOT_STICKY;
    }

    @Override
    public void onDestroy() {
        releaseLocks();
        super.onDestroy();
    }

    private Notification buildNotification(String url) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && manager != null) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID, "Serve to Desktop", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("Shown while Sloom Studio hosts its workspace for other devices on your network.");
            manager.createNotificationChannel(channel);
        }

        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(
            this, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0));

        Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
            ? new Notification.Builder(this, CHANNEL_ID)
            : new Notification.Builder(this);
        return builder
            .setContentTitle("Serving to desktop")
            .setContentText("Sloom Studio is available at " + url)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentIntent(tap)
            .setOngoing(true)
            .build();
    }

    private void acquireLocks() {
        if (wakeLock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SignalLoom:LanServer");
                wakeLock.setReferenceCounted(false);
                wakeLock.acquire();
            }
        }
        if (wifiLock == null) {
            WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wm != null) {
                wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "SignalLoom:LanServer");
                wifiLock.setReferenceCounted(false);
                wifiLock.acquire();
            }
        }
    }

    private void releaseLocks() {
        if (wakeLock != null) {
            if (wakeLock.isHeld()) wakeLock.release();
            wakeLock = null;
        }
        if (wifiLock != null) {
            if (wifiLock.isHeld()) wifiLock.release();
            wifiLock = null;
        }
    }
}
