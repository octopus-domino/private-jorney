package codoc.site.privateWalks;

import android.net.Uri;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/** Facade: house passports must not wait for slow property advertising requests. */
@CapacitorPlugin(name = "PublicSources")
public class PublicSourcesPlugin extends Plugin {
    private PublicSourceBrowserChannel portal;
    private PublicSourceBrowserChannel otherSources;
    private PublicSourceBrowserChannel history;
    private PublicSourceBrowserChannel catalogue;

    @Override
    public void load() {
        portal = new PublicSourceBrowserChannel(getActivity());
        otherSources = new PublicSourceBrowserChannel(getActivity());
        history = new PublicSourceBrowserChannel(getActivity());
        catalogue = new PublicSourceBrowserChannel(getActivity());
    }

    /** Routes portal reads to an independent queue without changing source URLs or cancellation IDs. */
    @PluginMethod
    public void read(PluginCall call) {
        String url = call.getString("url");
        String host = url == null ? null : Uri.parse(url).getHost();
        String path = url == null ? null : Uri.parse(url).getPath();
        boolean index = "www.citywalls.ru".equals(host) && ("/map_around.html".equals(path) || "/include/map_handler.php".equals(path));
        (index ? catalogue : PublicSourcePolicy.isHistoryHost(host) ? history
            : PublicSourcePolicy.isHouseDataHost(host) ? portal : otherSources).read(call);
    }

    /** Cancels only the matching request, regardless of its queue. */
    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("requestId");
        portal.cancel(id);
        otherSources.cancel(id);
        history.cancel(id);
        catalogue.cancel(id);
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        portal.close();
        otherSources.close();
        history.close();
        catalogue.close();
    }
}
