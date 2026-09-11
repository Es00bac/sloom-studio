import { describe, expect, it } from 'vitest';
import { NonRetryableError } from './exponentialBackoff';
import {
  BACKEND_PROXY_RESULT_ENVELOPE_VERSION,
  DEFAULT_BACKEND_PROXY_RESULT_ENVELOPE_LIMITS,
  decodeBackendProxyResultEnvelope,
  encodeBackendProxyResultEnvelope,
  type BackendProxyResultEnvelopeLimits,
} from './backendProxyResultEnvelope';

const V = BACKEND_PROXY_RESULT_ENVELOPE_VERSION;

// Deliberately loose so tests can build both valid envelopes and hostile/malformed payloads.
function versioned(overrides: Record<string, unknown>): Record<string, unknown> {
  return { envelopeVersion: V, result: 'ok', resultType: 'text', ...overrides };
}

function tinyLimits(overrides: Partial<BackendProxyResultEnvelopeLimits> = {}): BackendProxyResultEnvelopeLimits {
  return { ...DEFAULT_BACKEND_PROXY_RESULT_ENVELOPE_LIMITS, ...overrides };
}

async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

describe('backend proxy result envelope version', () => {
  it('keeps the result-envelope version distinct from any request-settings version counter', async () => {
    const { BACKEND_PROXY_EXECUTION_SETTINGS_VERSION } = await import('./backendProxy');
    // They may happen to share a numeric value today, but they are separate constants that evolve
    // independently — proving they are separate symbols guards against collapsing them into one.
    expect(BACKEND_PROXY_RESULT_ENVELOPE_VERSION).toBeTypeOf('number');
    expect(BACKEND_PROXY_EXECUTION_SETTINGS_VERSION).toBeTypeOf('number');
  });
});

describe('decodeBackendProxyResultEnvelope — versioned success', () => {
  it('decodes a text result with status and usage', () => {
    const decoded = decodeBackendProxyResultEnvelope(versioned({
      result: 'hello world',
      resultType: 'text',
      statusMessage: 'Generated with model',
      usage: { source: 'actual', confidence: 'measured', inputTokens: 3, outputTokens: 5, costUsd: 0.01, notes: ['ok'] },
    }));
    expect(decoded).toMatchObject({
      result: 'hello world',
      resultType: 'text',
      statusMessage: 'Generated with model',
      usage: { inputTokens: 3, outputTokens: 5, costUsd: 0.01 },
    });
  });

  it('retains a literal Boolean result without coercion', () => {
    const decoded = decodeBackendProxyResultEnvelope(versioned({ result: false, resultType: 'boolean' }));
    expect(decoded.result).toBe(false);
    expect(typeof decoded.result).toBe('boolean');
  });

  it('retains a JSON string result and nested JSON-safe output metadata exactly', () => {
    const outputMetadata = { seed: 7, nested: { list: [1, 2, { flag: true }], label: 'x' } };
    const decoded = decodeBackendProxyResultEnvelope(versioned({
      result: '{"a":1}',
      resultType: 'json',
      outputMetadata,
    }));
    expect(decoded.result).toBe('{"a":1}');
    expect(decoded.outputMetadata).toEqual(outputMetadata);
  });

  it('retains file metadata (mimeType, extension, fileName)', () => {
    const decoded = decodeBackendProxyResultEnvelope(versioned({
      result: 'data:application/zip;base64,UEsD',
      resultType: 'package',
      mimeType: 'application/zip',
      extension: 'zip',
      fileName: 'frames.zip',
    }));
    expect(decoded).toMatchObject({ mimeType: 'application/zip', extension: 'zip', fileName: 'frames.zip' });
  });

  it('preserves ordered additionalResults with distinct MIME values', () => {
    const decoded = decodeBackendProxyResultEnvelope(versioned({
      result: 'data:image/png;base64,AAAA',
      resultType: 'image',
      mimeType: 'image/png',
      additionalResults: [
        { result: 'data:image/webp;base64,BBBB', mimeType: 'image/webp' },
        { result: 'data:image/jpeg;base64,CCCC', mimeType: 'image/jpeg' },
      ],
    }));
    expect(decoded.additionalResults).toEqual([
      { result: 'data:image/webp;base64,BBBB', mimeType: 'image/webp' },
      { result: 'data:image/jpeg;base64,CCCC', mimeType: 'image/jpeg' },
    ]);
  });
});

