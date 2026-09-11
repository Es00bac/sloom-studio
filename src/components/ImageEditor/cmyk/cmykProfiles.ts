import { findBundledProfile, type IccProfileRef } from '../../../lib/paperIccProfiles';
import { resolveBundledAssetUrl } from '../../../lib/bundledAssetUrl';
import { validateImageCmykProfile, type ImageCmykProfileInfo } from '../../../lib/iccTransforms';

export interface BundledImageCmykProfile {
  source: { kind: 'bundled'; id: string };
  id: string;
  label: string;
  url: string;
  outputConditionId: string;
}

/** Persisted by the later `.slimg` asset route; never substitute an imported profile with a bundled one. */
export interface ImportedImageCmykProfile {
  source: { kind: 'imported'; assetId: string; sha256: string };
  label: string;
  outputConditionId?: string;
}

export type ImageCmykProfileIdentity = BundledImageCmykProfile | ImportedImageCmykProfile;
export type ImageCmykProfileLoader = (url: string) => Promise<Uint8Array>;

function isSafeAssetId(value: string): boolean {
  return value.trim().length > 0 && value.length <= 512;
}

function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function bundledIdentity(profile: IccProfileRef): BundledImageCmykProfile {
  if (!profile.url || !profile.outputConditionId) throw new Error('The selected bundled CMYK profile lacks distributable source metadata.');
  return {
    source: { kind: 'bundled', id: profile.id },
    id: profile.id,
    label: profile.displayName,
    url: profile.url,
    outputConditionId: profile.outputConditionId,
  };
}

/** Returns one stable identity for a redistribution-cleared bundled CMYK profile. */
export function resolveBundledImageCmykProfile(profileId: string): BundledImageCmykProfile {
  const profile = findBundledProfile(profileId);
  if (!profile || profile.source !== 'bundled') throw new Error('Choose a shipped CMYK output profile.');
  return bundledIdentity(profile);
}

/** Loads and validates a bundled profile before it can enter an Image-side transform. */
export async function loadBundledImageCmykProfile(
  profileId: string,
  load: ImageCmykProfileLoader = async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`The bundled CMYK profile could not be loaded (HTTP ${response.status}).`);
    return new Uint8Array(await response.arrayBuffer());
  },
): Promise<{ identity: BundledImageCmykProfile; bytes: Uint8Array; profile: ImageCmykProfileInfo }> {
  const identity = resolveBundledImageCmykProfile(profileId);
  const bytes = await load(resolveBundledAssetUrl(identity.url));
  const profile = await validateImageCmykProfile(bytes);
  return { identity, bytes, profile };
}

/** Creates imported-profile metadata only after the caller has already stored the exact bytes as an asset. */
export function createImportedImageCmykProfile(input: {
  assetId: string;
  sha256: string;
  label: string;
  outputConditionId?: string;
}): ImportedImageCmykProfile {
  const label = input.label.trim();
  const outputConditionId = input.outputConditionId?.trim();
  if (!isSafeAssetId(input.assetId) || !isSha256(input.sha256) || !label || label.length > 256) {
    throw new Error('Imported Image CMYK profile metadata is invalid.');
  }
  if (outputConditionId !== undefined && outputConditionId.length > 256) throw new Error('The CMYK output condition is too long.');
  return {
    source: { kind: 'imported', assetId: input.assetId, sha256: input.sha256.toLowerCase() },
    label,
    ...(outputConditionId ? { outputConditionId } : {}),
  };
}
