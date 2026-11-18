package codoc.site.privateWalks.recording;

/** Strategy presets apply after bounded initial acquisition, rather than changing GPS quality silently. */
public enum GpsMode {
    ECONOMY("economy", 30000, 20, 60000, 150),
    BALANCED("balanced", 10000, 8, 15000, 75),
    PRECISE("precise", 3000, 2, 0, 35);

    public final String id;
    public final long intervalMillis;
    public final float distanceMeters;
    public final long batchMillis;
    public final float maxAccuracy;

    GpsMode(String id, long intervalMillis, float distanceMeters, long batchMillis, float maxAccuracy) {
        this.id = id; this.intervalMillis = intervalMillis; this.distanceMeters = distanceMeters;
        this.batchMillis = batchMillis; this.maxAccuracy = maxAccuracy;
    }

    /** Old APK preferences and malformed bridge arguments retain the ordinary walking mode. */
    public static GpsMode from(String value) {
        for (GpsMode mode : values()) if (mode.id.equals(value)) return mode;
        return BALANCED;
    }
}
