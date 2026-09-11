import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export type MobileChromeMode = 'collapsed' | 'expanded' | 'hidden';
export type MobileEdgeDrawerId = 'top' | 'source' | 'panels' | 'assets';

interface MobileInterfaceState {
  chromeMode: MobileChromeMode;
  activeEdgeDrawer: MobileEdgeDrawerId | null;
  setChromeMode: (mode: MobileChromeMode) => void;
  setActiveEdgeDrawer: (drawerId: MobileEdgeDrawerId | null) => void;
  toggleEdgeDrawer: (drawerId: MobileEdgeDrawerId) => void;
  hideInterface: () => void;
  restoreInterface: () => void;
  cycleChromeMode: () => void;
}

const memoryMobileInterfaceStorage = new Map<string, string>();

export function getMobileInterfacePersistenceStorage(): StateStorage {
  if (typeof window === 'undefined' || !window.localStorage) {
    return createMemoryMobileInterfaceStorage();
  }

  try {
    const probeKey = '__signal_loom_mobile_interface_storage_probe__';
    window.localStorage.setItem(probeKey, probeKey);
    window.localStorage.removeItem(probeKey);
    return window.localStorage;
  } catch {
    return createMemoryMobileInterfaceStorage();
  }
}

function createMemoryMobileInterfaceStorage(): StateStorage {
  return {
    getItem: (name) => memoryMobileInterfaceStorage.get(name) ?? null,
    setItem: (name, value) => {
      memoryMobileInterfaceStorage.set(name, value);
    },
    removeItem: (name) => {
      memoryMobileInterfaceStorage.delete(name);
    },
  };
}

export function sanitizeMobileChromeMode(value: unknown): MobileChromeMode {
  return value === 'expanded' || value === 'hidden' || value === 'collapsed' ? value : 'collapsed';
}

export function sanitizeMobileEdgeDrawerId(value: unknown): MobileEdgeDrawerId | null {
  return value === 'top' || value === 'source' || value === 'panels' || value === 'assets' ? value : null;
}

export function resolveMobileEdgeDrawerToggle(
  currentDrawerId: MobileEdgeDrawerId | null,
  requestedDrawerId: MobileEdgeDrawerId,
): MobileEdgeDrawerId | null {
  return currentDrawerId === requestedDrawerId ? null : requestedDrawerId;
}

export function resolveNextMobileChromeModeForApplicationTab(mode: MobileChromeMode): MobileChromeMode {
  return mode === 'hidden' ? 'collapsed' : 'hidden';
}

function resolveChromeModeForActiveDrawer(drawerId: MobileEdgeDrawerId | null, currentMode: MobileChromeMode): MobileChromeMode {
  if (drawerId === 'top') {
    return 'expanded';
  }

  if (currentMode === 'hidden') {
    return 'hidden';
  }

  return drawerId ? 'collapsed' : currentMode === 'expanded' ? 'collapsed' : currentMode;
}

export const useMobileInterfaceStore = create<MobileInterfaceState>()(
  persist(
    (set) => ({
      chromeMode: 'collapsed',
      activeEdgeDrawer: null,
      setChromeMode: (mode) => {
        const chromeMode = sanitizeMobileChromeMode(mode);
        set({
          chromeMode,
          activeEdgeDrawer: chromeMode === 'hidden' ? null : chromeMode === 'expanded' ? 'top' : null,
        });
      },
      setActiveEdgeDrawer: (drawerId) =>
        set((state) => {
          const activeEdgeDrawer = sanitizeMobileEdgeDrawerId(drawerId);
          return {
            activeEdgeDrawer,
            chromeMode: resolveChromeModeForActiveDrawer(activeEdgeDrawer, state.chromeMode),
          };
        }),
      toggleEdgeDrawer: (drawerId) =>
        set((state) => {
          const activeEdgeDrawer = resolveMobileEdgeDrawerToggle(state.activeEdgeDrawer, drawerId);
          return {
            activeEdgeDrawer,
            chromeMode: resolveChromeModeForActiveDrawer(activeEdgeDrawer, state.chromeMode),
          };
        }),
      hideInterface: () => set({ chromeMode: 'hidden', activeEdgeDrawer: null }),
      restoreInterface: () => set({ chromeMode: 'collapsed', activeEdgeDrawer: null }),
      cycleChromeMode: () =>
        set((state) => {
          const chromeMode = state.chromeMode === 'hidden'
            ? 'collapsed'
            : state.chromeMode === 'collapsed'
              ? 'expanded'
              : 'hidden';
          return {
            chromeMode,
            activeEdgeDrawer: chromeMode === 'expanded' ? 'top' : null,
          };
        }),
    }),
    {
      name: 'signal-loom-mobile-interface',
      storage: createJSONStorage(getMobileInterfacePersistenceStorage),
      partialize: (state) => ({ chromeMode: state.chromeMode, activeEdgeDrawer: state.activeEdgeDrawer }),
      merge: (persisted, current) => ({
        ...current,
        chromeMode: sanitizeMobileChromeMode((persisted as Partial<MobileInterfaceState> | undefined)?.chromeMode),
        activeEdgeDrawer: sanitizeMobileEdgeDrawerId((persisted as Partial<MobileInterfaceState> | undefined)?.activeEdgeDrawer),
      }),
    },
  ),
);
