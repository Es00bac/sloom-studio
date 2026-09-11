package studio.sloom.slstapp;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.FileInputStream;
import java.io.IOException;
import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import fi.iki.elonen.NanoHTTPD;

/**
 * Serves the bundled web app over the local network so a desktop browser can open the full Signal
 * Loom interface from the phone (the "phone as host" half of the phone-as-drawing-tablet vision).
 * The web layer starts this on boot (Android only) and surfaces the URL + pairing PIN.
 *
 * <p>The data API is served over plain HTTP and secured by a pairing PIN → bearer token (see
 * {@link LanAppServer}); HTTPS was dropped because a self-signed cert only produced browser warnings
 * and never provided access control. The PIN is generated here so it can be shown on the phone.
 */
@CapacitorPlugin(name = "SignalLoomLanServer")
public class SignalLoomLanServerPlugin extends Plugin {

    private static final int DEFAULT_PORT = 8723;
    // Relayed long-poll (source-library events) holds up to ~25s on the JS side; allow generous time.
    private static final int RELAY_TIMEOUT_SECONDS = 40;
    // Video timeline ops are metadata-only and the renderer rejects JSON above the same bound. Enforce
    // it before allocating the Content-Length buffer so a paired LAN peer cannot make Android reserve
    // an unbounded byte array. Large Paper/Image bytes use their separate /asset/ routes.
    private static final int MAX_VIDEO_TIMELINE_MUTATION_BYTES = 1_500_000;
    /** Current peers route larger Source/project assets through 512 KiB idempotent chunks. */
    private static final int MAX_DIRECT_ASSET_RELAY_BYTES = 600_000;
    /** Native-side ceiling before NanoHTTPD hands a paired request to the WebView. JS routes impose
     * narrower schema/asset limits; this prevents any other route from buffering without bound. */
    private static final int MAX_RELAY_REQUEST_BYTES = 135_000_000;
    /**
     * A View.post() runnable may remain parked until an invisible/detached WebView is attached again
     * (observed on the Note9 after a longer HOME dwell). The process main looper stays runnable under
     * the foreground service, so all relay wake/evaluate work must enter through it instead.
     */
    private static final Handler MAIN_HANDLER = new Handler(Looper.getMainLooper());

    private LanAppServer server;
    private int activePort = 0;
    private String activePin = "";

    private final ConcurrentHashMap<String, CountDownLatch> pendingRequests = new ConcurrentHashMap<>();
    private final ConcurrentHashMap<String, String> responses = new ConcurrentHashMap<>();

