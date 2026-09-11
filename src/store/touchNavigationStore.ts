import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';
import {
  DEFAULT_PAPER_TOUCH_NAVIGATION_SETTINGS,
  sanitizePaperTouchNavigationSettings,
  type PaperTouchNavigationSettings,
} from '../lib/paperTouchNavigation';

export interface TouchNavigationStateSnapshot {
  paper: PaperTouchNavigationSettings;
  image: PaperTouchNavigationSettings;
}

interface TouchNavigationState extends TouchNavigationStateSnapshot {
  setPaperTouchNavigationEnabled: (enabled: boolean) => void;
  setPaperTouchNavigationGesture: (gesture: keyof Omit<PaperTouchNavigationSettings, 'enabled'>, enabled: boolean) => void;
  setImageTouchNavigationEnabled: (enabled: boolean) => void;
  setImageTouchNavigationGesture: (gesture: keyof Omit<PaperTouchNavigationSettings, 'enabled'>, enabled: boolean) => void;
}

const memoryTouchNavigationStorage = new Map<string, string>();

export function getTouchNavigationPersistenceStorage(): StateStorage {
  if (typeof window === 'undefined' || !window.localStorage) {
    return createMemoryTouchNavigationStorage();
  }

  try {
    const probeKey = '__signal_loom_touch_navigation_storage_probe__';
    window.localStorage.setItem(probeKey, probeKey);
    window.localStorage.removeItem(probeKey);
    return window.localStorage;
  } catch {
    return createMemoryTouchNavigationStorage();
  }
}

function createMemoryTouchNavigationStorage(): StateStorage {
  return {
    getItem: (name) => memoryTouchNavigationStorage.get(name) ?? null,
    setItem: (name, value) => {
      memoryTouchNavigationStorage.set(name, value);
    },
    removeItem: (name) => {
      memoryTouchNavigationStorage.delete(name);
    },
  };
}

export function sanitizeTouchNavigationState(value: unknown): TouchNavigationStateSnapshot {
  const candidate = value && typeof value === 'object'
    ? value as Partial<TouchNavigationStateSnapshot>
    : {};

  return {
    paper: sanitizePaperTouchNavigationSettings(candidate.paper),
    image: sanitizePaperTouchNavigationSettings(candidate.image),
  };
}

export const useTouchNavigationStore = create<TouchNavigationState>()(
  persist(
    (set) => ({
      paper: DEFAULT_PAPER_TOUCH_NAVIGATION_SETTINGS,
      image: DEFAULT_PAPER_TOUCH_NAVIGATION_SETTINGS,
      setPaperTouchNavigationEnabled: (enabled) =>
        set((state) => ({
          paper: sanitizePaperTouchNavigationSettings({
            ...state.paper,
            enabled,
          }),
        })),
      setPaperTouchNavigationGesture: (gesture, enabled) =>
        set((state) => ({
          paper: sanitizePaperTouchNavigationSettings({
            ...state.paper,
            [gesture]: enabled,
          }),
        })),
      setImageTouchNavigationEnabled: (enabled) =>
        set((state) => ({
          image: sanitizePaperTouchNavigationSettings({
            ...state.image,
            enabled,
          }),
        })),
      setImageTouchNavigationGesture: (gesture, enabled) =>
        set((state) => ({
          image: sanitizePaperTouchNavigationSettings({
            ...state.image,
            [gesture]: enabled,
          }),
        })),
    }),
    {
      name: 'signal-loom-touch-navigation',
      storage: createJSONStorage(getTouchNavigationPersistenceStorage),
      partialize: (state) => ({ paper: state.paper, image: state.image }),
      merge: (persisted, current) => ({
        ...current,
        ...sanitizeTouchNavigationState(persisted),
      }),
    },
  ),
);
