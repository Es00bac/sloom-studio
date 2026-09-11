import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readPngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(path);
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

describe('Android launch splash source guards', () => {
  it('uses the Sloom Studio splash artwork for the Android launch theme', () => {
    const root = process.cwd();
    const electronSplashPath = join(root, 'electron/assets/signal-loom-splash.png');
    const androidSplashPath = join(root, 'android/app/src/main/res/drawable-nodpi/signal_loom_splash.png');
    const launchDrawablePath = join(root, 'android/app/src/main/res/drawable/signal_loom_launch_splash.xml');
    const stylesPath = join(root, 'android/app/src/main/res/values/styles.xml');
    const manifestPath = join(root, 'android/app/src/main/AndroidManifest.xml');
    const mainActivityPath = join(root, 'android/app/src/main/java/studio/sloom/slstapp/MainActivity.java');

    expect(existsSync(electronSplashPath)).toBe(true);
    expect(existsSync(androidSplashPath)).toBe(true);
    expect(existsSync(launchDrawablePath)).toBe(true);

    expect(readPngSize(androidSplashPath)).toEqual(readPngSize(electronSplashPath));
    expect(readFileSync(androidSplashPath)).toEqual(readFileSync(electronSplashPath));

    const launchDrawable = readFileSync(launchDrawablePath, 'utf8');
    expect(launchDrawable).not.toContain('android:drawable="#020711"');
    expect(launchDrawable).toContain('<shape android:shape="rectangle">');
    expect(launchDrawable).toContain('<solid android:color="#020711" />');
    expect(launchDrawable).toContain('@drawable/signal_loom_splash');
    expect(launchDrawable).toContain('android:gravity="center"');
    expect(launchDrawable).toContain('#020711');

    const styles = readFileSync(stylesPath, 'utf8');
    expect(styles).toContain('<style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">');
    expect(styles).toContain('<item name="windowSplashScreenBackground">#020711</item>');
    // The Android 12 splash icon is the brand mark (rings), not the full splash art (which gets
    // circle-masked); the full art remains the windowBackground for the post-splash handoff.
    expect(styles).toContain('<item name="windowSplashScreenAnimatedIcon">@mipmap/ic_launcher_foreground</item>');
    expect(styles).toContain('<item name="windowSplashScreenIconBackgroundColor">#020711</item>');
    expect(styles).toContain('<item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>');
    expect(styles).toContain('<item name="android:background">@drawable/signal_loom_launch_splash</item>');

    const manifest = readFileSync(manifestPath, 'utf8');
    expect(manifest).toContain('android:theme="@style/AppTheme.NoActionBarLaunch"');

    const mainActivity = readFileSync(mainActivityPath, 'utf8');
    expect(mainActivity).toContain('import androidx.core.splashscreen.SplashScreen;');
    expect(mainActivity).toMatch(/SplashScreen\.installSplashScreen\(this\);[\s\S]*super\.onCreate\(savedInstanceState\);/);
    // The native splash is held on screen until the web app reports its first paint, so it covers
    // the whole cold start instead of flashing to a blank webview.
    expect(mainActivity).toContain('setKeepOnScreenCondition');
    expect(mainActivity).toContain('AndroidSplash');
  });
});
