import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  createPaperComicSfxDesign,
  normalizePaperComicSfxDesign,
  type PaperComicSfxDesign,
} from '../lib/paperComicSfx';

export interface SavedComicSfxStyle {
  id: string;
  name: string;
  design: PaperComicSfxDesign;
  createdAt: number;
  updatedAt: number;
}

interface ComicSfxDesignerState {
  lastDesign: PaperComicSfxDesign;
  savedStyles: SavedComicSfxStyle[];
  setLastDesign: (design: PaperComicSfxDesign) => void;
  saveStyle: (name: string, design: PaperComicSfxDesign) => string;
  deleteStyle: (styleId: string) => void;
}

const MAX_SAVED_COMIC_SFX_STYLES = 36;

export const useComicSfxDesignerStore = create<ComicSfxDesignerState>()(
  persist(
    (set) => ({
      lastDesign: createPaperComicSfxDesign('bang'),
      savedStyles: [],
      setLastDesign: (design) => set({ lastDesign: normalizePaperComicSfxDesign(design) }),
      saveStyle: (name, design) => {
        const timestamp = Date.now();
        const styleId = `sfx-style-${globalThis.crypto?.randomUUID?.() ?? `${timestamp}-${Math.floor(Math.random() * 1000)}`}`;
        const safeName = name.trim().slice(0, 64) || 'Comic SFX Style';
        const savedStyle: SavedComicSfxStyle = {
          id: styleId,
          name: safeName,
          design: normalizePaperComicSfxDesign(design),
          createdAt: timestamp,
          updatedAt: timestamp,
        };

        set((state) => ({
          lastDesign: savedStyle.design,
          savedStyles: [
            savedStyle,
            ...state.savedStyles.filter((style) => style.id !== styleId),
          ].slice(0, MAX_SAVED_COMIC_SFX_STYLES),
        }));

        return styleId;
      },
      deleteStyle: (styleId) =>
        set((state) => ({
          savedStyles: state.savedStyles.filter((style) => style.id !== styleId),
        })),
    }),
    {
      name: 'comic-sfx-designer-storage',
      merge: (persistedState, currentState) => {
        const typedPersistedState = persistedState as Partial<ComicSfxDesignerState> | undefined;
        const lastDesign = typedPersistedState?.lastDesign
          ? normalizePaperComicSfxDesign({
              ...createPaperComicSfxDesign(typedPersistedState.lastDesign.presetId ?? 'bang'),
              ...typedPersistedState.lastDesign,
            })
          : currentState.lastDesign;
        return {
          ...currentState,
          ...typedPersistedState,
          lastDesign,
          savedStyles: (typedPersistedState?.savedStyles ?? []).map((style) => ({
            ...style,
            design: normalizePaperComicSfxDesign({
              ...createPaperComicSfxDesign(style.design?.presetId ?? 'bang'),
              ...style.design,
            }),
          })),
        };
      },
    },
  ),
);
