import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBinaryImageResponseBlob, resolveReferenceImageInput } from './blobUtils';

function imageResponse(body: Uint8Array, contentType = 'image/png'): Response {
  return new Response(body as BodyInit, { headers: { 'content-type': contentType } });
}

describe('readBinaryImageResponseBlob', () => {
  it('passes real binary image bytes through unchanged (desktop / web)', async () => {
    // PNG magic 0x89504E47 — not valid base64, so it is treated as raw binary.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 250, 251, 252, 0, 9]);
    const blob = await readBinaryImageResponseBlob(imageResponse(png));

    expect(blob.type).toBe('image/png');
    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual(Array.from(png));
  });

  it('decodes a base64-text body (the Android CapacitorHttp-wrapped POST response)', async () => {
    const original = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    let raw = '';
    for (const b of original) raw += String.fromCharCode(b);
    const base64Text = btoa(raw);

    const blob = await readBinaryImageResponseBlob(imageResponse(new TextEncoder().encode(base64Text)));

    expect(Array.from(new Uint8Array(await blob.arrayBuffer()))).toEqual(Array.from(original));
  });

  it('honours the response content-type for the decoded blob', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const blob = await readBinaryImageResponseBlob(imageResponse(jpeg, 'image/jpeg; charset=binary'));
    expect(blob.type).toBe('image/jpeg');
  });
});

describe('resolveReferenceImageInput', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses the provided Blob directly without any fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });

    const resolved = await resolveReferenceImageInput({ image: blob });

    expect(resolved).toEqual({ blob });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('passes public http(s) URLs through untouched by default', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const resolved = await resolveReferenceImageInput({ imageUrl: ' https://example.com/ref.png ' });

    expect(resolved).toEqual({ httpUrl: 'https://example.com/ref.png' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('fetches http(s) URLs to bytes when the provider needs inline data (fetchHttp)', async () => {
    const bytes = new Uint8Array([9, 8, 7]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(bytes as BodyInit, { headers: { 'content-type': 'image/png' } })));

    const resolved = await resolveReferenceImageInput({ imageUrl: 'https://example.com/ref.png' }, { fetchHttp: true });

    expect(resolved && 'blob' in resolved).toBe(true);
    expect(Array.from(new Uint8Array(await (resolved as { blob: Blob }).blob.arrayBuffer()))).toEqual([9, 8, 7]);
  });

  it('resolves browser-local URLs (blob:/asset schemes) to bytes in-app — servers can never fetch those', async () => {
    const bytes = new Uint8Array([4, 5, 6]);
    const fetchSpy = vi.fn(async () => new Response(bytes as BodyInit, { headers: { 'content-type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchSpy);

    const resolved = await resolveReferenceImageInput({ imageUrl: 'blob:http://localhost/123-abc' });

    expect(fetchSpy).toHaveBeenCalledWith('blob:http://localhost/123-abc', { signal: undefined });
    expect(resolved && 'blob' in resolved).toBe(true);
  });

  it('throws a clear error when a local reference URL cannot be loaded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));

    await expect(resolveReferenceImageInput({ imageUrl: 'signal-loom-asset://missing' }))
      .rejects.toThrow('Reference image could not be loaded (404).');
  });

  it('throws when a reference resolves to empty data instead of silently sending nothing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob([]), { status: 200 })));

    await expect(resolveReferenceImageInput({ imageUrl: 'blob:http://localhost/empty' }))
      .rejects.toThrow('Reference image resolved to empty data.');
  });

  it('returns null for a reference with no image and no URL', async () => {
    expect(await resolveReferenceImageInput({})).toBeNull();
    expect(await resolveReferenceImageInput({ imageUrl: '   ' })).toBeNull();
  });
});
