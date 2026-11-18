import java.net.HttpURLConnection;
import java.net.URI;

/** Manual smoke check using the same origin-free HTTPS protocol as the Android adapter. */
public final class ProbeCodoc {
    private static final String BASE = "https://www.codoc.site/api/journeys/";

    public static void main(String[] args) {
        for (String path : new String[]{
            "buildings/nearby?lon=30.27&lat=59.94&radiusKm=1&beforeYear=0&limit=1",
            "buildings/nearby?lon=30.27&lat=59.94&radiusKm=1&beforeYear=0&limit=200",
            "routes/places/themed?longitude=30.27&latitude=59.94&language=ru&theme=cultural&maxStops=7"
        }) {
            if (args.length > 0 && !path.endsWith("limit=1")) continue;
            check(path);
        }
    }

    private static void check(String path) {
        long started = System.nanoTime();
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) URI.create(BASE + path).toURL().openConnection();
            connection.setConnectTimeout(8000);
            connection.setReadTimeout(15000);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("User-Agent", "Dalvik/2.1.0 (Linux; U; Android 14)");
            int status = connection.getResponseCode();
            int bytes;
            try (var input = status >= 400 ? connection.getErrorStream() : connection.getInputStream()) {
                bytes = input == null ? 0 : input.readAllBytes().length;
            }
            System.out.printf("%s status=%d bytes=%d seconds=%.2f%n", path, status, bytes, (System.nanoTime() - started) / 1e9);
        } catch (Exception error) {
            System.out.printf("%s %s seconds=%.2f%n", path, error.getClass().getSimpleName(), (System.nanoTime() - started) / 1e9);
            for (int index = 0; index < Math.min(4, error.getStackTrace().length); index++) System.out.println(error.getStackTrace()[index]);
        }
        finally { if (connection != null) connection.disconnect(); }
    }
}
