package codoc.site.privateWalks.recording;

import org.junit.Test;
import static org.junit.Assert.*;

/** Exercises movement acceptance without a device or Android framework mocks. */
public class TrackQualityPolicyTest {
    private static final long NOW = 100000;
    private static final TrackFix FIRST = new TrackFix(59.94, 30.27, 8, 1000000, NOW);

    @Test public void acceptsOrdinaryWalkingMovement() {
        TrackFix next = new TrackFix(59.94015, 30.27, 8, 1012000, NOW + 12000);
        assertTrue(TrackQualityPolicy.accepts(next, FIRST, NOW + 12000));
        assertTrue(TrackQualityPolicy.distance(FIRST, next) > 15);
    }

    @Test public void selectedModeControlsAccuracyWithoutAcceptingStaleFixes() {
        TrackFix approximate = new TrackFix(59.94, 30.27, 65, 1000000, NOW);
        assertTrue(TrackQualityPolicy.accepts(approximate, null, NOW, GpsMode.BALANCED.maxAccuracy));
        assertFalse(TrackQualityPolicy.accepts(approximate, null, NOW, GpsMode.PRECISE.maxAccuracy));
        assertFalse(TrackQualityPolicy.accepts(approximate, null, NOW + 61000, GpsMode.ECONOMY.maxAccuracy));
        assertEquals(GpsMode.BALANCED, GpsMode.from(null));
        assertEquals(GpsMode.PRECISE, GpsMode.from("precise"));
    }

    @Test public void rejectsNoiseAndImpossibleJumps() {
        assertFalse(TrackQualityPolicy.accepts(new TrackFix(59.94, 30.27, 8, 1012000, NOW + 12000), FIRST, NOW + 12000));
        assertFalse(TrackQualityPolicy.accepts(new TrackFix(60.04, 30.27, 8, 1012000, NOW + 12000), FIRST, NOW + 12000));
    }

    @Test public void rejectsStaleInaccurateAndReorderedSamples() {
        assertFalse(TrackQualityPolicy.accepts(FIRST, null, NOW + 61000));
        assertFalse(TrackQualityPolicy.accepts(new TrackFix(59.94, 30.27, 60, 1000000, NOW), null, NOW));
        assertFalse(TrackQualityPolicy.accepts(FIRST, FIRST, NOW));
        assertFalse(TrackQualityPolicy.accepts(new TrackFix(Double.NaN, 30.27, 8, 1000000, NOW), null, NOW));
    }
}
