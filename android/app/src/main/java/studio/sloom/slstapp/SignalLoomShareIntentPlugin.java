package studio.sloom.slstapp;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Surfaces ACTION_SEND ("share to Sloom Studio" from another app's share sheet) to the web layer.
 *
 * `@capacitor/app`'s `appUrlOpen` event only recognizes `Intent.ACTION_VIEW` + `intent.getData()`
 * (see AppPlugin.handleOnNewIntent in node_modules/@capacitor/app) — a share-to intent's URI lives
 * in `EXTRA_STREAM` instead, under `Intent.ACTION_SEND`, so it is invisible to that plugin
 * entirely. This plugin mirrors AppPlugin's own two-mechanism approach exactly, just for
 * ACTION_SEND + EXTRA_STREAM instead of ACTION_VIEW + getData():
 *  - `getLaunchShareIntent()` mirrors `AppPlugin.getLaunchUrl()` — a direct read of the Activity's
 *    current intent, for the JS side to poll once on cold start (the same explicit, deterministic
 *    read androidFileOpen.ts already relies on via `App.getLaunchUrl()`, verified end-to-end on
 *    device per docs/notes/718 — this plugin reuses that exact reliability pattern rather than
 *    depending solely on the retained-event race below).
 *  - `handleOnNewIntent` mirrors `AppPlugin.handleOnNewIntent` — fires a `shareIntent` event
 *    (`notifyListeners(..., true)`, retained-until-consumed) for the warm-start case (already
 *    running, singleTask -> onNewIntent). `BridgeActivity.onCreate()` also synthesizes a call to
 *    `onNewIntent(getIntent())` before the WebView loads (see BridgeActivity.java /
 *    Bridge.onNewIntent), so this same override observes cold-start ACTION_SEND intents too — the
 *    retained event is a second chance to catch it if `getLaunchShareIntent()` is called too late,
 *    but is not relied on as the only path.
 *
 * The TS side (src/lib/androidFileOpen.ts) reads `getLaunchShareIntent()` on cold start and listens
 * for the `shareIntent` event for warm start, then routes the URI through the SAME
 * `readOpenedUriBytes` + `onOpen` path ACTION_VIEW uses — only the capture point differs;
 * everything downstream (content:// byte reading via the unpatched `CapacitorWebFetch`, filename
 * resolution, opening in the editor) is reused as-is.
 *
 * SEND_MULTIPLE is intentionally not handled — a single shared item covers the "share to Signal
 * Loom" use case this ships; multi-item sharing would need its own UI to pick which one to open.
 */
@CapacitorPlugin(name = "SignalLoomShareIntent")
public class SignalLoomShareIntentPlugin extends Plugin {
    private static final String EVENT_SHARE_INTENT = "shareIntent";

    @PluginMethod
    public void getLaunchShareIntent(PluginCall call) {
        Uri uri = extractShareUri(getActivity() != null ? getActivity().getIntent() : null);
        JSObject result = new JSObject();
        if (uri != null) {
            result.put("url", uri.toString());
            String mimeType = getActivity().getIntent().getType();
            if (mimeType != null) {
                result.put("mimeType", mimeType);
            }
        }
        call.resolve(result);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        Uri uri = extractShareUri(intent);
        if (uri == null) {
            return;
        }
        JSObject data = new JSObject();
        data.put("url", uri.toString());
        String mimeType = intent.getType();
        if (mimeType != null) {
            data.put("mimeType", mimeType);
        }
        notifyListeners(EVENT_SHARE_INTENT, data, true);
    }

    /** A single ACTION_SEND EXTRA_STREAM Uri, or null for anything else (wrong action, no stream,
     * SEND_MULTIPLE — which carries an ArrayList under EXTRA_STREAM instead of a single Uri and so
     * simply fails this Parcelable read and returns null). */
    @SuppressWarnings("deprecation")
    private Uri extractShareUri(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) {
            return null;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class);
        }
        return intent.getParcelableExtra(Intent.EXTRA_STREAM);
    }
}
