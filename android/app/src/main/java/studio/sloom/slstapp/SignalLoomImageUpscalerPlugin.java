package studio.sloom.slstapp;

import android.content.Context;
import android.content.res.AssetManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.os.Build;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@CapacitorPlugin(name = "SignalLoomImageUpscaler")
public class SignalLoomImageUpscalerPlugin extends Plugin {
    private static final String TAG = "SignalLoomUpscaler";
    private static final long MAX_OUTPUT_PIXELS = 100_000_000L;
    private static final String LOCAL_DREAM_HEALTH_URL = "http://127.0.0.1:8081/health";
    private static final String LOCAL_DREAM_UPSCALE_URL = "http://127.0.0.1:8081/upscale";
    private static final String DEFAULT_UPSCALER_ID = "upscaler_realistic";
    private static final Map<String, String> CHIPSET_SUFFIXES = new HashMap<>();

    static {
        CHIPSET_SUFFIXES.put("SM8475", "8gen1");
        CHIPSET_SUFFIXES.put("SM8450", "8gen1");
        CHIPSET_SUFFIXES.put("SM8550", "8gen2");
        CHIPSET_SUFFIXES.put("SM8550P", "8gen2");
        CHIPSET_SUFFIXES.put("QCS8550", "8gen2");
        CHIPSET_SUFFIXES.put("QCM8550", "8gen2");
        CHIPSET_SUFFIXES.put("SM8650", "8gen2");
        CHIPSET_SUFFIXES.put("SM8650P", "8gen2");
        CHIPSET_SUFFIXES.put("SM8750", "8gen2");
        CHIPSET_SUFFIXES.put("SM8750P", "8gen2");
        CHIPSET_SUFFIXES.put("SM8850", "8gen2");
        CHIPSET_SUFFIXES.put("SM8850P", "8gen2");
        CHIPSET_SUFFIXES.put("SM8735", "8gen2");
        CHIPSET_SUFFIXES.put("SM8845", "8gen2");
    }

    private Process bundledUpscalerProcess;
    // After a definitive backend startup failure, skip the spawn + 15s health poll on
    // subsequent calls for a short window so batch upscales (Paper print export) do not
    // stall per image; the TTL keeps the path self-healing without an app restart.
    private static final long BACKEND_FAILURE_RETRY_MS = 5 * 60_000L;
    private volatile long backendFailedAtMs = 0L;

    @PluginMethod
    public void upscale(PluginCall call) {
        new Thread(() -> runUpscale(call), "SignalLoomImageUpscaler").start();
    }

