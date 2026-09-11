package studio.sloom.slstapp;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;

/**
 * Binds each authenticated LAN bearer session to one durable browser-device identity.
 *
 * <p>The browser supplies an identity and a locally retained pairing proof only while exchanging the
 * displayed PIN. Later API requests derive their identity exclusively from the bearer token stored in
 * this registry. A known member id therefore cannot be claimed by pairing a second browser with a
 * different proof, and the reserved phone-host id is never pairable.
 *
 * <p>This is intentionally process-local: restarting the phone server invalidates every bearer and
 * binding, so a browser must pair again. The proof is not a hosted account credential and is never
 * returned by the server.
 */
final class LanSessionDeviceBindings {
    static final String HOST_DEVICE_ID = "__loom_host__";
    private static final int MAX_ID_LENGTH = 300;
    private static final Pattern SAFE_VALUE = Pattern.compile("[A-Za-z0-9._:-]{1," + MAX_ID_LENGTH + "}");

    private final Map<String, String> deviceProofs = new ConcurrentHashMap<>();
    private final Map<String, String> sessionDevices = new ConcurrentHashMap<>();

    /**
     * Atomically binds a freshly minted bearer token to a registered device. Returns false without
     * mutating either registry for invalid, host-reserved, or proof-mismatched input.
     */
    synchronized boolean bind(String token, String deviceId, String deviceProof) {
        if (!isSafe(token) || !isSafe(deviceId) || !isSafe(deviceProof) || HOST_DEVICE_ID.equals(deviceId)) {
            return false;
        }
        String knownProof = deviceProofs.get(deviceId);
        if (knownProof != null && !constantTimeEquals(knownProof, deviceProof)) {
            return false;
        }
        if (knownProof == null) {
            deviceProofs.put(deviceId, deviceProof);
        }
        sessionDevices.put(token, deviceId);
        return true;
    }

    /** Returns the token-bound device or null for an expired, unknown, or malformed bearer. */
    String deviceForToken(String token) {
        if (!isSafe(token)) return null;
        return sessionDevices.get(token);
    }

    private static boolean isSafe(String value) {
        return value != null && value.length() <= MAX_ID_LENGTH && SAFE_VALUE.matcher(value).matches();
    }

    private static boolean constantTimeEquals(String left, String right) {
        return MessageDigest.isEqual(
            left.getBytes(StandardCharsets.UTF_8),
            right.getBytes(StandardCharsets.UTF_8)
        );
    }
}
