package codoc.site.privateWalks;

/** Keeps public portal content negotiation separate from advertising sessions. */
final class PublicSourcePolicy {
    private PublicSourcePolicy() {}

    static boolean isCityPortal(String host) {
        return "gorod.gov.spb.ru".equals(host);
    }

    /** Both cities' technical house data must be independent of the advertisement queue. */
    static boolean isHouseDataHost(String host) {
        return isCityPortal(host) || "apidata.mos.ru".equals(host) || "api.openstreetmap.org".equals(host);
    }

    static boolean isMoscowDatasetPath(String path) {
        return "/v1/datasets/60562/features".equals(path)
            || "/v1/datasets/2681/rows".equals(path)
            || "/v1/datasets/62963/rows".equals(path);
    }

    /** Only a small read-only map rectangle is allowed; no editing API methods are exposed. */
    static boolean isSmallMapBounds(String bounds) {
        if (bounds == null) return false;
        String[] parts = bounds.split(",");
        if (parts.length != 4) return false;
        try {
            double west = Double.parseDouble(parts[0]), south = Double.parseDouble(parts[1]);
            double east = Double.parseDouble(parts[2]), north = Double.parseDouble(parts[3]);
            return Double.isFinite(west) && Double.isFinite(south) && Double.isFinite(east) && Double.isFinite(north)
                && west >= -180 && east <= 180 && south >= -90 && north <= 90
                && east > west && north > south && (east - west) * (north - south) <= 0.00005;
        } catch (NumberFormatException error) {
            return false;
        }
    }

    /** Public passports need no cookies; a previous mobile session must not select the mobile shell. */
    static String credentials(String host) {
        return isCityPortal(host) ? "omit" : "include";
    }
}
