package codoc.site.privateWalks.recording;

import android.content.Context;
import android.util.AtomicFile;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.Comparator;

/** App-private append-only journals survive activity destruction without repeatedly rewriting the full track. */
public final class RecordingFiles {
    private final File directory;

    /** Native GPS journals are excluded from cloud backup and retained until explicitly removed. */
    public RecordingFiles(Context context) throws IOException {
        directory = new File(context.getNoBackupFilesDir(), "walk-recordings");
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("Cannot create recording storage");
    }

    /** Writes compact session metadata atomically; sample data remains append-only. */
    public synchronized void save(JSONObject metadata) throws Exception {
        String id = metadata.getString("id");
        AtomicFile file = new AtomicFile(path(id, ".json"));
        FileOutputStream output = file.startWrite();
        try {
            output.write(metadata.toString().getBytes(StandardCharsets.UTF_8));
            file.finishWrite(output);
        } catch (Exception error) { file.failWrite(output); throw error; }
    }

    /** Flushes a small batch instead of rewriting every preceding GPS sample. */
    public synchronized void append(String id, String lines) throws IOException {
        try (FileOutputStream output = new FileOutputStream(path(id, ".ndjson"), true)) {
            output.write(lines.getBytes(StandardCharsets.UTF_8));
        }
    }

    /** Loads a selected recording, optionally including the full journal only when requested. */
    public synchronized JSONObject read(String id, boolean includePoints) throws Exception {
        AtomicFile file = new AtomicFile(path(id, ".json"));
        JSONObject result = new JSONObject(new String(file.readFully(), StandardCharsets.UTF_8));
        if (includePoints) result.put("points", points(id));
        return result;
    }

    /** Lists lightweight metadata for interrupted recordings and recordings stopped from a notification. */
    public synchronized JSONArray list() throws Exception {
        JSONArray result = new JSONArray();
        for (File file : metadataFiles()) {
            String id = file.getName().replace(".json", "");
            try { result.put(read(id, false)); }
            catch (Exception error) { android.util.Log.w("WalkRecorder", "Unreadable session metadata: " + id, error); }
        }
        return result;
    }

    /** Removes only a validated recording id; the active service refuses its own removal separately. */
    public synchronized void remove(String id) throws IOException {
        for (String suffix : new String[]{".json", ".ndjson"}) {
            File file = path(id, suffix);
            if (file.exists() && !file.delete()) throw new IOException("Cannot remove recording");
        }
    }

    private JSONArray points(String id) throws Exception {
        JSONArray result = new JSONArray();
        File file = path(id, ".ndjson");
        if (!file.exists()) return result;
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(new FileInputStream(file), StandardCharsets.UTF_8))) {
            for (String line; (line = reader.readLine()) != null;) {
                try { result.put(new JSONObject(line)); }
                catch (org.json.JSONException error) { android.util.Log.w("WalkRecorder", "Incomplete journal row skipped"); }
            }
        }
        return result;
    }

    private File path(String id, String suffix) {
        if (!id.matches("walk_[a-f0-9-]{36}")) throw new IllegalArgumentException("Invalid recording id");
        return new File(directory, id + suffix);
    }

    private File[] metadataFiles() {
        File[] files = directory.listFiles((dir, name) -> name.matches("walk_[a-f0-9-]{36}\\.json"));
        if (files == null) return new File[0];
        Arrays.sort(files, Comparator.comparingLong(File::lastModified).reversed());
        return files;
    }

}
