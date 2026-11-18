package codoc.site.privateWalks.recording;

/** Filters stationary GPS noise and impossible jumps before any point is written to disk. */
public final class TrackQualityPolicy {
    public static final long INTERVAL_MS = 12000;
    public static final float MIN_DISTANCE_METERS = 12;
    private static final double EARTH_RADIUS_METERS = 6371000;
    private static final float MAX_ACCURACY_METERS = 45;
    private static final long MAX_SAMPLE_AGE_MS = 60000;
    private static final double MAX_SPEED_METERS_PER_SECOND = 8;

    private TrackQualityPolicy() {}

    /** Keeps genuine movement while rejecting low-accuracy, stale, out-of-order and teleport samples. */
    public static boolean accepts(TrackFix sample, TrackFix previous, long elapsedNow) {
        if (!Double.isFinite(sample.latitude()) || !Double.isFinite(sample.longitude())) return false;
        if (Math.abs(sample.latitude()) > 90 || Math.abs(sample.longitude()) > 180) return false;
        if (!Float.isFinite(sample.accuracy()) || sample.accuracy() < 0 || sample.accuracy() > MAX_ACCURACY_METERS) return false;
        if (elapsedNow - sample.elapsedMillis() > MAX_SAMPLE_AGE_MS) return false;
        if (previous == null) return true;
        long interval = sample.elapsedMillis() - previous.elapsedMillis();
        if (interval <= 0) return false;
        double distance = distance(previous, sample);
        if (distance < Math.max(6, sample.accuracy() * 0.35)) return false;
        return distance / (interval / 1000.0) <= MAX_SPEED_METERS_PER_SECOND;
    }

    /** Computes travelled length without Android framework dependencies so policy tests run on a plain JVM. */
    public static double distance(TrackFix from, TrackFix to) {
        double dLat = Math.toRadians(to.latitude() - from.latitude());
        double dLon = Math.toRadians(to.longitude() - from.longitude());
        double value = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(Math.toRadians(from.latitude()))
            * Math.cos(Math.toRadians(to.latitude())) * Math.pow(Math.sin(dLon / 2), 2);
        return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(value)));
    }
}
