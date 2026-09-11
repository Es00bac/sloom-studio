import { Inflate } from 'fflate';

/** Compressed bytes fed per push; caps worst-case transient expansion per push (~64x1032). */
const ZLIB_FEED_BYTES = 64 * 1024;

/**
 * Inflate a zlib stream while enforcing a cumulative output cap. `unzlibSync`
 * grows its output buffer without limit before any caller-side length check, so
 * a hostile stream can force its full expansion into memory. This feeds the
 * compressed stream incrementally and refuses the moment cumulative output
 * passes `maxBytes`, throwing `refusal`, so the expansion is never materialized.
 * Well-formed streams return byte-identical output and malformed streams raise
 * the same errors as `unzlibSync`.
 */
export function inflateZlibBounded(data: Uint8Array, maxBytes: number, refusal: string): Uint8Array {
  if (data.length < 2 || (data[0] & 15) !== 8 || (data[0] >> 4) > 7 || (((data[0] << 8) | data[1]) % 31) !== 0) {
    throw zlibError('invalid zlib data');
  }
  if (((data[1] >> 5) & 1) === 1) {
    throw zlibError(`invalid zlib data: ${data[1] & 32 ? 'need' : 'unexpected'} dictionary`);
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const inflater = new Inflate((chunk) => {
    total += chunk.length;
    if (total > maxBytes) throw new Error(refusal);
    chunks.push(chunk);
  });
  // Matches unzlibSync: the 2-byte zlib header is validated above, the 4-byte
  // adler32 trailer is stripped and never verified.
  const raw = data.subarray(2, data.length - 4);
  for (let at = 0; at < raw.length; at += ZLIB_FEED_BYTES) {
    const end = Math.min(at + ZLIB_FEED_BYTES, raw.length);
    inflater.push(raw.subarray(at, end), end === raw.length);
  }
  if (raw.length === 0) inflater.push(raw, true);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function zlibError(message: string): Error {
  const error = new Error(message) as Error & { code?: number };
  error.code = 6;
  return error;
}
