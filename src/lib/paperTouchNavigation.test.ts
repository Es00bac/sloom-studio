import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PAPER_TOUCH_NAVIGATION_SETTINGS,
  describePaperTouchNavigationAvailability,
  resolvePaperTouchPinchZoom,
  sanitizePaperTouchNavigationSettings,
  shouldRoutePaperPointerToTouchNavigation,
} from './paperTouchNavigation';

describe('paper touch navigation helpers', () => {
  it('detects touch-capable Android and desktop touch screens without enabling desktop mouse-only surfaces', () => {
    expect(describePaperTouchNavigationAvailability({
      userAgent: 'Mozilla/5.0 (Linux; Android 16; SM-S948U) AppleWebKit/537.36 Mobile Safari/537.36',
      maxTouchPoints: 10,
    })).toMatchObject({
      available: true,
      reason: 'touch-points',
    });

    expect(describePaperTouchNavigationAvailability({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125 Safari/537.36',
      maxTouchPoints: 0,
    })).toMatchObject({
      available: false,
      reason: 'no-touch',
    });
  });

  it('routes only finger touch input to navigation so pen and mouse still edit', () => {
    const settings = { ...DEFAULT_PAPER_TOUCH_NAVIGATION_SETTINGS, enabled: true };

    expect(shouldRoutePaperPointerToTouchNavigation({
      available: true,
      pointerType: 'touch',
      settings,
    })).toBe(true);
    expect(shouldRoutePaperPointerToTouchNavigation({
      available: true,
      pointerType: 'pen',
      settings,
    })).toBe(false);
    expect(shouldRoutePaperPointerToTouchNavigation({
      available: true,
      pointerType: 'mouse',
      settings,
    })).toBe(false);
    expect(shouldRoutePaperPointerToTouchNavigation({
      available: true,
      pointerType: 'touch',
      settings: { ...settings, enabled: false },
    })).toBe(false);
  });

  it('sanitizes persisted gesture settings back to implemented Paper navigation actions', () => {
    expect(sanitizePaperTouchNavigationSettings({
      enabled: true,
      oneFingerPan: false,
      pinchZoom: true,
      unsupported: true,
    })).toEqual({
      enabled: true,
      oneFingerPan: false,
      pinchZoom: true,
    });

    expect(sanitizePaperTouchNavigationSettings({ enabled: false, pinchZoom: false })).toEqual({
      enabled: false,
      oneFingerPan: true,
      pinchZoom: false,
    });
  });

  it('resolves pinch zoom from two-finger distance and clamps unsafe values', () => {
    expect(resolvePaperTouchPinchZoom({
      startDistance: 100,
      currentDistance: 150,
      startZoom: 1,
      minZoom: 0.25,
      maxZoom: 3,
    })).toBe(1.5);
    expect(resolvePaperTouchPinchZoom({
      startDistance: 100,
      currentDistance: 1_000,
      startZoom: 1,
      minZoom: 0.25,
      maxZoom: 3,
    })).toBe(3);
    expect(resolvePaperTouchPinchZoom({
      startDistance: 0,
      currentDistance: 100,
      startZoom: 1.25,
      minZoom: 0.25,
      maxZoom: 3,
    })).toBe(1.25);
  });
});
