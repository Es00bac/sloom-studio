package studio.sloom.slstapp;

import android.app.Activity;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.play.core.assetpacks.AssetPackLocation;
import com.google.android.play.core.assetpacks.AssetPackManager;
import com.google.android.play.core.assetpacks.AssetPackManagerFactory;
import com.google.android.play.core.assetpacks.AssetPackState;
import com.google.android.play.core.assetpacks.AssetPackStates;
import com.google.android.play.core.assetpacks.model.AssetPackStatus;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * On-demand Play Asset Delivery bridge for the audited Sloom publishing font catalog.
 *
 * The renderer never receives a filesystem path. A pack must pass the source-manifest signature,
 * catalog shape, and every declared font/license checksum before a bounded resource can be read.
 * Resource bytes cross the Capacitor bridge in 1 MiB chunks to avoid giant WebView messages.
 */
@CapacitorPlugin(name = "SloomFontPack")
public final class SloomFontPackPlugin extends Plugin {
    private static final String PACK_NAME = "sloom_fonts";
    private static final String LIBRARY_DIRECTORY = "library";
    private static final int EXPECTED_FAMILY_COUNT = 116;
    private static final int EXPECTED_FACE_COUNT = 430;
    private static final int EXPECTED_CHECKSUM_COUNT = 546;
    private static final int MAX_CHUNK_BYTES = 1024 * 1024;
    private static final long MAX_RESOURCE_BYTES = 64L * 1024L * 1024L;
    private static final Pattern SAFE_RESOURCE_PATH = Pattern.compile("^[A-Za-z0-9._\\/\\[\\]-]{1,512}$");
    private static final Pattern CHECKSUM_LINE = Pattern.compile("^([0-9a-f]{64})  ([A-Za-z0-9._\\/\\[\\]-]{1,512})$");

    private AssetPackManager assetPackManager;
    private ExecutorService verifier;
    private volatile VerifiedPack verifiedPack;

    private static final class VerifiedResource {
        final File file;
        final String sha256;
        final long byteLength;

        VerifiedResource(File file, String sha256, long byteLength) {
            this.file = file;
            this.sha256 = sha256;
            this.byteLength = byteLength;
        }
    }

    private static final class VerifiedPack {
        final String rootPath;
        final String signature;
        final Map<String, VerifiedResource> resources;

        VerifiedPack(String rootPath, String signature, Map<String, VerifiedResource> resources) {
            this.rootPath = rootPath;
            this.signature = signature;
            this.resources = resources;
        }
    }

    @Override
    public void load() {
        assetPackManager = AssetPackManagerFactory.getInstance(getContext().getApplicationContext());
        verifier = Executors.newSingleThreadExecutor();
    }

    @Override
    protected void handleOnDestroy() {
        if (verifier != null) verifier.shutdownNow();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        assetPackManager.getPackStates(Collections.singletonList(PACK_NAME))
            .addOnSuccessListener(states -> resolveStatus(call, states, null))
            .addOnFailureListener(error -> resolveStatus(call, null, message(error)));
    }

    @PluginMethod
    public void requestDownload(PluginCall call) {
        if (!isPlayManagedInstall() && assetPackManager.getPackLocation(PACK_NAME) == null) {
            call.reject(
                "The optional font catalog is available from the Google Play installation of Sloom Studio.",
                "FONT_PACK_REQUIRES_PLAY_INSTALL"
            );
            return;
        }
        assetPackManager.fetch(Collections.singletonList(PACK_NAME))
            .addOnSuccessListener(states -> {
                JSObject result = statePayload(states, null);
                result.put("requested", true);
                call.resolve(result);
            })
            .addOnFailureListener(error -> call.reject(
                "Google Play could not start the optional font-pack download. " + message(error),
                "FONT_PACK_DOWNLOAD_FAILED",
                error
            ));
    }

    @PluginMethod
    public void cancelDownload(PluginCall call) {
        AssetPackStates states = assetPackManager.cancel(Collections.singletonList(PACK_NAME));
        JSObject result = statePayload(states, null);
        result.put("canceled", true);
        call.resolve(result);
    }

    @PluginMethod
    public void requestDownloadConfirmation(PluginCall call) {
        Activity activity = getActivity();
        if (activity == null) {
            call.reject("The Android activity is unavailable.", "ACTIVITY_UNAVAILABLE");
            return;
        }
        assetPackManager.showConfirmationDialog(activity)
            .addOnSuccessListener(resultCode -> {
                JSObject result = new JSObject();
                result.put("accepted", resultCode == Activity.RESULT_OK);
                call.resolve(result);
            })
            .addOnFailureListener(error -> call.reject(
                "Google Play could not show the font-pack download confirmation. " + message(error),
                "FONT_PACK_CONFIRMATION_FAILED",
                error
            ));
    }

