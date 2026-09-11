package studio.sloom.slstapp;

import android.content.Context;
import android.content.res.AssetManager;

import java.io.IOException;
import java.io.InputStream;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import fi.iki.elonen.NanoHTTPD;

/**
 * Tiny LAN web server that streams the bundled web app (android/app/src/main/assets/public,
 * the same Vite build the WebView loads) over plain HTTP, so a desktop browser on the same network
 * can open the full Sloom Studio interface from the phone. The served app runs in plain "web" mode
 * (no Capacitor bridge), which matches the Chrome build used for tests.
 *
 * <p><b>Security without HTTPS.</b> Self-signed TLS was dropped on purpose: a self-signed cert for a
 * phone's LAN IP forces the desktop browser through a full-page "Your connection is not private"
 * warning and breaks fetch/long-poll, and it never provided <i>access control</i> anyway (only
 * transport encryption). On a home LAN the real threat is an <i>unauthorised reader</i>, so the data
 * API (<code>/__loom/api/*</code>) is gated by a <b>pairing PIN → server-issued bearer bound to one
 * registered device</b> and <b>same-origin-only CORS</b>. The static app shell stays open (it's just
 * the bundle; it carries no data and is what renders the pairing prompt). This is auth that works
 * over plain HTTP. See
 * {@code docs/notes/724-shared-state-design.md} §5 and {@code docs/notes/756-*}.
 */
public class LanAppServer extends NanoHTTPD {

    private static final String ROOT = "public";
    private static final String API_PREFIX = "/__loom/api/";
    private static final String LEGACY_API_PREFIX = "/api/";
    private static final Pattern PIN_FIELD = Pattern.compile("\"pin\"\\s*:\\s*\"([^\"]*)\"");
    private static final Pattern DEVICE_ID_FIELD = Pattern.compile("\"deviceId\"\\s*:\\s*\"([A-Za-z0-9._:-]{1,300})\"");
    private static final Pattern DEVICE_PROOF_FIELD = Pattern.compile("\"deviceProof\"\\s*:\\s*\"([A-Za-z0-9._:-]{1,300})\"");

    // Brute-force lockout for the pairing endpoint. A 6-digit PIN has 10^6 combinations; capping
    // attempts to MAX_PAIR_ATTEMPTS per PAIR_LOCK_MS window makes exhausting it on a LAN infeasible,
    // and the PIN is regenerated every time the server restarts anyway.
    private static final int MAX_PAIR_ATTEMPTS = 5;
    private static final long PAIR_LOCK_MS = 30_000L;

    private final AssetManager assets;
    private final String pairingPin;
    private final LanSessionDeviceBindings sessionDevices = new LanSessionDeviceBindings();
    private final SecureRandom random = new SecureRandom();

    private int failedPairAttempts = 0;
    private long pairLockUntilMs = 0L;

    public interface ProxyHandler {
        Response handleApiRequest(IHTTPSession session, String authenticatedDeviceId);
    }
    private ProxyHandler proxyHandler;

    public LanAppServer(Context context, int port, String pairingPin) {
        super(port);
        this.assets = context.getApplicationContext().getAssets();
        this.pairingPin = pairingPin != null ? pairingPin.trim() : "";
    }

    public void setProxyHandler(ProxyHandler handler) {
        this.proxyHandler = handler;
    }

    @Override
    public Response serve(IHTTPSession session) {
        String rawPath = session.getUri();
        int query = rawPath.indexOf('?');
        String path = query >= 0 ? rawPath.substring(0, query) : rawPath;
        boolean isApi = path.startsWith(API_PREFIX) || path.startsWith(LEGACY_API_PREFIX);

        // CORS preflight: same-origin only for the data API; the static shell stays open.
        if (session.getMethod() == Method.OPTIONS) {
            Response r = newFixedLengthResponse(Response.Status.OK, MIME_PLAINTEXT, "");
            if (isApi) {
                applyApiCors(r, session);
            } else {
                r.addHeader("Access-Control-Allow-Origin", "*");
            }
            return r;
        }

        if (isApi) {
            return serveApi(session, path);
        }
        return serveStatic(path);
    }

