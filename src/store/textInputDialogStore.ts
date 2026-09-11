import { create } from 'zustand';
import { shouldBypassConfirmations } from '../lib/automationBypass';

export interface TextInputDialogOptions {
  title: string;
  message?: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

export interface TextInputDialogRequest extends TextInputDialogOptions {
  id: string;
  resolve: (value: string | null) => void;
}

interface TextInputDialogState {
  activeRequest: TextInputDialogRequest | null;
  requestTextInput: (options: TextInputDialogOptions) => Promise<string | null>;
  respond: (value: string | null) => void;
}

export const useTextInputDialogStore = create<TextInputDialogState>()((set, get) => ({
  activeRequest: null,
  requestTextInput: (options): Promise<string | null> => {
    if (shouldBypassConfirmations()) {
      return Promise.resolve(options.initialValue ?? '');
    }

    const current = get().activeRequest;
    if (current) {
      current.resolve(null);
    }

    return new Promise<string | null>((resolve) => {
      set({
        activeRequest: {
          ...options,
          id: Math.random().toString(36).substring(2, 11),
          resolve,
        },
      });
    });
  },
  respond: (value): void => {
    const request = get().activeRequest;
    if (!request) {
      return;
    }

    request.resolve(value);
    set({ activeRequest: null });
  },
}));
