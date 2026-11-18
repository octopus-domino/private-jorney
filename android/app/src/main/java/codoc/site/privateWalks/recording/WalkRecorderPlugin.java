package codoc.site.privateWalks.recording;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.*;
import androidx.core.content.ContextCompat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import org.json.JSONObject;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Capacitor port for explicit start/stop, compact live status and durable native journals. */
@CapacitorPlugin(name = "WalkRecorder", permissions = {
    @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
    @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
})
public final class WalkRecorderPlugin extends Plugin {
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService disk = Executors.newSingleThreadExecutor();

    /** Requests location only in response to the user's recording action. */
    @PluginMethod public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") == PermissionState.PROMPT
                && getPermissionState("location") == PermissionState.GRANTED) {
            requestPermissionForAliases(new String[]{"notifications"}, call, "permissionsReady");
            return;
        }
        if (getPermissionState("location") != PermissionState.GRANTED) {
            String[] aliases = Build.VERSION.SDK_INT >= 33 ? new String[]{"location", "notifications"} : new String[]{"location"};
            requestPermissionForAliases(aliases, call, "permissionsReady");
            return;
        }
        launch(WalkRecordingService.ACTION_START, call);
    }

    @PermissionCallback private void permissionsReady(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) {
            call.reject("Для записи пути разрешите точное местоположение.");
            return;
        }
        launch(WalkRecordingService.ACTION_START, call);
    }

    /** Stops location collection before acknowledging completion to JavaScript. */
    @PluginMethod public void stop(PluginCall call) { launch(WalkRecordingService.ACTION_STOP, call); }

    /** Accepts a precise starting fix from the map's geolocation mechanism, without starting another watcher. */
    @PluginMethod public void seed(PluginCall call) {
        ui.post(() -> {
            try {
                Double latitude = call.getDouble("lat");
                Double longitude = call.getDouble("lng");
                Double accuracy = call.getDouble("accuracy");
                Double timestamp = call.getDouble("timestamp");
                if (latitude == null || longitude == null || accuracy == null || timestamp == null) {
                    call.reject("Неполные координаты начальной точки."); return;
                }
                WalkRecordingService.seed(latitude, longitude, accuracy.floatValue(), timestamp.longValue());
                call.resolve();
            } catch (Exception error) { call.reject("Не удалось принять начальную точку.", error); }
        });
    }

    /** Returns lightweight live state; full route reads are explicit, not part of each UI refresh. */
    @PluginMethod public void status(PluginCall call) {
        ui.post(() -> {
            try {
                JSONObject live = WalkRecordingService.snapshot();
                JSObject result = new JSObject();
                result.put("active", live != null);
                result.put("session", live == null ? JSONObject.NULL : live);
                call.resolve(result);
            } catch (Exception error) { call.reject("Не удалось прочитать состояние записи.", error); }
        });
    }

    /** Restores metadata for completed and interrupted recordings after process/activity recreation. */
    @PluginMethod public void list(PluginCall call) {
        disk.execute(() -> {
            try { JSObject result = new JSObject(); result.put("sessions", new RecordingFiles(getContext()).list()); call.resolve(result); }
            catch (Exception error) { call.reject("Не удалось прочитать записи.", error); }
        });
    }

    /** Loads a selected full journal off the UI thread. */
    @PluginMethod public void read(PluginCall call) {
        disk.execute(() -> {
            try { call.resolve(JSObject.fromJSONObject(new RecordingFiles(getContext()).read(call.getString("id", ""), true))); }
            catch (Exception error) { call.reject("Не удалось прочитать путь.", error); }
        });
    }

    /** Deletes native data only after the recorder has released that session. */
    @PluginMethod public void remove(PluginCall call) {
        ui.post(() -> {
            try {
                JSONObject live = WalkRecordingService.snapshot();
                String id = call.getString("id", "");
                if (live != null && live.getString("id").equals(id)) { call.reject("Сначала остановите запись."); return; }
                disk.execute(() -> removeFromDisk(id, call));
            } catch (Exception error) { call.reject("Не удалось проверить запись.", error); }
        });
    }

    private void removeFromDisk(String id, PluginCall call) {
        try { new RecordingFiles(getContext()).remove(id); call.resolve(); }
        catch (Exception error) { call.reject("Не удалось удалить запись.", error); }
    }

    private void launch(String action, PluginCall call) {
        ui.post(() -> {
            try {
                Intent intent = new Intent(getContext(), WalkRecordingService.class).setAction(action);
                intent.putExtra("gpsMode", GpsMode.from(call.getString("mode", "balanced")).id);
                intent.putExtra(WalkRecordingService.RESULT, new ResultReceiver(ui) {
                    @Override protected void onReceiveResult(int code, Bundle result) {
                        if (code == 0) call.resolve(); else call.reject(result.getString("error", "Ошибка записи."));
                    }
                });
                if (action.equals(WalkRecordingService.ACTION_START)) ContextCompat.startForegroundService(getContext(), intent);
                else getContext().startService(intent);
            } catch (Exception error) { call.reject("Не удалось запустить запись. Откройте приложение и повторите.", error); }
        });
    }

    /** Closing the activity releases plugin workers while the recording service continues independently. */
    @Override protected void handleOnDestroy() { disk.shutdown(); super.handleOnDestroy(); }
}
