package codoc.site.privateWalks.recording;

import org.json.JSONObject;
import java.util.UUID;

/** Owns accepted samples, compact live statistics and a small pending disk batch for one walk. */
public final class RecordingSession {
    private static final long FLUSH_INTERVAL_MS = 30000;
    private final RecordingFiles files;
    private final JSONObject metadata;
    private final StringBuilder pending = new StringBuilder();
    private TrackFix previous;
    private long flushedAt;
    private int count;
    private double distance;

    /** Creates a new durable session before requesting the first location fix. */
    public RecordingSession(RecordingFiles files) throws Exception {
        this.files = files;
        metadata = new JSONObject().put("id", "walk_" + UUID.randomUUID()).put("startedAt", System.currentTimeMillis())
            .put("state", "recording").put("pointCount", 0).put("distanceMeters", 0);
        files.save(metadata);
    }

    /** Appends only validated movement and batches ordinary writes at most once per thirty seconds. */
    public void accept(TrackFix sample, long elapsedNow) throws Exception {
        if (!TrackQualityPolicy.accepts(sample, previous, elapsedNow)) return;
        if (previous != null) distance += TrackQualityPolicy.distance(previous, sample);
        previous = sample;
        count++;
        JSONObject point = new JSONObject().put("lat", sample.latitude()).put("lng", sample.longitude())
            .put("accuracy", sample.accuracy()).put("timestamp", sample.timestamp());
        pending.append(point).append('\n');
        metadata.put("pointCount", count).put("distanceMeters", distance).put("lastPoint", point);
        if (count == 1 || elapsedNow - flushedAt >= FLUSH_INTERVAL_MS) { flush(); flushedAt = elapsedNow; }
    }

    /** Returns a detached small snapshot, not the whole growing GPS journal. */
    public JSONObject snapshot() throws Exception { return new JSONObject(metadata.toString()); }

    /** Makes an explicit stop or interruption durable before releasing location updates. */
    public void finish(String state) throws Exception {
        flush();
        metadata.put("state", state).put("endedAt", System.currentTimeMillis());
        files.save(metadata);
    }

    private void flush() throws Exception {
        if (!pending.isEmpty()) { files.append(metadata.getString("id"), pending.toString()); pending.setLength(0); }
        files.save(metadata);
    }
}