describe('decodeBackendProxyResultEnvelope — Blob round-trip', () => {
  it('round-trips non-UTF-8 bytes byte-for-byte as a real Blob with the correct type and length', async () => {
    const raw = new Uint8Array([0x00, 0xff, 0xfe, 0x80, 0x7f, 0x01, 0xc3, 0x28]); // 0xC3 0x28 is invalid UTF-8
    const blob = new Blob([raw], { type: 'application/octet-stream' });
    // The primary result and the binary describe the SAME asset: the data URL carries the identical
    // bytes and MIME as the Blob, which the decoder now binds and enforces. A `package` (application/*
    // archive) is the family-coherent home for these opaque octet-stream bytes.
    const envelope = await encodeBackendProxyResultEnvelope({
      result: `data:application/octet-stream;base64,${Buffer.from(raw).toString('base64')}`,
      resultType: 'package',
      blob,
    });
    // Survives a JSON hop, proving it is genuinely serializable over the wire.
    const decoded = decodeBackendProxyResultEnvelope(JSON.parse(JSON.stringify(envelope)));
    expect(decoded.blob).toBeInstanceOf(Blob);
    expect(decoded.blob?.type).toBe('application/octet-stream');
    expect(decoded.blob?.size).toBe(raw.byteLength);
    expect(await bytesOf(decoded.blob!)).toEqual(raw);
  });

  it('reconstructs a zero-byte Blob', () => {
    const decoded = decodeBackendProxyResultEnvelope(versioned({
      result: 'data:application/octet-stream;base64,',
      resultType: 'package',
      binary: { encoding: 'base64', mimeType: 'application/octet-stream', byteLength: 0, data: '' },
    }));
    expect(decoded.blob?.size).toBe(0);
  });
});

describe('decodeBackendProxyResultEnvelope — primary/binary binding', () => {
  const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  const b64 = Buffer.from(bytes).toString('base64');
  const matchingDataUrl = `data:image/png;base64,${b64}`;
  const binary = { encoding: 'base64' as const, mimeType: 'image/png', byteLength: bytes.byteLength, data: b64 };

  it('accepts a primary data URL that matches the binary byte-for-byte and derives runtime MIME from the binary', () => {
    const decoded = decodeBackendProxyResultEnvelope(versioned({ result: matchingDataUrl, resultType: 'image', binary }));
    expect(decoded.blob?.size).toBe(bytes.byteLength);
    // No top-level mimeType supplied → runtime MIME is derived from the (matching) binary.
    expect(decoded.mimeType).toBe('image/png');
  });

  it('honours a top-level MIME that agrees with the binary and data URL', () => {
    const decoded = decodeBackendProxyResultEnvelope(versioned({ result: matchingDataUrl, resultType: 'image', mimeType: 'image/png', binary }));
    expect(decoded.mimeType).toBe('image/png');
  });

  it.each<[string, Record<string, unknown>]>([
    ['data-URL MIME disagrees with the binary', versioned({ result: `data:image/webp;base64,${b64}`, resultType: 'image', binary })],
    ['top-level MIME disagrees with the binary', versioned({ result: matchingDataUrl, resultType: 'image', mimeType: 'image/webp', binary })],
    ['primary bytes differ from the binary at the same length', versioned({
      result: `data:image/png;base64,${Buffer.from(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0b])).toString('base64')}`,
      resultType: 'image', binary,
    })],
    ['HTTP(S) primary cannot prove local bytes', versioned({ result: 'https://cdn.example/img.png', resultType: 'image', binary })],
    ['a binary requires an asset result type', versioned({ result: matchingDataUrl, resultType: 'json', binary })],
  ])('rejects when %s', (_label, payload) => {
    expect(() => decodeBackendProxyResultEnvelope(payload)).toThrow(NonRetryableError);
  });

  it('keeps an HTTP(S) primary valid when there is NO binary (unprovable is only rejected alongside binary)', () => {
    const decoded = decodeBackendProxyResultEnvelope(versioned({ result: 'https://cdn.example/img.png', resultType: 'image' }));
    expect(decoded.result).toBe('https://cdn.example/img.png');
    expect(decoded.blob).toBeUndefined();
  });
});

