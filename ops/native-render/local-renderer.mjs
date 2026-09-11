import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import {
  buildLinkedRenderOutputPath,
  buildStreamFfmpegArgs,
  createRenderStreamSessionId,
  expectedFrameStreamBytes,
  findExpiredStreamSessions,
  sanitizeFileName as sanitizeStreamFileName,
  StreamTruncatedError,
  replaceLinkedRenderInputArgs,
  validateStreamMetadata,
  validateLinkedRenderInputPath,
  writeStreamChunkToFfmpegStdin,
} from './local-renderer-lib.mjs';

const HOST = process.env.SIGNAL_LOOM_NATIVE_RENDER_HOST || '127.0.0.1';
const PORT = Number.parseInt(process.env.SIGNAL_LOOM_NATIVE_RENDER_PORT || '41736', 10);
const VAAPI_DEVICE = '/dev/dri/renderD128';

/** Live chunked-upload sessions for the frame-server streaming endpoints, keyed by session id — see
 *  local-renderer-lib.mjs's module doc comment for the three-request wire protocol this backs. */
const streamSessions = new Map();

const health = await probeCapabilities();

const server = http.createServer(async (request, response) => {
  setCorsHeaders(response);

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  try {
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(health));
      return;
    }

    if (request.method === 'POST' && request.url === '/render') {
      const payload = await readJson(request);
      const result = await executeRenderJob(payload);
      if (result && typeof result === 'object' && 'filePath' in result) {
        response.writeHead(200, {
          'Content-Type': 'application/json',
          'X-Signal-Loom-Renderer': payload.backend,
        });
        response.end(JSON.stringify(result));
        return;
      }
      response.writeHead(200, {
        'Content-Type': 'video/mp4',
        'X-Signal-Loom-Renderer': payload.backend,
      });
      response.end(result);
      return;
    }

    // Delivery loudness is a real two-pass operation: the renderer needs the
    // first pass's measured JSON before it can build the final output filter.
    // Keep the report itself local and return only that small JSON object, not
    // FFmpeg's path-bearing diagnostic stream or any media bytes.
    if (request.method === 'POST' && request.url === '/analyze-loudness') {
      const payload = await readJson(request);
      const report = await executeLoudnessAnalysis(payload);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ report }));
      return;
    }

    // Frame-server export (docs/gpu-frame-server-export-brief.md): the client has ALREADY
    // composited every frame (same compositor as the Edit Stage) and uploads raw RGBA bytes here in
    // small chunks (see local-renderer-lib.mjs's module doc for why three requests, not one
    // streamed body). This endpoint's only job across the three routes below is: spawn ffmpeg once,
    // wire chunks to its stdin with backpressure, mux the client's audio inputs, and hand back the
    // mp4.
    if (request.method === 'POST' && request.url === '/render-stream/start') {
      const payload = await readJson(request);
      const { sessionId } = await startStreamingRenderSession(payload);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ sessionId }));
      return;
    }

    if (request.method === 'POST' && request.url.startsWith('/render-stream/chunk')) {
      const sessionId = new URL(request.url, 'http://internal').searchParams.get('session');
      const bytesReceived = await appendStreamingRenderChunk(sessionId, request);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, bytesReceived }));
      return;
    }

    if (request.method === 'POST' && request.url.startsWith('/render-stream/finish')) {
      const sessionId = new URL(request.url, 'http://internal').searchParams.get('session');
      const result = await finishStreamingRenderSession(sessionId);
      response.writeHead(200, {
        'Content-Type': 'video/mp4',
        'X-Signal-Loom-Renderer': 'stage-frame-server',
      });
      response.end(result);
      return;
    }

    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Not found.' }));
  } catch (error) {
    response.writeHead(500, { 'Content-Type': 'application/json' });
    response.end(
      JSON.stringify({
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Signal Loom native render service listening on http://${HOST}:${PORT}`);
});

async function probeCapabilities() {
  const availableBackends = ['cpu'];
  const ffmpegVersion = await readFfmpegVersion();

  if (await probeVaapiBackend()) {
    availableBackends.push('amd-vaapi');
  }

  // Advertise broader hardware only after a real encode probe succeeds. Merely finding an FFmpeg
  // encoder name is insufficient: driver/device initialization must also work on this machine.
  if (await probeHardwareEncoder('h264_nvenc')) {
    availableBackends.push('nvidia-nvenc');
  }
  if (await probeHardwareEncoder('h264_qsv')) {
    availableBackends.push('intel-qsv');
  }

  return {
    ok: true,
    ffmpegVersion,
    availableBackends,
    recommendedBackend: availableBackends.includes('amd-vaapi')
      ? 'amd-vaapi'
      : availableBackends.includes('nvidia-nvenc')
        ? 'nvidia-nvenc'
        : availableBackends.includes('intel-qsv') ? 'intel-qsv' : 'cpu',
    cpuThreads: os.cpus().length,
  };
}

async function probeHardwareEncoder(encoder) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), `signal-loom-${encoder}-probe-`));
  try {
    await runProcess('ffmpeg', [
      '-hide_banner', '-y', '-f', 'lavfi', '-i', 'color=c=black:s=128x72:r=30:d=0.2',
      '-frames:v', '2', '-vf', 'format=yuv420p', '-c:v', encoder, '-f', 'mp4', path.join(tempDir, 'probe.mp4'),
    ], tempDir);
    return true;
  } catch {
    return false;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function readFfmpegVersion() {
  try {
    const output = await runProcess('ffmpeg', ['-hide_banner', '-version'], undefined);
    return output.stdout.split('\n')[0]?.trim() || 'ffmpeg';
  } catch {
    return 'ffmpeg';
  }
}

async function probeVaapiBackend() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'signal-loom-vaapi-probe-'));

  try {
    const outputPath = path.join(tempDir, 'probe.mp4');
    await runProcess(
      'ffmpeg',
      [
        '-hide_banner',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=1280x720:r=30:d=0.2',
        '-vf',
        'format=nv12,hwupload',
        '-vaapi_device',
        VAAPI_DEVICE,
        '-c:v',
        'h264_vaapi',
        outputPath,
      ],
      tempDir,
    );
    return true;
  } catch {
    return false;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function executeRenderJob(payload) {
  validateRenderPayload(payload);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'signal-loom-render-'));
  let linkedOutputPath;
  let renderCompleted = false;

  try {
    const linkedInputPaths = new Map();

    for (const input of payload.inputs) {
      const fileName = sanitizeFileName(input.name);

      if (typeof input.filePath === 'string' && input.filePath.trim()) {
        const linkedPath = await realpath(validateLinkedRenderInputPath(input.filePath));
        const linkedStat = await stat(linkedPath);

        if (!linkedStat.isFile()) {
          throw new Error(`Linked render input is not a regular file: ${linkedPath}`);
        }

        linkedInputPaths.set(fileName, linkedPath);
        continue;
      }

      if (typeof input.base64 !== 'string') {
        throw new Error(`Render input "${fileName}" has neither linked path nor inline bytes.`);
      }

      await writeFile(path.join(tempDir, fileName), Buffer.from(input.base64, 'base64'));
    }

    const outputName = sanitizeFileName(payload.outputName);
    const resolvedCommand = replaceLinkedRenderInputArgs(payload.command, linkedInputPaths);
    if (typeof payload.outputDirectoryPath === 'string' && payload.outputDirectoryPath.trim()) {
      linkedOutputPath = buildLinkedRenderOutputPath(
        payload.outputDirectoryPath,
        outputName,
        createRenderStreamSessionId(),
      );
      await mkdir(path.dirname(linkedOutputPath), { recursive: true });
      if (resolvedCommand.at(-1) !== outputName) {
        throw new Error('The render command output does not match the requested output name.');
      }
      resolvedCommand[resolvedCommand.length - 1] = linkedOutputPath;
    }
    await runProcess('ffmpeg', ['-hide_banner', '-y', ...resolvedCommand], tempDir);
    renderCompleted = true;
    if (linkedOutputPath) {
      return {
        filePath: linkedOutputPath,
        fileName: path.basename(linkedOutputPath),
      };
    }
    return await readFile(path.join(tempDir, outputName));
  } finally {
    if (linkedOutputPath && !renderCompleted) {
      await rm(linkedOutputPath, { force: true }).catch(() => {});
    }
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function executeLoudnessAnalysis(payload) {
  validateLoudnessAnalysisPayload(payload);
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'signal-loom-loudness-'));

  try {
    const linkedInputPaths = new Map();

    for (const input of payload.inputs) {
      const fileName = sanitizeFileName(input.name);

      if (typeof input.filePath === 'string' && input.filePath.trim()) {
        const linkedPath = await realpath(validateLinkedRenderInputPath(input.filePath));
        const linkedStat = await stat(linkedPath);
        if (!linkedStat.isFile()) {
          throw new Error(`Linked loudness input is not a regular file: ${linkedPath}`);
        }
        linkedInputPaths.set(fileName, linkedPath);
        continue;
      }

      if (typeof input.base64 !== 'string') {
        throw new Error(`Loudness input "${fileName}" has neither linked path nor inline bytes.`);
      }

      await writeFile(path.join(tempDir, fileName), Buffer.from(input.base64, 'base64'));
    }

    const resolvedCommand = replaceLinkedRenderInputArgs(payload.command, linkedInputPaths);
    const output = await runProcess('ffmpeg', ['-hide_banner', '-y', ...resolvedCommand], tempDir);
    return extractLoudnormJson(output.stdout, output.stderr);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function extractLoudnormJson(stdout, stderr) {
  const blocks = `${stdout}\n${stderr}`.match(/\{[\s\S]*?\}/g) ?? [];

  for (const block of blocks.reverse()) {
    try {
      const value = JSON.parse(block);
      if (
        value
        && typeof value === 'object'
        && ['input_i', 'input_lra', 'input_tp', 'input_thresh', 'target_offset']
          .every((key) => typeof value[key] === 'string' || typeof value[key] === 'number')
      ) {
        return block;
      }
    } catch {
      // Progress output can contain braces; only loudnorm's complete JSON is
      // returned to the renderer.
    }
  }

  throw new Error('FFmpeg loudness analysis did not return a complete measured first-pass report.');
}

/**
 * Handles POST /render-stream/start: validates the metadata, writes the client's audio input files
 * to a temp dir exactly like `executeRenderJob` does, spawns ffmpeg with `-i pipe:0` as the rawvideo
 * source, and parks the live process (plus its stderr buffer and exit promise) in `streamSessions`
 * keyed by a fresh session id for the `/chunk` and `/finish` calls that follow.
 */
async function startStreamingRenderSession(rawMetadata) {
  const metadata = validateStreamMetadata(rawMetadata);

  if (metadata.backend && !health.availableBackends.includes(metadata.backend)) {
    throw new Error(`${metadata.backend} rendering was requested, but this machine does not currently support it.`);
  }

  await sweepExpiredStreamSessions();

  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'signal-loom-render-stream-'));

  try {
    const audioInputFileNames = [];

    for (const input of metadata.audioInputs) {
      const fileName = sanitizeStreamFileName(input.name);
      await writeFile(path.join(tempDir, fileName), Buffer.from(input.base64, 'base64'));
      audioInputFileNames.push(fileName);
    }

    const outputName = sanitizeStreamFileName(metadata.outputName);
    const args = ['-hide_banner', '-y', ...buildStreamFfmpegArgs(metadata, audioInputFileNames)];
    const ffmpeg = spawn('ffmpeg', args, { cwd: tempDir, stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    ffmpeg.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    const ffmpegExit = new Promise((resolve, reject) => {
      ffmpeg.on('error', reject);
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(new Error(stderr.trim() || `ffmpeg exited with code ${code}`));
      });
    });
    // Nothing awaits `ffmpegExit` until /finish; without this, ffmpeg crashing mid-upload (bad
    // frame dims, encoder rejecting a param) would be an unhandled rejection the moment it happens.
    ffmpegExit.catch(() => {});

    const sessionId = createRenderStreamSessionId();
    const startedAt = Date.now();
    streamSessions.set(sessionId, {
      ffmpeg,
      tempDir,
      outputName,
      expectedBytes: expectedFrameStreamBytes(metadata),
      bytesReceived: 0,
      ffmpegExit,
      getStderr: () => stderr,
      createdAt: startedAt,
      lastActivityAt: startedAt,
    });

    return { sessionId };
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw error;
  }
}

