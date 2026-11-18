package codoc.site.privateWalks.recording;

/** Immutable location sample; elapsed time keeps speed checks independent of wall-clock corrections. */
public record TrackFix(double latitude, double longitude, float accuracy, long timestamp, long elapsedMillis) {}
