import type { ImageDocument } from '../types/imageEditor';
import type { ManagedBundledFontFaceReference } from '../types/managedFont';
import {
  type EnsureBundledFontFacesOptions,
  type ManagedBundledFontDependency,
  normalizeBundledFontFaceIssue,
  normalizeBundledFontFaceReference,
  upgradeLegacyBundledFontFaceIssue,
} from './bundledFontLibrary';

function collect(managedFace: unknown, managedFaceIssue: unknown): ManagedBundledFontDependency[] {
  const reference = normalizeBundledFontFaceReference(managedFace);
  if (reference) return [{ reference }];
  const issue = normalizeBundledFontFaceIssue(managedFaceIssue);
  return issue ? [{ issue }] : [];
}

export function managedBundledFontDependenciesForState(
  managedFace: unknown,
  managedFaceIssue?: unknown,
): ManagedBundledFontDependency[] {
  return collect(managedFace, managedFaceIssue);
}

export function collectImageBundledFontDependencies(
  documents: readonly Pick<ImageDocument, 'layers' | 'snapshots'>[],
): ManagedBundledFontDependency[] {
  return documents.flatMap((document) => [
    ...document.layers.flatMap((layer) => collect(layer.text?.managedFace, layer.text?.managedFaceIssue)),
    ...(document.snapshots ?? []).flatMap((snapshot) => snapshot.layers.flatMap((layer) => (
      collect(layer.text?.managedFace, layer.text?.managedFaceIssue)
    ))),
  ]);
}

export function collectImageBundledFontFaceReferences(
  documents: readonly Pick<ImageDocument, 'layers' | 'snapshots'>[],
): ManagedBundledFontFaceReference[] {
  return collectImageBundledFontDependencies(documents).flatMap((dependency) => dependency.reference ?? []);
}

export function collectVideoBundledFontDependencies({
  assets = [],
  visualClips = [],
  stageObjects = [],
}: {
  assets?: readonly { textDefaults?: { managedFace?: unknown; managedFaceIssue?: unknown } }[];
  visualClips?: readonly { textTypography?: { managedFace?: unknown; managedFaceIssue?: unknown } }[];
  stageObjects?: readonly { kind?: string; managedFace?: unknown; managedFaceIssue?: unknown }[];
}): ManagedBundledFontDependency[] {
  return [
    ...assets.flatMap((asset) => collect(asset.textDefaults?.managedFace, asset.textDefaults?.managedFaceIssue)),
    ...visualClips.flatMap((clip) => collect(clip.textTypography?.managedFace, clip.textTypography?.managedFaceIssue)),
    ...stageObjects.flatMap((object) => object.kind === 'text'
      ? collect(object.managedFace, object.managedFaceIssue)
      : []),
  ];
}

export function collectVideoBundledFontFaceReferences(input: Parameters<typeof collectVideoBundledFontDependencies>[0]): ManagedBundledFontFaceReference[] {
  return collectVideoBundledFontDependencies(input).flatMap((dependency) => dependency.reference ?? []);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Promotes v1 face references only after catalog identity and bytes have been verified. Invalid
 * states and legacy references that cannot be proven remain serializable blockers in the project.
 */
export async function upgradeLegacyBundledFontIssuesInProject(
  value: unknown,
  options: EnsureBundledFontFacesOptions = {},
): Promise<void> {
  const seen = new WeakSet<object>();

  const visit = async (current: unknown): Promise<void> => {
    if (!current || typeof current !== 'object' || seen.has(current)) return;
    seen.add(current);
    if (Array.isArray(current)) {
      await Promise.all(current.map(visit));
      return;
    }
    const record = current as Record<string, unknown>;
    const fontIssue = normalizeBundledFontFaceIssue(record.managedFaceIssue);
    if (fontIssue?.reason === 'legacy-reference') {
      const upgraded = await upgradeLegacyBundledFontFaceIssue(fontIssue, options).catch(() => undefined);
      if (upgraded) {
        record.managedFace = upgraded;
        delete record.managedFaceIssue;
      }
    }
    await Promise.all(Object.values(record).filter((entry) => isRecord(entry) || Array.isArray(entry)).map(visit));
  };

  await visit(value);
}
