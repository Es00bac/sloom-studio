import { describe, expect, it } from 'vitest';
import {
  isHaneProviderBinId,
  isHaneProviderSourceItem,
  parseHaneLinkProviderCapabilities,
  supportsHaneStrokePreview,
} from './haneLinkProviderContract';

const contract = {
  format: 'sloom-link-provider',
  version: 1,
  product: 'Hane',
  authentication: 'pin-bearer',
  mount: {
    mode: 'additive-provider',
    preserveDesktopProjectAuthority: true,
    preserveDesktopSaveAuthority: true,
    disconnectEffect: 'remove-provider-only',
  },
  channels: {
    sourceLibrary: {
      access: 'read-only',
      mount: 'named-provider-bins',
      autoMount: true,
    },
    image: {
      access: 'read-only',
      activation: 'explicit-follow',
      autoOpen: false,
    },
  },
};

const linkedEdit = {
  access: 'desktop-target-handoff',
  activation: 'explicit-paper-frame',
  canvasAuthority: 'hane-phone',
  desktopProjectAuthority: true,
  desktopSaveAuthority: true,
};

const contractV2 = {
  ...contract,
  version: 2,
  channels: {
    ...contract.channels,
    linkedEdit: {
      ...linkedEdit,
    },
    strokePreview: {
      access: 'ephemeral-overlay',
      operations: [
        'stroke-preview-begin',
        'stroke-preview-append',
        'stroke-preview-commit',
        'stroke-preview-cancel',
      ],
      maximumFps: 30,
      backpressure: 'drop-intermediate-append',
      durableAuthority: 'accepted-raster-epoch',
      reconnect: 'discard-overlay-request-latest-snapshot',
      targetOwnership: 'exclusive-confirmed-lease',
    },
  },
  mutations: {
    sourceLibrary: {
      allowed: false,
      rejectionCode: 'hane-library-is-phone-authoritative',
    },
    image: {
      allowed: false,
      rejectionCode: 'hane-live-image-is-phone-authoritative',
    },
    imageAssets: {
      allowed: false,
      rejectionCode: 'hane-live-image-is-phone-authoritative',
    },
  },
};

describe('Hane Link provider contract', () => {
  it('accepts the exact deployed v1 Source Library/Image contract', () => {
    expect(parseHaneLinkProviderCapabilities(contract)).toBe(contract);
    expect(supportsHaneStrokePreview(parseHaneLinkProviderCapabilities(contract))).toBe(false);
    expect(parseHaneLinkProviderCapabilities({
      ...contract,
      mount: { ...contract.mount, mode: 'replace-project' },
    })).toBeNull();
    expect(parseHaneLinkProviderCapabilities({
      ...contract,
      channels: {
        ...contract.channels,
        linkedEdit,
      },
    })).toBeNull();
  });

  it('strictly negotiates v2 linked edit and preview while retaining v1 compatibility', () => {
    const parsed = parseHaneLinkProviderCapabilities(contractV2);
    expect(parsed).toBe(contractV2);
    expect(supportsHaneStrokePreview(parsed)).toBe(true);
    expect(parseHaneLinkProviderCapabilities({
      ...contractV2,
      channels: {
        sourceLibrary: contractV2.channels.sourceLibrary,
        image: contractV2.channels.image,
        strokePreview: contractV2.channels.strokePreview,
      },
    })).toBeNull();
    expect(parseHaneLinkProviderCapabilities({
      ...contractV2,
      channels: {
        ...contractV2.channels,
        linkedEdit: {
          ...contractV2.channels.linkedEdit,
          desktopSaveAuthority: false,
        },
      },
    })).toBeNull();
    expect(parseHaneLinkProviderCapabilities({
      ...contractV2,
      channels: {
        ...contractV2.channels,
        strokePreview: {
          ...contractV2.channels.strokePreview,
          durableAuthority: 'transient-overlay',
        },
      },
    })).toBeNull();
    expect(parseHaneLinkProviderCapabilities({
      ...contractV2,
      mutations: {
        ...contractV2.mutations,
        image: {
          allowed: true,
          rejectionCode: 'hane-live-image-is-phone-authoritative',
        },
      },
    })).toBeNull();
  });

  it('rejects unsupported provider versions instead of guessing their authority', () => {
    expect(parseHaneLinkProviderCapabilities({
      ...contractV2,
      version: 3,
    })).toBeNull();
  });

  it('recognizes provider-owned bins and items without matching local assets', () => {
    expect(isHaneProviderBinId('hane:library:art')).toBe(true);
    expect(isHaneProviderBinId('local-bin')).toBe(false);
    expect(isHaneProviderSourceItem({ sourceKey: 'hane:library:item' })).toBe(true);
    expect(isHaneProviderSourceItem({ id: 'local-item' })).toBe(false);
  });
});
