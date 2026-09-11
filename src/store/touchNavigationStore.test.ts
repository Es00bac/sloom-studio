import { describe, expect, it } from 'vitest';
import { sanitizeTouchNavigationState } from './touchNavigationStore';

describe('touchNavigationStore', () => {
  it('sanitizes persisted Paper touch navigation state', () => {
    expect(sanitizeTouchNavigationState({
      paper: {
        enabled: false,
        oneFingerPan: false,
        pinchZoom: true,
        ignored: true,
      },
      image: {
        enabled: true,
        oneFingerPan: false,
        pinchZoom: false,
        ignored: true,
      },
    })).toEqual({
      paper: {
        enabled: false,
        oneFingerPan: false,
        pinchZoom: true,
      },
      image: {
        enabled: true,
        oneFingerPan: false,
        pinchZoom: false,
      },
    });

    expect(sanitizeTouchNavigationState(undefined)).toEqual({
      paper: {
        enabled: true,
        oneFingerPan: true,
        pinchZoom: true,
      },
      image: {
        enabled: true,
        oneFingerPan: true,
        pinchZoom: true,
      },
    });
  });
});
