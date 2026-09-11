package studio.sloom.slstapp;

import android.net.Uri;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.HashMap;
import java.util.Map;

import fi.iki.elonen.NanoHTTPD;

/** Single-use, five-minute LAN callback carried by the QR shown in Sloom Studio. */
final class HanePairInvitationServer extends NanoHTTPD {
    static final String PROTOCOL = "sloom-hane-qr-pair";
    static final int VERSION = 1;
    static final long TTL_MS = 5L * 60L * 1000L;
    private static final int MAX_BODY_BYTES = 8 * 1024;
    private static final int HANE_LINK_DEFAULT_PORT = 8723;
    private static final int HANE_LINK_FALLBACK_PORT_START = 8740;
    private static final int HANE_LINK_FALLBACK_PORT_END = 8749;

    static final class Completion {
        final String haneUrl;
        final String token;
        final String haneDeviceLabel;

        Completion(String haneUrl, String token, String haneDeviceLabel) {
            this.haneUrl = haneUrl;
            this.token = token;
            this.haneDeviceLabel = haneDeviceLabel;
        }
    }

    private final String invitationId;
    private final String secret;
    private final String payload;
    private final String deviceLabel;
    private final long expiresAt;
    private final String callbackPath;
    private Completion completion;

    HanePairInvitationServer(int port, String ipAddress, String requestedDeviceLabel) {
        super(port);
        invitationId = randomHex(16);
        secret = randomBase64Url(32);
        expiresAt = System.currentTimeMillis() + TTL_MS;
        deviceLabel = boundedLabel(requestedDeviceLabel, "Sloom Studio Android");
        callbackPath = "/__loom/api/hane-pair/complete/" + invitationId;
        String callbackUrl = "http://" + ipAddress + ":" + port + callbackPath;
        payload = new Uri.Builder()
            .scheme("sloom-link")
            .authority("pair")
            .appendQueryParameter("v", String.valueOf(VERSION))
            .appendQueryParameter("id", invitationId)
            .appendQueryParameter("secret", secret)
            .appendQueryParameter("expires", String.valueOf(expiresAt))
            .appendQueryParameter("name", deviceLabel)
            .appendQueryParameter("callback", callbackUrl)
            .build()
            .toString();
    }

    String getInvitationId() {
        return invitationId;
    }

    String getPayload() {
        return payload;
    }

    String getDeviceLabel() {
        return deviceLabel;
    }

    long getExpiresAt() {
        return expiresAt;
    }

    synchronized Completion getCompletion() {
        return completion;
    }

    synchronized boolean isExpired() {
        return System.currentTimeMillis() > expiresAt;
    }

    @Override
    public Response serve(IHTTPSession session) {
        if (session.getMethod() != Method.POST || !callbackPath.equals(session.getUri())) {
            return json(Response.Status.NOT_FOUND, false, "not-found");
        }
        synchronized (this) {
            if (isExpired()) return json(Response.Status.GONE, false, "invitation-expired");
            if (completion != null) return json(Response.Status.CONFLICT, false, "invitation-used");
        }
        String contentLength = session.getHeaders().get("content-length");
        if (contentLength != null) {
            try {
                int declared = Integer.parseInt(contentLength);
                if (declared < 0 || declared > MAX_BODY_BYTES) {
                    return json(Response.Status.PAYLOAD_TOO_LARGE, false, "payload-too-large");
                }
            } catch (NumberFormatException invalid) {
                return json(Response.Status.BAD_REQUEST, false, "invalid-content-length");
            }
        }

        final String body;
        try {
            Map<String, String> parsed = new HashMap<>();
            session.parseBody(parsed);
            body = parsed.get("postData");
            if (body == null || body.getBytes(StandardCharsets.UTF_8).length > MAX_BODY_BYTES) {
                return json(Response.Status.BAD_REQUEST, false, "invalid-body");
            }
        } catch (Exception invalid) {
            return json(Response.Status.BAD_REQUEST, false, "invalid-body");
        }

        final Completion accepted;
        try {
            JSONObject value = new JSONObject(body);
            if (!PROTOCOL.equals(value.optString("protocol"))
                || value.optInt("version", -1) != VERSION
                || !invitationId.equals(value.optString("invitationId"))
                || !secureEquals(secret, value.optString("secret"))) {
                return json(Response.Status.UNAUTHORIZED, false, "invalid-invitation-proof");
            }
            String token = value.optString("token");
            String haneUrl = normalizeHaneUrl(value.optString("haneUrl"));
            if (!token.matches("[a-f0-9]{64}") || haneUrl == null) {
                return json(Response.Status.UNAUTHORIZED, false, "invalid-hane-capability");
            }
            accepted = new Completion(
                haneUrl,
                token,
                boundedLabel(value.optString("haneDeviceLabel"), "Hane mobile device")
            );
        } catch (Exception invalid) {
            return json(Response.Status.BAD_REQUEST, false, "invalid-json");
        }

        synchronized (this) {
            if (isExpired()) return json(Response.Status.GONE, false, "invitation-expired");
            if (completion != null) return json(Response.Status.CONFLICT, false, "invitation-used");
            completion = accepted;
        }
        JSONObject response = new JSONObject();
        try {
            response.put("ok", true);
            response.put("invitationId", invitationId);
        } catch (Exception ignored) {
        }
        return NanoHTTPD.newFixedLengthResponse(
            Response.Status.OK,
            "application/json",
            response.toString()
        );
    }

