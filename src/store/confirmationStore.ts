import { create } from 'zustand';
import { shouldBypassConfirmations } from '../lib/automationBypass';

export interface ConfirmationRequest {
  id: string;
  message: string;
  title?: string;
  resolve: (value: boolean) => void;
}

export interface ConfirmationState {
  activeRequest: ConfirmationRequest | null;
  requestConfirmation: (message: string, title?: string) => Promise<boolean>;
  respond: (approved: boolean) => void;
}

export const useConfirmationStore = create<ConfirmationState>()((set, get) => ({
  activeRequest: null,
  requestConfirmation: (message: string, title?: string): Promise<boolean> => {
    if (shouldBypassConfirmations()) {
      return Promise.resolve(true);
    }

    const current = get().activeRequest;
    if (current) {
      // Resolve the prior outstanding request with false to avoid blocking,
      // then display the new one.
      current.resolve(false);
    }

    return new Promise<boolean>((resolve) => {
      set({
        activeRequest: {
          id: Math.random().toString(36).substring(2, 11),
          message,
          title,
          resolve,
        },
      });
    });
  },
  respond: (approved: boolean): void => {
    const request = get().activeRequest;
    if (request) {
      request.resolve(approved);
      set({ activeRequest: null });
    }
  },
}));
