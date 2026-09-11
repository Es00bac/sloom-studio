import { useDockablePanelStore } from '../store/dockablePanelStore';
import { useWorkspaceLayoutStore } from '../store/workspaceLayoutStore';
import {
  resetProjectDocumentWithCompleteRecovery,
  type CompleteRecoveryProjectResetResult,
} from './projectDocumentActions';

export const NON_SECRET_RECOVERY_STORAGE_KEYS = [
  'signal-loom-workspace-layouts',
  'signal-loom-dockable-panels',
  'signal-loom-activity-trail',
] as const;

export const SECRET_PERSISTED_STORAGE_KEYS = [
  'flow-settings-storage',
  'image-editor-generic-auth-template',
] as const;

export type AppRecoveryStorage = Pick<Storage, 'removeItem'>;

export interface RecoveryRemovalResult {
  key: string;
  removed: boolean;
  error?: string;
}

export function safeRemoveLocalStorageKeys(
  keys: readonly string[],
  storage: AppRecoveryStorage | null | undefined = getBrowserLocalStorage(),
): RecoveryRemovalResult[] {
  return keys.map((key) => {
    if (!storage) {
      return { key, removed: false, error: 'localStorage unavailable' };
    }

    try {
      storage.removeItem(key);
      return { key, removed: true };
    } catch (error) {
      return { key, removed: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

export type CrashRecoveryResetResult = CompleteRecoveryProjectResetResult;
export const CONFIRMED_CRASH_RECOVERY_RESET = 'reset-with-recovery' as const;

export async function resetProjectToBlank(
  decision: typeof CONFIRMED_CRASH_RECOVERY_RESET,
): Promise<CrashRecoveryResetResult> {
  if (decision !== CONFIRMED_CRASH_RECOVERY_RESET) {
    throw new Error('Blank project reset requires an explicit Reset with Recovery decision.');
  }
  return resetProjectDocumentWithCompleteRecovery();
}

export function resetDockableAndWorkspaceLayout(): void {
  useDockablePanelStore.getState().resetAllPanelLayouts();
  useWorkspaceLayoutStore.getState().resetWorkspaceLayout();
}

export function clearNonSecretPersistedRecoveryState(
  storage: AppRecoveryStorage | undefined = getBrowserLocalStorage(),
): RecoveryRemovalResult[] {
  const results = safeRemoveLocalStorageKeys(NON_SECRET_RECOVERY_STORAGE_KEYS, storage);
  resetDockableAndWorkspaceLayout();
  return results;
}

export async function resetProjectAndClearNonSecretState(
  decision: typeof CONFIRMED_CRASH_RECOVERY_RESET,
  storage: AppRecoveryStorage | undefined = getBrowserLocalStorage(),
): Promise<RecoveryRemovalResult[]> {
  await resetProjectToBlank(decision);
  return clearNonSecretPersistedRecoveryState(storage);
}

function getBrowserLocalStorage(): Storage | undefined {
  try {
    return typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined;
  } catch {
    return undefined;
  }
}
