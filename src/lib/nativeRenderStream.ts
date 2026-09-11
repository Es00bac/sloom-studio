/**
 * Client-side transport for the frame-server export's streaming render endpoints (`POST
 * /render-stream/{start,chunk,finish}` on `ops/native-render/local-renderer.mjs`). Mirrors
 * `localNativeRender.ts`'s conventions (endpoint resolution, error extraction, base64 helpers) but is
 * kept as its own module rather than folded into `localNativeRender.ts` — the legacy `/render`
 * endpoint and its client stay completely untouched by this feature; see `resolveNativeRenderTarget`,
 * reused as-is.
 *
 * Wire protocol: three small requests, not one long-lived streaming one — see
 * `ops/native-render/local-renderer-lib.mjs`'s module doc comment for the full shape and for why:
 * Chrome's `fetch()` only supports a streamed (`ReadableStream`) request body over HTTP/2 + TLS.
 * Confirmed against a real dev server + real render service: a plain `duplex: 'half'` streaming
 * upload to a plain `http://` origin throws `ERR_ALPN_NEGOTIATION_FAILED` immediately, every time —
 * not a corner case, a hard requirement (https://developer.chrome.com/docs/capabilities/web-apis/fetch-streaming-requests).
 * Requiring HTTPS for a loopback render helper would mean asking every user to trust a self-signed
 * cert for a local process — not reasonable. So instead: one ordinary POST to start the session, one
 * ordinary (non-streaming) POST per frame/chunk with a ordinary Content-Length, one ordinary POST to
 * finish. Each chunk request only resolves once the server has safely absorbed it into ffmpeg's
 * stdin — awaiting that before sending the next chunk IS the backpressure contract here, expressed as
 * request/response pacing instead of a raw stream's pause()/resume().
 */
import type { ProviderSettings } from '../types/flow';
import { resolveNativeRenderTarget } from './localNativeRender';
import type { NativeRenderExecutionBackend } from './nativeRenderSupport';

export interface StageFrameStreamAudioInput {
  name: string;
  base64: string;
}

export interface StageFrameStreamMetadata {
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  outputName: string;
  backend: NativeRenderExecutionBackend;
  /** Global ffmpeg options that must precede every `-i` (e.g. `-vaapi_device ...`). */
  commandPrefix: string[];
  /** Everything between the last `-i` and the output filename: video filter, `-map`s, encoder args,
   *  audio filter_complex + codec args. The client (not the server) owns this, exactly like the
   *  existing `/render` endpoint's `command` — see `nativeRenderSupport.ts`'s
   *  `getNativeSequenceEncoderArgs`/`getNativeSequenceOutputFilter`, which build most of it. */
  middleArgs: string[];
  audioInputs: StageFrameStreamAudioInput[];
}

/**
 * Uploads a deterministically-generated sequence of raw RGBA frames to the native render service for
 * encode+mux, returning the resulting mp4 as a `Blob`. Returns `null` (never throws for
 * unreachability) when no native render target is configured/reachable, so callers can fall back to
 * the legacy ffmpeg-graph export path — mirrors `renderViaLocalNativeFFmpeg`'s null-means-fallback
 * contract in `localNativeRender.ts`. A failure AFTER the session starts (chunk or finish rejected)
 * throws, same as the legacy path's fetch failures — this is a real render error, not "unavailable."
 */
export async function renderStageFrameStream(
  providerSettings: ProviderSettings,
  metadata: StageFrameStreamMetadata,
  frames: AsyncIterable<Uint8Array>,
): Promise<Blob | null> {
  const target = await resolveNativeRenderTarget(providerSettings);

  if (!target) {
    return null;
  }

  const token = providerSettings.localNativeRenderToken?.trim();
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    ...(token ? { 'X-Signal-Loom-Render-Token': token } : {}),
  };

  const startResponse = await fetch(`${target.endpoint}/render-stream/start`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...metadata, backend: target.backend, pixFmt: 'rgba' as const }),
  });

  if (!startResponse.ok) {
    throw new Error(await extractStreamRenderError(startResponse));
  }

  const { sessionId } = await startResponse.json() as { sessionId: string };

  for await (const frame of frames) {
    const chunkResponse = await fetch(`${target.endpoint}/render-stream/chunk?session=${encodeURIComponent(sessionId)}`, {
      method: 'POST',
      headers,
      body: toArrayBufferBody(frame),
    });

    if (!chunkResponse.ok) {
      throw new Error(await extractStreamRenderError(chunkResponse));
    }

    // Draining the (tiny, `{ok, bytesReceived}`) response body lets the connection be reused for
    // the next chunk instead of piling up unread bodies.
    await chunkResponse.arrayBuffer();
  }

  const finishResponse = await fetch(`${target.endpoint}/render-stream/finish?session=${encodeURIComponent(sessionId)}`, {
    method: 'POST',
    headers,
  });

  if (!finishResponse.ok) {
    throw new Error(await extractStreamRenderError(finishResponse));
  }

  return await finishResponse.blob();
}

/** Fetches `url`, base64-encodes the bytes, and names the result — the shape
 *  `StageFrameStreamMetadata.audioInputs` (and the existing `/render` endpoint's `inputs`) expect. */
export async function fetchAsStreamAudioInput(name: string, url: string): Promise<StageFrameStreamAudioInput> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Unable to prepare frame-server audio input "${name}".`);
  }

  const buffer = await response.arrayBuffer();

  return { name, base64: arrayBufferToBase64(buffer) };
}

/** `fetch`'s `body` option rejects a plain `Uint8Array` view in some engines when its `byteOffset`
 *  isn't 0 (e.g. a view into a larger shared buffer) — copy to a fresh, tightly-sized `ArrayBuffer`
 *  so every frame is unambiguously a valid `BodyInit` regardless of how the caller sliced it. */
function toArrayBufferBody(frame: Uint8Array): ArrayBuffer {
  if (frame.byteOffset === 0 && frame.byteLength === frame.buffer.byteLength) {
    return frame.buffer as ArrayBuffer;
  }

  return frame.slice().buffer as ArrayBuffer;
}

async function extractStreamRenderError(response: Response): Promise<string> {
  const text = await response.text();

  if (!text.trim()) {
    return 'The local native render service returned an empty error response.';
  }

  try {
    const payload = JSON.parse(text) as { error?: string };
    return payload.error || text;
  } catch {
    return text;
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}
