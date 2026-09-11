import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  createPaperObjectLibraryItem,
  normalizePaperObjectLibraryItems,
  removePaperObjectLibraryItem,
  upsertPaperObjectLibraryItem,
  type PaperObjectLibraryItem,
  type PaperObjectLibrarySaveInput,
} from '../lib/paperObjectLibrary';
import type { PaperFrame } from '../types/paper';

/** Independent local persistence for reusable Paper object snippets (MH-073). */

interface PaperObjectLibraryState {
  items: PaperObjectLibraryItem[];
  saveFrame: (frame: PaperFrame, input: PaperObjectLibrarySaveInput) => string | undefined;
  removeItem: (id: string) => void;
  clear: () => void;
}

function createQuotaSafeStorage() {
  return createJSONStorage(() => {
    const base = window.localStorage;
    return {
      getItem: (name: string) => {
        try {
          return base.getItem(name);
        } catch (error) {
          console.warn('[paperObjectLibraryStore] persisted library unavailable:', error);
          return null;
        }
      },
      setItem: (name: string, value: string) => {
        try {
          base.setItem(name, value);
        } catch (error) {
          console.warn('[paperObjectLibraryStore] library persist skipped:', error);
        }
      },
      removeItem: (name: string) => {
        try {
          base.removeItem(name);
        } catch (error) {
          console.warn('[paperObjectLibraryStore] persisted library could not be removed:', error);
        }
      },
    };
  });
}

export const usePaperObjectLibraryStore = create<PaperObjectLibraryState>()(
  persist(
    (set) => ({
      items: [],
      saveFrame: (frame, input) => {
        const item = createPaperObjectLibraryItem(frame, input);
        if (!item) return undefined;
        set((state) => ({ items: upsertPaperObjectLibraryItem(state.items, item) }));
        return item.id;
      },
      removeItem: (id) => set((state) => ({ items: removePaperObjectLibraryItem(state.items, id) })),
      clear: () => set({ items: [] }),
    }),
    {
      name: 'sloom.paper-object-library',
      storage: createQuotaSafeStorage(),
      partialize: (state) => ({ items: state.items }),
      merge: (persisted, current) => ({
        ...current,
        items: normalizePaperObjectLibraryItems((persisted as { items?: unknown } | undefined)?.items),
      }),
    },
  ),
);
