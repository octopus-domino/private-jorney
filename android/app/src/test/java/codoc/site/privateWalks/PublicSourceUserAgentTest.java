package codoc.site.privateWalks;

import org.junit.Test;
import static org.junit.Assert.*;

/** Regression coverage for the portal redirect that replaces both JSON search and passports with /m/. */
public class PublicSourceUserAgentTest {
    private static final String MOBILE = "Mozilla/5.0 (Linux; Android 13; Pixel 5; wv) "
        + "AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36";

    @Test
    public void cityPortalRequestsDesktopRepresentationWithInstalledChromiumVersion() {
        String agent = PublicSourceUserAgent.forHost("gorod.gov.spb.ru", MOBILE);

        assertFalse(agent.contains("Android"));
        assertFalse(agent.contains("Mobile"));
        assertFalse(agent.contains("; wv"));
        assertFalse(agent.contains("Version/4.0"));
        assertTrue(agent.contains("Chrome/130.0.0.0"));
        assertTrue(agent.contains("Safari/537.36"));
    }

    @Test
    public void otherSourcesKeepTheirExistingTransportIdentity() {
        for (String host : new String[]{"www.citywalls.ru", "www.avito.ru", "api.cian.ru"}) {
            assertEquals(MOBILE, PublicSourceUserAgent.forHost(host, MOBILE));
        }
    }

    @Test
    public void tabletAndAlreadyDesktopAgentsAreSupported() {
        String tablet = MOBILE.replace(" Mobile", "");
        String desktop = PublicSourceUserAgent.forHost("gorod.gov.spb.ru", tablet);

        assertFalse(desktop.contains("Android"));
        assertEquals(desktop, PublicSourceUserAgent.forHost("gorod.gov.spb.ru", desktop));
    }
}