describe('decodeBackendProxyResultEnvelope — media-family contract', () => {
  // A direct executor only ever emits a primary and siblings of ITS OWN family (imageGen → image/*,
  // etc.). A proxied envelope must not be able to declare one family while smuggling another as the
  // primary, the binary, or an additional sibling — the store would otherwise persist heterogeneous
  // media under the parent kind.
  it.each<[string, Record<string, unknown>]>([
    ['image-declared primary carries a video data URL', versioned({ result: 'data:video/mp4;base64,AAAA', resultType: 'image' })],
    ['image-declared primary carries an audio data URL', versioned({ result: 'data:audio/wav;base64,AAAA', resultType: 'image' })],
    ['image primary supplied MIME disagrees with its (same-family) data URL', versioned({ result: 'data:image/png;base64,AAAA', resultType: 'image', mimeType: 'image/webp' })],
    ['image primary supplied MIME is a foreign family', versioned({ result: 'https://cdn.example/x', resultType: 'image', mimeType: 'audio/mpeg' })],
    ['image additional result is an audio data URL', versioned({ result: 'data:image/png;base64,AAAA', resultType: 'image', additionalResults: [{ result: 'data:audio/wav;base64,BBBB' }] })],
    ['image additional result is a video data URL (even with matching MIME)', versioned({ result: 'data:image/png;base64,AAAA', resultType: 'image', additionalResults: [{ result: 'data:video/mp4;base64,BBBB', mimeType: 'video/mp4' }] })],
    ['image additional result HTTP URL carries a foreign explicit MIME', versioned({ result: 'data:image/png;base64,AAAA', resultType: 'image', additionalResults: [{ result: 'https://cdn.example/clip', mimeType: 'video/mp4' }] })],
    ['video-declared primary carries an image data URL', versioned({ result: 'data:image/png;base64,AAAA', resultType: 'video' })],
    ['video HTTP primary carries a foreign explicit MIME', versioned({ result: 'https://cdn.example/clip', resultType: 'video', mimeType: 'image/png' })],
    ['audio-declared additional result is an image data URL', versioned({ result: 'data:audio/mpeg;base64,AAAA', resultType: 'audio', additionalResults: [{ result: 'data:image/png;base64,BBBB' }] })],
    ['package-declared primary carries a video data URL', versioned({ result: 'data:video/mp4;base64,AAAA', resultType: 'package' })],
    ['non-asset (text) result declares asset siblings', versioned({ result: 'hello', resultType: 'text', additionalResults: [{ result: 'data:image/png;base64,AAAA' }] })],
    ['an internally-consistent video binary+primary is still rejected under an image declaration', versioned({
      result: `data:video/mp4;base64,${Buffer.from([0x00, 0x00, 0x00, 0x18]).toString('base64')}`,
      resultType: 'image',
      binary: { encoding: 'base64', mimeType: 'video/mp4', byteLength: 4, data: Buffer.from([0x00, 0x00, 0x00, 0x18]).toString('base64') },
    })],
  ])('rejects when %s', (_label, payload) => {
    expect(() => decodeBackendProxyResultEnvelope(payload)).toThrow(NonRetryableError);
  });

  it('accepts a video HTTP(S) primary with a same-family explicit MIME', () => {
    const decoded = decodeBackendProxyResultEnvelope(versioned({ result: 'https://cdn.example/clip.mp4', resultType: 'video', mimeType: 'video/mp4' }));
    expect(decoded.result).toBe('https://cdn.example/clip.mp4');
    expect(decoded.mimeType).toBe('video/mp4');
  });

  it('accepts a video HTTP(S) primary with no MIME (unprovable but same-family by the direct contract)', () => {
    const decoded = decodeBackendProxyResultEnvelope(versioned({ result: 'https://cdn.example/clip', resultType: 'video' }));
    expect(decoded.result).toBe('https://cdn.example/clip');
  });

  it('preserves ordered same-family image additionalResults (with and without explicit MIME)', () => {
    const decoded = decodeBackendProxyResultEnvelope(versioned({
      result: 'data:image/png;base64,AAAA',
      resultType: 'image',
      additionalResults: [
        { result: 'data:image/webp;base64,BBBB', mimeType: 'image/webp' },
        { result: 'data:image/jpeg;base64,CCCC' },
      ],
    }));
    expect(decoded.additionalResults).toEqual([
      { result: 'data:image/webp;base64,BBBB', mimeType: 'image/webp' },
      { result: 'data:image/jpeg;base64,CCCC' },
    ]);
  });

  it('preserves ordered same-family audio additionalResults', () => {
    const decoded = decodeBackendProxyResultEnvelope(versioned({
      result: 'data:audio/mpeg;base64,AAAA',
      resultType: 'audio',
      additionalResults: [{ result: 'data:audio/wav;base64,BBBB', mimeType: 'audio/wav' }],
    }));
    expect(decoded.additionalResults).toEqual([{ result: 'data:audio/wav;base64,BBBB', mimeType: 'audio/wav' }]);
  });
});

