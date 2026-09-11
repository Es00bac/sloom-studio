import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMAGE_TOUCH_NAVIGATION_SETTINGS,
  shouldRouteImagePointerToTouchNavigation,
} from './imageTouchNavigation';

describe('image touch navigation helpers', () => {
  it('routes only finger touch input to Image navigation so pen and mouse keep editing', () => {
    const settings = { ...DEFAULT_IMAGE_TOUCH_NAVIGATION_SETTINGS, enabled: true };

    expect(shouldRouteImagePointerToTouchNavigation({
      available: true,
      pointerType: 'touch',
      settings,
    })).toBe(true);
    expect(shouldRouteImagePointerToTouchNavigation({
      available: true,
      pointerType: 'pen',
      settings,
    })).toBe(false);
    expect(shouldRouteImagePointerToTouchNavigation({
      available: true,
      pointerType: 'mouse',
      settings,
    })).toBe(false);
    expect(shouldRouteImagePointerToTouchNavigation({
      available: true,
      pointerType: 'touch',
      settings: { ...settings, enabled: false },
    })).toBe(false);
  });
});
