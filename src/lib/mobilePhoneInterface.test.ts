import { describe, expect, it } from 'vitest';
import { describeMobilePhoneInterface } from './mobilePhoneInterface';

describe('mobile phone interface detection', () => {
  it('enables phone chrome on an Android phone in portrait', () => {
    const descriptor = describeMobilePhoneInterface({
      userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-S948U) AppleWebKit/537.36 Mobile Safari/537.36',
      innerWidth: 412,
      innerHeight: 915,
      screenWidth: 412,
      screenHeight: 915,
      devicePixelRatio: 2.625,
      maxTouchPoints: 10,
    });

    expect(descriptor).toMatchObject({
      enabled: true,
      orientation: 'portrait',
      surface: 'phone',
      collapsedTopPaddingClassName: 'pt-12',
      hiddenTopPaddingClassName: 'pt-0',
    });
  });

  it('enables phone chrome on an Android phone in landscape even when the wide edge is desktop-sized', () => {
    const descriptor = describeMobilePhoneInterface({
      userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-S948U) AppleWebKit/537.36 Mobile Safari/537.36',
      innerWidth: 915,
      innerHeight: 412,
      screenWidth: 915,
      screenHeight: 412,
      devicePixelRatio: 2.625,
      maxTouchPoints: 10,
    });

    expect(descriptor).toMatchObject({
      enabled: true,
      orientation: 'landscape',
      surface: 'phone',
    });
  });

  it('enables phone chrome when an Android WebView reports high-density physical display pixels', () => {
    const descriptor = describeMobilePhoneInterface({
      userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-S948U Build/AP3A.240905.015; wv) AppleWebKit/537.36 Version/4.0 Chrome/126 Mobile Safari/537.36',
      innerWidth: 1080,
      innerHeight: 2340,
      screenWidth: 1080,
      screenHeight: 2340,
      devicePixelRatio: 3,
      maxTouchPoints: 10,
    });

    expect(descriptor).toMatchObject({
      enabled: true,
      orientation: 'portrait',
      surface: 'phone',
    });
  });

  it('enables phone chrome when an Android WebView reports Galaxy-class physical pixels at DPR 1', () => {
    const descriptor = describeMobilePhoneInterface({
      userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-S948U Build/AP3A.240905.015; wv) AppleWebKit/537.36 Version/4.0 Chrome/126 Mobile Safari/537.36',
      innerWidth: 1080,
      innerHeight: 2340,
      screenWidth: 1080,
      screenHeight: 2340,
      devicePixelRatio: 1,
      maxTouchPoints: 10,
    });

    expect(descriptor).toMatchObject({
      enabled: true,
      orientation: 'portrait',
      surface: 'phone',
    });
  });

  it('keeps Android tablet and DeX-sized surfaces on the regular interface', () => {
    const tablet = describeMobilePhoneInterface({
      userAgent: 'Mozilla/5.0 (Linux; Android 16; Tablet) AppleWebKit/537.36 Safari/537.36',
      innerWidth: 1280,
      innerHeight: 800,
      screenWidth: 1280,
      screenHeight: 800,
      devicePixelRatio: 1.5,
      maxTouchPoints: 10,
    });
    const dex = describeMobilePhoneInterface({
      userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-S948U) AppleWebKit/537.36 Safari/537.36',
      innerWidth: 1920,
      innerHeight: 1080,
      screenWidth: 1920,
      screenHeight: 1080,
      devicePixelRatio: 1,
      maxTouchPoints: 1,
    });

    expect(tablet.enabled).toBe(false);
    expect(tablet.surface).toBe('tablet-or-dex');
    expect(dex.enabled).toBe(false);
    expect(dex.surface).toBe('tablet-or-dex');
  });

  it('treats an Aluminum OS / ChromeOS desktop-class surface as desktop, not the phone shell', () => {
    // ALOS: Android-based, large desktop display, touch present. Must use the
    // desktop host (tablet-or-dex), never the compact phone chrome.
    const alosDesktop = describeMobilePhoneInterface({
      userAgent: 'Mozilla/5.0 (Linux; Android 17; Desktop) AppleWebKit/537.36 Safari/537.36',
      innerWidth: 2560,
      innerHeight: 1440,
      screenWidth: 2560,
      screenHeight: 1440,
      devicePixelRatio: 1,
      maxTouchPoints: 10,
    });
    // ChromeOS proper (CrOS UA, non-Android) is plain desktop.
    const chromeOs = describeMobilePhoneInterface({
      userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 Safari/537.36',
      innerWidth: 1920,
      innerHeight: 1080,
      screenWidth: 1920,
      screenHeight: 1080,
      devicePixelRatio: 1,
      maxTouchPoints: 0,
    });

    // The real Aluminium_Desktop AVD reports a generic Android emulator UA (no
    // "Desktop" marker) on a large display — verified live 2026-06-17 to render
    // the desktop layout (full menu bar + panels, no phone edge handles).
    const alosEmulator = describeMobilePhoneInterface({
      userAgent: 'Mozilla/5.0 (Linux; Android 14; sdk_gpc_x86_64 Build/UE2A.240712.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/138.0 Mobile Safari/537.36',
      innerWidth: 1800,
      innerHeight: 950,
      screenWidth: 1920,
      screenHeight: 1080,
      devicePixelRatio: 1,
      maxTouchPoints: 10,
    });

    expect(alosDesktop.enabled).toBe(false);
    expect(alosDesktop.surface).toBe('tablet-or-dex');
    expect(chromeOs.enabled).toBe(false);
    expect(chromeOs.surface).toBe('desktop');
    expect(alosEmulator.enabled).toBe(false);
    expect(alosEmulator.surface).toBe('tablet-or-dex');
  });

  it('keeps desktop browsers out of phone mode', () => {
    const descriptor = describeMobilePhoneInterface({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
      innerWidth: 1920,
      innerHeight: 1080,
      screenWidth: 1920,
      screenHeight: 1080,
      devicePixelRatio: 1,
      maxTouchPoints: 0,
    });

    expect(descriptor).toMatchObject({
      enabled: false,
      surface: 'desktop',
      collapsedTopPaddingClassName: 'pt-16',
    });
  });
});