describe('decodeBackendProxyResultEnvelope — usage allowlist', () => {
  const usage = (overrides: Record<string, unknown>) => versioned({
    result: 'x', resultType: 'text', usage: { source: 'actual', confidence: 'measured', ...overrides },
  });

  it('accepts provider/modelId at the exact length bound and preserves a legitimate zero', () => {
    const limits = tinyLimits({ maxUsageStringLength: 8 });
    const decoded = decodeBackendProxyResultEnvelope(usage({
      provider: 'a'.repeat(8), modelId: 'b'.repeat(8), costUsd: 0, imageCount: 0, inputTokens: 12,
    }), limits);
    expect(decoded.usage).toEqual({
      source: 'actual', confidence: 'measured', provider: 'a'.repeat(8), modelId: 'b'.repeat(8),
      costUsd: 0, imageCount: 0, inputTokens: 12,
    });
  });

  it.each<[string, Record<string, unknown>]>([
    ['invalid source enum', { source: 'guess' }],
    ['invalid confidence enum', { confidence: 'vibes' }],
    ['negative cost', { costUsd: -0.01 }],
    ['negative token count', { inputTokens: -1 }],
    ['fractional token count', { outputTokens: 1.5 }],
    ['fractional image count', { imageCount: 2.5 }],
    ['unknown field', { surprise: true }],
    ['oversized provider string', { provider: 'p'.repeat(4096) }],
  ])('rejects usage with %s', (_label, overrides) => {
    // source/confidence overrides land in the object; the enum cases override those exact keys.
    expect(() => decodeBackendProxyResultEnvelope(usage(overrides))).toThrow(NonRetryableError);
  });

  it('does not cast unknown keys through even when every known field is valid', () => {
    expect(() => decodeBackendProxyResultEnvelope(usage({ inputTokens: 3, extraneous: 'x' }))).toThrow(/unsupported field/);
  });
});

describe('decodeBackendProxyResultEnvelope — direct-vs-proxy parity', () => {
  it('a direct ExecutionResult encoded and decoded is field-equivalent', async () => {
    const direct = {
      result: 'data:image/png;base64,QUJD',
      resultType: 'image' as const,
      statusMessage: 'Generated with stable-image-core',
      usage: { source: 'actual' as const, confidence: 'heuristic' as const, costUsd: 0.02, imageCount: 1 },
      mimeType: 'image/png',
      extension: 'png',
      fileName: 'render.png',
      outputMetadata: { width: 1024, height: 1024 },
    };
    const decoded = decodeBackendProxyResultEnvelope(
      JSON.parse(JSON.stringify(await encodeBackendProxyResultEnvelope(direct))),
    );
    expect(decoded).toMatchObject(direct);
  });
});

