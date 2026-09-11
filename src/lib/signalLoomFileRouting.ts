import { unpackContainer } from '../shared/files/SignalLoomContainer';

export type OpenedFileKind = 'project' | 'image' | 'paper' | 'unknown';

/**
 * Classify a file chosen from an "Open" picker by its real content, not just its name.
 *
 * Sloom Studio sub-documents (`.slimg` / `.slppr`) are ZIP containers — their first bytes are the
 * ZIP magic `PK` (0x50 0x4B). A `.sloom` project, by contrast, is plain-text JSON. OS file pickers
 * — especially on Android — routinely ignore the `accept` filter, so a user can pick a `.slimg` in
 * the project-open dialog. Without this routing the project opener does `JSON.parse` on the ZIP and
 * throws `Unexpected token 'P', "PK"... is not valid JSON`. Classifying by content lets the opener
 * send each file to the right place (project / image / paper).
 */
export function classifyOpenedFile(bytes: Uint8Array, fileName = ''): OpenedFileKind {
  const lower = fileName.toLowerCase();
  const isZipContainer = bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b; // "PK"

  if (!isZipContainer) {
    // Plain JSON `.sloom` project (or some non-container the project opener will report on).
    return 'project';
  }

  try {
    const { manifest } = unpackContainer(bytes);
    const format = (manifest.format || '').toLowerCase();
    const kind = (manifest.kind || '').toLowerCase();
    if (kind === 'image' || format.includes('image')) return 'image';
    if (kind === 'paper' || format.includes('paper')) return 'paper';
  } catch {
    // Corrupt/unsupported container — fall back to the file extension below.
  }

  if (lower.endsWith('.slimg')) return 'image';
  if (lower.endsWith('.slppr')) return 'paper';
  return 'unknown';
}
