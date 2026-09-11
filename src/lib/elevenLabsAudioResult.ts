import { raceWithAbort, throwIfAborted } from './abortSignals';
import { NonRetryableError } from './exponentialBackoff';

export interface ElevenLabsAudioResult {
  blob: Blob;
  mimeType: string;
  extension?: string;
  outputMetadata: Record<string, unknown>;
}

const SIGNED_PCM_16_LE_SAMPLE_RATES = new Set([
  8_000,
  16_000,
  22_050,
  24_000,
  44_100,
  48_000,
]);

/**
 * ElevenLabs' `pcm_<rate>` output formats are headerless mono signed 16-bit
 * little-endian samples. A browser cannot treat those bytes as `audio/wav` until
 * they have a RIFF/WAVE container. Keep that conversion at the response boundary
 * so every TTS, sound, music, and voice-change route publishes the same truthful
 * bytes and metadata.
 */
export async function materializeElevenLabsAudioResult(
  response: Response,
  providerOutputFormat: string,
  signal?: AbortSignal,
): Promise<ElevenLabsAudioResult> {
  throwIfAborted(signal);
  const providerBlob = await raceWithAbort(response.blob(), signal);
  const arrayBuffer = await raceWithAbort(providerBlob.arrayBuffer(), signal);
  throwIfAborted(signal);

  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.byteLength === 0) {
    throw new NonRetryableError('ElevenLabs completed the request but returned an empty audio payload.');
  }

  const pcm = parseSignedPcm16LeFormat(providerOutputFormat);
  if (pcm) {
    if (bytes.byteLength % 2 !== 0) {
      throw new NonRetryableError(
        `ElevenLabs returned a truncated ${providerOutputFormat} payload (${bytes.byteLength} bytes cannot contain complete 16-bit samples).`,
      );
    }

    const blob = wrapSignedPcm16LeAsWave(bytes, pcm.sampleRateHz);
    return {
      blob,
      mimeType: 'audio/wav',
      extension: 'wav',
      outputMetadata: {
        providerOutputFormat,
        container: 'wav',
        codec: 'pcm_s16le',
        sampleRateHz: pcm.sampleRateHz,
        channels: 1,
        bitsPerSample: 16,
        endianness: 'little',
      },
    };
  }

  const mp3 = /^mp3_(\d+)_(\d+)$/.exec(providerOutputFormat);
  if (mp3) {
    const sampleRateHz = Number(mp3[1]);
    const bitRateKbps = Number(mp3[2]);
    return {
      blob: withMimeType(providerBlob, bytes, 'audio/mpeg'),
      mimeType: 'audio/mpeg',
      extension: 'mp3',
      outputMetadata: {
        providerOutputFormat,
        container: 'mp3',
        codec: 'mp3',
        sampleRateHz,
        bitRateKbps,
      },
    };
  }

  // For formats not understood by this build, the response Content-Type is the
  // only honest media identity. Preserve both it and the provider bytes rather
  // than guessing that an unknown payload is MP3 or WAV.
  const mimeType = normalizeMimeType(providerBlob.type || response.headers.get('content-type'));
  return {
    blob: withMimeType(providerBlob, bytes, mimeType),
    mimeType,
    extension: extensionForMimeType(mimeType),
    outputMetadata: {
      providerOutputFormat,
      container: 'provider',
      codec: 'unknown',
    },
  };
}

function parseSignedPcm16LeFormat(providerOutputFormat: string): { sampleRateHz: number } | undefined {
  const match = /^pcm_(\d+)$/.exec(providerOutputFormat);
  if (!match) return undefined;

  const sampleRateHz = Number(match[1]);
  return SIGNED_PCM_16_LE_SAMPLE_RATES.has(sampleRateHz) ? { sampleRateHz } : undefined;
}

function wrapSignedPcm16LeAsWave(bytes: Uint8Array, sampleRateHz: number): Blob {
  if (bytes.byteLength > 0xffff_ffff - 36) {
    throw new NonRetryableError('ElevenLabs PCM output is too large for a standard RIFF/WAVE container.');
  }

  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const channels = 1;
  const bitsPerSample = 16;
  const blockAlign = channels * (bitsPerSample / 8);
  const byteRate = sampleRateHz * blockAlign;

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + bytes.byteLength, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRateHz, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, bytes.byteLength, true);

  return new Blob([header, Uint8Array.from(bytes).buffer], { type: 'audio/wav' });
}

function withMimeType(original: Blob, bytes: Uint8Array, mimeType: string): Blob {
  return original.type === mimeType
    ? original
    : new Blob([Uint8Array.from(bytes).buffer], { type: mimeType });
}

function normalizeMimeType(value: string | null): string {
  const [mimeType = ''] = (value ?? '').split(';', 1);
  return mimeType.trim().toLowerCase() || 'application/octet-stream';
}

function extensionForMimeType(mimeType: string): string | undefined {
  switch (mimeType) {
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'audio/wav':
    case 'audio/wave':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/flac':
    case 'audio/x-flac':
      return 'flac';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/webm':
      return 'webm';
    case 'audio/aac':
      return 'aac';
    case 'audio/mp4':
      return 'm4a';
    default:
      return undefined;
  }
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}