describe('decodeBackendProxyResultEnvelope — bounds (exact edge + edge+1)', () => {
  it('accepts a Blob at the exact byte limit and rejects one byte over, without allocating the declared payload', () => {
    const limits = tinyLimits({ maxDecodedBinaryBytes: 4, maxEncodedBinaryLength: 1024 });
    const okData = Buffer.from(new Uint8Array([1, 2, 3, 4])).toString('base64');
    const ok = decodeBackendProxyResultEnvelope(versioned({
      result: `data:application/octet-stream;base64,${okData}`,
      resultType: 'package',
      binary: { encoding: 'base64', mimeType: 'application/octet-stream', byteLength: 4, data: okData },
    }), limits);
    expect(ok.blob?.size).toBe(4);

    // Declared 5 bytes with a matching-length payload: rejected because 5 > 4 (before binding).
    const overData = Buffer.from(new Uint8Array([1, 2, 3, 4, 5])).toString('base64');
    expect(() => decodeBackendProxyResultEnvelope(versioned({
      result: `data:application/octet-stream;base64,${overData}`,
      resultType: 'package',
      binary: { encoding: 'base64', mimeType: 'application/octet-stream', byteLength: 5, data: overData },
    }), limits)).toThrow(NonRetryableError);
  });

  it('rejects an absurd declared byteLength without attempting to allocate it', () => {
    const limits = tinyLimits({ maxDecodedBinaryBytes: 8 });
    // Declared a terabyte but data is empty: rejected on the number alone, no allocation.
    expect(() => decodeBackendProxyResultEnvelope(versioned({
      result: 'data:application/octet-stream;base64,AA==',
      resultType: 'package',
      binary: { encoding: 'base64', mimeType: 'application/octet-stream', byteLength: 1_000_000_000_000, data: '' },
    }), limits)).toThrow(/byteLength exceeds/);
  });

  it('accepts additionalResults at the exact count limit and rejects count+1', () => {
    const limits = tinyLimits({ maxAdditionalResults: 2 });
    const make = (count: number) => versioned({
      result: 'data:image/png;base64,AAAA',
      resultType: 'image',
      additionalResults: Array.from({ length: count }, (_, i) => ({ result: `data:image/png;base64,${'A'.repeat(4)}${i}` })),
    });
    expect(decodeBackendProxyResultEnvelope(make(2), limits).additionalResults).toHaveLength(2);
    expect(() => decodeBackendProxyResultEnvelope(make(3), limits)).toThrow(/additionalResults exceeds/);
  });

  it('accepts metadata at the exact depth limit and rejects depth+1', () => {
    const limits = tinyLimits({ maxMetadataDepth: 3 });
    const atLimit = { a: { b: { c: 1 } } };       // depths 1,2,3
    const overLimit = { a: { b: { c: { d: 1 } } } }; // depth 4
    expect(decodeBackendProxyResultEnvelope(versioned({ result: '{}', resultType: 'json', outputMetadata: atLimit }), limits).outputMetadata)
      .toEqual(atLimit);
    expect(() => decodeBackendProxyResultEnvelope(versioned({ result: '{}', resultType: 'json', outputMetadata: overLimit }), limits))
      .toThrow(/nests deeper/);
  });

  it('rejects metadata whose serialized size exceeds the limit', () => {
    const limits = tinyLimits({ maxMetadataSerializedBytes: 32 });
    expect(() => decodeBackendProxyResultEnvelope(versioned({
      result: '{}', resultType: 'json', outputMetadata: { blob: 'x'.repeat(64) },
    }), limits)).toThrow(/exceeds the 32-byte limit/);
  });

  it('rejects an over-long encoded binary payload before decoding it', () => {
    const limits = tinyLimits({ maxEncodedBinaryLength: 4 });
    expect(() => decodeBackendProxyResultEnvelope(versioned({
      result: 'data:application/octet-stream;base64,AAAA',
      resultType: 'package',
      binary: { encoding: 'base64', mimeType: 'application/octet-stream', byteLength: 6, data: 'AAAAAAAA' },
    }), limits)).toThrow(/binary.data exceeds/);
  });
});

