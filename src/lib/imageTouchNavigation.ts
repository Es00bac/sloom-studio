import {
  DEFAULT_PAPER_TOUCH_NAVIGATION_SETTINGS,
  shouldRoutePaperPointerToTouchNavigation,
  type PaperTouchNavigationSettings,
} from './paperTouchNavigation';

export type ImageTouchNavigationSettings = PaperTouchNavigationSettings;

export const DEFAULT_IMAGE_TOUCH_NAVIGATION_SETTINGS: ImageTouchNavigationSettings = {
  ...DEFAULT_PAPER_TOUCH_NAVIGATION_SETTINGS,
};

export function shouldRouteImagePointerToTouchNavigation(input: {
  available: boolean;
  pointerType: string;
  settings: ImageTouchNavigationSettings;
}): boolean {
  return shouldRoutePaperPointerToTouchNavigation(input);
}
