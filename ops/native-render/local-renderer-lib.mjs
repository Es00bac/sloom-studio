import path from 'node:path';

/**
 * Pure/testable helpers for `local-renderer.mjs`'s frame-server streaming endpoints (`POST
 * /render-stream/start`, `/render-stream/chunk`, `/render-stream/finish`). Kept separate from the
 * HTTP server itself (same split as `ops/dev-dashboard/dashboard.mjs` / `dashboard-lib.mjs`) so the
 * backpressure/truncation and ffmpeg-argv logic can be unit tested without spawning a real server or
 * ffmpeg process.
 *
 * Wire protocol — three small requests instead of one long-lived streaming one:
 *   1. POST /render-stream/start   body: JSON metadata (ordinary, bounded request; audio inputs ride
 *      here as base64, same shape the existing `/render` endpoint already uses). Response:
 *      `{ sessionId }`.
 *   2. POST /render-stream/chunk?session=<id>   body: raw RGBA bytes for one frame (or a small batch)
 *      — an ordinary Blob/ArrayBuffer body with a real Content-Length, repeated once per chunk.
 *      Response only after the chunk is safely absorbed by ffmpeg's stdin (see
 *      `writeStreamChunkToFfmpegStdin`) — THIS is the backpressure mechanism: the client can't send
 *      the next chunk until the current one's response arrives, so a slow encoder naturally paces a
 *      fast frame producer, without either side ever needing to buffer the whole video.
 *   3. POST /render-stream/finish?session=<id>   body: empty. Ends ffmpeg's stdin, awaits the encode,
 *      returns the mp4 — same response shape the existing `/render` endpoint already uses.
 *
 * This replaced an earlier design (one POST with a `ReadableStream` request body). That design is a
 * dead end in every Chromium-based client (Electron's renderer included): Chrome only supports a
 * streamed `fetch()` request body over HTTP/2 + TLS (`duplex: 'half'` throws
 * `ERR_ALPN_NEGOTIATION_FAILED` over plain HTTP/1.1, which is what a localhost helper service should
 * stay on — asking every user's machine to trust a self-signed cert for a loopback render helper is
 * not reasonable). Confirmed by exercising the real client against a real dev server, not assumed.
 */

export const STREAM_SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000; // sweep abandoned sessions after 10 minutes

export class StreamTruncatedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'StreamTruncatedError';
  }
}

export function validateStreamMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    throw new Error('Render-stream metadata is missing.');
  }

  for (const key of ['width', 'height', 'fps', 'frameCount']) {
    if (!Number.isFinite(metadata[key]) || metadata[key] <= 0) {
      throw new Error(`Render-stream metadata field "${key}" must be a positive number.`);
    }
  }

  if (metadata.pixFmt !== 'rgba') {
    throw new Error('Render-stream metadata field "pixFmt" must be "rgba" for this milestone.');
  }

  if (typeof metadata.outputName !== 'string' || !metadata.outputName.trim()) {
    throw new Error('Render-stream metadata field "outputName" is missing.');
  }

  if (!Array.isArray(metadata.commandPrefix) || !Array.isArray(metadata.middleArgs)) {
    throw new Error('Render-stream metadata is missing its ffmpeg argument arrays.');
  }

  if (!Array.isArray(metadata.audioInputs)) {
    throw new Error('Render-stream metadata field "audioInputs" is missing.');
  }

  return metadata;
}

/** Expected raw-video byte length for a fully-received frame stream: one RGBA (4 bytes/px) frame
 *  per `frameCount`, at `width x height`. Used to detect an upload that finished short. */
export function expectedFrameStreamBytes(metadata) {
  return metadata.width * metadata.height * 4 * metadata.frameCount;
}

/**
 * Builds the full ffmpeg argv for the streaming render, given already-sanitized audio input file
 * names (written to disk by the caller) and the client-supplied `commandPrefix` / `middleArgs`.
 * Deliberately dumb: exactly like the existing `/render` endpoint, the SERVER does not decide
 * backend/encoder/filter semantics — the client (which already owns `nativeRenderSupport.ts`) fully
 * resolves those into `commandPrefix` (global input-side options such as `-vaapi_device`) and
 * `middleArgs` (video filter + map + encoder + audio codec args, everything between the last `-i`
 * and the output filename). This keeps one source of ffmpeg truth (the client) instead of teaching
 * the server a second copy of encoder-selection logic.
 */
