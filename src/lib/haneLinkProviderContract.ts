export const HANE_LINK_PROVIDER_FORMAT = 'sloom-link-provider';
export const HANE_LINK_PROVIDER_MIN_VERSION = 1 as const;
export const HANE_LINK_PROVIDER_VERSION = 2 as const;

export interface HaneLinkProviderCapabilitiesV1 {
  format: typeof HANE_LINK_PROVIDER_FORMAT;
  version: typeof HANE_LINK_PROVIDER_MIN_VERSION;
  product: 'Hane';
  authentication: 'pin-bearer';
  mount: {
    mode: 'additive-provider';
    preserveDesktopProjectAuthority: true;
    preserveDesktopSaveAuthority: true;
    disconnectEffect: 'remove-provider-only';
  };
  channels: {
    sourceLibrary: {
      access: 'read-only';
      mount: 'named-provider-bins';
      autoMount: true;
    };
    image: {
      access: 'read-only';
      activation: 'explicit-follow';
      autoOpen: false;
    };
  };
}

export interface HaneLinkProviderCapabilitiesV2
  extends Omit<HaneLinkProviderCapabilitiesV1, 'version' | 'channels'> {
  version: typeof HANE_LINK_PROVIDER_VERSION;
  channels: HaneLinkProviderCapabilitiesV1['channels'] & {
    linkedEdit: {
      access: 'desktop-target-handoff';
      activation: 'explicit-paper-frame';
      canvasAuthority: 'hane-phone';
      desktopProjectAuthority: true;
      desktopSaveAuthority: true;
    };
    strokePreview: {
      access: 'ephemeral-overlay';
      operations: readonly [
        'stroke-preview-begin',
        'stroke-preview-append',
        'stroke-preview-commit',
        'stroke-preview-cancel',
      ];
      maximumFps: 30;
      backpressure: 'drop-intermediate-append';
      durableAuthority: 'accepted-raster-epoch';
      reconnect: 'discard-overlay-request-latest-snapshot';
      targetOwnership: 'exclusive-confirmed-lease';
    };
  };
  mutations: {
    sourceLibrary: {
      allowed: false;
      rejectionCode: 'hane-library-is-phone-authoritative';
    };
    image: {
      allowed: false;
      rejectionCode: 'hane-live-image-is-phone-authoritative';
    };
    imageAssets: {
      allowed: false;
      rejectionCode: 'hane-live-image-is-phone-authoritative';
    };
  };
}

export type HaneLinkProviderCapabilities =
  | HaneLinkProviderCapabilitiesV1
  | HaneLinkProviderCapabilitiesV2;

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index]);
}

/**
 * Accept only the authority-preserving Hane mount. A malformed or older
 * contract is not guessed into provider mode because doing so could replace
 * the desktop's open Paper project.
 */
export function parseHaneLinkProviderCapabilities(
  value: unknown,
): HaneLinkProviderCapabilities | null {
  const source = record(value);
  const mount = record(source?.mount);
  const channels = record(source?.channels);
  const sourceLibrary = record(channels?.sourceLibrary);
  const image = record(channels?.image);
  if (
    source?.format !== HANE_LINK_PROVIDER_FORMAT
    || (
      source.version !== HANE_LINK_PROVIDER_MIN_VERSION
      && source.version !== HANE_LINK_PROVIDER_VERSION
    )
    || source.product !== 'Hane'
    || source.authentication !== 'pin-bearer'
    || mount?.mode !== 'additive-provider'
    || mount.preserveDesktopProjectAuthority !== true
    || mount.preserveDesktopSaveAuthority !== true
    || mount.disconnectEffect !== 'remove-provider-only'
    || sourceLibrary?.access !== 'read-only'
    || sourceLibrary.mount !== 'named-provider-bins'
    || sourceLibrary.autoMount !== true
    || image?.access !== 'read-only'
    || image.activation !== 'explicit-follow'
    || image.autoOpen !== false
  ) {
    return null;
  }
  if (source.version === HANE_LINK_PROVIDER_MIN_VERSION) {
    if (!channels || !hasExactKeys(channels, ['sourceLibrary', 'image'])) {
      return null;
    }
    return value as HaneLinkProviderCapabilitiesV1;
  }
  if (
    !channels
    || !hasExactKeys(channels, ['sourceLibrary', 'image', 'linkedEdit', 'strokePreview'])
  ) {
    return null;
  }
  const linkedEdit = record(channels.linkedEdit);
  const strokePreview = record(channels?.strokePreview);
  const operations = Array.isArray(strokePreview?.operations)
    ? strokePreview.operations
    : [];
  const mutations = record(source.mutations);
  const sourceLibraryMutation = record(mutations?.sourceLibrary);
  const imageMutation = record(mutations?.image);
  const imageAssetsMutation = record(mutations?.imageAssets);
  if (
    linkedEdit?.access !== 'desktop-target-handoff'
    || linkedEdit.activation !== 'explicit-paper-frame'
    || linkedEdit.canvasAuthority !== 'hane-phone'
    || linkedEdit.desktopProjectAuthority !== true
    || linkedEdit.desktopSaveAuthority !== true
    || strokePreview?.access !== 'ephemeral-overlay'
    || JSON.stringify(operations) !== JSON.stringify([
      'stroke-preview-begin',
      'stroke-preview-append',
      'stroke-preview-commit',
      'stroke-preview-cancel',
    ])
    || strokePreview.maximumFps !== 30
    || strokePreview.backpressure !== 'drop-intermediate-append'
    || strokePreview.durableAuthority !== 'accepted-raster-epoch'
    || strokePreview.reconnect !== 'discard-overlay-request-latest-snapshot'
    || strokePreview.targetOwnership !== 'exclusive-confirmed-lease'
    || sourceLibraryMutation?.allowed !== false
    || sourceLibraryMutation.rejectionCode !== 'hane-library-is-phone-authoritative'
    || imageMutation?.allowed !== false
    || imageMutation.rejectionCode !== 'hane-live-image-is-phone-authoritative'
    || imageAssetsMutation?.allowed !== false
    || imageAssetsMutation.rejectionCode !== 'hane-live-image-is-phone-authoritative'
  ) {
    return null;
  }
  return value as HaneLinkProviderCapabilitiesV2;
}

export function supportsHaneStrokePreview(
  capabilities: HaneLinkProviderCapabilities | null,
): capabilities is HaneLinkProviderCapabilitiesV2 {
  return capabilities?.version === HANE_LINK_PROVIDER_VERSION;
}

export function isHaneProviderBinId(id: string): boolean {
  return id.startsWith('hane:');
}

export function isHaneProviderSourceItem(value: {
  id?: string;
  sourceKey?: string;
  originWorkspaceId?: string;
}): boolean {
  return Boolean(
    value.id?.startsWith('hane:')
    || value.sourceKey?.startsWith('hane:')
    || value.originWorkspaceId?.startsWith('hane:'),
  );
}
