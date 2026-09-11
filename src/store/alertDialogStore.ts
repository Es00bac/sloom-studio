import { create } from 'zustand';
import { shouldBypassConfirmations } from '../lib/automationBypass';

export type AlertDialogTone = 'info' | 'warning' | 'danger';

export interface AlertDialogOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  tone?: AlertDialogTone;
}

export interface AlertDialogRequest extends AlertDialogOptions {
  id: string;
  resolve: () => void;
}

interface AlertDialogState {
  activeRequest: AlertDialogRequest | null;
  requestAlert: (options: AlertDialogOptions | string) => Promise<void>;
  respond: () => void;
}

function normalizeAlertOptions(options: AlertDialogOptions | string): AlertDialogOptions {
  return typeof options === 'string' ? { message: options } : options;
}

export const useAlertDialogStore = create<AlertDialogState>()((set, get) => ({
  activeRequest: null,
  requestAlert: (options): Promise<void> => {
    if (shouldBypassConfirmations()) {
      return Promise.resolve();
    }

    const current = get().activeRequest;
    if (current) {
      current.resolve();
    }

    return new Promise<void>((resolve) => {
      set({
        activeRequest: {
          ...normalizeAlertOptions(options),
          id: Math.random().toString(36).substring(2, 11),
          resolve,
        },
      });
    });
  },
  respond: (): void => {
    const request = get().activeRequest;
    if (!request) {
      return;
    }

    request.resolve();
    set({ activeRequest: null });
  },
}));

export function showAlertDialog(options: AlertDialogOptions | string): Promise<void> {
  return useAlertDialogStore.getState().requestAlert(options);
}