export function buildStreamFfmpegArgs(metadata, audioInputFileNames) {
  return [
    ...metadata.commandPrefix,
    '-f', 'rawvideo',
    '-pix_fmt', metadata.pixFmt,
    '-s', `${metadata.width}x${metadata.height}`,
    '-r', String(metadata.fps),
    '-i', 'pipe:0',
    ...audioInputFileNames.flatMap((name) => ['-i', name]),
    ...metadata.middleArgs,
    metadata.outputName,
  ];
}

/**
 * Writes one chunk to ffmpeg's stdin, resolving once it is safe to accept the NEXT chunk: immediately
 * if `stdin.write()` reports no backpressure, or after the next `drain` event otherwise. Rejects if
 * `stdin` errors while writing (e.g. ffmpeg already exited) — the caller should treat that as fatal
 * for the session (kill ffmpeg if it hasn't already, respond with an error, drop the session).
 */
export function writeStreamChunkToFfmpegStdin(stdin, chunk) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      stdin.removeListener('error', onError);
      reject(error);
    };

    stdin.once('error', onError);

    const canContinue = stdin.write(chunk);

    if (canContinue) {
      stdin.removeListener('error', onError);
      resolve();
      return;
    }

    stdin.once('drain', () => {
      stdin.removeListener('error', onError);
      resolve();
    });
  });
}

/** Opaque, sufficiently-unique id for a chunked upload session. Not a security boundary (this
 *  service is loopback-only) — just needs to not collide across concurrent renders. */
export function createRenderStreamSessionId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Given a `Map` of live sessions (keyed by id, each with a `lastActivityAt` timestamp), returns the ids
 * that have been idle longer than `idleTimeoutMs` — a client that starts an upload and never calls
 * `/finish` (crash, closed tab) would otherwise leak a temp dir and an ffmpeg process forever. The
 * caller is responsible for actually killing/cleaning up each returned session; kept as a pure
 * "which ones" query here so it is unit-testable without real timers or processes.
 */
export function findExpiredStreamSessions(sessions, now = Date.now(), idleTimeoutMs = STREAM_SESSION_IDLE_TIMEOUT_MS) {
  const expired = [];

  for (const [sessionId, session] of sessions) {
    const lastActivityAt = session.lastActivityAt ?? session.createdAt;
    if (now - lastActivityAt > idleTimeoutMs) {
      expired.push(sessionId);
    }
  }

  return expired;
}

export function sanitizeFileName(value) {
  const safeName = path.basename(String(value)).replace(/[^a-zA-Z0-9._-]/g, '_');

  if (!safeName) {
    throw new Error(`Invalid render input or output name: ${value}`);
  }

  return safeName;
}

/**
 * Validates a renderer-supplied desktop source path before the native service asks the OS for it.
 * This endpoint already receives the complete FFmpeg argv from the trusted local renderer; linked
 * paths remove the much riskier multi-gigabyte base64 copy without broadening that trust boundary.
 */
export function validateLinkedRenderInputPath(value) {
  const candidate = typeof value === 'string' ? value.trim() : '';

  if (!candidate || candidate.includes('\0') || !path.isAbsolute(candidate)) {
    throw new Error('Linked render inputs require an absolute local file path.');
  }

  return path.normalize(candidate);
}

export function buildLinkedRenderOutputPath(directoryPath, outputName, uniqueId) {
  const directory = typeof directoryPath === 'string' ? directoryPath.trim() : '';
  if (!directory || directory.includes('\0') || !path.isAbsolute(directory)) {
    throw new Error('Linked render outputs require an absolute local directory path.');
  }

  const safeOutputName = sanitizeFileName(outputName);
  const parsed = path.parse(safeOutputName);
  const safeUniqueId = sanitizeFileName(uniqueId || createRenderStreamSessionId()).replaceAll('.', '_');
  return path.join(path.normalize(directory), `${parsed.name}-${safeUniqueId}${parsed.ext}`);
}

/** Replace only complete argv entries that name an uploaded input; filters and output args remain untouched. */
export function replaceLinkedRenderInputArgs(command, linkedInputPaths) {
  return command.map((argument) => linkedInputPaths.get(argument) ?? argument);
}
