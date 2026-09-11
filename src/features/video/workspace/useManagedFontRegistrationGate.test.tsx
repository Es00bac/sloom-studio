// @vitest-environment jsdom

import { act, startTransition, Suspense } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedBundledFontDependency } from '../../../lib/bundledFontLibrary';
import type { ManagedBundledFontFaceReference } from '../../../types/managedFont';
import {
  useManagedFontRegistrationGate,
  type ManagedFontDependencyRegistrar,
} from './useManagedFontRegistrationGate';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function reference(seed: string): ManagedBundledFontFaceReference {
  return {
    kind: 'bundled', schemaVersion: 2, faceId: `face-${seed}`, family: 'Duplicate Family',
    weight: 400, style: 'normal', stretchPercent: 100, collectionIndex: seed === 'a' ? 0 : 1,
    sha256: seed.repeat(64), byteLength: seed === 'a' ? 100 : 200,
  };
}

function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function Harness({
  dependencies,
  register,
  suspend,
  onSuspendedRender,
}: {
  dependencies: ManagedBundledFontDependency[];
  register: ManagedFontDependencyRegistrar;
  suspend?: Promise<never>;
  onSuspendedRender?: () => void;
}) {
  const gate = useManagedFontRegistrationGate(dependencies, register);
  if (suspend) {
    onSuspendedRender?.();
    throw suspend;
  }
  return (
    <div data-gate-status={gate.status}>
      {gate.status === 'ready' ? <div data-exact-preview="true">Exact preview</div> : null}
      {gate.status === 'error' ? <div data-gate-error="true">{gate.error}</div> : null}
      <button onClick={gate.retry} type="button">Retry</button>
    </div>
  );
}

describe('useManagedFontRegistrationGate', () => {
  let root: Root | undefined;
  let host: HTMLDivElement | undefined;

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    host?.remove();
    root = undefined;
    host = undefined;
  });

  it('gates first paint, ignores stale reference completion, keeps failure blocked, and succeeds on retry', async () => {
    const a = deferred();
    const bFailure = deferred();
    const bRetry = deferred();
    let bAttempts = 0;
    const register = vi.fn<ManagedFontDependencyRegistrar>((dependencies) => {
      const faceId = dependencies[0]?.reference?.faceId;
      if (faceId === 'face-a') return a.promise;
      bAttempts += 1;
      return bAttempts === 1 ? bFailure.promise : bRetry.promise;
    });
    const dependenciesA: ManagedBundledFontDependency[] = [{ reference: reference('a') }];
    const dependenciesB: ManagedBundledFontDependency[] = [{ reference: reference('b') }];
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);

    await act(async () => root?.render(<Harness dependencies={dependenciesA} register={register} />));
    expect(host.querySelector('[data-gate-status]')?.getAttribute('data-gate-status')).toBe('loading');
    expect(host.querySelector('[data-exact-preview]')).toBeNull();

    await act(async () => root?.render(<Harness dependencies={dependenciesB} register={register} />));
    a.resolve();
    await act(async () => { await a.promise; });
    expect(host.querySelector('[data-gate-status]')?.getAttribute('data-gate-status')).toBe('loading');
    expect(host.querySelector('[data-exact-preview]')).toBeNull();

    bFailure.reject(new Error('collection face unavailable'));
    await act(async () => { await bFailure.promise.catch(() => undefined); });
    expect(host.querySelector('[data-gate-status]')?.getAttribute('data-gate-status')).toBe('error');
    expect(host.textContent).toContain('collection face unavailable');
    expect(host.querySelector('[data-exact-preview]')).toBeNull();

    await act(async () => host?.querySelector<HTMLButtonElement>('button')?.click());
    expect(host.querySelector('[data-gate-status]')?.getAttribute('data-gate-status')).toBe('loading');
    bRetry.resolve();
    await act(async () => { await bRetry.promise; });
    expect(host.querySelector('[data-gate-status]')?.getAttribute('data-gate-status')).toBe('ready');
    expect(host.querySelector('[data-exact-preview]')).not.toBeNull();
  });

  it('does not let an abandoned suspended render invalidate the active committed registration', async () => {
    const activeRegistration = deferred();
    const register = vi.fn<ManagedFontDependencyRegistrar>(() => activeRegistration.promise);
    const dependenciesA: ManagedBundledFontDependency[] = [{ reference: reference('a') }];
    const dependenciesB: ManagedBundledFontDependency[] = [{ reference: reference('b') }];
    const neverSettles = new Promise<never>(() => undefined);
    const sawSuspendedRender = vi.fn();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);

    const committedA = (
      <Suspense fallback={<div data-fallback="true" />}>
        <Harness dependencies={dependenciesA} register={register} />
      </Suspense>
    );
    await act(async () => root?.render(committedA));
    expect(register).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-gate-status]')?.getAttribute('data-gate-status')).toBe('loading');

    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    try {
      startTransition(() => root?.render(
        <Suspense fallback={<div data-fallback="true" />}>
          <Harness
            dependencies={dependenciesB}
            onSuspendedRender={sawSuspendedRender}
            register={register}
            suspend={neverSettles}
          />
        </Suspense>,
      ));
      await vi.waitFor(() => expect(sawSuspendedRender).toHaveBeenCalled());
    } finally {
      (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    }

    expect(sawSuspendedRender).toHaveBeenCalled();
    expect(register).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-fallback]')).toBeNull();

    // A synchronous return to the already-committed A tree abandons the suspended B work. The A
    // effect must remain the sole active request; render-only B work cannot cancel or supersede it.
    await act(async () => flushSync(() => root?.render(committedA)));
    expect(register).toHaveBeenCalledTimes(1);

    activeRegistration.resolve();
    await act(async () => { await activeRegistration.promise; });
    expect(host.querySelector('[data-gate-status]')?.getAttribute('data-gate-status')).toBe('ready');
    expect(host.querySelector('[data-exact-preview]')).not.toBeNull();
  });

  it('starts ready for an empty dependency set without exposing a fallback', async () => {
    const register = vi.fn<ManagedFontDependencyRegistrar>(() => Promise.resolve());
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);

    await act(async () => root?.render(<Harness dependencies={[]} register={register} />));

    expect(register).not.toHaveBeenCalled();
    expect(host.querySelector('[data-gate-status]')?.getAttribute('data-gate-status')).toBe('ready');
    expect(host.querySelector('[data-exact-preview]')).not.toBeNull();
  });
});
