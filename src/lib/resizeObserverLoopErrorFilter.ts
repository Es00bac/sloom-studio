const RESIZE_OBSERVER_LOOP_MESSAGES = new Set([
  'ResizeObserver loop completed with undelivered notifications.',
  'ResizeObserver loop limit exceeded',
]);

export function isResizeObserverLoopError(value: unknown): boolean {
  const message = extractErrorMessage(value);
  return message ? RESIZE_OBSERVER_LOOP_MESSAGES.has(message.trim()) : false;
}

export function installResizeObserverLoopErrorFilter(
  target: Window | undefined = typeof window === 'undefined' ? undefined : window,
): () => void {
  if (!target) {
    return () => undefined;
  }

  const handleError = (event: Event) => {
    const errorEvent = event as ErrorEvent;
    if (!isResizeObserverLoopError(errorEvent.message) && !isResizeObserverLoopError(errorEvent.error)) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const handleRejection = (event: Event) => {
    const rejectionEvent = event as PromiseRejectionEvent;
    if (!isResizeObserverLoopError(rejectionEvent.reason)) {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
  };

  target.addEventListener('error', handleError, true);
  target.addEventListener('unhandledrejection', handleRejection, true);

  return () => {
    target.removeEventListener('error', handleError, true);
    target.removeEventListener('unhandledrejection', handleRejection, true);
  };
}

function extractErrorMessage(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Error) {
    return value.message;
  }

  if (value && typeof value === 'object' && 'message' in value) {
    const message = (value as { message?: unknown }).message;
    return typeof message === 'string' ? message : null;
  }

  return null;
}