describe('decodeBackendProxyResultEnvelope — rejections', () => {
  it.each<[string, unknown]>([
    ['invalid base64', versioned({ result: 'data:image/png;base64,AA==', resultType: 'image', binary: { encoding: 'base64', mimeType: 'image/png', byteLength: 3, data: '@@@@' } })],
    ['byte-length mismatch', versioned({ result: 'data:image/png;base64,AA==', resultType: 'image', binary: { encoding: 'base64', mimeType: 'image/png', byteLength: 99, data: Buffer.from([1, 2]).toString('base64') } })],
    ['unsupported binary encoding', versioned({ result: 'data:image/png;base64,AA==', resultType: 'image', binary: { encoding: 'hex', mimeType: 'image/png', byteLength: 1, data: '01' } })],
    ['malformed metadata (array)', versioned({ result: '{}', resultType: 'json', outputMetadata: [1, 2, 3] })],
    ['non-finite telemetry', versioned({ result: 'x', resultType: 'text', usage: { source: 'actual', confidence: 'measured', costUsd: Number.POSITIVE_INFINITY } })],
    ['NaN telemetry', versioned({ result: 'x', resultType: 'text', usage: { source: 'actual', confidence: 'measured', inputTokens: Number.NaN } })],
    ['unknown result type', versioned({ result: 'x', resultType: 'quantum' })],
    ['wrong result type for boolean', versioned({ result: 'true', resultType: 'boolean' })],
    ['asset result is not a URL', versioned({ result: 'not-a-url', resultType: 'image' })],
    ['asset result is an object URL', versioned({ result: 'blob:https://x/abc', resultType: 'image' })],
    ['additional child malformed', versioned({ result: 'data:image/png;base64,AAAA', resultType: 'image', additionalResults: [{ result: 'data:image/png;base64,BBBB' }, { result: 42 }] })],
    ['tempting fields in an error payload', versioned({ error: 'provider blew up', result: 'data:image/png;base64,AAAA', resultType: 'image', binary: { encoding: 'base64', mimeType: 'image/png', byteLength: 2, data: Buffer.from([1, 2]).toString('base64') } })],
    ['unsupported version', { envelopeVersion: 999, result: 'x', resultType: 'text' }],
    ['non-record payload', []],
  ])('rejects %s', (_label, payload) => {
    expect(() => decodeBackendProxyResultEnvelope(payload)).toThrow(NonRetryableError);
  });
});

describe('decodeBackendProxyResultEnvelope — legacy unversioned adapter', () => {
  it('accepts the historical single-asset shape', () => {
    const decoded = decodeBackendProxyResultEnvelope({
      result: 'data:image/png;base64,Q09SRQ==',
      resultType: 'image',
      statusMessage: 'Generated through backend proxy',
    });
    expect(decoded).toMatchObject({ result: 'data:image/png;base64,Q09SRQ==', resultType: 'image' });
    expect(decoded.blob).toBeUndefined();
    expect(decoded.additionalResults).toBeUndefined();
  });

  it('refuses a legacy payload that tries to claim a Blob', () => {
    expect(() => decodeBackendProxyResultEnvelope({
      result: 'data:image/png;base64,AAAA',
      resultType: 'image',
      binary: { encoding: 'base64', mimeType: 'image/png', byteLength: 2, data: Buffer.from([1, 2]).toString('base64') },
    })).toThrow(/versioned result envelope/);
  });

  it('refuses a legacy payload that tries to claim multiple results', () => {
    expect(() => decodeBackendProxyResultEnvelope({
      result: 'data:image/png;base64,AAAA',
      resultType: 'image',
      additionalResults: [{ result: 'data:image/png;base64,BBBB' }],
    })).toThrow(/versioned result envelope/);
  });
});
