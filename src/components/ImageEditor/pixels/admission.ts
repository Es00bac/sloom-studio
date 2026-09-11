/**
 * MH-009 D7 admission gate for high-bit documents.
 *
 * Tova Reed's Wave-0 P5 probe (4000x3000 float32 RGBA x 8 layers) measured
 * raw authority bytes of 1,536,000,000 (1.431 GiB) and a touched peak RSS of
 * 1515.7 MiB against the 1.5 GiB cap — raw bytes alone leave almost no room
 * for the display proxy, undo history, allocator, and renderer overhead. The
 * gate therefore refuses on raw authority bytes PLUS a per-layer display
 * proxy allowance PLUS a fixed runtime reserve, before any allocation.
 */

export const HIGH_BIT_ADMISSION_BUDGET_BYTES = Math.round(1.5 * 1024 * 1024 * 1024);

/**
 * Fixed runtime reserve (history deltas, proxy regeneration scratch,
 * allocator and renderer overhead). P5 observed >= 50.9 MiB of runtime
 * overhead above raw bytes at peak with zero history outstanding; 64 MiB is
 * the minimum honest floor and the budget parameter stays settable.
 */
export const HIGH_BIT_RUNTIME_RESERVE_BYTES = 64 * 1024 * 1024;

export const BYTES_PER_DISPLAY_PROXY_PIXEL = 4;

export interface HighBitAdmissionLayer {
  width: number;
  height: number;
}

export interface HighBitAdmissionInput {
  depth: 'u16' | 'f32';
  layers: readonly HighBitAdmissionLayer[];
  /** Settable budget; defaults to the D7 1.5 GiB cap. */
  budgetBytes?: number;
}

export type HighBitAdmissionResult =
  | {
      admitted: true;
      depth: 'u16' | 'f32';
      estimatedBytes: number;
      authorityBytes: number;
      proxyBytes: number;
      reserveBytes: number;
      budgetBytes: number;
    }
  | {
      admitted: false;
      depth: 'u16' | 'f32';
      estimatedBytes: number;
      authorityBytes: number;
      proxyBytes: number;
      reserveBytes: number;
      budgetBytes: number;
      overBytes: number;
      advice: string;
    };

/** Estimate the full resident cost of a high-bit document before allocating it. */
export function estimateHighBitDocumentBytes(input: {
  depth: 'u16' | 'f32';
  layers: readonly HighBitAdmissionLayer[];
}): { authorityBytes: number; proxyBytes: number } {
  const bytesPerSample = input.depth === 'u16' ? 2 : 4;
  let authorityBytes = 0;
  let proxyBytes = 0;
  for (const layer of input.layers) {
    if (!Number.isSafeInteger(layer.width) || !Number.isSafeInteger(layer.height)
      || layer.width < 1 || layer.height < 1) {
      throw new Error(
        `High-bit admission dimensions ${String(layer.width)}x${String(layer.height)} must be finite positive safe integers.`,
      );
    }
    const pixels = layer.width * layer.height;
    const authorityLayerBytes = pixels * 4 * bytesPerSample;
    const proxyLayerBytes = pixels * BYTES_PER_DISPLAY_PROXY_PIXEL;
    if (!Number.isSafeInteger(pixels)
      || !Number.isSafeInteger(authorityLayerBytes)
      || !Number.isSafeInteger(proxyLayerBytes)
      || !Number.isSafeInteger(authorityBytes + authorityLayerBytes)
      || !Number.isSafeInteger(proxyBytes + proxyLayerBytes)) {
      throw new Error(
        `High-bit admission dimensions ${layer.width}x${layer.height} overflow the bounded byte estimate.`,
      );
    }
    authorityBytes += authorityLayerBytes;
    proxyBytes += proxyLayerBytes;
  }
  return { authorityBytes, proxyBytes };
}

/**
 * Admission before allocation. `admitted: false` names the exact numbers and
 * advises a smaller depth instead of silently downsampling.
 */
export function checkHighBitAdmission(input: HighBitAdmissionInput): HighBitAdmissionResult {
  const budgetBytes = input.budgetBytes ?? HIGH_BIT_ADMISSION_BUDGET_BYTES;
  const reserveBytes = HIGH_BIT_RUNTIME_RESERVE_BYTES;
  let estimate: { authorityBytes: number; proxyBytes: number };
  try {
    estimate = estimateHighBitDocumentBytes(input);
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'dimensions are invalid';
    return {
      admitted: false,
      depth: input.depth,
      estimatedBytes: Number.POSITIVE_INFINITY,
      authorityBytes: Number.POSITIVE_INFINITY,
      proxyBytes: Number.POSITIVE_INFINITY,
      reserveBytes,
      budgetBytes,
      overBytes: Number.POSITIVE_INFINITY,
      advice: `Refused before allocation: ${reason}`,
    };
  }
  const { authorityBytes, proxyBytes } = estimate;
  const estimatedBytes = authorityBytes + proxyBytes + reserveBytes;
  const base = {
    depth: input.depth,
    estimatedBytes,
    authorityBytes,
    proxyBytes,
    reserveBytes,
    budgetBytes,
  };
  if (Number.isFinite(estimatedBytes) && estimatedBytes <= budgetBytes) {
    return { admitted: true, ...base };
  }
  const overBytes = estimatedBytes - budgetBytes;
  const suggestion = input.depth === 'f32'
    ? 'Convert to 16-bit integer, or open the document at 8-bit.'
    : 'Open the document at 8-bit, or split it into smaller documents.';
  return {
    admitted: false,
    ...base,
    overBytes,
    advice: suggestion,
  };
}

/** Human-readable refusal naming every component of the estimate. */
export function describeHighBitAdmissionRefusal(result: Extract<
  HighBitAdmissionResult,
  { admitted: false }
>): string {
  const mib = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  const depthLabel = result.depth === 'f32' ? '32-bit float' : '16-bit integer';
  return `Document refused before allocation: ${depthLabel} working depth needs about `
    + `${mib(result.estimatedBytes)} (authority ${mib(result.authorityBytes)} + display proxies `
    + `${mib(result.proxyBytes)} + runtime/history reserve ${mib(result.reserveBytes)}) but the `
    + `admission budget is ${mib(result.budgetBytes)} (${mib(result.overBytes)} over). `
    + `${result.advice}`;
}
