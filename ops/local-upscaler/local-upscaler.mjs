#!/usr/bin/env node
/**
 * Signal Loom local AI upscaler — the runtime behind the "Local AI upscaler"
 * option. A zero-dependency HTTP wrapper around realesrgan-ncnn-vulkan (device
 * auto-selected by ncnn), speaking the protocol src/lib/localCpuUpscaler.ts expects:
 *
 *   GET  /v1/capabilities → { ok, service, device, models }
 *   POST /v1/upscale      → { image: dataUrl, targetWidthPx, targetHeightPx,
 *                             model?, outputFormat?, quality? }
 *                         ← { dataUrl, mimeType, modelUsed, width, height }
 *
 * Usually spawned by the Electron main process (which installs the binary and
 * passes BIN/MODELS/PORT/TOKEN), but runs standalone too:
 *
 *   node ops/local-upscaler/local-upscaler.mjs \
 *     --bin /path/to/realesrgan-ncnn-vulkan --models /path/to/models --port 41797
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import runtimeContract from './runtime-contract.cjs';

const {
  buildManagedLocalUpscalerCapabilities,
  classifyLocalUpscalerProcessFailure,
} = runtimeContract;

const args = parseArgs(process.argv.slice(2), process.env);

const MODELS = {
  'realesrgan-4x': { file: 'realesrgan-x4plus', scale: 4 },
  'realesrgan-4x-anime': { file: 'realesrgan-x4plus-anime', scale: 4 },
};
const DEFAULT_MODEL = 'realesrgan-4x';
const MAX_PASSES = 2;
const MAX_BODY_BYTES = 256 * 1024 * 1024;

if (!args.bin || !existsSync(args.bin)) {
  console.error(`local-upscaler: binary not found at "${args.bin ?? ''}" — pass --bin or BIN env.`);
  process.exit(2);
}

const server = createServer((request, response) => {
  void handle(request, response).catch((error) => {
    const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
    sendJson(response, statusCode, {
      error: error instanceof Error ? error.message : String(error),
      ...(typeof error?.code === 'string' ? { code: error.code } : {}),
    });
  });
});

server.listen(args.port, args.host, () => {
  console.log(`local-upscaler: listening on http://${args.host}:${args.port} (bin=${args.bin})`);
});

async function handle(request, response) {
  if (args.token) {
    const header = request.headers.authorization ?? '';
    const bearer = header.replace(/^Bearer\s+/i, '').trim();
    if (bearer !== args.token) {
      sendJson(response, 401, { error: 'Unauthorized.' });
      return;
    }
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/v1/capabilities') {
    sendJson(response, 200, buildManagedLocalUpscalerCapabilities(
      Number.isFinite(args.gpu) && args.gpu >= 0 ? `gpu-${args.gpu}` : 'auto',
      Object.keys(MODELS),
    ));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/v1/upscale') {
    const body = await readJsonBody(request);
    const result = await upscale(body);
    sendJson(response, 200, result);
    return;
  }

  sendJson(response, request.method === 'POST' ? 501 : 404, { error: `Unsupported route: ${request.method} ${url.pathname}` });
}

async function upscale(body) {
  const dataUrl = typeof body.image === 'string' ? body.image : '';
  const match = dataUrl.match(/^data:(image\/[a-z0-9.+-]+);base64,(.+)$/i);
  if (!match) {
    throw new Error('POST /v1/upscale expects { image: "data:image/...;base64,..." }.');
  }
  const model = MODELS[typeof body.model === 'string' && body.model in MODELS ? body.model : DEFAULT_MODEL];
  const modelName = typeof body.model === 'string' && body.model in MODELS ? body.model : DEFAULT_MODEL;
  const targetW = positiveInt(body.targetWidthPx);
  const targetH = positiveInt(body.targetHeightPx);

  const workDir = await mkdtemp(join(tmpdir(), 'sl-upscale-'));
  try {
    let current = join(workDir, 'pass-0.png');
    await writeFile(current, Buffer.from(match[2], 'base64'));
    let dims = pngDimensions(await readFile(current));

    for (let pass = 1; pass <= MAX_PASSES; pass += 1) {
      const output = join(workDir, `pass-${pass}.png`);
      await runBinary(current, output, model.file);
      current = output;
      dims = pngDimensions(await readFile(current));
      const reachedTarget = !targetW || !targetH || (dims.width >= targetW && dims.height >= targetH);
      if (reachedTarget) break;
    }

    const bytes = await readFile(current);
    return {
      dataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
      mimeType: 'image/png',
      modelUsed: modelName,
      width: dims.width,
      height: dims.height,
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

function runBinary(inputPath, outputPath, modelFile) {
  return new Promise((resolve, reject) => {
    const child = spawn(args.bin, [
      '-i', inputPath,
      '-o', outputPath,
      '-n', modelFile,
      '-s', '4',
      // Default: let ncnn pick the device ("auto" = GPU when Vulkan works). The
      // 20220424 upstream build REJECTS -g -1, so CPU-only isn't available here;
      // an explicit GPU index can still be forced via --gpu / GPU env.
      ...(Number.isFinite(args.gpu) && args.gpu >= 0 ? ['-g', String(args.gpu)] : []),
      ...(args.models ? ['-m', args.models] : []),
    ], { stdio: ['ignore', 'ignore', 'pipe'] });

    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0 && existsSync(outputPath)) {
        resolve();
        return;
      }
      const failure = classifyLocalUpscalerProcessFailure(code, stderr);
      const error = new Error(failure.message);
      error.code = failure.code;
      error.statusCode = failure.statusCode;
      reject(error);
    });
  });
}

/** PNG IHDR: width/height are big-endian u32 at byte offsets 16 and 20. */
export function pngDimensions(bytes) {
  if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50) {
    throw new Error('Upscaler output is not a PNG.');
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Request body is not valid JSON.'));
      }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
  });
  response.end(body);
}

function positiveInt(value) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function parseArgs(argv, env) {
  const options = {
    port: Number(env.PORT) > 0 ? Number(env.PORT) : 41797,
    host: env.HOST || '127.0.0.1',
    token: (env.TOKEN || '').trim(),
    bin: (env.BIN || '').trim(),
    models: (env.MODELS || '').trim(),
    gpu: Number.isFinite(Number(env.GPU)) && env.GPU !== '' ? Number(env.GPU) : Number.NaN,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--port') options.port = Number(argv[++index]);
    else if (arg === '--host') options.host = argv[++index];
    else if (arg === '--token') options.token = argv[++index];
    else if (arg === '--bin') options.bin = argv[++index];
    else if (arg === '--models') options.models = argv[++index];
    else if (arg === '--gpu') options.gpu = Number(argv[++index]);
  }
  return options;
}