/** Handles POST /render-stream/chunk?session=<id>: reads the (bounded, ordinary) request body as raw
 *  bytes and writes it to the session's ffmpeg stdin, awaiting drain if backpressured — see
 *  `writeStreamChunkToFfmpegStdin`'s doc comment for why this IS the backpressure mechanism here. */
async function appendStreamingRenderChunk(sessionId, request) {
  const session = requireStreamSession(sessionId);
  session.lastActivityAt = Date.now();

  if (session.ffmpeg.exitCode !== null || session.ffmpeg.signalCode !== null) {
    throw new Error(`Render-stream session "${sessionId}" already ended (ffmpeg is no longer running).${describeSessionFailure(session)}`);
  }

  const chunk = await readRawBody(request);

  try {
    await writeStreamChunkToFfmpegStdin(session.ffmpeg.stdin, chunk);
  } catch (error) {
    await abandonStreamSession(sessionId, session);
    throw error;
  }

  session.bytesReceived += chunk.length;
  session.lastActivityAt = Date.now();
  return session.bytesReceived;
}

/**
 * Handles POST /render-stream/finish?session=<id>: rejects a short upload as a `StreamTruncatedError`
 * (mirroring what a truncated single-stream upload would have surfaced), otherwise ends ffmpeg's
 * stdin, awaits the encode, and returns the mp4 bytes — same shape `/render` already returns.
 */