    @PluginMethod
    public void getResourceInfo(PluginCall call) {
        final String path;
        try {
            path = requireSafePath(call.getString("path"));
        } catch (IllegalArgumentException error) {
            call.reject(error.getMessage(), "INVALID_FONT_RESOURCE_PATH");
            return;
        }
        verifier.execute(() -> {
            try {
                VerifiedResource resource = requireVerifiedResource(path);
                JSObject result = new JSObject();
                result.put("path", path);
                result.put("byteLength", resource.byteLength);
                result.put("sha256", resource.sha256);
                result.put("chunkSize", MAX_CHUNK_BYTES);
                call.resolve(result);
            } catch (Exception error) {
                call.reject(message(error), "FONT_RESOURCE_UNAVAILABLE", error);
            }
        });
    }

    @PluginMethod
    public void readResourceChunk(PluginCall call) {
        final String path;
        final int offset = call.getInt("offset", 0);
        final int requestedLength = call.getInt("length", MAX_CHUNK_BYTES);
        try {
            path = requireSafePath(call.getString("path"));
            if (offset < 0 || requestedLength < 1 || requestedLength > MAX_CHUNK_BYTES) {
                throw new IllegalArgumentException("The font resource chunk is outside the allowed bounds.");
            }
        } catch (IllegalArgumentException error) {
            call.reject(error.getMessage(), "INVALID_FONT_RESOURCE_RANGE");
            return;
        }
        verifier.execute(() -> {
            try {
                VerifiedResource resource = requireVerifiedResource(path);
                if ((long) offset >= resource.byteLength) {
                    throw new IllegalArgumentException("The font resource offset is outside the file.");
                }
                int length = (int) Math.min((long) requestedLength, resource.byteLength - offset);
                byte[] bytes = new byte[length];
                try (RandomAccessFile input = new RandomAccessFile(resource.file, "r")) {
                    input.seek(offset);
                    input.readFully(bytes);
                }
                JSObject result = new JSObject();
                result.put("path", path);
                result.put("offset", offset);
                result.put("byteLength", length);
                result.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
                call.resolve(result);
            } catch (Exception error) {
                call.reject(message(error), "FONT_RESOURCE_READ_FAILED", error);
            }
        });
    }

    private void resolveStatus(PluginCall call, AssetPackStates states, String transportError) {
        AssetPackLocation location = assetPackManager.getPackLocation(PACK_NAME);
        if (location == null) {
            call.resolve(statePayload(states, transportError));
            return;
        }
        verifier.execute(() -> {
            JSObject result = statePayload(states, transportError);
            result.put("downloaded", true);
            try {
                VerifiedPack pack = verify(location);
                result.put("available", true);
                result.put("verified", true);
                result.put("status", "completed");
                result.put("signature", pack.signature);
            } catch (Exception error) {
                result.put("available", false);
                result.put("verified", false);
                result.put("status", "corrupt");
                result.put("errorMessage", message(error));
            }
            call.resolve(result);
        });
    }

    private JSObject statePayload(AssetPackStates states, String transportError) {
        JSObject result = new JSObject();
        result.put("supported", assetPackManager.getPackLocation(PACK_NAME) != null || isPlayManagedInstall());
        result.put("packName", PACK_NAME);
        result.put("downloaded", assetPackManager.getPackLocation(PACK_NAME) != null);
        result.put("available", false);
        result.put("verified", false);
        AssetPackState state = states == null ? null : states.packStates().get(PACK_NAME);
        result.put("status", state == null ? "not-installed" : statusName(state.status()));
        result.put("bytesDownloaded", state == null ? 0L : state.bytesDownloaded());
        result.put("totalBytes", state == null ? 0L : state.totalBytesToDownload());
        result.put("errorCode", state == null ? 0 : state.errorCode());
        if (transportError != null && !transportError.isEmpty()) result.put("errorMessage", transportError);
        return result;
    }

    private VerifiedResource requireVerifiedResource(String path) throws Exception {
        AssetPackLocation location = assetPackManager.getPackLocation(PACK_NAME);
        if (location == null) throw new IOException("The optional publishing font pack is not installed.");
        VerifiedResource resource = verify(location).resources.get(path);
        if (resource == null) throw new IOException("The requested file is not in the audited font-pack inventory.");
        return resource;
    }

