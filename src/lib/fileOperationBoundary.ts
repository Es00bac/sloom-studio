import { isAbortError } from './abortSignals';
import { showAlertDialog } from '../store/alertDialogStore';

const DEFAULT_FALLBACK_MESSAGE = 'The operation could not be completed.';

/**
 * Menu/keyboard/navbar/gamepad dispatch fires user file commands without awaiting them, so every
 * command must settle its own promise (AUD-016) — an operation that rejects without this boundary
 * becomes an unhandled rejection with no user-facing failure. A user-cancelled picker rejects with
 * AbortError and must stay silent instead of surfacing as a failure dialog.
 */
export async function runFileOperation(
  title: string,
  operation: () => Promise<void>,
  fallbackMessage: string = DEFAULT_FALLBACK_MESSAGE,
): Promise<void> {
  try {
    await operation();
  } catch (error) {
    if (isAbortError(error)) {
      return;
    }
    await showAlertDialog({
      title,
      message: error instanceof Error ? error.message : fallbackMessage,
      tone: 'danger',
    });
  }
}
