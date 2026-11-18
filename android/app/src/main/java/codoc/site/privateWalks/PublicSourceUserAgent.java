package codoc.site.privateWalks;

import java.util.regex.Pattern;

/** Selects the representation containing a building passport rather than the mobile portal shell. */
public final class PublicSourceUserAgent {
    private static final String CITY_PORTAL_HOST = "gorod.gov.spb.ru";
    private static final Pattern ANDROID_PLATFORM = Pattern.compile("\\([^)]*Android[^)]*\\)");
    private static final Pattern WEBVIEW_VERSION = Pattern.compile("Version/[\\d.]+\\s+");
    private static final Pattern MOBILE_MARKER = Pattern.compile("\\bMobile\\s+");

    private PublicSourceUserAgent() {}

    /** Keeps the installed Chromium version and changes only the city portal's mobile content negotiation. */
    public static String forHost(String host, String defaultAgent) {
        if (!CITY_PORTAL_HOST.equals(host)) {
            return defaultAgent;
        }

        String desktopAgent = ANDROID_PLATFORM.matcher(defaultAgent).replaceAll("(X11; Linux x86_64)");
        desktopAgent = WEBVIEW_VERSION.matcher(desktopAgent).replaceAll("");
        return MOBILE_MARKER.matcher(desktopAgent).replaceAll("");
    }
}
