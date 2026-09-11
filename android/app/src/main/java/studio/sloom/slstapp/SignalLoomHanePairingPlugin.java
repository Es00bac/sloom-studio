package studio.sloom.slstapp;

import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.util.Collections;

import fi.iki.elonen.NanoHTTPD;

/** Native invitation receiver used while Sloom displays a QR for Hane to scan. */
@CapacitorPlugin(name = "SignalLoomHanePairing")
public class SignalLoomHanePairingPlugin extends Plugin {
    private static final int FIRST_PORT = 8731;
    private static final int LAST_PORT = 8739;

    private HanePairInvitationServer server;

    @PluginMethod
    public synchronized void begin(PluginCall call) {
        closeServer();
        String ip = getLanIpAddress();
        if ("127.0.0.1".equals(ip)) {
            call.reject("Connect Sloom Studio to a private Wi-Fi or Ethernet network before showing a pairing QR.");
            return;
        }
        Exception lastError = null;
        for (int port = FIRST_PORT; port <= LAST_PORT; port += 1) {
            HanePairInvitationServer candidate = new HanePairInvitationServer(
                port,
                ip,
                "Sloom Studio on " + boundedModelName()
            );
            try {
                candidate.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false);
                server = candidate;
                call.resolve(invitationState(candidate));
                return;
            } catch (Exception error) {
                lastError = error;
                candidate.stop();
            }
        }
        call.reject(
            lastError == null
                ? "Could not open the local QR pairing receiver."
                : "Could not open the local QR pairing receiver: " + lastError.getMessage()
        );
    }

    @PluginMethod
    public synchronized void poll(PluginCall call) {
        String invitationId = call.getString("invitationId", "");
        if (server == null || !server.getInvitationId().equals(invitationId)) {
            JSObject value = new JSObject();
            value.put("status", "invalid");
            value.put("error", "That QR invitation is no longer active.");
            call.resolve(value);
            return;
        }
        HanePairInvitationServer.Completion completion = server.getCompletion();
        JSObject value = new JSObject();
        if (completion != null) {
            value.put("status", "completed");
            value.put("haneUrl", completion.haneUrl);
            value.put("token", completion.token);
            value.put("haneDeviceLabel", completion.haneDeviceLabel);
            closeServer();
        } else if (server.isExpired()) {
            value.put("status", "expired");
            closeServer();
        } else {
            value.put("status", "pending");
        }
        call.resolve(value);
    }

    @PluginMethod
    public synchronized void cancel(PluginCall call) {
        String invitationId = call.getString("invitationId", "");
        if (server != null
            && (invitationId.isEmpty() || server.getInvitationId().equals(invitationId))) {
            closeServer();
        }
        JSObject value = new JSObject();
        value.put("ok", true);
        call.resolve(value);
    }

    @Override
    protected synchronized void handleOnDestroy() {
        closeServer();
        super.handleOnDestroy();
    }

    private JSObject invitationState(HanePairInvitationServer invitation) {
        JSObject value = new JSObject();
        value.put("invitationId", invitation.getInvitationId());
        value.put("payload", invitation.getPayload());
        value.put("expiresAt", invitation.getExpiresAt());
        value.put("deviceLabel", invitation.getDeviceLabel());
        return value;
    }

    private void closeServer() {
        if (server == null) return;
        server.stop();
        server = null;
    }

    private static String boundedModelName() {
        String manufacturer = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.trim();
        String model = Build.MODEL == null ? "" : Build.MODEL.trim();
        String combined = (manufacturer + " " + model).trim().replaceAll("\\s+", " ");
        if (combined.isEmpty()) return "Android";
        return combined.length() <= 80 ? combined : combined.substring(0, 80);
    }

    private static String getLanIpAddress() {
        String fallback = null;
        try {
            for (NetworkInterface network : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (network.isLoopback() || !network.isUp()) continue;
                for (InetAddress address : Collections.list(network.getInetAddresses())) {
                    if (!(address instanceof Inet4Address) || address.isLoopbackAddress()) continue;
                    String candidate = address.getHostAddress();
                    if (!isPrivateIpv4(candidate)) continue;
                    String name = network.getName() == null ? "" : network.getName().toLowerCase();
                    if (name.startsWith("wlan")
                        || name.startsWith("wifi")
                        || name.startsWith("eth")
                        || name.startsWith("ap")) return candidate;
                    if (fallback == null
                        && !name.startsWith("rmnet")
                        && !name.startsWith("ccmni")
                        && !name.startsWith("pdp")
                        && !name.startsWith("tun")) fallback = candidate;
                }
            }
        } catch (Exception ignored) {
        }
        return fallback == null ? "127.0.0.1" : fallback;
    }

    private static boolean isPrivateIpv4(String value) {
        if (value == null) return false;
        String[] parts = value.split("\\.", -1);
        if (parts.length != 4) return false;
        int[] octets = new int[4];
        try {
            for (int index = 0; index < parts.length; index += 1) {
                if (!parts[index].matches("\\d{1,3}")) return false;
                octets[index] = Integer.parseInt(parts[index]);
                if (octets[index] < 0 || octets[index] > 255) return false;
            }
        } catch (NumberFormatException invalid) {
            return false;
        }
        return octets[0] == 10
            || (octets[0] == 169 && octets[1] == 254)
            || (octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31)
            || (octets[0] == 192 && octets[1] == 168);
    }
}