async function finishStreamingRenderSession(sessionId) {
  const session = requireStreamSession(sessionId);
  streamSessions.delete(sessionId);

  try {
    if (session.bytesReceived < session.expectedBytes) {
      throw new StreamTruncatedError(
        `Frame upload for session "${sessionId}" ended after ${session.bytesReceived} byte(s); expected ${session.expectedBytes}. The client likely disconnected mid-render.`,
      );
    }

    session.ffmpeg.stdin.end();

    try {
      await session.ffmpegExit;
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}${describeSessionFailure(session)}`);
    }

    return await readFile(path.join(session.tempDir, session.outputName));
  } finally {
    if (session.ffmpeg.exitCode === null && session.ffmpeg.signalCode === null) {
      session.ffmpeg.kill('SIGKILL');
    }

    await rm(session.tempDir, { recursive: true, force: true });
  }
}

function requireStreamSession(sessionId) {
  const session = sessionId ? streamSessions.get(sessionId) : undefined;

  if (!session) {
    throw new Error(`Unknown or expired render-stream session: "${sessionId}".`);
  }

  return session;
}

function describeSessionFailure(session) {
  const stderr = session.getStderr?.().trim();
  return stderr ? ` ffmpeg stderr: ${stderr}` : '';
}

/** A client that starts an upload and never calls /finish (crashed tab, killed process) would
 *  otherwise leak a temp dir and an ffmpeg process forever — kill+clean any session idle past
 *  `findExpiredStreamSessions`'s timeout. Opportunistic (runs on each /start), not a persistent
 *  timer: good enough for a localhost dev/render helper with a handful of concurrent sessions. */
async function sweepExpiredStreamSessions() {
  const expiredIds = findExpiredStreamSessions(streamSessions);

  for (const sessionId of expiredIds) {
    const session = streamSessions.get(sessionId);
    streamSessions.delete(sessionId);

    if (session) {
      await abandonStreamSession(sessionId, session);
    }
  }
}

async function abandonStreamSession(sessionId, session) {
  streamSessions.delete(sessionId);

  if (session.ffmpeg.exitCode === null && session.ffmpeg.signalCode === null) {
    session.ffmpeg.kill('SIGKILL');
  }

  await rm(session.tempDir, { recursive: true, force: true }).catch(() => {});
}

async function readRawBody(request) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;

    if (totalBytes > 256 * 1024 * 1024) {
      throw new Error('Render-stream chunk exceeded the 256MB safety limit.');
    }

    chunks.push(chunk);
  }

  return Buffer.concat(chunks, totalBytes);
}

function validateRenderPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Render payload is missing.');
  }

  if (!Array.isArray(payload.command) || payload.command.length === 0) {
    throw new Error('Render command is missing.');
  }

  if (!Array.isArray(payload.inputs)) {
    throw new Error('Render inputs are missing.');
  }

  if (typeof payload.outputName !== 'string' || !payload.outputName.trim()) {
    throw new Error('Render output name is missing.');
  }

  if (payload.backend && !health.availableBackends.includes(payload.backend)) {
    throw new Error(`${payload.backend} rendering was requested, but this machine does not currently support it.`);
  }
}

function validateLoudnessAnalysisPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Loudness analysis payload is missing.');
  }

  if (!Array.isArray(payload.command) || payload.command.length === 0 || payload.command.length > 512) {
    throw new Error('Loudness analysis command is missing or exceeds the 512-argument safety limit.');
  }

  if (!Array.isArray(payload.inputs) || payload.inputs.length === 0 || payload.inputs.length > 64) {
    throw new Error('Loudness analysis requires between one and 64 input(s).');
  }

  if (!payload.command.every((entry) => typeof entry === 'string' && entry.length <= 8_192)) {
    throw new Error('Loudness analysis command contains an invalid argument.');
  }

  const finalFormat = payload.command.findIndex((entry, index) => entry === '-f' && payload.command[index + 1] === 'null');
  if (finalFormat === -1 || payload.command.at(-1) !== '-' || !payload.command.some((entry) => entry.includes('loudnorm='))) {
    throw new Error('Loudness analysis must be a loudnorm first pass that writes only to the null sink.');
  }

  if (payload.backend === 'amd-vaapi' && !health.availableBackends.includes('amd-vaapi')) {
    throw new Error('AMD VAAPI rendering was requested, but this machine does not currently support it.');
  }
}

async function readJson(request) {
  const chunks = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    totalBytes += chunk.length;

    if (totalBytes > 1024 * 1024 * 1024) {
      throw new Error('Render request body exceeded the 1GB safety limit.');
    }

    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');

  if (!rawBody.trim()) {
    throw new Error('Render request body is empty.');
  }

  return JSON.parse(rawBody);
}

function sanitizeFileName(value) {
  const safeName = path.basename(value).replace(/[^a-zA-Z0-9._-]/g, '_');

  if (!safeName) {
    throw new Error(`Invalid render input or output name: ${value}`);
  }

  return safeName;
}

function setCorsHeaders(response) {
  response.setHeader('Access-Control-Allow-Origin', '*');
  // X-Sloom-Meta-Length: the frame-server /render-stream endpoint's metadata-preamble length
  // (see local-renderer-lib.mjs). X-Signal-Loom-Render-Token: the existing /render endpoint's
  // optional auth header (renderViaLocalNativeFFmpeg in localNativeRender.ts) — allowlisted here
  // too since it was missing before and would hit this same preflight failure the moment a render
  // token is configured.
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Sloom-Meta-Length, X-Signal-Loom-Render-Token');
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
}

function runProcess(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code });
        return;
      }

      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}