    private static Response json(Response.Status status, boolean ok, String error) {
        JSONObject value = new JSONObject();
        try {
            value.put("ok", ok);
            value.put("error", error);
        } catch (Exception ignored) {
        }
        return NanoHTTPD.newFixedLengthResponse(status, "application/json", value.toString());
    }

    private static String normalizeHaneUrl(String raw) {
        try {
            java.net.URI uri = new java.net.URI(raw);
            String host = uri.getHost();
            if (!"http".equalsIgnoreCase(uri.getScheme())
                || uri.getUserInfo() != null
                || uri.getQuery() != null
                || uri.getFragment() != null
                || host == null
                || !isPrivateIpv4(host)
                || !isAllowedHaneLinkPort(uri.getPort())
                || !(uri.getPath() == null || uri.getPath().isEmpty() || "/".equals(uri.getPath()))) {
                return null;
            }
            return "http://" + host + ":" + uri.getPort() + "/";
        } catch (Exception invalid) {
            return null;
        }
    }

    private static boolean isAllowedHaneLinkPort(int port) {
        return port == HANE_LINK_DEFAULT_PORT
            || (port >= HANE_LINK_FALLBACK_PORT_START
                && port <= HANE_LINK_FALLBACK_PORT_END);
    }

    private static boolean isPrivateIpv4(String value) {
        String[] parts = value.split("\\.", -1);
        if (parts.length != 4) return false;
        int[] octets = new int[4];
        try {
            for (int index = 0; index < 4; index += 1) {
                if (!parts[index].matches("\\d{1,3}")) return false;
                octets[index] = Integer.parseInt(parts[index]);
                if (octets[index] < 0 || octets[index] > 255) return false;
            }
        } catch (NumberFormatException invalid) {
            return false;
        }
        return octets[0] == 10
            || octets[0] == 127
            || (octets[0] == 169 && octets[1] == 254)
            || (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31)
            || (octets[0] == 192 && octets[1] == 168);
    }

    private static boolean secureEquals(String expected, String actual) {
        return MessageDigest.isEqual(
            expected.getBytes(StandardCharsets.UTF_8),
            actual.getBytes(StandardCharsets.UTF_8)
        );
    }

    private static String boundedLabel(String value, String fallback) {
        String normalized = value == null
            ? ""
            : value.replaceAll("[\\p{Cntrl}]+", " ").trim().replaceAll("\\s+", " ");
        if (normalized.isEmpty()) return fallback;
        return normalized.length() <= 120 ? normalized : normalized.substring(0, 120);
    }

    private static String randomHex(int byteCount) {
        byte[] bytes = new byte[byteCount];
        new SecureRandom().nextBytes(bytes);
        StringBuilder value = new StringBuilder(byteCount * 2);
        for (byte item : bytes) value.append(String.format("%02x", item));
        return value.toString();
    }

    private static String randomBase64Url(int byteCount) {
        byte[] bytes = new byte[byteCount];
        new SecureRandom().nextBytes(bytes);
        return android.util.Base64.encodeToString(
            bytes,
            android.util.Base64.NO_WRAP | android.util.Base64.NO_PADDING | android.util.Base64.URL_SAFE
        );
    }
}