    private void runUpscale(PluginCall call) {
        Bitmap source = null;
        try {
            String sourceDataUrl = call.getString("sourceDataUrl", "");
            Integer targetWidthPx = call.getInt("targetWidthPx");
            Integer targetHeightPx = call.getInt("targetHeightPx");
            String outputFormat = call.getString("outputFormat", "png").toLowerCase(Locale.US);
            double quality = clampQuality(call.getDouble("quality", 0.94));
            String preferredBackend = call.getString("preferredBackend", "local-dream-qnn");
            String upscalerId = normalizeUpscalerId(call.getString("upscalerId", DEFAULT_UPSCALER_ID));
            boolean allowBitmapFallback = Boolean.TRUE.equals(call.getBoolean("allowBitmapFallback", true));

            if (sourceDataUrl == null || !sourceDataUrl.startsWith("data:image/")) {
                call.reject("Android native upscaler expected an image data URL.");
                return;
            }
            if (targetWidthPx == null || targetHeightPx == null || targetWidthPx < 1 || targetHeightPx < 1) {
                call.reject("Android native upscaler requires positive target dimensions.");
                return;
            }
            long outputPixels = (long) targetWidthPx * (long) targetHeightPx;
            if (outputPixels > MAX_OUTPUT_PIXELS) {
                call.reject("Android native upscaler target is too large for in-app processing.");
                return;
            }

            byte[] sourceBytes = decodeDataUrlPayload(sourceDataUrl);
            source = BitmapFactory.decodeByteArray(sourceBytes, 0, sourceBytes.length);
            if (source == null) {
                call.reject("Android native upscaler could not decode the source image.");
                return;
            }

            List<String> warnings = new ArrayList<>();
            UpscalePayload payload = null;
            if (!"bitmap-fallback".equals(preferredBackend)) {
                try {
                    payload = runLocalDreamQnnUpscale(source, targetWidthPx, targetHeightPx, outputFormat, quality, upscalerId);
                } catch (Exception error) {
                    if (!allowBitmapFallback) {
                        call.reject("Sloom Studio bundled QNN upscaler is unavailable: " + readableMessage(error), error);
                        return;
                    }
                    warnings.add("Sloom Studio bundled QNN upscaler unavailable; used Android bitmap fallback instead. " + readableMessage(error));
                }
            }

            if (payload == null) {
                payload = runBitmapFallbackUpscale(source, targetWidthPx, targetHeightPx, outputFormat, quality);
            }
            if (!payload.supportedFormat) {
                warnings.add("Unsupported output format requested; encoded PNG instead.");
            }
            warnings.addAll(payload.warnings);

            JSObject result = payload.toJson();
            if (!warnings.isEmpty()) {
                JSArray warningArray = new JSArray();
                for (String warning : warnings) {
                    warningArray.put(warning);
                }
                result.put("warnings", warningArray);
            }
            call.resolve(result);
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "Android native image upscale failed." : error.getMessage(), error);
        } finally {
            if (source != null) {
                source.recycle();
            }
        }
    }

    private UpscalePayload runLocalDreamQnnUpscale(
        Bitmap source,
        int targetWidthPx,
        int targetHeightPx,
        String outputFormat,
        double quality,
        String upscalerId
    ) throws Exception {
        startBundledLocalDreamUpscalerBackend();
        File upscalerFile = ensureSignalLoomUpscalerModel(upscalerId);
        return postBundledLocalDreamUpscale(
            source,
            targetWidthPx,
            targetHeightPx,
            outputFormat,
            quality,
            upscalerId,
            upscalerFile
        );
    }

    private synchronized void startBundledLocalDreamUpscalerBackend() throws Exception {
        if (isLocalDreamBackendHealthy()) {
            backendFailedAtMs = 0L;
            return;
        }
        long failedAt = backendFailedAtMs;
        if (failedAt > 0L && System.currentTimeMillis() - failedAt < BACKEND_FAILURE_RETRY_MS) {
            throw new IllegalStateException(
                "Bundled Local Dream QNN backend failed to start recently; skipping retry for a few minutes.");
        }

        Context context = getContext();
        File nativeDir = new File(context.getApplicationInfo().nativeLibraryDir);
        File executableFile = new File(nativeDir, "libstable_diffusion_core.so");
        if (!executableFile.exists()) {
            throw new IllegalStateException("Bundled Local Dream QNN runtime is missing from this Sloom Studio APK.");
        }

        File runtimeDir = prepareQnnRuntimeDir(context);
        List<String> command = new ArrayList<>();
        command.add(executableFile.getAbsolutePath());
        command.add("--upscaler_mode");
        command.add("--lib_dir");
        command.add(runtimeDir.getAbsolutePath());
        command.add("--port");
        command.add("8081");

        ProcessBuilder processBuilder = new ProcessBuilder(command);
        processBuilder.directory(nativeDir);
        processBuilder.redirectErrorStream(true);
        String libraryPath = runtimeDir.getAbsolutePath()
            + ":/system/lib64:/vendor/lib64:/vendor/lib64/egl";
        processBuilder.environment().put("LD_LIBRARY_PATH", libraryPath);
        processBuilder.environment().put("DSP_LIBRARY_PATH", runtimeDir.getAbsolutePath());

        bundledUpscalerProcess = processBuilder.start();
        consumeProcessLogs(bundledUpscalerProcess);

        long deadline = System.currentTimeMillis() + 15_000L;
        while (System.currentTimeMillis() < deadline) {
            if (isLocalDreamBackendHealthy()) {
                backendFailedAtMs = 0L;
                return;
            }
            Thread.sleep(500L);
        }
        backendFailedAtMs = System.currentTimeMillis();
        throw new IllegalStateException("Bundled Local Dream QNN backend did not become ready on 127.0.0.1:8081.");
    }

    private File prepareQnnRuntimeDir(Context context) throws Exception {
        File runtimeDir = new File(context.getFilesDir(), "runtime_libs");
        if (!runtimeDir.exists() && !runtimeDir.mkdirs()) {
            throw new IllegalStateException("Could not create Sloom Studio QNN runtime directory.");
        }

        AssetManager assets = context.getAssets();
        String[] qnnAssets = assets.list("qnnlibs");
        if (qnnAssets == null || qnnAssets.length == 0) {
            throw new IllegalStateException("Bundled QNN libraries are missing from Sloom Studio assets.");
        }

        for (String fileName : qnnAssets) {
            File target = new File(runtimeDir, fileName);
            try (InputStream inputStream = assets.open("qnnlibs/" + fileName)) {
                if (target.exists() && target.length() == inputStream.available()) {
                    target.setReadable(true, true);
                    target.setExecutable(true, true);
                    continue;
                }
            }
            try (InputStream inputStream = assets.open("qnnlibs/" + fileName);
                 OutputStream outputStream = new FileOutputStream(target)) {
                copy(inputStream, outputStream);
            }
            target.setReadable(true, true);
            target.setExecutable(true, true);
        }

        runtimeDir.setReadable(true, true);
        runtimeDir.setExecutable(true, true);
        return runtimeDir;
    }

    private File ensureSignalLoomUpscalerModel(String upscalerId) throws Exception {
        File modelDir = new File(new File(getContext().getFilesDir(), "models"), upscalerId);
        if (!modelDir.exists() && !modelDir.mkdirs()) {
            throw new IllegalStateException("Could not create Sloom Studio upscaler model directory.");
        }
        File upscalerFile = new File(modelDir, "upscaler.bin");
        if (upscalerFile.exists() && upscalerFile.length() > 0) {
            return upscalerFile;
        }

        File partialFile = new File(modelDir, "upscaler.bin.part");
        HttpURLConnection connection = (HttpURLConnection) new URL(resolveUpscalerModelUrl(upscalerId)).openConnection();
        try {
            connection.setConnectTimeout(30_000);
            connection.setReadTimeout(300_000);
            int responseCode = connection.getResponseCode();
            if (responseCode < 200 || responseCode >= 300) {
                throw new IllegalStateException("Could not download Sloom Studio upscaler model (" + responseCode + "): " + readErrorBody(connection));
            }
            try (InputStream inputStream = connection.getInputStream();
                 OutputStream outputStream = new FileOutputStream(partialFile)) {
                copy(inputStream, outputStream);
            }
        } finally {
            connection.disconnect();
        }

        if (!partialFile.renameTo(upscalerFile)) {
            throw new IllegalStateException("Could not finalize downloaded Sloom Studio upscaler model.");
        }
        return upscalerFile;
    }

    private String resolveUpscalerModelUrl(String upscalerId) {
        String suffix = resolveChipsetSuffix();
        String modelPath = "upscaler_anime".equals(upscalerId)
            ? "realesrgan_x4plus_anime_6b"
            : "4x_UltraSharpV2_Lite";
        return "https://huggingface.co/xororz/upscaler/resolve/main/"
            + modelPath
            + "/upscaler_"
            + suffix
            + ".bin";
    }

    private static String resolveChipsetSuffix() {
        String soc = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? Build.SOC_MODEL : "";
        String mapped = CHIPSET_SUFFIXES.get(soc);
        if (mapped != null) {
            return mapped;
        }
        return soc != null && soc.startsWith("SM") ? "min" : "min";
    }

    private UpscalePayload postBundledLocalDreamUpscale(
        Bitmap source,
        int targetWidthPx,
        int targetHeightPx,
        String outputFormat,
        double quality,
        String upscalerId,
        File upscalerFile
    ) throws Exception {
        byte[] rgbBytes = toRgbBytes(source);
        HttpURLConnection connection = (HttpURLConnection) new URL(LOCAL_DREAM_UPSCALE_URL).openConnection();
        try {
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Content-Type", "application/octet-stream");
            connection.setRequestProperty("X-Image-Width", String.valueOf(source.getWidth()));
            connection.setRequestProperty("X-Image-Height", String.valueOf(source.getHeight()));
            connection.setRequestProperty("X-Upscaler-Path", upscalerFile.getAbsolutePath());
            connection.setDoOutput(true);
            connection.setConnectTimeout(5000);
            connection.setReadTimeout(300000);

            try (OutputStream outputStream = connection.getOutputStream()) {
                outputStream.write(rgbBytes);
            }

            int responseCode = connection.getResponseCode();
            if (responseCode != HttpURLConnection.HTTP_OK) {
                throw new IllegalStateException("Sloom Studio bundled QNN upscaler rejected request (" + responseCode + "): " + readErrorBody(connection));
            }

            byte[] responseBytes;
            try (InputStream inputStream = connection.getInputStream()) {
                responseBytes = readAllBytes(inputStream);
            }
            Bitmap decoded = BitmapFactory.decodeByteArray(responseBytes, 0, responseBytes.length);
            if (decoded == null) {
                throw new IllegalStateException("Sloom Studio bundled QNN upscaler returned an undecodable image.");
            }

            Bitmap finalBitmap = decoded;
            if (decoded.getWidth() != targetWidthPx || decoded.getHeight() != targetHeightPx) {
                finalBitmap = Bitmap.createScaledBitmap(decoded, targetWidthPx, targetHeightPx, true);
                decoded.recycle();
            }

            try {
                UpscalePayload payload = encodeBitmap(finalBitmap, targetWidthPx, targetHeightPx, outputFormat, quality);
                payload.accelerator = "local-dream-qnn-htp";
                payload.backend = "signal-loom-bundled-local-dream";
                payload.modelUsed = upscalerId;
                payload.durationMs = parsePositiveInt(connection.getHeaderField("X-Duration-Ms"));
                payload.warnings.add("Bundled Local Dream QNN upscaler output is 4x internally and was final-fit to the requested dimensions.");
                return payload;
            } finally {
                finalBitmap.recycle();
            }
        } finally {
            connection.disconnect();
        }
    }

    private UpscalePayload runBitmapFallbackUpscale(
        Bitmap source,
        int targetWidthPx,
        int targetHeightPx,
        String outputFormat,
        double quality
    ) throws Exception {
        Bitmap output = Bitmap.createBitmap(targetWidthPx, targetHeightPx, Bitmap.Config.ARGB_8888);
        try {
            Canvas canvas = new Canvas(output);
            Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG | Paint.DITHER_FLAG);
            canvas.drawBitmap(source, null, new Rect(0, 0, targetWidthPx, targetHeightPx), paint);
            UpscalePayload payload = encodeBitmap(output, targetWidthPx, targetHeightPx, outputFormat, quality);
            payload.accelerator = "android-native-bitmap-fallback";
            payload.backend = "android-bitmap";
            return payload;
        } finally {
            output.recycle();
        }
    }

    private static UpscalePayload encodeBitmap(
        Bitmap bitmap,
        int width,
        int height,
        String outputFormat,
        double quality
    ) throws Exception {
        EncodePlan encodePlan = resolveEncodePlan(outputFormat);
        ByteArrayOutputStream outputBytes = new ByteArrayOutputStream();
        if (!bitmap.compress(encodePlan.format, (int) Math.round(quality * 100), outputBytes)) {
            throw new IllegalStateException("Android native upscaler could not encode the output image.");
        }
        UpscalePayload payload = new UpscalePayload();
        payload.dataUrl = "data:" + encodePlan.mimeType + ";base64," + Base64.encodeToString(outputBytes.toByteArray(), Base64.NO_WRAP);
        payload.mimeType = encodePlan.mimeType;
        payload.width = width;
        payload.height = height;
        payload.supportedFormat = encodePlan.supportedFormat;
        return payload;
    }

    private boolean isLocalDreamBackendHealthy() {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(LOCAL_DREAM_HEALTH_URL).openConnection();
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(750);
            connection.setReadTimeout(750);
            return connection.getResponseCode() == HttpURLConnection.HTTP_OK;
        } catch (Exception error) {
            return false;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    private static byte[] decodeDataUrlPayload(String dataUrl) {
        int separatorIndex = dataUrl.indexOf(',');
        if (separatorIndex < 0 || separatorIndex == dataUrl.length() - 1) {
            throw new IllegalArgumentException("Android native upscaler received an invalid image data URL.");
        }
        return Base64.decode(dataUrl.substring(separatorIndex + 1), Base64.DEFAULT);
    }

    private static byte[] toRgbBytes(Bitmap bitmap) {
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        int[] pixels = new int[width * height];
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height);
        byte[] rgbBytes = new byte[width * height * 3];
        for (int i = 0; i < pixels.length; i += 1) {
            int pixel = pixels[i];
            rgbBytes[i * 3] = (byte) ((pixel >> 16) & 0xFF);
            rgbBytes[i * 3 + 1] = (byte) ((pixel >> 8) & 0xFF);
            rgbBytes[i * 3 + 2] = (byte) (pixel & 0xFF);
        }
        return rgbBytes;
    }

    private void consumeProcessLogs(Process process) {
        new Thread(() -> {
            try (InputStream inputStream = process.getInputStream()) {
                byte[] buffer = new byte[4096];
                while (inputStream.read(buffer) != -1) {
                    // Drain the stream so the native process cannot block on stdout.
                }
            } catch (Exception error) {
                Log.w(TAG, "Bundled QNN upscaler log drain stopped: " + readableMessage(error));
            }
        }, "SignalLoomQnnUpscalerLogs").start();
    }

    private static void copy(InputStream inputStream, OutputStream outputStream) throws Exception {
        byte[] buffer = new byte[16 * 1024];
        int read;
        while ((read = inputStream.read(buffer)) != -1) {
            outputStream.write(buffer, 0, read);
        }
    }

    private static int parsePositiveInt(String value) {
        if (value == null) return 0;
        try {
            return Math.max(0, Integer.parseInt(value));
        } catch (NumberFormatException error) {
            return 0;
        }
    }

    private static String readableMessage(Exception error) {
        return error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
    }

    private static String readErrorBody(HttpURLConnection connection) {
        InputStream inputStream = connection.getErrorStream();
        if (inputStream == null) {
            return "";
        }
        try (InputStream bodyStream = inputStream) {
            return new String(readAllBytes(bodyStream));
        } catch (Exception error) {
            return "";
        }
    }

    private static byte[] readAllBytes(InputStream inputStream) throws Exception {
        ByteArrayOutputStream outputStream = new ByteArrayOutputStream();
        byte[] buffer = new byte[16 * 1024];
        int read;
        while ((read = inputStream.read(buffer)) != -1) {
            outputStream.write(buffer, 0, read);
        }
        return outputStream.toByteArray();
    }

    private static double clampQuality(double quality) {
        if (Double.isNaN(quality) || Double.isInfinite(quality)) {
            return 0.94;
        }
        return Math.max(0.05, Math.min(1.0, quality));
    }

    private static String normalizeUpscalerId(String value) {
        if (value == null || value.trim().isEmpty()) {
            return DEFAULT_UPSCALER_ID;
        }
        return value.trim();
    }

    private static EncodePlan resolveEncodePlan(String outputFormat) {
        if ("jpeg".equals(outputFormat) || "jpg".equals(outputFormat)) {
            return new EncodePlan(Bitmap.CompressFormat.JPEG, "image/jpeg", true);
        }
        if ("webp".equals(outputFormat) && Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            return new EncodePlan(Bitmap.CompressFormat.WEBP_LOSSY, "image/webp", true);
        }
        if ("webp".equals(outputFormat)) {
            return new EncodePlan(Bitmap.CompressFormat.WEBP, "image/webp", true);
        }
        return new EncodePlan(Bitmap.CompressFormat.PNG, "image/png", "png".equals(outputFormat));
    }

    private static class EncodePlan {
        final Bitmap.CompressFormat format;
        final String mimeType;
        final boolean supportedFormat;

        EncodePlan(Bitmap.CompressFormat format, String mimeType, boolean supportedFormat) {
            this.format = format;
            this.mimeType = mimeType;
            this.supportedFormat = supportedFormat;
        }
    }

    private static class UpscalePayload {
        String dataUrl;
        String mimeType;
        int width;
        int height;
        String accelerator;
        String backend;
        String modelUsed;
        int durationMs;
        boolean supportedFormat = true;
        final List<String> warnings = new ArrayList<>();

        JSObject toJson() {
            JSObject result = new JSObject();
            result.put("dataUrl", dataUrl);
            result.put("mimeType", mimeType);
            result.put("width", width);
            result.put("height", height);
            result.put("accelerator", accelerator);
            result.put("backend", backend);
            if (modelUsed != null) {
                result.put("modelUsed", modelUsed);
            }
            if (durationMs > 0) {
                result.put("durationMs", durationMs);
            }
            return result;
        }
    }
}
