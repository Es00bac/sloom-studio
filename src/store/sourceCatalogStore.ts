import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import {
  buildSourceCatalogProjectRecord,
  parsePersistedSourceCatalog,
  upsertSourceCatalogProjectRecord,
  type SourceCatalogProjectRecord,
} from '../lib/sourceCatalog';
import type { SourceBinProjectSnapshot } from './sourceBinStore';

/**
 * Persisted cross-project Source Library catalogue (MH-085).
 *
 * Holds only bounded metadata records derived from project saves/opens (see
 * `src/lib/sourceCatalog.ts`); asset bytes never enter this store. The active
 * project identity is deliberately session state — after a reload no project
 * is open until a replacement transaction sets it, and the UI must not guess.
 */

export interface SourceCatalogRecordingInput {
  projectId: string;
  projectName: string;
  savedAt: number;
  snapshot?: SourceBinProjectSnapshot;
}

interface SourceCatalogState {
  records: SourceCatalogProjectRecord[];
  activeProjectId?: string;
  activeProjectName?: string;
  /** Record one save/open observation; never throws into the caller. */
  recordProject: (input: SourceCatalogRecordingInput) => void;
  /** Note which project is currently open (replacement commit success). */
  setActiveProject: (identity: { id?: string; name?: string }) => void;
  forgetProject: (projectId: string) => void;
  clearCatalogue: () => void;
}

function createCatalogQuotaSafeStorage() {
  return createJSONStorage(() => {
    // Match the Source Library convention: unavailable storage disables
    // persistence instead of throwing; quota failures warn and skip rather
    // than escaping into the project save/open funnel that records here.
    const base = window.localStorage;
    return {
      getItem: (name: string) => {
        try {
          return base.getItem(name);
        } catch (error) {
          console.warn('[sourceCatalogStore] persisted catalogue state unavailable:', error);
          return null;
        }
      },
      setItem: (name: string, value: string) => {
        try {
          base.setItem(name, value);
        } catch (error) {
          console.warn('[sourceCatalogStore] catalogue persist skipped (storage quota/availability):', error);
        }
      },
      removeItem: (name: string) => {
        try {
          base.removeItem(name);
        } catch (error) {
          console.warn('[sourceCatalogStore] persisted catalogue state could not be removed:', error);
        }
      },
    };
  });
}

export const useSourceCatalogStore = create<SourceCatalogState>()(
  persist(
    (set) => ({
      records: [],
      recordProject: (input) => {
        try {
          if (!input.projectId || !input.projectName || !Number.isFinite(input.savedAt)) {
            return;
          }
          const record = buildSourceCatalogProjectRecord({
            projectId: input.projectId,
            projectName: input.projectName,
            savedAt: input.savedAt,
            snapshot: input.snapshot,
          });
          set((state) => ({
            records: upsertSourceCatalogProjectRecord(state.records, record),
          }));
        } catch (error) {
          console.warn('[sourceCatalogStore] project recording skipped:', error);
        }
      },
      setActiveProject: (identity) => set({
        activeProjectId: identity.id,
        activeProjectName: identity.name,
      }),
      forgetProject: (projectId) => set((state) => ({
        records: state.records.filter((record) => record.projectId !== projectId),
      })),
      clearCatalogue: () => set({ records: [] }),
    }),
    {
      name: 'sloom.source-catalog',
      storage: createCatalogQuotaSafeStorage(),
      partialize: (state) => ({ records: state.records }) as unknown as SourceCatalogState,
      merge: (persisted, current) => ({
        ...current,
        records: parsePersistedSourceCatalog((persisted as { records?: unknown } | undefined)?.records),
      }),
    },
  ),
);

/**
 * Recording helper for the canonical save funnel. Wrapped so a catalogue
 * failure can never break a project save/autosave/export.
 */
export function recordSourceCatalogProjectDocument(document: {
  id: string;
  name: string;
  savedAt: number;
  sourceBin?: SourceBinProjectSnapshot;
}): void {
  useSourceCatalogStore.getState().recordProject({
    projectId: document.id,
    projectName: document.name,
    savedAt: document.savedAt,
    snapshot: document.sourceBin,
  });
}

/**
 * Recording helper for a successful project replacement (open/new): the
 * opened project becomes both the active identity and a catalogue record.
 */
export function noteActiveSourceCatalogProjectDocument(document: {
  id: string;
  name: string;
  savedAt?: number;
  sourceBin?: SourceBinProjectSnapshot;
}): void {
  try {
    useSourceCatalogStore.getState().setActiveProject({ id: document.id, name: document.name });
    useSourceCatalogStore.getState().recordProject({
      projectId: document.id,
      projectName: document.name,
      savedAt: document.savedAt ?? Date.now(),
      snapshot: document.sourceBin,
    });
  } catch (error) {
    console.warn('[sourceCatalogStore] active-project note skipped:', error);
  }
}
