import type { BrushBackend, BrushBackendId } from './backend';
import { createCpuBrushBackend } from './cpuBackend';
import { createWebgl2BrushBackend } from './webgl2Backend';
import { backendProducesCorrectOutput } from './selfTest';

export type BrushBackendPreference = 'auto' | BrushBackendId;

export interface BrushBackendSelection {
  id: BrushBackendId;
  backend: BrushBackend;
  /** Set when a forced/auto preference downgraded to a lower tier (e.g. GPU unavailable or untrusted). */
  downgradedFrom?: BrushBackendId;
}

/** Cached result of the one-time WebGL2 correctness self-test (undefined = not yet run). */
let webgl2Trusted: boolean | undefined;

/**
 * Validates a WebGL2 backend against the CPU reference exactly once per session. A driver can compile
 * the shaders yet compute wrong output; since GPU is on by default for every user, we only trust the
 * GPU path when its output matches the CPU reference within tolerance, and fall back to CPU otherwise.
 */
function isWebgl2Trusted(webgl2: BrushBackend, cpu: BrushBackend): boolean {
  if (webgl2Trusted === undefined) {
    webgl2Trusted = backendProducesCorrectOutput(webgl2, cpu);
  }
  return webgl2Trusted;
}

/** Test-only: reset the cached self-test result so detection re-validates the GPU backend. */
export function resetBrushBackendSelfTestCache(): void {
  webgl2Trusted = undefined;
}

/**
 * Resolves which backend to use for a stroke. Chain: WebGPU (P3, not yet built) -> WebGL2 -> CPU.
 * - `cpu`: always the CPU backend.
 * - `auto`: WebGL2 if available AND it passes the correctness self-test, else CPU.
 * - `webgl2`: WebGL2 if available and trusted, else CPU (downgraded).
 * - `webgpu`: WebGL2 if available and trusted (WebGPU backend not built yet — downgraded), else CPU (downgraded).
 */
export function detectBrushBackend(preference: BrushBackendPreference): BrushBackendSelection {
  const cpu = createCpuBrushBackend();
  if (preference === 'cpu') {
    return { id: 'cpu', backend: cpu };
  }

  const webgl2 = createWebgl2BrushBackend();
  if (webgl2 && isWebgl2Trusted(webgl2, cpu)) {
    return preference === 'webgpu'
      ? { id: 'webgl2', backend: webgl2, downgradedFrom: 'webgpu' }
      : { id: 'webgl2', backend: webgl2 };
  }

  if (preference === 'webgl2' || preference === 'webgpu') {
    return { id: 'cpu', backend: cpu, downgradedFrom: preference };
  }
  return { id: 'cpu', backend: cpu };
}
