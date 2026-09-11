package studio.sloom.slstapp;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.KeyEvent;
import android.webkit.JavascriptInterface;

import androidx.core.splashscreen.SplashScreen;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    public static volatile boolean interceptVolumeKeys = false;

    /** Flipped true once the web app has rendered its first frame (or the safety timeout fires). */
    private volatile boolean contentReady = false;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Must be installed before super.onCreate(). The returned controller lets us hold the
        // native splash on screen for the whole cold start instead of flashing to a blank webview.
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        registerPlugin(SignalLoomImageUpscalerPlugin.class);
        registerPlugin(SignalLoomSystemUiPlugin.class);
        registerPlugin(SignalLoomLanServerPlugin.class);
        registerPlugin(SignalLoomHanePairingPlugin.class);
        registerPlugin(SignalLoomShareIntentPlugin.class);
        registerPlugin(SloomPlayCommercePlugin.class);
        registerPlugin(SloomFontPackPlugin.class);
        super.onCreate(savedInstanceState);

        // Keep the native splash up until the web app reports its first paint (AndroidSplash.onWebReady).
        splashScreen.setKeepOnScreenCondition(() -> !contentReady);

        // Web -> native bridge so the page can release the splash exactly when its UI is up.
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().addJavascriptInterface(new SplashBridge(), "AndroidSplash");
        }

        // Safety net: never hold the splash longer than 12s even if the web signal never arrives.
        new Handler(Looper.getMainLooper()).postDelayed(() -> contentReady = true, 12000L);
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        if (interceptVolumeKeys) {
            if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
                dispatchVolumeKey("volumedown", "keydown");
                return true;
            } else if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
                dispatchVolumeKey("volumeup", "keydown");
                return true;
            }
        }
        return super.onKeyDown(keyCode, event);
    }

    @Override
    public boolean onKeyUp(int keyCode, KeyEvent event) {
        if (interceptVolumeKeys) {
            // Forward the key-up too so the web layer can treat a held volume key as a modifier
            // (e.g. Volume Down = Ctrl-equivalent for Paper frame reshaping) and know when it's released.
            if (keyCode == KeyEvent.KEYCODE_VOLUME_DOWN) {
                dispatchVolumeKey("volumedown", "keyup");
                return true;
            } else if (keyCode == KeyEvent.KEYCODE_VOLUME_UP) {
                dispatchVolumeKey("volumeup", "keyup");
                return true;
            }
        }
        return super.onKeyUp(keyCode, event);
    }

    private void dispatchVolumeKey(final String key, final String type) {
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().post(() -> {
                String js = "document.dispatchEvent(new KeyboardEvent('" + type + "', { key: '" + key + "', bubbles: true }));";
                getBridge().getWebView().evaluateJavascript(js, null);
            });
        }
    }

    /** Exposed to the WebView as `window.AndroidSplash`. */
    private class SplashBridge {
        @JavascriptInterface
        public void onWebReady() {
            contentReady = true;
        }
    }
}
