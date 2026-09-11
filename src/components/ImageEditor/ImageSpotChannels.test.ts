import { describe, expect, it } from 'vitest';
import {
  buildImageSpotChannelManifest,
  buildImageSpotChannelEntry,
  buildImageSpotChannelExportReadinessDescriptor,
  buildImageSpotChannelGrayscalePlate,
  buildImageSpotChannelPanelDescriptor,
  buildImageSpotChannelPlanningDescriptor,
  buildImageSpotChannelReadinessDescriptor,
  buildImageSpotChannelWorkflowDescriptors,
  buildSpotChannelExportWarnings,
  decodeImageSpotChannelMask,
  describeSpotChannelPreviewMetadata,
  renderSpotChannelPreview,
  updateImageSpotChannelMetadata,
} from './ImageSpotChannels';

describe('ImageSpotChannels', () => {
  it('creates a serializable spot channel entry from an alpha mask', () => {
    const entry = buildImageSpotChannelEntry(
      {
        width: 2,
        height: 1,
        data: new Uint8ClampedArray([
          255, 255, 255, 0,
          255, 255, 255, 128,
        ]),
        kind: 'rgba',
      },
      [{ id: 'existing', name: 'Spot 1', width: 2, height: 1, color: { r: 0, g: 0, b: 0 }, opacity: 1, solidity: 1, visible: true, dataBase64: 'AA==', createdAt: 1 }],
      {
        name: '  Spot 1  ',
        color: { r: 12.4, g: 260, b: -8 },
        opacity: 1.4,
        solidity: -0.1,
        now: 42,
        id: 'spot-custom',
      },
    );

    expect(entry).toMatchObject({
      id: 'spot-custom',
      name: 'Spot 2',
      width: 2,
      height: 1,
      color: { r: 12, g: 255, b: 0 },
      opacity: 1,
      solidity: 0,
      visible: true,
      createdAt: 42,
    });
    expect(Array.from(decodeImageSpotChannelMask(entry)!.data)).toEqual([0, 128]);
  });

  it('renders a spot channel tint over an optional base preview buffer', () => {
    const preview = renderSpotChannelPreview(
      {
        width: 2,
        height: 1,
        data: new Uint8ClampedArray([255, 128]),
      },
      {
        color: { r: 20, g: 120, b: 220 },
        opacity: 1,
        solidity: 0.5,
        baseRgba: new Uint8ClampedArray([
          100, 100, 100, 255,
          200, 200, 200, 255,
        ]),
      },
    );

    expect(Array.from(preview.data)).toEqual([
      60, 110, 160, 255,
      155, 180, 205, 255,
    ]);
  });

  it('materializes a deterministic local grayscale coverage plate from retained spot metadata', () => {
    const channel = buildImageSpotChannelEntry(
      { width: 3, height: 1, data: new Uint8ClampedArray([255, 128, 0]) },
      [],
      {
        id: 'spot-varnish',
        name: 'Varnish / Gloss',
        opacity: 0.8,
        solidity: 0.5,
        now: 10,
      },
    );

    const plate = buildImageSpotChannelGrayscalePlate(channel);

    expect(plate).toMatchObject({
      kind: 'spot-grayscale-plate',
      channelId: 'spot-varnish',
      channelName: 'Varnish / Gloss',
      width: 3,
      height: 1,
      effectiveOpacity: 0.4,
      mimeType: 'image/x-portable-graymap',
      filename: 'varnish-gloss-coverage.pgm',
      signature: 'spot-grayscale-plate:v1:spot-varnish:3x1:0.4:visible:14',
    });
    expect(Array.from(plate?.inkCoverage ?? [])).toEqual([102, 51, 0]);
    expect(Array.from(plate?.grayscale ?? [])).toEqual([153, 204, 255]);
    expect(new TextDecoder().decode(plate?.data.slice(0, 11))).toBe('P5\n3 1\n255\n');
    expect(Array.from(plate?.data.slice(11) ?? [])).toEqual([153, 204, 255]);
    expect(plate?.limitations).toEqual([
      'This local grayscale plate is a mask-coverage proof, not a native spot plate or a CMYK process separation.',
      'Use an external prepress tool for press-ready spot-color output.',
    ]);

    const hidden = buildImageSpotChannelGrayscalePlate({ ...channel, visible: false });
    expect(Array.from(hidden?.inkCoverage ?? [])).toEqual([0, 0, 0]);
    expect(Array.from(hidden?.grayscale ?? [])).toEqual([255, 255, 255]);
    expect(buildImageSpotChannelGrayscalePlate({ ...channel, dataBase64: 'invalid' })).toBeNull();
  });

  it('updates channel metadata by id without mutating other entries or mask payloads', () => {
    const channels = [
      buildImageSpotChannelEntry(
        { width: 1, height: 1, data: new Uint8ClampedArray([255]) },
        [],
        { id: 'spot-a', name: 'Spot A', now: 10 },
      ),
      buildImageSpotChannelEntry(
        { width: 1, height: 1, data: new Uint8ClampedArray([128]) },
        [],
        { id: 'spot-b', name: 'Spot B', now: 20 },
      ),
    ];

    const updated = updateImageSpotChannelMetadata(channels, 'spot-b', {
      name: '  Varnish  ',
      color: { r: 300, g: 24, b: 100.8 },
      opacity: -1,
      solidity: 2,
      visible: false,
      now: 30,
    });

    expect(updated[0]).toBe(channels[0]);
    expect(updated[1]).not.toBe(channels[1]);
    expect(updated[1]).toMatchObject({
      id: 'spot-b',
      name: 'Varnish',
      color: { r: 255, g: 24, b: 101 },
      opacity: 0,
      solidity: 1,
      visible: false,
      updatedAt: 30,
    });
    expect(decodeImageSpotChannelMask(updated[1])?.data[0]).toBe(128);
  });

  it('builds deterministic spot-channel manifest descriptors with tint preview metadata', () => {
    const channel = {
      ...buildImageSpotChannelEntry(
        { width: 2, height: 2, data: new Uint8ClampedArray([255, 128, 0, 64]) },
        [],
        {
          id: 'spot-varnish',
          name: 'Varnish',
          color: { r: 12, g: 200, b: 55 },
          opacity: 0.8,
          solidity: 0.5,
          now: 100,
        },
      ),
      updatedAt: 120,
    };

    expect(describeSpotChannelPreviewMetadata(channel)).toEqual({
      previewKind: 'rgb-tint-preview',
      tintColor: { r: 12, g: 200, b: 55 },
      tintCssColor: 'rgb(12, 200, 55)',
      opacity: 0.8,
      solidity: 0.5,
      effectiveOpacity: 0.4,
      visible: true,
      warnings: ['Spot channel preview is an RGB tint overlay; it is not a native ink separation.'],
    });

    expect(buildImageSpotChannelManifest([channel])).toEqual([
      {
        id: 'spot-varnish',
        kind: 'spot',
        name: 'Varnish',
        index: 0,
        width: 2,
        height: 2,
        pixelCount: 4,
        byteLength: 4,
        createdAt: 100,
        updatedAt: 120,
        visible: true,
        preview: {
          previewKind: 'rgb-tint-preview',
          tintColor: { r: 12, g: 200, b: 55 },
          tintCssColor: 'rgb(12, 200, 55)',
          opacity: 0.8,
          solidity: 0.5,
          effectiveOpacity: 0.4,
          visible: true,
          warnings: ['Spot channel preview is an RGB tint overlay; it is not a native ink separation.'],
        },
        exportWarnings: [
          '1 spot channel is preserved only as Sloom Studio metadata; native spot plates and press-ready separations are not exported.',
          'Use an external prepress tool for final spot-color separations before print handoff.',
        ],
      },
    ]);
  });

  it('reports export warnings when spot channels target non-native print separations', () => {
    const channels = [
      buildImageSpotChannelEntry(
        { width: 1, height: 1, data: new Uint8ClampedArray([255]) },
        [],
        { id: 'spot-a', name: 'Spot A', now: 10 },
      ),
      buildImageSpotChannelEntry(
        { width: 1, height: 1, data: new Uint8ClampedArray([128]) },
        [],
        { id: 'spot-b', name: 'Spot B', now: 20 },
      ),
    ];

    expect(buildSpotChannelExportWarnings([], { targetFormat: 'tiff' })).toEqual([]);
    expect(buildSpotChannelExportWarnings(channels, { targetFormat: 'tiff' })).toEqual([
      '2 spot channels are preserved only as Sloom Studio metadata; TIFF export cannot emit native spot plates or press-ready separations.',
      'Use an external prepress tool for final spot-color separations before print handoff.',
    ]);
  });

  it('builds spot-channel workflow descriptors with tint, export, and unsupported paint/separation states', () => {
    const channels = [
      {
        ...buildImageSpotChannelEntry(
          { width: 3, height: 1, data: new Uint8ClampedArray([255, 128, 0]) },
          [],
          {
            id: 'spot-varnish',
            name: 'Varnish',
            color: { r: 20, g: 120, b: 220 },
            opacity: 0.75,
            solidity: 0.5,
            visible: false,
            now: 100,
          },
        ),
        updatedAt: 140,
      },
    ];

    expect(buildImageSpotChannelWorkflowDescriptors(channels, { targetFormat: 'psd' })).toEqual([
      {
        id: 'spot-varnish',
        kind: 'spot-workflow',
        name: 'Varnish',
        index: 0,
        dimensions: '3x1',
        pixelCount: 3,
        byteLength: 3,
        createdAt: 100,
        updatedAt: 140,
        tint: {
          color: { r: 20, g: 120, b: 220 },
          cssColor: 'rgb(20, 120, 220)',
          opacity: 0.75,
          solidity: 0.5,
          effectiveOpacity: 0.375,
          visible: false,
        },
        preview: {
          previewKind: 'rgb-tint-preview',
          signature: 'spot-preview:spot-varnish:3x1:20,120,220:0.75:0.5:hidden',
          warning: 'Spot channel preview is an RGB tint overlay; it is not a native ink separation.',
        },
        directPaint: {
          supported: false,
          enabled: false,
          reason: 'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
        },
        printSeparation: {
          supported: false,
          warning: 'Sloom Studio does not emit native spot plates or press-ready separations.',
        },
        exportWarnings: [
          '1 spot channel is preserved only as Sloom Studio metadata; PSD export cannot emit native spot plates or press-ready separations.',
          'Use an external prepress tool for final spot-color separations before print handoff.',
        ],
        warnings: [],
      },
    ]);
  });

  it('builds deterministic spot-channel planning descriptors for parity integration', () => {
    const channels = [
      buildImageSpotChannelEntry(
        { width: 2, height: 2, data: new Uint8ClampedArray([255, 0, 128, 64]) },
        [],
        {
          id: 'spot-varnish',
          name: 'Varnish',
          color: { r: 20, g: 120, b: 220 },
          opacity: 0.75,
          solidity: 0.5,
          visible: true,
          now: 100,
        },
      ),
    ];

    expect(buildImageSpotChannelPlanningDescriptor(channels, { targetFormat: 'tiff' })).toEqual({
      kind: 'spot-channel-planning',
      channelCount: 1,
      readinessSignature: 'spot-channels:tiff:spot-varnish:2x2:20,120,220:0.75:0.5:visible',
      directPaint: {
        supported: false,
        enabled: false,
        status: 'unsupported',
        signature: 'spot-edit:1:unsupported',
        reason: 'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
      },
      channels: [
        {
          id: 'spot-varnish',
          name: 'Varnish',
          dimensions: '2x2',
          previewSignature: 'spot-preview:spot-varnish:2x2:20,120,220:0.75:0.5:visible',
          ready: true,
          byteLength: 4,
        },
      ],
      printSeparation: {
        supported: false,
        status: 'metadata-only',
        warning: 'Sloom Studio does not emit native spot plates or press-ready separations.',
      },
      exportWarnings: [
        '1 spot channel is preserved only as Sloom Studio metadata; TIFF export cannot emit native spot plates or press-ready separations.',
        'Use an external prepress tool for final spot-color separations before print handoff.',
      ],
    });
  });

  it('builds a spot-channel panel descriptor with paint and press-ready caveats', () => {
    const channels = [
      buildImageSpotChannelEntry(
        { width: 2, height: 2, data: new Uint8ClampedArray([255, 0, 128, 64]) },
        [],
        {
          id: 'spot-varnish',
          name: 'Varnish',
          color: { r: 20, g: 120, b: 220 },
          opacity: 0.75,
          solidity: 0.5,
          visible: true,
          now: 100,
        },
      ),
    ];

    expect(buildImageSpotChannelPanelDescriptor(channels, {
      selectedChannelId: 'spot-varnish',
      targetFormat: 'psd',
    })).toEqual({
      kind: 'spot-channel-panel',
      channelCount: 1,
      selectedChannelId: 'spot-varnish',
      selectedChannelName: 'Varnish',
      selectedDimensions: '2x2',
      directPaint: {
        supported: false,
        enabled: false,
        status: 'unsupported',
        signature: 'spot-edit:1:unsupported',
        reason: 'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
      },
      printSeparation: {
        supported: false,
        status: 'metadata-only',
        warning: 'Sloom Studio does not emit native spot plates or press-ready separations.',
      },
      warnings: [
        'Spot channel preview is an RGB tint overlay; it is not a native ink separation.',
        '1 spot channel is preserved only as Sloom Studio metadata; PSD export cannot emit native spot plates or press-ready separations.',
        'Use an external prepress tool for final spot-color separations before print handoff.',
      ],
      summaryLines: [
        'Spot channel preview is an RGB tint overlay; it is not a native ink separation.',
        'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
        'Sloom Studio does not emit native spot plates or press-ready separations.',
      ],
      signature: 'spot-channel-panel:v1:psd:spot-varnish:2x2:warning-count=3',
    });
  });

  it('builds spot-channel readiness descriptors with metadata, preview, export, and direct-paint states', () => {
    const channel = buildImageSpotChannelEntry(
      { width: 2, height: 2, data: new Uint8ClampedArray([255, 128, 0, 64]) },
      [],
      {
        id: 'spot-varnish',
        name: 'Varnish',
        color: { r: 20, g: 120, b: 220 },
        opacity: 0.75,
        solidity: 0.5,
        visible: true,
        now: 100,
      },
    );
    const invalid = {
      ...channel,
      id: 'spot-broken',
      name: 'Broken',
      dataBase64: 'not valid',
      createdAt: 120,
    };

    expect(buildImageSpotChannelReadinessDescriptor([channel, invalid], { targetFormat: 'jpeg' })).toEqual({
      kind: 'spot-channel-readiness',
      channelCount: 2,
      targetFormat: 'jpeg',
      readinessSignature: 'spot-readiness:jpeg:spot-varnish:2x2:20,120,220:0.75:0.5:visible:ready+spot-broken:2x2:20,120,220:0.75:0.5:visible:blocked',
      metadata: {
        ready: false,
        signature: 'spot-metadata:spot-varnish:4:20,120,220:0.75:0.5:visible+spot-broken:0:20,120,220:0.75:0.5:visible',
        channels: [
          {
            id: 'spot-varnish',
            name: 'Varnish',
            index: 0,
            dimensions: '2x2',
            byteLength: 4,
            tint: {
              color: { r: 20, g: 120, b: 220 },
              cssColor: 'rgb(20, 120, 220)',
              opacity: 0.75,
              solidity: 0.5,
              effectiveOpacity: 0.375,
              visible: true,
            },
            previewSignature: 'spot-preview:spot-varnish:2x2:20,120,220:0.75:0.5:visible',
            metadataSignature: 'spot-varnish:4:20,120,220:0.75:0.5:visible',
          },
          {
            id: 'spot-broken',
            name: 'Broken',
            index: 1,
            dimensions: '2x2',
            byteLength: 0,
            tint: {
              color: { r: 20, g: 120, b: 220 },
              cssColor: 'rgb(20, 120, 220)',
              opacity: 0.75,
              solidity: 0.5,
              effectiveOpacity: 0.375,
              visible: true,
            },
            previewSignature: 'spot-preview:spot-broken:2x2:20,120,220:0.75:0.5:visible',
            metadataSignature: 'spot-broken:0:20,120,220:0.75:0.5:visible',
          },
        ],
      },
      preview: {
        ready: false,
        previewKind: 'rgb-tint-preview',
        previewSignatures: [
          'spot-preview:spot-varnish:2x2:20,120,220:0.75:0.5:visible',
          'spot-preview:spot-broken:2x2:20,120,220:0.75:0.5:visible',
        ],
        invalidChannelIds: ['spot-broken'],
        warning: 'Spot channel preview is an RGB tint overlay; it is not a native ink separation.',
        signature: 'spot-preview-readiness:spot-varnish:ready+spot-broken:blocked',
      },
      export: {
        ready: false,
        warnings: [
          '2 spot channels are preserved only as Sloom Studio metadata; JPEG export cannot emit native spot plates or press-ready separations.',
          'Use an external prepress tool for final spot-color separations before print handoff.',
        ],
        signature: 'spot-export:jpeg:2:metadata-only:blocked',
      },
      directPaint: {
        supported: false,
        enabled: false,
        status: 'unsupported',
        signature: 'spot-edit:2:unsupported',
        reason: 'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
      },
      printSeparation: {
        supported: false,
        status: 'metadata-only',
        warning: 'Sloom Studio does not emit native spot plates or press-ready separations.',
      },
      blockers: [
        {
          code: 'spot-channel-mask-invalid',
          severity: 'blocker',
          channelId: 'spot-broken',
          message: 'Spot channel "Broken" mask data is invalid and cannot be previewed or exported as metadata.',
        },
      ],
      warnings: [
        {
          code: 'spot-channel-preview-rgb-only',
          severity: 'warning',
          message: 'Spot channel preview is an RGB tint overlay; it is not a native ink separation.',
        },
        {
          code: 'spot-channel-export-metadata-only',
          severity: 'warning',
          message: '2 spot channels are preserved only as Sloom Studio metadata; JPEG export cannot emit native spot plates or press-ready separations.',
        },
        {
          code: 'spot-channel-export-prepress-required',
          severity: 'warning',
          message: 'Use an external prepress tool for final spot-color separations before print handoff.',
        },
        {
          code: 'spot-channel-direct-paint-unsupported',
          severity: 'warning',
          message: 'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
        },
        {
          code: 'spot-channel-print-separation-unsupported',
          severity: 'warning',
          message: 'Sloom Studio does not emit native spot plates or press-ready separations.',
        },
      ],
    });
  });

  it('adds document-size mismatch blockers to spot export readiness checks', () => {
    const channel = buildImageSpotChannelEntry(
      { width: 3, height: 2, data: new Uint8ClampedArray([255, 128, 0, 64, 32, 16]) },
      [],
      {
        id: 'spot-varnish',
        name: 'Varnish',
        color: { r: 20, g: 120, b: 220 },
        opacity: 0.75,
        solidity: 0.5,
        visible: true,
        now: 100,
      },
    );

    expect(buildImageSpotChannelReadinessDescriptor([channel], {
      targetFormat: 'psd',
      documentWidth: 4,
      documentHeight: 4,
    })).toMatchObject({
      documentCompatibility: {
        targetDimensions: '4x4',
        ready: false,
        signature: 'spot-document-compatibility:v1:4x4:spot-varnish:3x2:blocked',
        channels: [
          {
            id: 'spot-varnish',
            name: 'Varnish',
            dimensions: '3x2',
            ready: false,
            blockerCodes: ['spot-channel-size-mismatch'],
            signature: 'spot-channel-size:spot-varnish:3x2->4x4:blocked',
          },
        ],
      },
      blockers: [
        {
          code: 'spot-channel-size-mismatch',
          severity: 'blocker',
          channelId: 'spot-varnish',
          message: 'Spot channel "Varnish" is 3x2 but the active document is 4x4.',
        },
      ],
      export: {
        ready: false,
        signature: 'spot-export:psd:1:metadata-only:blocked',
      },
    });
  });

  it('builds typed spot export readiness with preview, blocker, and print-separation limitations', () => {
    const channel = buildImageSpotChannelEntry(
      { width: 3, height: 2, data: new Uint8ClampedArray([255, 128, 0, 64, 32, 16]) },
      [],
      {
        id: 'spot-varnish',
        name: 'Varnish',
        color: { r: 20, g: 120, b: 220 },
        opacity: 0.75,
        solidity: 0.5,
        visible: true,
        now: 100,
      },
    );

    expect(buildImageSpotChannelExportReadinessDescriptor([channel], {
      targetFormat: 'tiff',
      documentWidth: 4,
      documentHeight: 4,
    })).toEqual({
      kind: 'spot-export-readiness',
      targetFormat: 'tiff',
      channelCount: 1,
      metadataStatus: 'metadata-only',
      preview: {
        previewKind: 'rgb-tint-preview',
        ready: true,
        rgbOnly: true,
        signatures: ['spot-preview:spot-varnish:3x2:20,120,220:0.75:0.5:visible'],
        signature: 'spot-export-preview:v1:spot-preview:spot-varnish:3x2:20,120,220:0.75:0.5:visible',
      },
      blockers: [
        {
          code: 'spot-channel-size-mismatch',
          channelId: 'spot-varnish',
          severity: 'blocker',
          signature: 'spot-export-blocker:spot-channel-size-mismatch:spot-varnish',
          message: 'Spot channel "Varnish" is 3x2 but the active document is 4x4.',
        },
      ],
      warnings: [
        {
          code: 'spot-channel-preview-rgb-only',
          severity: 'warning',
          signature: 'spot-export-warning:spot-channel-preview-rgb-only:none',
          message: 'Spot channel preview is an RGB tint overlay; it is not a native ink separation.',
        },
        {
          code: 'spot-channel-export-metadata-only',
          severity: 'warning',
          signature: 'spot-export-warning:spot-channel-export-metadata-only:none',
          message: '1 spot channel is preserved only as Sloom Studio metadata; TIFF export cannot emit native spot plates or press-ready separations.',
        },
        {
          code: 'spot-channel-export-prepress-required',
          severity: 'warning',
          signature: 'spot-export-warning:spot-channel-export-prepress-required:none',
          message: 'Use an external prepress tool for final spot-color separations before print handoff.',
        },
        {
          code: 'spot-channel-direct-paint-unsupported',
          severity: 'warning',
          signature: 'spot-export-warning:spot-channel-direct-paint-unsupported:none',
          message: 'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
        },
        {
          code: 'spot-channel-print-separation-unsupported',
          severity: 'warning',
          signature: 'spot-export-warning:spot-channel-print-separation-unsupported:none',
          message: 'Sloom Studio does not emit native spot plates or press-ready separations.',
        },
      ],
      limitations: {
        directSpotPainting: false,
        realSpotPlates: false,
        photoshopSeparations: false,
        cmykSpotPressReadyExport: false,
        status: 'metadata-only',
        externalPrepressRequired: true,
        signature: 'spot-export-limitations:v1:tiff:metadata-only:no-direct-paint:no-real-plates:no-photoshop-separations:no-cmyk-spot-press-ready',
      },
      exportSignature: 'spot-export:tiff:1:metadata-only:blocked',
      signature: 'spot-export-readiness:v1:tiff:1:metadata-only:blocked:spot-export-preview:v1:spot-preview:spot-varnish:3x2:20,120,220:0.75:0.5:visible',
    });
  });
});
