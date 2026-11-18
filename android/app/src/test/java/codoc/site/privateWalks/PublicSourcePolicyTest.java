package codoc.site.privateWalks;

import org.junit.Test;
import static org.junit.Assert.*;

/** Portal requests are isolated from slow advertisements and persistent mobile session cookies. */
public class PublicSourcePolicyTest {
    @Test
    public void historyCannotWaitBehindAdvertisingRequests() {
        assertTrue(PublicSourcePolicy.isHistoryHost("www.citywalls.ru"));
        assertTrue(PublicSourcePolicy.isHistoryHost("um.mos.ru"));
        assertFalse(PublicSourcePolicy.isHistoryHost("api.cian.ru"));
        assertFalse(PublicSourcePolicy.isHistoryHost("www.avito.ru"));
        assertFalse(PublicSourcePolicy.isHistoryHost(null));
    }
    @Test
    public void mapGeometryPermitsOnlySmallFiniteReadBounds() {
        assertTrue(PublicSourcePolicy.isHouseDataHost("api.openstreetmap.org"));
        assertTrue(PublicSourcePolicy.isSmallMapBounds("30.3845,59.8574,30.3885,59.8595"));
        assertFalse(PublicSourcePolicy.isSmallMapBounds("0,0,10,10"));
        assertFalse(PublicSourcePolicy.isSmallMapBounds("NaN,0,1,1"));
        assertFalse(PublicSourcePolicy.isSmallMapBounds("30,60,29,59"));
        assertFalse(PublicSourcePolicy.isSmallMapBounds(null));
    }

    @Test
    public void moscowRepairsUseHouseChannelAndOnlyApprovedDatasetPaths() {
        assertTrue(PublicSourcePolicy.isHouseDataHost("apidata.mos.ru"));
        assertFalse(PublicSourcePolicy.isHouseDataHost("api.cian.ru"));
        assertTrue(PublicSourcePolicy.isMoscowDatasetPath("/v1/datasets/62963/rows"));
        assertFalse(PublicSourcePolicy.isMoscowDatasetPath("/v1/datasets/62963/rows/123"));
        assertFalse(PublicSourcePolicy.isMoscowDatasetPath("/v1/datasets/1/rows"));
    }

    @Test
    public void portalUsesItsOwnAnonymousChannel() {
        assertTrue(PublicSourcePolicy.isCityPortal("gorod.gov.spb.ru"));
        assertEquals("omit", PublicSourcePolicy.credentials("gorod.gov.spb.ru"));
    }

    @Test
    public void otherSourcesKeepExistingSessions() {
        for (String host : new String[]{"www.citywalls.ru", "www.avito.ru", "api.cian.ru", "apidata.mos.ru"}) {
            assertFalse(PublicSourcePolicy.isCityPortal(host));
            assertEquals("include", PublicSourcePolicy.credentials(host));
        }
    }

    @Test
    public void missingOrSimilarHostCannotSelectPortalChannel() {
        assertFalse(PublicSourcePolicy.isCityPortal(null));
        assertFalse(PublicSourcePolicy.isCityPortal("gorod.gov.spb.ru.example.org"));
    }
}