    @PluginMethod
    public void start(PluginCall call) {
        final int port = call.getInt("port", DEFAULT_PORT);
        // An explicit fixed PIN is optional; otherwise mint a fresh 6-digit code each server session.
        final String fixedPin = call.getString("pin", "");
        final String pin = (fixedPin != null && !fixedPin.trim().isEmpty())
            ? fixedPin.trim()
            : String.format("%06d", new SecureRandom().nextInt(1_000_000));
        try {
            if (server != null) {
                server.stop();
                server = null;
            }
            final LanAppServer next = new LanAppServer(getContext(), port, pin);

            next.setProxyHandler((session, authenticatedDeviceId) -> {
                String id = UUID.randomUUID().toString();
                JSObject req = new JSObject();
                req.put("id", id);
                req.put("method", session.getMethod().name());
                // This value is derived from the native bearer-token binding, never from a browser
                // query parameter. The WebView authority uses it only for team-review authorization.
                req.put("authenticatedDeviceId", authenticatedDeviceId);
                // NanoHTTPD's getUri() strips the query string. The web handler parses cursors and
                // mutation ids out of req.path (`?since=`, `?mutation=`); without the query, long
                // polls re-send the whole event log and idempotent retry acknowledgements are lost.
                String query = session.getQueryParameterString();
                req.put("path", query != null && !query.isEmpty()
                    ? session.getUri() + "?" + query
                    : session.getUri());
                try {
                    String uri = session.getUri();
                    boolean boundedAssetPut = session.getMethod() == NanoHTTPD.Method.PUT && (
                        uri.startsWith("/__loom/api/asset/")
                            || uri.startsWith("/__loom/api/asset-upload/")
                            || (uri.startsWith("/__loom/api/project/")
                                && (uri.contains("/asset/") || uri.contains("/asset-upload/")))
                    );
                    Map<String, String> headers = session.getHeaders();
                    String contentLengthStr = headers.get("content-length");
                    if (contentLengthStr != null) {
                        int contentLength = Integer.parseInt(contentLengthStr);
                        if (contentLength < 0 || contentLength > MAX_RELAY_REQUEST_BYTES) {
                            return NanoHTTPD.newFixedLengthResponse(
                                NanoHTTPD.Response.Status.BAD_REQUEST,
                                "application/json",
                                "{\"ok\":false,\"error\":\"request-payload-too-large\"}");
                        }
                        if (session.getUri().endsWith("/project/video/mutate")
                            && contentLength > MAX_VIDEO_TIMELINE_MUTATION_BYTES) {
                            return NanoHTTPD.newFixedLengthResponse(
                                NanoHTTPD.Response.Status.BAD_REQUEST,
                                "application/json",
                                "{\"ok\":false,\"error\":\"video-payload-too-large\"}");
                        }
                        if (boundedAssetPut
                            && contentLength > MAX_DIRECT_ASSET_RELAY_BYTES) {
                            return NanoHTTPD.newFixedLengthResponse(
                                NanoHTTPD.Response.Status.BAD_REQUEST,
                                "application/json",
                                "{\"ok\":false,\"error\":\"use-chunked-asset-upload\"}");
                        }
                    }

                    // NanoHTTPD has already buffered enough of the request to parse its headers. Reading
                    // getInputStream() until Content-Length here can therefore wait forever for bytes that
                    // are already in NanoHTTPD's internal buffer (observed on Chrome/Firefox lock claims).
                    // Its supported parseBody path combines those buffered bytes with the remaining stream.
                    // POST JSON is returned as `postData`; PUT is saved to the `content` temporary-file key.
                    // Handle both or every desktop-to-phone asset PUT reaches JS with an empty body.
                    if (session.getMethod() == NanoHTTPD.Method.POST
                        || session.getMethod() == NanoHTTPD.Method.PUT) {
                        String json = readParsedRequestBody(
                            session,
                            boundedAssetPut ? MAX_DIRECT_ASSET_RELAY_BYTES : MAX_RELAY_REQUEST_BYTES
                        );
                        if (json != null) req.put("body", json);
                    }
                } catch (Exception error) {
                    return NanoHTTPD.newFixedLengthResponse(
                        NanoHTTPD.Response.Status.BAD_REQUEST,
                        "application/json",
                        "{\"ok\":false,\"error\":\"invalid-request-body\"}");
                }

                CountDownLatch latch = new CountDownLatch(1);
                pendingRequests.put(id, latch);
                dispatchLanRequest(req);

                try {
                    latch.await(RELAY_TIMEOUT_SECONDS, TimeUnit.SECONDS);
                } catch (InterruptedException ignored) { }

                // Remove membership and collect its response under the same per-key CHM lock used by
                // respond(). Whichever side wins is now final: a late WebView response can never land
                // between two cleanup operations and remain orphaned in native heap.
                final String[] responseHolder = new String[1];
                pendingRequests.compute(id, (key, pendingLatch) -> {
                    responseHolder[0] = responses.remove(key);
                    return null;
                });
                String resData = responseHolder[0];

                // CORS for these responses is applied by LanAppServer.serveApi after this returns.
                if (resData != null) {
                    return NanoHTTPD.newFixedLengthResponse(
                        NanoHTTPD.Response.Status.OK, "application/json", resData);
                }
                return NanoHTTPD.newFixedLengthResponse(
                    NanoHTTPD.Response.Status.INTERNAL_ERROR, NanoHTTPD.MIME_PLAINTEXT, "Timeout or error");
            });

            next.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false);
            server = next;
            activePort = port;
            activePin = pin;

            // Keep the native server socket alive while the app is backgrounded or the screen is
            // off. Android can still suspend a fully hidden WebView renderer; live project relays
            // are guaranteed while Sloom is visible and remain best-effort while another app owns
            // the display. Static serving and /health do not depend on the renderer.
            startKeepAliveService();

            call.resolve(state(true));
        } catch (IOException error) {
            call.reject("Failed to start LAN server on port " + port + ": " + error.getMessage());
        }
    }

    private static String readParsedRequestBody(NanoHTTPD.IHTTPSession session, int maxBytes) throws Exception {
        Map<String, String> body = new HashMap<>();
        session.parseBody(body);
        String inline = body.get("postData");
        if (inline != null) {
            if (inline.getBytes(StandardCharsets.UTF_8).length > maxBytes) {
                throw new IOException("request-payload-too-large");
            }
            return inline;
        }

        String contentPath = body.get("content");
        if (contentPath == null || contentPath.isEmpty()) return null;
        try (FileInputStream input = new FileInputStream(contentPath);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[64 * 1024];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > maxBytes) {
                    throw new IOException("request-payload-too-large");
                }
                output.write(buffer, 0, read);
            }
            return output.toString("UTF-8");
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (server != null) {
            server.stop();
            server = null;
        }
        activePort = 0;
        activePin = "";
        stopKeepAliveService();
        call.resolve(state(false));
    }

    private void startKeepAliveService() {
        try {
            Context context = getContext();
            Intent intent = new Intent(context, LanServerForegroundService.class);
            intent.putExtra(LanServerForegroundService.EXTRA_URL, "http://" + getLanIpAddress() + ":" + activePort + "/");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception error) {
            // Serving still works in the foreground without the keep-alive; never fail start() on it.
        }
        keepWebViewResponsive();
    }

    /**
     * The foreground service keeps the *process* alive, but Android still deprioritizes the
     * WebView's renderer once the app is invisible — relayed data-API calls then hit the 40s
     * latch timeout while native /health keeps answering (measured: 3/3 relay timeouts after
     * 150s of screen-off). Pin the renderer's priority for invisibility and keep the WebView
     * timers eligible to run while we're hosting. This is best-effort for a fully hidden renderer;
     * Android/WebView is allowed to defer JavaScript until the activity is visible again.
     */
    private void keepWebViewResponsive() {
        try {
            MAIN_HANDLER.post(() -> {
                try {
                    resumeWebView(getBridge().getWebView());
                } catch (Exception ignored) {
                    // The Activity may be between WebView instances during a configuration change.
                }
            });
        } catch (Exception ignored) {
        }
    }

    /**
     * A foreground service and wake lock keep the native HTTP socket alive, but an invisible Android
     * WebView may still pause again long after the activity's onPause callback. Wake it on the UI
     * thread immediately before each JS-backed relay event. Native-to-JS Capacitor messages and even
     * plugin-call responses are queued while this Android 10 WebView is invisible, so the request must
     * travel through the wake-capable evaluation itself. Base64 makes the generated program inert and
     * syntactically fixed; current clients chunk source assets so a single evaluated body stays small.
     */
    private void dispatchLanRequest(JSObject request) {
        try {
            final String requestId = request.getString("id");
            final long expiresAt = System.currentTimeMillis()
                + TimeUnit.SECONDS.toMillis(RELAY_TIMEOUT_SECONDS);
            final String encoded = Base64.encodeToString(
                request.toString().getBytes(StandardCharsets.UTF_8),
                Base64.NO_WRAP
            );
            final String script = "(()=>{const expiresAt=" + expiresAt
                + ";if(Date.now()>expiresAt)return 'sloom-relay-expired';const b=atob('" + encoded
                + "'),u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);"
                + "window.dispatchEvent(new CustomEvent('sloom-native-lan-request',{detail:JSON.parse("
                + "new TextDecoder().decode(u))}));return 'sloom-relay-dispatched';})()";
            final boolean queued = MAIN_HANDLER.post(() -> {
                try {
                    // The activity can be recreated between HTTP admission and this main-loop turn.
                    // Reacquire instead of evaluating against a destroyed view, and do not apply a
                    // mutation after the waiting HTTP request has already timed out and been removed.
                    // The evaluated program repeats the deadline check inside the renderer to close
                    // the interval where Android accepts evaluateJavascript, then defers execution.
                    if (requestId == null || !pendingRequests.containsKey(requestId)) return;
                    final android.webkit.WebView currentWebView = getBridge().getWebView();
                    resumeWebView(currentWebView);
                    currentWebView.evaluateJavascript(script, result -> {
                        if (!"\"sloom-relay-dispatched\"".equals(result)) {
                            android.util.Log.w("SloomLanRelay", "WebView relay evaluation did not complete");
                        }
                    });
                } catch (Exception error) {
                    android.util.Log.w("SloomLanRelay", "WebView relay evaluation failed", error);
                }
            });
            if (!queued) {
                android.util.Log.w("SloomLanRelay", "Main-looper relay dispatch was rejected");
            }
        } catch (Exception ignored) {
            // The waiting native request times out cleanly if the WebView is being recreated.
        }
    }

    private void resumeWebView(android.webkit.WebView webView) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            webView.setRendererPriorityPolicy(android.webkit.WebView.RENDERER_PRIORITY_IMPORTANT, false);
        }
        webView.onResume();
        webView.resumeTimers();
    }

    /** Keep WebView timers eligible during a short background transition while serving. */
    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        if (server != null) {
            keepWebViewResponsive();
        }
    }

    private void stopKeepAliveService() {
        try {
            Context context = getContext();
            context.stopService(new Intent(context, LanServerForegroundService.class));
        } catch (Exception ignored) {
        }
    }

    @PluginMethod
    public void status(PluginCall call) {
        call.resolve(state(server != null && server.isAlive()));
    }

    @PluginMethod
    public void respond(PluginCall call) {
        String id = call.getString("id");
        String data = call.getString("data");
        if (id != null) {
            // Keep response insertion atomic with the pending-request membership check. A WebView
            // response that arrives after the native 40-second timeout must not leave a multi-MB
            // orphan in `responses` forever.
            pendingRequests.computeIfPresent(id, (key, latch) -> {
                responses.put(key, data != null ? data : "null");
                latch.countDown();
                return latch;
            });
        }
        call.resolve();
    }

    private JSObject state(boolean running) {
        final String ip = getLanIpAddress();
        final JSObject result = new JSObject();
        result.put("running", running);
        result.put("port", running ? activePort : 0);
        result.put("ip", ip);
        result.put("pin", running ? activePin : "");
        result.put("url", running ? "http://" + ip + ":" + activePort + "/" : null);
        return result;
    }

    /** First non-loopback IPv4 of an up interface — the address a LAN browser should target. */
    private String getLanIpAddress() {
        try {
            for (NetworkInterface networkInterface : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (networkInterface.isLoopback() || !networkInterface.isUp()) continue;
                for (InetAddress address : Collections.list(networkInterface.getInetAddresses())) {
                    if (address instanceof Inet4Address && !address.isLoopbackAddress()) {
                        return address.getHostAddress();
                    }
                }
            }
        } catch (Exception ignored) {
            // fall through
        }
        return "127.0.0.1";
    }
}
