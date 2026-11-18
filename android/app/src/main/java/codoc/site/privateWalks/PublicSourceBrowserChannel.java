package codoc.site.privateWalks;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.util.ArrayDeque;
import java.util.Iterator;
import org.json.JSONObject;

/** Owns one cancellable browser queue; unrelated sources use separate instances. */
final class PublicSourceBrowserChannel {
    private final Activity activity;

    PublicSourceBrowserChannel(Activity activity) {
        this.activity = activity;
    }
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ArrayDeque<Job> queue = new ArrayDeque<>();
    private Job active;
    private WebView browser;
    private Runnable timeout;
    private boolean destroyed;

    private static class Job {
        final PluginCall call;
        final String id;
        final String url;
        final String method;
        final String body;
        Job(PluginCall call, String id, String url, String method, String body) {
            this.call = call; this.id = id; this.url = url; this.method = method; this.body = body;
        }
    }

    private boolean allowed(String url) {
        if (url == null) return false;
        Uri uri = Uri.parse(url);
        if (!"https".equals(uri.getScheme()) || uri.getUserInfo() != null || (uri.getPort() != -1 && uri.getPort() != 443)) return false;
        String host = uri.getHost(), path = uri.getPath();
        if (host == null || path == null) return false;
        if (host.equals("api.openstreetmap.org")) return path.equals("/api/0.6/map") && PublicSourcePolicy.isSmallMapBounds(uri.getQueryParameter("bbox"));
        if (host.equals("www.citywalls.ru")) return path.equals("/map_around.html") || path.matches("/house[0-9]+\\.html") ||
            (path.equals("/include/map_handler.php") && "load_geodata_cache".equals(uri.getQueryParameter("action")));
        if (host.equals("gorod.gov.spb.ru")) return path.equals("/public_api/maps/get_nearest/") || path.equals("/facilities/search/ajax/") || path.matches("/facilities/[0-9]+/(info/|programs/)?");
        if (host.equals("api.cian.ru")) return path.equals("/mobile-search-frontend/v1/get-results-for-map-microfrontend/");
        if (host.equals("overpass-api.de")) return path.equals("/api/interpreter") && uri.getQueryParameter("data") != null;
        if (host.equals("apidata.mos.ru")) return PublicSourcePolicy.isMoscowDatasetPath(path);
        if (host.equals("um.mos.ru")) return path.matches("/houses/[a-zA-Z0-9_-]+/") ||
            (path.equals("/api/v2/points") && "house".equals(uri.getQueryParameter("filter[type]")));
        return host.equals("www.avito.ru") && path.equals("/js/1/map/items");
    }

    public void read(PluginCall call) {
        String url = call.getString("url"), id = call.getString("requestId");
        String method = call.getString("method", "GET"), body = call.getString("body");
        boolean permitted = "GET".equals(method) ? allowed(url) : allowedSearchPost(url, body);
        if ((!"GET".equals(method) && !"POST".equals(method)) || !permitted || id == null) {
            call.reject("Unsupported public source request"); return;
        }
        ui.post(() -> {
            if (destroyed) { call.reject("Browser transport closed"); return; }
            queue.add(new Job(call, id, url, method, body));
            next();
        });
    }

    private boolean allowedSearchPost(String url, String body) {
        if (url == null || body == null || body.length() > 32768) return false;
        return url.equals("https://api.cian.ru/search-engine/v1/search-offers-mobile-site/");
    }

    private String requestOptions(Job job) {
        String headers = "{Accept:'text/html,application/json,text/plain,*/*','Accept-Language':'ru-RU,ru;q=0.9,en;q=0.5'" +
            ("POST".equals(job.method) ? ",'Content-Type':'application/json'" : "") + "}";
        String credentials = PublicSourcePolicy.credentials(Uri.parse(job.url).getHost());
        String referrer = "www.citywalls.ru".equals(Uri.parse(job.url).getHost())
            ? ",referrer:'https://www.citywalls.ru/map_around.html'" : "";
        return "{credentials:" + JSONObject.quote(credentials) + ",cache:'no-store',method:" + JSONObject.quote(job.method) +
            ",headers:" + headers + referrer + ("POST".equals(job.method) ? ",body:" + JSONObject.quote(job.body) : "") + "}";
    }

    @SuppressLint({"SetJavaScriptEnabled", "JavascriptInterface"})
    private void next() {
        if (active != null || queue.isEmpty() || destroyed) return;
        active = queue.remove();
        final Job job = active;
        browser = new WebView(activity);
        WebSettings settings = browser.getSettings();
        settings.setUserAgentString(PublicSourceUserAgent.forHost(
            Uri.parse(job.url).getHost(), settings.getUserAgentString()));
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        browser.addJavascriptInterface(new Object() {
            @JavascriptInterface
            public void complete(String requestId, int status, String body) {
                ui.post(() -> {
                    if (active != job || !job.id.equals(requestId)) return;
                    if (body.length() > 10 * 1024 * 1024) { finish(null, "Source response too large"); return; }
                    JSObject result = new JSObject();
                    result.put("status", status);
                    result.put("data", body);
                    finish(result, null);
                });
            }
        }, "PublicSourceResult");
        browser.setWebViewClient(new WebViewClient() {
            private boolean started;
            @Override
            public void onPageFinished(WebView view, String url) {
                if (started || active != job) return;
                started = true;
                // Only this application-owned script runs. Fetched HTML is never executed.
                String script = "(async function(){try{var r=await fetch(" + JSONObject.quote(job.url) +
                    "," + requestOptions(job) + ");" +
                    "var t=await r.text();PublicSourceResult.complete(" + JSONObject.quote(job.id) + ",r.status,t);" +
                    "}catch(e){PublicSourceResult.complete(" + JSONObject.quote(job.id) + ",0,'');}})();";
                view.evaluateJavascript(script, null);
            }
        });
        timeout = () -> { if (active == job) finish(null, "Source request timed out"); };
        // A Citywalls square is several megabytes; normal mobile downloads can exceed 35 seconds.
        long timeoutMillis = "www.citywalls.ru".equals(Uri.parse(job.url).getHost())
            && "/include/map_handler.php".equals(Uri.parse(job.url).getPath()) ? 75000 : 35000;
        ui.postDelayed(timeout, timeoutMillis);
        Uri source = Uri.parse(job.url);
        String origin = "https://" + source.getHost() + "/";
        browser.loadDataWithBaseURL(origin, "<!doctype html><html><body></body></html>", "text/html", "UTF-8", origin);
    }

    private void finish(JSObject result, String error) {
        Job job = active;
        if (job == null) return;
        if (timeout != null) ui.removeCallbacks(timeout);
        if (browser != null) {
            browser.stopLoading();
            browser.removeJavascriptInterface("PublicSourceResult");
            browser.destroy();
            browser = null;
        }
        active = null;
        if (error != null) job.call.reject(error); else job.call.resolve(result);
        next();
    }

    public void cancel(String id) {
        ui.post(() -> {
            Iterator<Job> iterator = queue.iterator();
            while (iterator.hasNext()) {
                Job job = iterator.next();
                if (job.id.equals(id)) { iterator.remove(); job.call.reject("Aborted"); }
            }
            if (active != null && active.id.equals(id)) finish(null, "Aborted");
        });
    }

    public void close() {
        ui.post(() -> {
            destroyed = true;
            for (Job job : queue) job.call.reject("Browser transport closed");
            queue.clear();
            finish(null, "Browser transport closed");
        });
    }
}
