import { describe, expect, it, vi } from 'vitest';
import {
  installResizeObserverLoopErrorFilter,
  isResizeObserverLoopError,
} from './resizeObserverLoopErrorFilter';

describe('resize observer loop error filter', () => {
  it('matches only known ResizeObserver loop browser messages', () => {
    expect(isResizeObserverLoopError('ResizeObserver loop completed with undelivered notifications.')).toBe(true);
    expect(isResizeObserverLoopError(new Error('ResizeObserver loop limit exceeded'))).toBe(true);
    expect(isResizeObserverLoopError({ message: 'ResizeObserver loop limit exceeded' })).toBe(true);

    expect(isResizeObserverLoopError('Maximum update depth exceeded')).toBe(false);
    expect(isResizeObserverLoopError(new Error('Flow Canvas crashed'))).toBe(false);
    expect(isResizeObserverLoopError(null)).toBe(false);
  });

  it('prevents only matching error and rejection events', () => {
    const listeners = new Map<string, EventListener>();
    const target = {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn((type: string) => {
        listeners.delete(type);
      }),
    } as unknown as Window;

    const cleanup = installResizeObserverLoopErrorFilter(target);

    const resizeError = makeEvent({
      message: 'ResizeObserver loop completed with undelivered notifications.',
    });
    listeners.get('error')?.(resizeError);
    expect(resizeError.preventDefault).toHaveBeenCalledTimes(1);
    expect(resizeError.stopImmediatePropagation).toHaveBeenCalledTimes(1);

    const realError = makeEvent({ message: 'Sloom Studio real error' });
    listeners.get('error')?.(realError);
    expect(realError.preventDefault).not.toHaveBeenCalled();
    expect(realError.stopImmediatePropagation).not.toHaveBeenCalled();

    const rejection = makeEvent({ reason: new Error('ResizeObserver loop limit exceeded') });
    listeners.get('unhandledrejection')?.(rejection);
    expect(rejection.preventDefault).toHaveBeenCalledTimes(1);
    expect(rejection.stopImmediatePropagation).toHaveBeenCalledTimes(1);

    cleanup();
    expect(target.removeEventListener).toHaveBeenCalledTimes(2);
  });
});

function makeEvent(fields: Record<string, unknown>): Event {
  return {
    ...fields,
    preventDefault: vi.fn(),
    stopImmediatePropagation: vi.fn(),
  } as unknown as Event;
}
