import type {
  SlimgV2AssetRecord,
  SlimgV2Manifest,
} from '../../lib/slimgV2';

export interface ImageSlimgRuntimeState {
  sourceVersion: 1 | 2;
  manifest: SlimgV2Manifest;
  assets: Map<string, Uint8Array>;
  migrationWarnings: string[];
  migrationBackup?: {
    record: SlimgV2AssetRecord;
    bytes: Uint8Array;
  };
}

const MAX_OPEN_DOCUMENT_STATES = 32;
const states = new Map<string, ImageSlimgRuntimeState>();

function cloneBytes(bytes: Uint8Array): Uint8Array {
  return new Uint8Array(bytes);
}

function cloneState(state: ImageSlimgRuntimeState): ImageSlimgRuntimeState {
  return {
    sourceVersion: state.sourceVersion,
    manifest: structuredClone(state.manifest),
    assets: new Map(
      [...state.assets].map(([id, bytes]) => [id, cloneBytes(bytes)]),
    ),
    migrationWarnings: [...state.migrationWarnings],
    ...(state.migrationBackup
      ? {
          migrationBackup: {
            record: structuredClone(state.migrationBackup.record),
            bytes: cloneBytes(state.migrationBackup.bytes),
          },
        }
      : {}),
  };
}

/**
 * Opaque `.slimg` records cannot live in the serializable Image store. Keep
 * them beside the open document so unsupported ICC/font/timelapse/physical
 * assets survive an open-edit-save cycle without becoming a second authority.
 */
export function setImageSlimgRuntimeState(
  documentId: string,
  state: ImageSlimgRuntimeState,
): void {
  states.delete(documentId);
  states.set(documentId, cloneState(state));
  while (states.size > MAX_OPEN_DOCUMENT_STATES) {
    const oldest = states.keys().next().value;
    if (typeof oldest !== 'string') break;
    states.delete(oldest);
  }
}

export function getImageSlimgRuntimeState(
  documentId: string,
): ImageSlimgRuntimeState | undefined {
  const state = states.get(documentId);
  return state ? cloneState(state) : undefined;
}

export function clearImageSlimgRuntimeState(documentId: string): void {
  states.delete(documentId);
}

/** Test-only lifecycle reset; production callers clear by exact document id. */
export function clearAllImageSlimgRuntimeStatesForTests(): void {
  states.clear();
}
