import { useEffect, useState } from 'react';

export interface PaperTouchNavigationSettings {
  enabled: boolean;
  oneFingerPan: boolean;
  pinchZoom: boolean;
}

export interface PaperTouchNavigationAvailabilitySnapshot {
  userAgent?: string;
  maxTouchPoints?: number;
}

export interface PaperTouchNavigationAvailabilityDescriptor {
  available: boolean;
  reason: 'touch-points' | 'mobile-user-agent' | 'no-touch';
}

export interface PaperTouchPointerRouteInput {
  available: boolean;
  pointerType: string;
  settings: PaperTouchNavigationSettings;
}

export interface PaperTouchPinchZoomInput {
  startDistance: number;
  currentDistance: number;
  startZoom: number;
  minZoom?: number;
  maxZoom?: number;
}

export const DEFAULT_PAPER_TOUCH_NAVIGATION_SETTINGS: PaperTouchNavigationSettings = {
  enabled: true,
  oneFingerPan: true,
  pinchZoom: true,
};

export function describePaperTouchNavigationAvailability(
  snapshot: PaperTouchNavigationAvailabilitySnapshot,
): PaperTouchNavigationAvailabilityDescriptor {
  const maxTouchPoints = Number.isFinite(snapshot.maxTouchPoints) ? Math.max(0, snapshot.maxTouchPoints ?? 0) : 0;
  if (maxTouchPoints > 0) {
    return { available: true, reason: 'touch-points' };
  }

  if (/android|iphone|ipad|ipod|mobile/i.test(snapshot.userAgent ?? '')) {
    return { available: true, reason: 'mobile-user-agent' };
  }

  return { available: false, reason: 'no-touch' };
}

export function readPaperTouchNavigationAvailabilitySnapshot(): PaperTouchNavigationAvailabilitySnapshot {
  if (typeof window === 'undefined') {
    return { userAgent: '', maxTouchPoints: 0 };
  }

  return {
    userAgent: window.navigator.userAgent,
    maxTouchPoints: window.navigator.maxTouchPoints,
  };
}

export function usePaperTouchNavigationAvailabilityDescriptor(): PaperTouchNavigationAvailabilityDescriptor {
  const [descriptor, setDescriptor] = useState(() =>
    describePaperTouchNavigationAvailability(readPaperTouchNavigationAvailabilitySnapshot()),
  );

  useEffect(() => {
    const update = () => {
      setDescriptor(describePaperTouchNavigationAvailability(readPaperTouchNavigationAvailabilitySnapshot()));
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, []);

  return descriptor;
}

export function shouldRoutePaperPointerToTouchNavigation(input: PaperTouchPointerRouteInput): boolean {
  if (!input.available || !input.settings.enabled) return false;
  if (input.pointerType !== 'touch') return false;
  return input.settings.oneFingerPan || input.settings.pinchZoom;
}

export function sanitizePaperTouchNavigationSettings(value: unknown): PaperTouchNavigationSettings {
  const candidate = value && typeof value === 'object'
    ? value as Partial<PaperTouchNavigationSettings>
    : {};

  return {
    enabled: typeof candidate.enabled === 'boolean'
      ? candidate.enabled
      : DEFAULT_PAPER_TOUCH_NAVIGATION_SETTINGS.enabled,
    oneFingerPan: typeof candidate.oneFingerPan === 'boolean'
      ? candidate.oneFingerPan
      : DEFAULT_PAPER_TOUCH_NAVIGATION_SETTINGS.oneFingerPan,
    pinchZoom: typeof candidate.pinchZoom === 'boolean'
      ? candidate.pinchZoom
      : DEFAULT_PAPER_TOUCH_NAVIGATION_SETTINGS.pinchZoom,
  };
}

export function resolvePaperTouchPinchZoom(input: PaperTouchPinchZoomInput): number {
  if (!Number.isFinite(input.startDistance) || !Number.isFinite(input.currentDistance) || input.startDistance <= 0 || input.currentDistance <= 0) {
    return input.startZoom;
  }

  const minZoom = Number.isFinite(input.minZoom) ? input.minZoom ?? 0.1 : 0.1;
  const maxZoom = Number.isFinite(input.maxZoom) ? input.maxZoom ?? 4 : 4;
  const nextZoom = input.startZoom * (input.currentDistance / input.startDistance);
  return Math.min(Math.max(nextZoom, minZoom), maxZoom);
}
