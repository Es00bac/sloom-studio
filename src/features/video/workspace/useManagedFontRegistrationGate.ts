import { useCallback, useEffect, useState } from 'react';
import {
  bundledFontFaceIdentitySignature,
  ensureBundledFontDependenciesReady,
  type ManagedBundledFontDependency,
} from '../../../lib/bundledFontLibrary';

export type ManagedFontRegistrationGateState =
  | { status: 'ready'; error?: undefined; retry: () => void }
  | { status: 'loading'; error?: undefined; retry: () => void }
  | { status: 'error'; error: string; retry: () => void };

export type ManagedFontDependencyRegistrar = (
  dependencies: readonly ManagedBundledFontDependency[],
) => Promise<unknown>;

export function buildManagedFontDependencySignature(
  dependencies: readonly ManagedBundledFontDependency[],
): string {
  return JSON.stringify(dependencies.map((dependency) => (
    dependency.reference
      ? ['exact', bundledFontFaceIdentitySignature(dependency.reference)]
      : ['issue', dependency.issue.reason, dependency.issue.message, dependency.issue.original]
  )).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))));
}

export function useManagedFontRegistrationGate(
  dependencies: readonly ManagedBundledFontDependency[],
  register: ManagedFontDependencyRegistrar = ensureBundledFontDependenciesReady,
): ManagedFontRegistrationGateState {
  const signature = buildManagedFontDependencySignature(dependencies);
  const [retryNonce, setRetryNonce] = useState(0);
  const [settled, setSettled] = useState<{
    dependencies: readonly ManagedBundledFontDependency[];
    register: ManagedFontDependencyRegistrar;
    retryNonce: number;
    signature: string;
    status: 'ready' | 'loading' | 'error';
    error?: string;
  }>(() => ({ dependencies, register, retryNonce: 0, signature, status: dependencies.length > 0 ? 'loading' : 'ready' }));
  useEffect(() => {
    if (dependencies.length === 0) {
      return undefined;
    }
    let active = true;
    void register(dependencies).then(
      () => {
        if (active) {
          setSettled({ dependencies, register, retryNonce, signature, status: 'ready' });
        }
      },
      (error) => {
        if (active) {
          setSettled({
            dependencies,
            register,
            retryNonce,
            signature,
            status: 'error',
            error: error instanceof Error ? error.message : 'A bundled font face is unavailable.',
          });
        }
      },
    );
    return () => { active = false; };
  }, [dependencies, register, retryNonce, signature]);

  const retry = useCallback(() => {
    setRetryNonce((value) => value + 1);
  }, []);

  if (dependencies.length === 0) return { status: 'ready', retry };
  if (
    settled.dependencies !== dependencies
    || settled.register !== register
    || settled.retryNonce !== retryNonce
    || settled.signature !== signature
  ) {
    return { status: 'loading', retry };
  }
  if (settled.status === 'error') return { status: 'error', error: settled.error ?? 'A bundled font face is unavailable.', retry };
  return { status: settled.status, retry };
}
