package codoc.site.privateWalks.recording;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.location.*;
import android.os.*;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.core.location.*;
import org.json.JSONObject;

/** User-started location foreground service; does no networking and never keeps the screen awake. */
public final class WalkRecordingService extends Service {
    public static final String ACTION_START = "privatewalks.recording.START";
    public static final String ACTION_STOP = "privatewalks.recording.STOP";
    public static final String RESULT = "result";
    private static final String CHANNEL = "walk-recording";
    private static final int NOTIFICATION_ID = 2301;
    private static final long BATCH_DELAY_MS = 30000;
    private static final long MAX_SEED_AGE_MS = 60000;
    private static volatile WalkRecordingService instance;
    private RecordingSession session;
    private LocationManager locations;
    private String failure;

    private final LocationListenerCompat listener = new LocationListenerCompat() {
        @Override public void onLocationChanged(Location location) {
            try {
                TrackFix fix = new TrackFix(location.getLatitude(), location.getLongitude(), location.getAccuracy(),
                    location.getTime(), location.getElapsedRealtimeNanos() / 1000000);
                if (session != null) session.accept(fix, SystemClock.elapsedRealtime());
            } catch (Exception error) {
                failure = "Не удалось сохранить точку. Проверьте свободное место.";
                android.util.Log.e("WalkRecorder", "Unable to persist a GPS sample", error);
                stopRecording("interrupted");
            }
        }
    };

    /** Provides a compact live snapshot only while the native session is running. */
    public static JSONObject snapshot() throws Exception {
        WalkRecordingService service = instance;
        return service != null && service.session != null ? service.session.snapshot() : null;
    }

    /** Reuses the same precise one-shot position as the map pin while GNSS obtains its first native fix. */
    public static void seed(double latitude, double longitude, float accuracy, long timestamp) throws Exception {
        WalkRecordingService service = instance;
        long age = System.currentTimeMillis() - timestamp;
        if (service == null || service.session == null || age < -5000 || age > MAX_SEED_AGE_MS) return;
        if (service.session.snapshot().optInt("pointCount") > 0) return;
        long now = SystemClock.elapsedRealtime();
        service.session.accept(new TrackFix(latitude, longitude, accuracy, timestamp, now - Math.max(0, age)), now);
    }

    /** Handles explicit user actions; process death does not silently restart GPS collection. */
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent == null) { stopSelf(); return START_NOT_STICKY; }
        ResultReceiver result = receiver(intent);
        if (ACTION_STOP.equals(intent.getAction())) {
            stopRecording("stopped");
            reply(result, failure == null ? 0 : 1, failure);
            return START_NOT_STICKY;
        }
        try {
            if (session == null) begin();
            reply(result, 0, null);
        } catch (Exception error) {
            failure = "Не удалось начать запись. Проверьте точную геолокацию и настройки телефона.";
            android.util.Log.e("WalkRecorder", "Unable to start foreground recording", error);
            reply(result, 1, failure);
            stopRecording("interrupted");
        }
        return START_NOT_STICKY;
    }

    private void begin() throws Exception {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED)
            throw new SecurityException("Precise location permission required");
        locations = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (!LocationManagerCompat.isLocationEnabled(locations)) throw new IllegalStateException("Location disabled");
        startForeground(NOTIFICATION_ID, notification());
        session = new RecordingSession(new RecordingFiles(this));
        instance = this;
        LocationRequestCompat request = new LocationRequestCompat.Builder(TrackQualityPolicy.INTERVAL_MS)
            .setMinUpdateDistanceMeters(TrackQualityPolicy.MIN_DISTANCE_METERS)
            .setMaxUpdateDelayMillis(BATCH_DELAY_MS).setQuality(LocationRequestCompat.QUALITY_HIGH_ACCURACY).build();
        // Strategy: prefer the actual GNSS provider. A balanced fused request can yield only coarse fixes
        // that the walking accuracy filter correctly rejects, leaving recording waiting indefinitely.
        String provider = locations.isProviderEnabled(LocationManager.GPS_PROVIDER) ? LocationManager.GPS_PROVIDER
            : Build.VERSION.SDK_INT >= 31 && locations.hasProvider(LocationManager.FUSED_PROVIDER)
                ? LocationManager.FUSED_PROVIDER : LocationManager.NETWORK_PROVIDER;
        seedLastKnown(provider);
        LocationManagerCompat.requestLocationUpdates(locations, provider, request, listener, Looper.getMainLooper());
    }

    private void seedLastKnown(String provider) {
        try {
            Location location = locations.getLastKnownLocation(provider);
            if (location != null) seed(location.getLatitude(), location.getLongitude(), location.getAccuracy(), location.getTime());
        } catch (Exception error) { android.util.Log.i("WalkRecorder", "No usable cached starting position", error); }
    }

    private Notification notification() {
        NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(new NotificationChannel(CHANNEL,
            "Запись прогулки", NotificationManager.IMPORTANCE_LOW));
        Intent stop = new Intent(this, WalkRecordingService.class).setAction(ACTION_STOP);
        PendingIntent stopAction = PendingIntent.getService(this, 0, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent openAction = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Записываем вашу прогулку").setContentText("Путь сохраняется в телефоне. Экран можно выключить.")
            .setContentIntent(openAction).setOngoing(true).setOnlyAlertOnce(true)
            .addAction(android.R.drawable.ic_media_pause, "Остановить", stopAction).build();
    }

    private void stopRecording(String state) {
        try {
            if (locations != null) locations.removeUpdates(listener);
            if (session != null) session.finish(state);
        } catch (Exception error) {
            failure = "Не удалось завершить сохранение. Уже записанная часть пути останется в телефоне.";
            android.util.Log.e("WalkRecorder", "Unable to finalize recording", error);
        } finally {
            session = null;
            instance = null;
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
        }
    }

    private ResultReceiver receiver(Intent intent) {
        return Build.VERSION.SDK_INT >= 33 ? intent.getParcelableExtra(RESULT, ResultReceiver.class)
            : intent.getParcelableExtra(RESULT);
    }

    private void reply(ResultReceiver receiver, int code, String message) {
        if (receiver == null) return;
        Bundle bundle = new Bundle();
        if (message != null) bundle.putString("error", message);
        receiver.send(code, bundle);
    }

    /** Flushes accepted pending samples if Android tears down the service. */
    @Override public void onDestroy() {
        if (session != null) stopRecording("interrupted");
        super.onDestroy();
    }

    /** This service accepts explicit intents rather than external binding. */
    @Override public IBinder onBind(Intent intent) { return null; }
}