    private Response serveApi(IHTTPSession session, String path) {
        // Health is the open probe — it reveals only the app identity and that auth is required.
        if (path.equals(API_PREFIX + "health") || path.equals(LEGACY_API_PREFIX + "health")) {
            Response r = newFixedLengthResponse(
                Response.Status.OK,
                "application/json",
                "{\"name\":\"Sloom Studio\",\"authRequired\":true,\"collaborationMode\":\"simultaneous\"}");
            applyApiCors(r, session);
            return r;
        }

        // Pairing: trade the phone-displayed PIN plus browser-held registration proof for a server-bound
        // session token. No HTTPS required.
        if (path.equals(API_PREFIX + "pair") || path.equals(LEGACY_API_PREFIX + "pair")) {
            return handlePair(session);
        }

        // Every other data-API call requires a valid bearer token bound to one paired device.
        String authenticatedDeviceId = authenticatedDeviceId(session);
        if (authenticatedDeviceId == null) {
            Response r = newFixedLengthResponse(
                Response.Status.UNAUTHORIZED, "application/json", "{\"error\":\"unauthorized\"}");
            applyApiCors(r, session);
            return r;
        }

        Response r = proxyHandler != null
            ? proxyHandler.handleApiRequest(session, authenticatedDeviceId)
            : newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "API not available");
        applyApiCors(r, session);
        return r;
    }

    private synchronized Response handlePair(IHTTPSession session) {
        long now = System.currentTimeMillis();
        if (now < pairLockUntilMs) {
            Response r = newFixedLengthResponse(
                Response.Status.UNAUTHORIZED, "application/json", "{\"error\":\"locked\"}");
            applyApiCors(r, session);
            return r;
        }

        String submitted = "";
        String deviceId = "";
        String deviceProof = "";
        try {
            Map<String, String> body = new HashMap<>();
            session.parseBody(body);
            String json = body.get("postData");
            if (json != null) {
                Matcher m = PIN_FIELD.matcher(json);
                if (m.find()) submitted = m.group(1);
                Matcher deviceIdMatcher = DEVICE_ID_FIELD.matcher(json);
                if (deviceIdMatcher.find()) deviceId = deviceIdMatcher.group(1);
                Matcher deviceProofMatcher = DEVICE_PROOF_FIELD.matcher(json);
                if (deviceProofMatcher.find()) deviceProof = deviceProofMatcher.group(1);
            }
        } catch (Exception ignored) {
            // treat as a failed attempt below
        }

        Response r;
        if (!pairingPin.isEmpty() && submitted.equals(pairingPin)) {
            String token = newToken();
            if (sessionDevices.bind(token, deviceId, deviceProof)) {
                failedPairAttempts = 0;
                r = newFixedLengthResponse(
                    Response.Status.OK, "application/json", "{\"token\":\"" + token + "\"}");
            } else {
                r = newFixedLengthResponse(
                    Response.Status.FORBIDDEN, "application/json", "{\"error\":\"device-binding-refused\"}");
            }
        } else {
            failedPairAttempts++;
            if (failedPairAttempts >= MAX_PAIR_ATTEMPTS) {
                pairLockUntilMs = now + PAIR_LOCK_MS;
                failedPairAttempts = 0;
            }
            r = newFixedLengthResponse(
                Response.Status.UNAUTHORIZED, "application/json", "{\"error\":\"bad_pin\"}");
        }
        applyApiCors(r, session);
        return r;
    }

    private String authenticatedDeviceId(IHTTPSession session) {
        String auth = session.getHeaders().get("authorization");
        if (auth == null) return null;
        String trimmed = auth.trim();
        if (trimmed.length() < 7 || !trimmed.substring(0, 7).equalsIgnoreCase("bearer ")) return null;
        String token = trimmed.substring(7).trim();
        return token.isEmpty() ? null : sessionDevices.deviceForToken(token);
    }

    private String newToken() {
        byte[] bytes = new byte[32];
        random.nextBytes(bytes);
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    /**
     * Same-origin-only CORS for the data API: echo the request Origin <i>only</i> when its host:port
     * equals our own Host header. A cross-origin web page therefore gets no allow-origin header and the
     * browser blocks it from reading any project data, even though the page can't forge the token. The
     * legit served app is same-origin, so it needs no CORS at all — this is purely a cross-origin lock.
     */
    private void applyApiCors(Response r, IHTTPSession session) {
        if (r == null) return;
        Map<String, String> headers = session.getHeaders();
        String origin = headers.get("origin");
        String host = headers.get("host");
        if (origin != null && host != null) {
            String originHostPort = origin.replaceFirst("^https?://", "");
            if (originHostPort.equals(host)) {
                r.addHeader("Access-Control-Allow-Origin", origin);
                r.addHeader("Vary", "Origin");
                r.addHeader("Access-Control-Allow-Credentials", "true");
            }
        }
        r.addHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
        r.addHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
    }

    private Response serveStatic(String path) {
        if (path.isEmpty() || path.equals("/")) path = "/index.html";

        // No path traversal out of the asset root.
        if (path.contains("..")) {
            return newFixedLengthResponse(Response.Status.FORBIDDEN, MIME_PLAINTEXT, "Forbidden");
        }

        final String assetPath = ROOT + path;
        try {
            final InputStream stream = assets.open(assetPath);
            final Response response = newChunkedResponse(Response.Status.OK, mimeFor(path), stream);
            response.addHeader("Access-Control-Allow-Origin", "*");
            response.addHeader("Cache-Control", "no-cache");
            return response;
        } catch (IOException missing) {
            // SPA fallback: serve index.html for extension-less route paths, 404 for missing assets
            // (so a missing .js never returns HTML and breaks module loading).
            final String leaf = path.substring(path.lastIndexOf('/') + 1);
            if (!leaf.contains(".")) {
                try {
                    final InputStream index = assets.open(ROOT + "/index.html");
                    final Response response = newChunkedResponse(Response.Status.OK, "text/html", index);
                    response.addHeader("Access-Control-Allow-Origin", "*");
                    return response;
                } catch (IOException ignored) {
                    // fall through to 404
                }
            }
            return newFixedLengthResponse(Response.Status.NOT_FOUND, MIME_PLAINTEXT, "Not found");
        }
    }

    private static String mimeFor(String path) {
        if (path.endsWith(".html") || path.endsWith(".htm")) return "text/html";
        if (path.endsWith(".js") || path.endsWith(".mjs")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".json") || path.endsWith(".map")) return "application/json";
        if (path.endsWith(".svg")) return "image/svg+xml";
        if (path.endsWith(".png")) return "image/png";
        if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
        if (path.endsWith(".gif")) return "image/gif";
        if (path.endsWith(".webp")) return "image/webp";
        if (path.endsWith(".ico")) return "image/x-icon";
        if (path.endsWith(".woff2")) return "font/woff2";
        if (path.endsWith(".woff")) return "font/woff";
        if (path.endsWith(".ttf")) return "font/ttf";
        if (path.endsWith(".wasm")) return "application/wasm";
        return "application/octet-stream";
    }
}
