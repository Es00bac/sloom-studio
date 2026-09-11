package studio.sloom.slstapp;

import android.app.Activity;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Native immersive fullscreen for the Android WebView. The web Fullscreen API is a no-op
 * inside a Capacitor WebView, so the JS fullscreen toggle calls setFullscreen here, which
 * hides/shows the status and navigation bars (immersive sticky) on the activity window.
 */
@CapacitorPlugin(name = "SignalLoomSystemUi")
public class SignalLoomSystemUiPlugin extends Plugin {

    @PluginMethod
    public void setFullscreen(PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", Boolean.TRUE));
        final Activity activity = getActivity();
        if (activity == null) {
            call.reject("Activity is not available");
            return;
        }

        activity.runOnUiThread(() -> {
            final Window window = activity.getWindow();
            final WindowInsetsControllerCompat controller =
                WindowCompat.getInsetsController(window, window.getDecorView());

            // When fullscreen, let content draw behind where the bars were.
            WindowCompat.setDecorFitsSystemWindows(window, !enabled);

            if (enabled) {
                controller.setSystemBarsBehavior(
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                controller.hide(WindowInsetsCompat.Type.systemBars());
            } else {
                controller.show(WindowInsetsCompat.Type.systemBars());
            }

            final JSObject result = new JSObject();
            result.put("enabled", enabled);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void setInterceptVolumeKeys(PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", Boolean.FALSE));
        MainActivity.interceptVolumeKeys = enabled;
        final JSObject result = new JSObject();
        result.put("enabled", enabled);
        call.resolve(result);
    }
}