    private VerifiedPack verify(AssetPackLocation location) throws Exception {
        File root = new File(location.assetsPath(), LIBRARY_DIRECTORY).getCanonicalFile();
        VerifiedPack cached = verifiedPack;
        if (cached != null && cached.rootPath.equals(root.getPath())) return cached;
        if (!root.isDirectory()) throw new IOException("The downloaded font pack has no library directory.");

        byte[] sourceLock = readBounded(new File(root, "source-artifact.json"), 1024 * 1024);
        byte[] inventoryBytes = readBounded(new File(root, "inventory/font-inventory.json"), 4 * 1024 * 1024);
        byte[] sumsBytes = readBounded(new File(root, "inventory/SHA256SUMS"), 1024 * 1024);
        String expectedSignature = new String(
            readBounded(new File(root, ".source-inventory.sha256"), 256), StandardCharsets.UTF_8
        ).trim();
        MessageDigest signatureDigest = sha256();
        signatureDigest.update(sourceLock);
        signatureDigest.update(inventoryBytes);
        signatureDigest.update(sumsBytes);
        String actualSignature = hex(signatureDigest.digest());
        if (!actualSignature.equals(expectedSignature)) {
            throw new IOException("The font-pack inventory signature does not match its audited source.");
        }

        JSONObject inventory = new JSONObject(new String(inventoryBytes, StandardCharsets.UTF_8));
        JSONArray families = inventory.optJSONArray("families");
        if (inventory.optInt("faceCount", -1) != EXPECTED_FACE_COUNT
            || inventory.optInt("criticalErrorCount", -1) != 0
            || families == null
            || families.length() != EXPECTED_FAMILY_COUNT) {
            throw new IOException("The font-pack catalog shape is not the approved 116-family/430-face inventory.");
        }

        Map<String, VerifiedResource> resources = new LinkedHashMap<>();
        String[] lines = new String(sumsBytes, StandardCharsets.UTF_8).split("\\r?\\n");
        for (String line : lines) {
            if (line.isEmpty()) continue;
            Matcher matcher = CHECKSUM_LINE.matcher(line);
            if (!matcher.matches()) throw new IOException("The font-pack checksum manifest is malformed.");
            String expectedHash = matcher.group(1);
            String path = requireSafePath(matcher.group(2));
            if (resources.containsKey(path)) throw new IOException("The font-pack checksum manifest contains a duplicate path.");
            File file = resolveInside(root, path);
            long byteLength = file.length();
            if (!file.isFile() || byteLength < 1 || byteLength > MAX_RESOURCE_BYTES) {
                throw new IOException("A declared font-pack resource is missing or outside the size limit: " + path);
            }
            String actualHash = hashFile(file);
            if (!actualHash.equals(expectedHash)) throw new IOException("Font-pack checksum mismatch: " + path);
            resources.put(path, new VerifiedResource(file, actualHash, byteLength));
        }
        if (resources.size() != EXPECTED_CHECKSUM_COUNT) {
            throw new IOException("The font pack does not contain all 546 audited font/license resources.");
        }
        String inventoryHash = hex(sha256().digest(inventoryBytes));
        resources.put(
            "inventory/font-inventory.json",
            new VerifiedResource(resolveInside(root, "inventory/font-inventory.json"), inventoryHash, inventoryBytes.length)
        );
        VerifiedPack result = new VerifiedPack(root.getPath(), actualSignature, Collections.unmodifiableMap(resources));
        verifiedPack = result;
        return result;
    }

    private static String requireSafePath(String value) {
        if (value == null || !SAFE_RESOURCE_PATH.matcher(value).matches()
            || value.startsWith("/") || value.contains("//") || value.contains("../")
            || value.equals("..") || value.endsWith("/..")) {
            throw new IllegalArgumentException("The font resource path is invalid.");
        }
        return value;
    }

    private static File resolveInside(File root, String path) throws IOException {
        File resolved = new File(root, path).getCanonicalFile();
        String rootPrefix = root.getCanonicalPath() + File.separator;
        if (!resolved.getPath().startsWith(rootPrefix)) throw new IOException("The font resource escaped the pack root.");
        return resolved;
    }

    private static byte[] readBounded(File file, int maxBytes) throws IOException {
        if (!file.isFile() || file.length() < 1 || file.length() > maxBytes) {
            throw new IOException("A required font-pack metadata file is missing or invalid.");
        }
        try (FileInputStream input = new FileInputStream(file); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[32 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                if (output.size() + read > maxBytes) throw new IOException("A font-pack metadata file exceeded its size limit.");
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    private static String hashFile(File file) throws IOException, NoSuchAlgorithmException {
        MessageDigest digest = sha256();
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] buffer = new byte[128 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) digest.update(buffer, 0, read);
        }
        return hex(digest.digest());
    }

    private static MessageDigest sha256() throws NoSuchAlgorithmException {
        return MessageDigest.getInstance("SHA-256");
    }

    private static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder(bytes.length * 2);
        for (byte value : bytes) result.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return result.toString();
    }

    private static String statusName(int status) {
        switch (status) {
            case AssetPackStatus.PENDING: return "pending";
            case AssetPackStatus.DOWNLOADING: return "downloading";
            case AssetPackStatus.TRANSFERRING: return "transferring";
            case AssetPackStatus.COMPLETED: return "completed";
            case AssetPackStatus.FAILED: return "failed";
            case AssetPackStatus.CANCELED: return "canceled";
            case AssetPackStatus.WAITING_FOR_WIFI: return "waiting-for-wifi";
            case AssetPackStatus.NOT_INSTALLED: return "not-installed";
            case AssetPackStatus.REQUIRES_USER_CONFIRMATION: return "confirmation-required";
            default: return "unknown";
        }
    }

    @SuppressWarnings("deprecation")
    private boolean isPlayManagedInstall() {
        String installer = getContext().getPackageManager().getInstallerPackageName(getContext().getPackageName());
        return "com.android.vending".equals(installer);
    }

    private static String message(Throwable error) {
        String detail = error == null ? null : error.getMessage();
        return detail == null || detail.trim().isEmpty() ? "Unknown Play Asset Delivery error." : detail;
    }
}
