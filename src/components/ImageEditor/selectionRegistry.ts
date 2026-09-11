import type { SelectionMask } from './SelectionMask';

/**
 * Module-level registry mapping document id → selection mask. Selection masks
 * carry typed arrays that are not appropriate to put inside zustand state
 * (large, mutated frequently, never serialized for persistence). The
 * imageEditorStore tracks `hasSelection` + `selectionVersion` so React
 * subscribers know when to re-render; the actual pixel buffer lives here.
 */
const registry = new Map<string, SelectionMask>();

/**
 * When the Move tool drags a selection's pixels, the pixels are lifted onto a new "floating" layer
 * (Photoshop-style) rather than composited back into the source layer — see moveTool. This records,
 * per document, which layer currently holds that floated selection so a subsequent drag moves the
 * SAME layer instead of cutting a fresh hole (the old behaviour deleted whatever was beneath the
 * previous drop). Cleared when the selection is dropped (deselect) or replaced by a new selection.
 */
const floatingSelections = new Map<string, { layerId: string }>();

export function getSelection(docId: string | null | undefined): SelectionMask | undefined {
  if (!docId) return undefined;
  return registry.get(docId);
}

export function setSelection(docId: string, mask: SelectionMask): void {
  registry.set(docId, mask);
}

export function clearSelection(docId: string): void {
  registry.delete(docId);
  floatingSelections.delete(docId);
}

export function getFloatingSelection(docId: string | null | undefined): { layerId: string } | null {
  if (!docId) return null;
  return floatingSelections.get(docId) ?? null;
}

export function setFloatingSelection(docId: string, value: { layerId: string }): void {
  floatingSelections.set(docId, value);
}

export function clearFloatingSelection(docId: string): void {
  floatingSelections.delete(docId);
}

export function hasSelectionFor(docId: string | null | undefined): boolean {
  if (!docId) return false;
  return registry.has(docId);
}

export function clearAllSelections(): void {
  registry.clear();
  floatingSelections.clear();
}
