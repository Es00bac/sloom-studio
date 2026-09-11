import { useEffect, useState } from 'react';

export type MobilePhoneOrientation = 'portrait' | 'landscape';
export type MobilePhoneSurface = 'phone' | 'tablet-or-dex' | 'desktop';

export interface MobilePhoneInterfaceSnapshot {
  userAgent?: string;
  innerWidth: number;
  innerHeight: number;
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio?: number;
  maxTouchPoints?: number;
}

export interface MobilePhoneInterfaceDescriptor {
  enabled: boolean;
  orientation: MobilePhoneOrientation;
  surface: MobilePhoneSurface;
  topbarHeightPx: number;
  expandedDrawerMaxHeightCss: string;
  collapsedTopPaddingClassName: 'pt-12' | 'pt-16';
  hiddenTopPaddingClassName: 'pt-0' | 'pt-16';
  reason: string;
}

const PHONE_SHORT_EDGE_MAX_CSS_PX = 760;
const PHONE_LANDSCAPE_LONG_EDGE_MIN_CSS_PX = 820;
const PHONE_PHYSICAL_SHORT_EDGE_MAX_PX = 1200;
const PHONE_PHYSICAL_LONG_EDGE_MIN_PX = 2000;
const COLLAPSED_TOPBAR_HEIGHT_PX = 48;

export function describeMobilePhoneInterface(snapshot: MobilePhoneInterfaceSnapshot): MobilePhoneInterfaceDescriptor {
  const innerWidth = positiveFinite(snapshot.innerWidth);
  const innerHeight = positiveFinite(snapshot.innerHeight);
  const screenWidth = positiveFinite(snapshot.screenWidth);
  const screenHeight = positiveFinite(snapshot.screenHeight);
  const shortViewportEdge = Math.min(innerWidth, innerHeight);
  const longViewportEdge = Math.max(innerWidth, innerHeight);
  const shortScreenEdge = Math.min(screenWidth, screenHeight);
  const longScreenEdge = Math.max(screenWidth, screenHeight);
  const orientation: MobilePhoneOrientation = innerHeight >= innerWidth ? 'portrait' : 'landscape';
  const userAgent = snapshot.userAgent ?? '';
  const isAndroid = /android/i.test(userAgent);
  const isMobileUa = /mobile|iphone|ipod/i.test(userAgent);
  const isDesktopUa = !isAndroid && !isMobileUa;
  const maxTouchPoints = snapshot.maxTouchPoints ?? 0;
  const hasTouch = maxTouchPoints > 0;
  const devicePixelRatio = snapshot.devicePixelRatio ?? 1;
  const phoneAspect = longScreenEdge / Math.max(1, shortScreenEdge);
  const compactTouchViewport = shortViewportEdge <= PHONE_SHORT_EDGE_MAX_CSS_PX;
  const compactTouchScreen = shortScreenEdge <= PHONE_SHORT_EDGE_MAX_CSS_PX;
  const normalizedShortViewportEdge = shortViewportEdge / Math.max(1, devicePixelRatio);
  const normalizedShortScreenEdge = shortScreenEdge / Math.max(1, devicePixelRatio);
  const highDensityPhoneShape =
    devicePixelRatio >= 2 &&
    phoneAspect >= 1.65 &&
    shortViewportEdge <= PHONE_SHORT_EDGE_MAX_CSS_PX &&
    longViewportEdge >= PHONE_LANDSCAPE_LONG_EDGE_MIN_CSS_PX;
  const highDensityPhysicalPhoneShape =
    isAndroid &&
    hasTouch &&
    devicePixelRatio >= 2 &&
    phoneAspect >= 1.65 &&
    normalizedShortViewportEdge <= PHONE_SHORT_EDGE_MAX_CSS_PX &&
    normalizedShortScreenEdge <= PHONE_SHORT_EDGE_MAX_CSS_PX &&
    longViewportEdge >= PHONE_LANDSCAPE_LONG_EDGE_MIN_CSS_PX;
  const physicalPixelPhoneShape =
    isAndroid &&
    maxTouchPoints >= 2 &&
    phoneAspect >= 1.65 &&
    shortViewportEdge <= PHONE_PHYSICAL_SHORT_EDGE_MAX_PX &&
    shortScreenEdge <= PHONE_PHYSICAL_SHORT_EDGE_MAX_PX &&
    longScreenEdge >= PHONE_PHYSICAL_LONG_EDGE_MIN_PX;

  if ((isDesktopUa && !physicalPixelPhoneShape) || !hasTouch) {
    return buildDescriptor(false, orientation, 'desktop', 'desktop-or-non-touch');
  }

  if ((isAndroid || isMobileUa) && (compactTouchViewport || compactTouchScreen || highDensityPhoneShape || highDensityPhysicalPhoneShape || physicalPixelPhoneShape)) {
    return buildDescriptor(true, orientation, 'phone', orientation === 'portrait' ? 'android-phone-portrait' : 'android-phone-landscape');
  }

  return buildDescriptor(false, orientation, 'tablet-or-dex', 'large-android-or-touch-surface');
}

export function readMobilePhoneInterfaceSnapshot(): MobilePhoneInterfaceSnapshot {
  if (typeof window === 'undefined') {
    return {
      userAgent: '',
      innerWidth: 1920,
      innerHeight: 1080,
      screenWidth: 1920,
      screenHeight: 1080,
      devicePixelRatio: 1,
      maxTouchPoints: 0,
    };
  }

  return {
    userAgent: window.navigator.userAgent,
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    devicePixelRatio: window.devicePixelRatio,
    maxTouchPoints: window.navigator.maxTouchPoints,
  };
}

export function useMobilePhoneInterfaceDescriptor(): MobilePhoneInterfaceDescriptor {
  const [descriptor, setDescriptor] = useState(() => describeMobilePhoneInterface(readMobilePhoneInterfaceSnapshot()));

  useEffect(() => {
    const update = () => {
      setDescriptor(describeMobilePhoneInterface(readMobilePhoneInterfaceSnapshot()));
    };

    update();
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    window.visualViewport?.addEventListener('resize', update);

    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      window.visualViewport?.removeEventListener('resize', update);
    };
  }, []);

  return descriptor;
}

function buildDescriptor(
  enabled: boolean,
  orientation: MobilePhoneOrientation,
  surface: MobilePhoneSurface,
  reason: string,
): MobilePhoneInterfaceDescriptor {
  return {
    enabled,
    orientation,
    surface,
    topbarHeightPx: enabled ? COLLAPSED_TOPBAR_HEIGHT_PX : 64,
    expandedDrawerMaxHeightCss: orientation === 'portrait' ? 'min(72vh, 34rem)' : 'min(66vh, 26rem)',
    collapsedTopPaddingClassName: enabled ? 'pt-12' : 'pt-16',
    hiddenTopPaddingClassName: enabled ? 'pt-0' : 'pt-16',
    reason,
  };
}

function positiveFinite(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 1;
}
