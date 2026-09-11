import { describe, expect, it } from 'vitest';
import { createMask, setRect } from './SelectionMask';
import {
  applySavedSelectionChannel,
  buildAlphaChannelPanelDescriptor,
  buildSavedSelectionChannelManifest,
  buildSavedSelectionChannel,
  buildAlphaChannelLoadActionSummary,
  buildImageChannelPlanningDescriptor,
  buildImageChannelSignatureDescriptor,
  buildImageChannelExportReadinessDescriptor,
  buildImageChannelReadinessDescriptor,
  buildImageChannelWorkflowPlan,
  buildRgbChannelTargetSummaries,
  buildSelectionToAlphaChannelActionSummary,
  buildSelectionChannelRoundTripDescriptor,
  getActiveImageColorChannel,
  getImageChannelEditTarget,
  planSavedSelectionChannelToSelection,
  planSelectionToSavedSelectionChannel,
  savedSelectionChannelToMask,
} from './ImageSelectionChannels';
import * as selectionChannels from './ImageSelectionChannels';
import { buildImageSpotChannelEntry } from './ImageSpotChannels';

describe('ImageSelectionChannels', () => {
  it('defaults documents without saved RGB channel state to the composite edit target', () => {
    expect(getActiveImageColorChannel({})).toBe('rgb');
    expect(getImageChannelEditTarget({})).toEqual({
      kind: 'colorChannel',
      channel: 'rgb',
      components: ['red', 'green', 'blue'],
    });
  });

  it('maps isolated RGB channels to single-component edit targets', () => {
    expect(getImageChannelEditTarget({ activeColorChannel: 'red' })).toEqual({
      kind: 'colorChannel',
      channel: 'red',
      components: ['red'],
    });
    expect(getImageChannelEditTarget({ activeColorChannel: 'green' })).toEqual({
      kind: 'colorChannel',
      channel: 'green',
      components: ['green'],
    });
    expect(getImageChannelEditTarget({ activeColorChannel: 'blue' })).toEqual({
      kind: 'colorChannel',
      channel: 'blue',
      components: ['blue'],
    });
  });

  it('round-trips a saved alpha channel through its serialized payload', () => {
    const mask = createMask(4, 4);
    setRect(mask, 0, 0, 2, 2, 255, false);

    const saved = buildSavedSelectionChannel(mask, [], 'Alpha 1');
    const restored = savedSelectionChannelToMask(saved);

    expect(saved.name).toBe('Alpha 1');
    expect(restored).not.toBeNull();
    expect(Array.from(restored!.data)).toEqual(Array.from(mask.data));
  });

  it('applies saved alpha channels back into a selection with combine modes', () => {
    const base = createMask(4, 4);
    setRect(base, 0, 0, 2, 2, 255, false);

    const source = createMask(4, 4);
    setRect(source, 1, 1, 2, 2, 255, false);
    const saved = buildSavedSelectionChannel(source, [], 'Alpha 1');

    const added = applySavedSelectionChannel(saved, base, 'add');
    const intersected = applySavedSelectionChannel(saved, base, 'intersect');

    expect(Array.from(added.data)).toEqual([
      255, 255, 0, 0,
      255, 255, 255, 0,
      0, 255, 255, 0,
      0, 0, 0, 0,
    ]);
    expect(Array.from(intersected.data)).toEqual([
      0, 0, 0, 0,
      0, 255, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
  });

  it('builds deterministic alpha-channel manifest descriptors for saved selections', () => {
    const mask = createMask(3, 2);
    setRect(mask, 0, 0, 2, 1, 255, false);
    const saved = {
      ...buildSavedSelectionChannel(mask, [], 'Subject'),
      id: 'alpha-subject',
      createdAt: 100,
    };

    expect(buildSavedSelectionChannelManifest([saved])).toEqual([
      {
        id: 'alpha-subject',
        kind: 'alpha',
        source: 'saved-selection',
        name: 'Subject',
        label: 'Subject (saved selection)',
        index: 0,
        width: 3,
        height: 2,
        pixelCount: 6,
        byteLength: 6,
        createdAt: 100,
        canLoadSelection: true,
        canReplaceSelection: true,
        actions: {
          visibility: {
            supported: false,
            enabled: false,
            label: 'Preview alpha overlay',
            description: 'Saved alpha channels expose preview metadata only; independent channel visibility toggles are not implemented.',
          },
          edit: {
            supported: false,
            enabled: false,
            label: 'Direct alpha painting unavailable',
            description: 'Saved alpha channels can be renamed, deleted, or loaded as selections, but cannot be painted directly.',
          },
          loadSelection: {
            supported: true,
            enabled: true,
            label: 'Load as selection',
            description: 'Load this alpha channel into the current selection.',
          },
        },
        limitations: [
          'Direct alpha-channel painting is not implemented; save or load selections instead.',
          'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
        ],
        preview: {
          previewKind: 'alpha-mask-overlay',
          tintColor: { r: 0, g: 174, b: 239 },
          tintCssColor: 'rgb(0, 174, 239)',
          opacity: 0.45,
          visible: true,
        },
        warnings: [],
      },
    ]);
  });

  it('builds an alpha-channel panel descriptor with size-mismatch blockers and metadata-only caveats', () => {
    const mask = createMask(3, 2);
    setRect(mask, 0, 0, 2, 1, 255, false);
    const saved = {
      ...buildSavedSelectionChannel(mask, [], 'Subject'),
      id: 'alpha-subject',
      createdAt: 100,
    };

    expect(buildAlphaChannelPanelDescriptor({
      documentWidth: 4,
      documentHeight: 4,
      savedSelectionChannels: [saved],
      selectedChannelId: 'alpha-subject',
      loadMode: 'replace',
      targetFormat: 'psd',
    })).toEqual({
      kind: 'alpha-channel-panel',
      channelCount: 1,
      selectedChannelId: 'alpha-subject',
      selectedChannelName: 'Subject',
      selectedDimensions: '3x2',
      loadMode: 'replace',
      loadEnabled: false,
      directPaint: {
        supported: false,
        enabled: false,
        reason: 'Direct alpha-channel painting is not implemented; save or load selections instead.',
      },
      printSeparation: {
        supported: false,
        warning: 'Saved alpha channels are selection masks only and do not create press-ready separations.',
      },
      actionReadiness: {
        loadSelection: {
          supported: true,
          enabled: false,
          mode: 'replace',
          selectedChannelId: 'alpha-subject',
          sourceDimensions: '3x2',
          targetDimensions: '4x4',
          blockerCodes: ['alpha-channel-size-mismatch'],
          summary: 'Load "Subject" is blocked: saved alpha is 3x2 but the active document is 4x4.',
        },
        loadModes: [
          {
            mode: 'replace',
            label: 'Replace selection',
            enabled: false,
            blockerCodes: ['alpha-channel-size-mismatch'],
            previewSignature: 'alpha-load:alpha-subject:replace:3x2:2/6:0.3333',
            signature: 'alpha-load-mode:alpha-subject:replace:3x2->4x4:blocked:alpha-channel-size-mismatch',
            summary: 'Replace selection is blocked until the saved alpha channel matches the active document dimensions.',
          },
          {
            mode: 'add',
            label: 'Add to selection',
            enabled: false,
            blockerCodes: ['alpha-channel-size-mismatch'],
            previewSignature: 'alpha-load:alpha-subject:add:3x2:2/6:0.3333',
            signature: 'alpha-load-mode:alpha-subject:add:3x2->4x4:blocked:alpha-channel-size-mismatch',
            summary: 'Add to selection is blocked until the saved alpha channel matches the active document dimensions.',
          },
          {
            mode: 'subtract',
            label: 'Subtract from selection',
            enabled: false,
            blockerCodes: ['alpha-channel-size-mismatch'],
            previewSignature: 'alpha-load:alpha-subject:subtract:3x2:2/6:0.3333',
            signature: 'alpha-load-mode:alpha-subject:subtract:3x2->4x4:blocked:alpha-channel-size-mismatch',
            summary: 'Subtract from selection is blocked until the saved alpha channel matches the active document dimensions.',
          },
          {
            mode: 'intersect',
            label: 'Intersect with selection',
            enabled: false,
            blockerCodes: ['alpha-channel-size-mismatch'],
            previewSignature: 'alpha-load:alpha-subject:intersect:3x2:2/6:0.3333',
            signature: 'alpha-load-mode:alpha-subject:intersect:3x2->4x4:blocked:alpha-channel-size-mismatch',
            summary: 'Intersect with selection is blocked until the saved alpha channel matches the active document dimensions.',
          },
        ],
        directPaint: {
          supported: false,
          enabled: false,
          reason: 'Direct alpha-channel painting is not implemented; save or load selections instead.',
        },
        exportMetadata: {
          targetFormat: 'psd',
          status: 'metadata-only',
          separationSupported: false,
          warningCount: 1,
          warnings: [
            'PSD export preserves saved alpha selections only as Sloom Studio metadata; native alpha channels and print plates are not emitted.',
          ],
          summary: '1 saved alpha channel will be preserved as Sloom Studio metadata only; no native alpha plate is exported.',
        },
        signature:
          'alpha-channel-panel-actions:v1:4x4:replace:alpha-subject:blocked:alpha-channel-size-mismatch:psd:metadata-only',
      },
      blockers: [
        'Saved alpha channel "Subject" is 3x2 but the active document is 4x4.',
      ],
      warnings: [
        'PSD export preserves saved alpha selections only as Sloom Studio metadata; native alpha channels and print plates are not emitted.',
      ],
      summaryLines: [
        'Saved alpha channels expose preview metadata only; independent channel visibility toggles are not implemented.',
        'Direct alpha painting is unavailable; save or load selections instead.',
        'Load selection is blocked until the saved alpha channel matches the active document dimensions.',
        'Saved alpha channels are selection masks only and do not create press-ready separations.',
      ],
      signature:
        'alpha-channel-panel:v1:4x4:replace:alpha-subject:blocked:size-mismatch:psd',
    });
  });

  it('builds typed alpha and spot export-readiness checks with stable signatures', () => {
    const mask = createMask(2, 2);
    setRect(mask, 0, 0, 1, 2, 255, false);
    const spot = buildImageSpotChannelEntry(mask, [], {
      id: 'spot-varnish',
      name: 'Varnish',
      now: 100,
    });

    expect(buildImageChannelExportReadinessDescriptor({
      alphaChannelCount: 1,
      spotChannels: [spot],
      targetFormat: 'tiff',
    }).checks).toEqual([
      {
        code: 'alpha-export-metadata-only',
        target: 'alpha',
        severity: 'warning',
        ready: false,
        targetFormat: 'tiff',
        channelCount: 1,
        status: 'metadata-only',
        message: 'TIFF export preserves saved alpha selections only as Sloom Studio metadata; native alpha channels and print plates are not emitted.',
        signature: 'channel-export-check:alpha:tiff:1:metadata-only:warning',
      },
      {
        code: 'spot-export-metadata-only',
        target: 'spot',
        severity: 'warning',
        ready: false,
        targetFormat: 'tiff',
        channelCount: 1,
        status: 'metadata-only',
        message: '1 spot channel is preserved only as Sloom Studio metadata; TIFF export cannot emit native spot plates or press-ready separations.',
        signature: 'channel-export-check:spot:tiff:1:metadata-only:warning',
      },
      {
        code: 'spot-external-prepress-required',
        target: 'separation',
        severity: 'warning',
        ready: false,
        targetFormat: 'tiff',
        channelCount: 1,
        status: 'unsupported',
        message: 'Use an external prepress tool for final spot-color separations before print handoff.',
        signature: 'channel-export-check:separation:tiff:1:unsupported:warning',
      },
      {
        code: 'native-channel-plates-unsupported',
        target: 'separation',
        severity: 'warning',
        ready: false,
        targetFormat: 'tiff',
        channelCount: 2,
        status: 'metadata-only',
        message: 'Channels, saved alpha masks, and spot-channel metadata do not emit native print plates or press-ready separations.',
        signature: 'channel-export-check:separation:tiff:2:metadata-only:warning',
      },
    ]);
  });

  it('builds a single inspectable channel signature descriptor for manifests, operations, export, and paint blockers', () => {
    const selection = createMask(3, 2);
    setRect(selection, 0, 0, 2, 1, 255, false);
    const saved = {
      ...buildSavedSelectionChannel(selection, [], 'Subject'),
      id: 'alpha-subject',
      createdAt: 100,
    };
    const mismatched = {
      ...buildSavedSelectionChannel(createMask(2, 2), [], 'Small'),
      id: 'alpha-small',
      createdAt: 120,
    };
    const spot = buildImageSpotChannelEntry(selection, [], {
      id: 'spot-varnish',
      name: 'Varnish',
      color: { r: 20, g: 120, b: 220 },
      opacity: 0.75,
      solidity: 0.5,
      visible: true,
      now: 130,
    });

    expect(buildImageChannelSignatureDescriptor({
      width: 3,
      height: 2,
      activeColorChannel: 'red',
      currentSelection: selection,
      preferredAlphaChannelName: 'Subject',
      loadSelectionMode: 'add',
      savedSelectionChannels: [saved, mismatched],
      spotChannels: [spot],
      targetFormat: 'psd',
    })).toEqual({
      kind: 'channel-signatures',
      dimensions: '3x2',
      targetFormat: 'psd',
      channelManifest: {
        rgbSignature: 'rgb-manifest:3x2:active=red:channels=rgb+red+green+blue',
        alphaSignature: 'alpha-manifest:alpha-subject:3x2:ready+alpha-small:2x2:ready',
        spotSignature: 'spot-manifest:spot-varnish:3x2:ready',
        signature: 'channel-manifest:v1:3x2:red:alpha-subject:3x2:ready+alpha-small:2x2:ready:spot-varnish:3x2:ready',
      },
      alphaOperations: {
        saveSignature: 'alpha-save:Subject 2:3x2:2/6:0.3333',
        loadSignatures: [
          'alpha-load:alpha-subject:add:3x2:2/6:0.3333:ready',
          'alpha-load:alpha-small:add:2x2:0/4:0:blocked',
        ],
        persistenceSignature: 'alpha-persistence:2/12:alpha-subject+alpha-small:ready',
        roundTripSignature: 'alpha-roundtrip:alpha-subject:ready+alpha-small:blocked',
        signature: 'alpha-operations:v1:alpha-save:Subject 2:3x2:2/6:0.3333:alpha-load:alpha-subject:add:3x2:2/6:0.3333:ready+alpha-load:alpha-small:add:2x2:0/4:0:blocked:alpha-persistence:2/12:alpha-subject+alpha-small:ready:alpha-roundtrip:alpha-subject:ready+alpha-small:blocked',
      },
      spotPreviews: {
        previewKind: 'rgb-tint-preview',
        signatures: ['spot-preview:spot-varnish:3x2:20,120,220:0.75:0.5:visible'],
        rgbOnly: true,
        signature: 'spot-previews:v1:spot-preview:spot-varnish:3x2:20,120,220:0.75:0.5:visible',
      },
      exportReadiness: {
        signature: 'channel-export-readiness:v1:psd:alpha=2:metadata-only:spot=1:metadata-only:warnings=3',
        checkSignatures: [
          'channel-export-check:alpha:psd:2:metadata-only:warning',
          'channel-export-check:spot:psd:1:metadata-only:warning',
          'channel-export-check:separation:psd:1:unsupported:warning',
          'channel-export-check:separation:psd:3:metadata-only:warning',
        ],
        limitation: {
          realSpotPlates: false,
          photoshopSeparations: false,
          cmykSpotPressReadyExport: false,
          status: 'metadata-only',
        },
      },
      paintRoutingBlockers: {
        rgbSignature: 'rgb-edit:red:red:3x2',
        alphaSignature: 'alpha-edit:2:3x2:unsupported',
        spotSignature: 'spot-edit:1:unsupported',
        alphaDirectPaintSupported: false,
        spotDirectPaintSupported: false,
        blockerCodes: ['alpha-channel-size-mismatch'],
        signature: 'paint-routing-blockers:v1:rgb-edit:red:red:3x2:alpha-edit:2:3x2:unsupported:spot-edit:1:unsupported:alpha-channel-size-mismatch',
      },
      unsupportedStates: {
        directAlphaPainting: 'unsupported',
        directSpotPainting: 'unsupported',
        realSpotPlates: 'unsupported',
        photoshopSeparations: 'unsupported',
        cmykSpotPressReadyExport: 'unsupported',
      },
      signature: 'channel-signatures:v1|channel-manifest:v1:3x2:red:alpha-subject:3x2:ready+alpha-small:2x2:ready:spot-varnish:3x2:ready|alpha-operations:v1:alpha-save:Subject 2:3x2:2/6:0.3333:alpha-load:alpha-subject:add:3x2:2/6:0.3333:ready+alpha-load:alpha-small:add:2x2:0/4:0:blocked:alpha-persistence:2/12:alpha-subject+alpha-small:ready:alpha-roundtrip:alpha-subject:ready+alpha-small:blocked|spot-previews:v1:spot-preview:spot-varnish:3x2:20,120,220:0.75:0.5:visible|channel-export-readiness:v1:psd:alpha=2:metadata-only:spot=1:metadata-only:warnings=3|paint-routing-blockers:v1:rgb-edit:red:red:3x2:alpha-edit:2:3x2:unsupported:spot-edit:1:unsupported:alpha-channel-size-mismatch',
    });
  });

  it('describes every alpha channel-to-selection load mode with blockers and deterministic signatures', () => {
    const mask = createMask(3, 2);
    setRect(mask, 0, 0, 2, 1, 255, false);
    const saved = {
      ...buildSavedSelectionChannel(mask, [], 'Subject'),
      id: 'alpha-subject',
      createdAt: 100,
    };

    expect(buildAlphaChannelPanelDescriptor({
      documentWidth: 4,
      documentHeight: 4,
      savedSelectionChannels: [saved],
      selectedChannelId: 'alpha-subject',
      loadMode: 'subtract',
      targetFormat: 'psd',
    }).actionReadiness.loadModes).toEqual([
      {
        mode: 'replace',
        label: 'Replace selection',
        enabled: false,
        blockerCodes: ['alpha-channel-size-mismatch'],
        previewSignature: 'alpha-load:alpha-subject:replace:3x2:2/6:0.3333',
        signature: 'alpha-load-mode:alpha-subject:replace:3x2->4x4:blocked:alpha-channel-size-mismatch',
        summary: 'Replace selection is blocked until the saved alpha channel matches the active document dimensions.',
      },
      {
        mode: 'add',
        label: 'Add to selection',
        enabled: false,
        blockerCodes: ['alpha-channel-size-mismatch'],
        previewSignature: 'alpha-load:alpha-subject:add:3x2:2/6:0.3333',
        signature: 'alpha-load-mode:alpha-subject:add:3x2->4x4:blocked:alpha-channel-size-mismatch',
        summary: 'Add to selection is blocked until the saved alpha channel matches the active document dimensions.',
      },
      {
        mode: 'subtract',
        label: 'Subtract from selection',
        enabled: false,
        blockerCodes: ['alpha-channel-size-mismatch'],
        previewSignature: 'alpha-load:alpha-subject:subtract:3x2:2/6:0.3333',
        signature: 'alpha-load-mode:alpha-subject:subtract:3x2->4x4:blocked:alpha-channel-size-mismatch',
        summary: 'Subtract from selection is blocked until the saved alpha channel matches the active document dimensions.',
      },
      {
        mode: 'intersect',
        label: 'Intersect with selection',
        enabled: false,
        blockerCodes: ['alpha-channel-size-mismatch'],
        previewSignature: 'alpha-load:alpha-subject:intersect:3x2:2/6:0.3333',
        signature: 'alpha-load-mode:alpha-subject:intersect:3x2->4x4:blocked:alpha-channel-size-mismatch',
        summary: 'Intersect with selection is blocked until the saved alpha channel matches the active document dimensions.',
      },
    ]);
  });

  it('builds deterministic RGB channel row descriptors with edit, visibility, and load-selection actions', () => {
    const buildRows = (
      selectionChannels as typeof selectionChannels & {
        buildImageChannelRowDescriptors?: (doc: {
          width: number;
          height: number;
          activeColorChannel?: string;
          savedSelectionChannels?: [];
        }) => unknown;
      }
    ).buildImageChannelRowDescriptors;

    expect(buildRows?.({
      width: 5,
      height: 3,
      activeColorChannel: 'green',
      savedSelectionChannels: [],
    })).toEqual([
      {
        id: 'color-rgb',
        kind: 'rgb',
        source: 'color-channel',
        channel: 'rgb',
        label: 'RGB Composite',
        shortLabel: 'RGB',
        detail: 'Composite RGB preview and edit target',
        dimensions: '5x3',
        active: false,
        components: ['red', 'green', 'blue'],
        actions: {
          visibility: {
            supported: false,
            enabled: false,
            label: 'Composite visibility fixed',
            description: 'The RGB composite stays visible; independent channel visibility toggles are not implemented.',
          },
          edit: {
            supported: true,
            enabled: true,
            label: 'Edit RGB composite',
            description: 'Brush and eraser strokes affect red, green, and blue components.',
          },
          loadSelection: {
            supported: false,
            enabled: false,
            label: 'Load selection unavailable',
            description: 'RGB color channels cannot be loaded as saved selection masks.',
          },
        },
        warnings: [],
        limitations: [
          'Direct channel painting is limited to RGB brush and eraser routing.',
          'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
        ],
      },
      {
        id: 'color-red',
        kind: 'rgb',
        source: 'color-channel',
        channel: 'red',
        label: 'Red',
        shortLabel: 'R',
        detail: 'Red component paint target',
        dimensions: '5x3',
        active: false,
        components: ['red'],
        actions: {
          visibility: {
            supported: false,
            enabled: false,
            label: 'Component visibility fixed',
            description: 'Selecting Red changes the edit target; independent channel visibility toggles are not implemented.',
          },
          edit: {
            supported: true,
            enabled: true,
            label: 'Edit Red channel',
            description: 'Brush and eraser strokes affect only the red component.',
          },
          loadSelection: {
            supported: false,
            enabled: false,
            label: 'Load selection unavailable',
            description: 'RGB color channels cannot be loaded as saved selection masks.',
          },
        },
        warnings: [],
        limitations: [
          'Direct channel painting is limited to RGB brush and eraser routing.',
          'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
        ],
      },
      {
        id: 'color-green',
        kind: 'rgb',
        source: 'color-channel',
        channel: 'green',
        label: 'Green',
        shortLabel: 'G',
        detail: 'Green component paint target',
        dimensions: '5x3',
        active: true,
        components: ['green'],
        actions: {
          visibility: {
            supported: false,
            enabled: false,
            label: 'Component visibility fixed',
            description: 'Selecting Green changes the edit target; independent channel visibility toggles are not implemented.',
          },
          edit: {
            supported: true,
            enabled: true,
            label: 'Edit Green channel',
            description: 'Brush and eraser strokes affect only the green component.',
          },
          loadSelection: {
            supported: false,
            enabled: false,
            label: 'Load selection unavailable',
            description: 'RGB color channels cannot be loaded as saved selection masks.',
          },
        },
        warnings: [],
        limitations: [
          'Direct channel painting is limited to RGB brush and eraser routing.',
          'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
        ],
      },
      {
        id: 'color-blue',
        kind: 'rgb',
        source: 'color-channel',
        channel: 'blue',
        label: 'Blue',
        shortLabel: 'B',
        detail: 'Blue component paint target',
        dimensions: '5x3',
        active: false,
        components: ['blue'],
        actions: {
          visibility: {
            supported: false,
            enabled: false,
            label: 'Component visibility fixed',
            description: 'Selecting Blue changes the edit target; independent channel visibility toggles are not implemented.',
          },
          edit: {
            supported: true,
            enabled: true,
            label: 'Edit Blue channel',
            description: 'Brush and eraser strokes affect only the blue component.',
          },
          loadSelection: {
            supported: false,
            enabled: false,
            label: 'Load selection unavailable',
            description: 'RGB color channels cannot be loaded as saved selection masks.',
          },
        },
        warnings: [],
        limitations: [
          'Direct channel painting is limited to RGB brush and eraser routing.',
          'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
        ],
      },
    ]);
  });

  it('builds saved alpha row descriptors with load-selection availability and size warnings', () => {
    const mask = createMask(2, 2);
    setRect(mask, 0, 0, 1, 1, 255, false);
    const saved = {
      ...buildSavedSelectionChannel(mask, [], 'Subject'),
      id: 'alpha-subject',
      createdAt: 100,
    };
    const buildRows = (
      selectionChannels as typeof selectionChannels & {
        buildImageChannelRowDescriptors?: (doc: {
          width: number;
          height: number;
          activeColorChannel?: string;
          savedSelectionChannels?: typeof saved[];
        }) => unknown;
      }
    ).buildImageChannelRowDescriptors;

    expect(buildRows?.({
      width: 3,
      height: 2,
      savedSelectionChannels: [saved],
    })).toContainEqual({
      id: 'alpha-alpha-subject',
      kind: 'alpha',
      source: 'saved-selection',
      channelId: 'alpha-subject',
      label: 'Subject',
      shortLabel: 'A',
      detail: 'Saved selection alpha channel',
      dimensions: '2x2',
      active: false,
      components: [],
      actions: {
        visibility: {
          supported: false,
          enabled: false,
          label: 'Preview alpha overlay',
          description: 'Saved alpha channels expose preview metadata only; independent channel visibility toggles are not implemented.',
        },
        edit: {
          supported: false,
          enabled: false,
          label: 'Direct alpha painting unavailable',
          description: 'Saved alpha channels can be renamed, deleted, or loaded as selections, but cannot be painted directly.',
        },
        loadSelection: {
          supported: true,
          enabled: false,
          label: 'Load as selection',
          description: 'Cannot load until the alpha channel dimensions match the current document.',
        },
      },
      warnings: ['Saved alpha channel is 2x2 but the document is 3x2.'],
      limitations: [
        'Direct alpha-channel painting is not implemented; save or load selections instead.',
        'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
      ],
    });
  });

  it('summarizes clean selection-to-channel and channel-to-selection plans', () => {
    const existingMask = createMask(2, 2);
    const existing = {
      ...buildSavedSelectionChannel(existingMask, [], 'Subject'),
      id: 'alpha-existing',
      createdAt: 90,
    };

    const mask = createMask(2, 2);
    setRect(mask, 0, 0, 1, 2, 255, false);

    expect(planSelectionToSavedSelectionChannel(mask, [existing], ' Subject ')).toEqual({
      operation: 'selection-to-channel',
      canApply: true,
      channelName: 'Subject 2',
      width: 2,
      height: 2,
      pixelCount: 4,
      selectedPixelCount: 2,
      coverage: 0.5,
      summary: 'Save current selection as "Subject 2" alpha channel (2 of 4 pixels selected).',
      warnings: [],
    });

    const saved = {
      ...buildSavedSelectionChannel(mask, [], 'Subject'),
      id: 'alpha-subject',
      createdAt: 100,
    };

    expect(planSavedSelectionChannelToSelection(saved, 'add')).toEqual({
      operation: 'channel-to-selection',
      canApply: true,
      channelId: 'alpha-subject',
      channelName: 'Subject',
      mode: 'add',
      width: 2,
      height: 2,
      pixelCount: 4,
      selectedPixelCount: 2,
      coverage: 0.5,
      summary: 'Load "Subject" alpha channel into the selection using add mode (2 of 4 pixels selected).',
      warnings: [],
    });
  });

  it('builds RGB target summaries with deterministic preview signatures and direct-paint status', () => {
    expect(buildRgbChannelTargetSummaries({
      width: 8,
      height: 4,
      activeColorChannel: 'red',
    })).toEqual([
      {
        channel: 'rgb',
        label: 'RGB Composite',
        components: ['red', 'green', 'blue'],
        componentCount: 3,
        dimensions: '8x4',
        pixelCount: 32,
        active: false,
        directPaint: {
          supported: true,
          enabled: true,
          summary: 'Brush and eraser strokes affect red, green, and blue components.',
        },
        preview: {
          previewKind: 'rgb-channel-target',
          signature: 'rgb-target:rgb:8x4:red+green+blue:inactive',
          componentSignature: 'red+green+blue',
        },
        warnings: [],
        limitations: [
          'Direct channel painting is limited to RGB brush and eraser routing.',
          'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
        ],
      },
      {
        channel: 'red',
        label: 'Red',
        components: ['red'],
        componentCount: 1,
        dimensions: '8x4',
        pixelCount: 32,
        active: true,
        directPaint: {
          supported: true,
          enabled: true,
          summary: 'Brush and eraser strokes affect only the red component.',
        },
        preview: {
          previewKind: 'rgb-channel-target',
          signature: 'rgb-target:red:8x4:red:active',
          componentSignature: 'red',
        },
        warnings: [],
        limitations: [
          'Direct channel painting is limited to RGB brush and eraser routing.',
          'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
        ],
      },
      {
        channel: 'green',
        label: 'Green',
        components: ['green'],
        componentCount: 1,
        dimensions: '8x4',
        pixelCount: 32,
        active: false,
        directPaint: {
          supported: true,
          enabled: true,
          summary: 'Brush and eraser strokes affect only the green component.',
        },
        preview: {
          previewKind: 'rgb-channel-target',
          signature: 'rgb-target:green:8x4:green:inactive',
          componentSignature: 'green',
        },
        warnings: [],
        limitations: [
          'Direct channel painting is limited to RGB brush and eraser routing.',
          'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
        ],
      },
      {
        channel: 'blue',
        label: 'Blue',
        components: ['blue'],
        componentCount: 1,
        dimensions: '8x4',
        pixelCount: 32,
        active: false,
        directPaint: {
          supported: true,
          enabled: true,
          summary: 'Brush and eraser strokes affect only the blue component.',
        },
        preview: {
          previewKind: 'rgb-channel-target',
          signature: 'rgb-target:blue:8x4:blue:inactive',
          componentSignature: 'blue',
        },
        warnings: [],
        limitations: [
          'Direct channel painting is limited to RGB brush and eraser routing.',
          'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
        ],
      },
    ]);
  });

  it('describes alpha save and load actions with preview signatures and unsupported direct-paint states', () => {
    const mask = createMask(3, 2);
    setRect(mask, 0, 0, 2, 1, 255, false);
    const existing = {
      ...buildSavedSelectionChannel(mask, [], 'Subject'),
      id: 'alpha-subject',
      createdAt: 100,
    };

    expect(buildSelectionToAlphaChannelActionSummary(mask, [existing], ' Subject ')).toEqual({
      operation: 'selection-to-channel',
      canApply: true,
      channelName: 'Subject 2',
      dimensions: '3x2',
      pixelCount: 6,
      selectedPixelCount: 2,
      coverage: 0.3333,
      actionLabel: 'Save selection as alpha channel',
      actionSummary: 'Save current selection as "Subject 2" alpha channel (2 of 6 pixels selected).',
      previewSignature: 'alpha-save:Subject 2:3x2:2/6:0.3333',
      directPaint: {
        supported: false,
        enabled: false,
        reason: 'Direct alpha-channel painting is not implemented; save or load selections instead.',
      },
      printSeparation: {
        supported: false,
        warning: 'Saved alpha channels are selection masks only and do not create press-ready separations.',
      },
      warnings: [],
    });

    expect(buildAlphaChannelLoadActionSummary(existing, 'subtract')).toEqual({
      operation: 'channel-to-selection',
      canApply: true,
      channelId: 'alpha-subject',
      channelName: 'Subject',
      mode: 'subtract',
      dimensions: '3x2',
      pixelCount: 6,
      selectedPixelCount: 2,
      coverage: 0.3333,
      actionLabel: 'Load alpha channel as selection',
      actionSummary: 'Load "Subject" alpha channel into the selection using subtract mode (2 of 6 pixels selected).',
      previewSignature: 'alpha-load:alpha-subject:subtract:3x2:2/6:0.3333',
      directPaint: {
        supported: false,
        enabled: false,
        reason: 'Direct alpha-channel painting is not implemented; save or load selections instead.',
      },
      printSeparation: {
        supported: false,
        warning: 'Saved alpha channels are selection masks only and do not create press-ready separations.',
      },
      warnings: [],
    });
  });

  it('builds deterministic channel planning descriptors for parity integration', () => {
    const mask = createMask(3, 2);
    setRect(mask, 0, 0, 2, 1, 255, false);
    const saved = {
      ...buildSavedSelectionChannel(mask, [], 'Subject'),
      id: 'alpha-subject',
      createdAt: 100,
    };
    const spot = buildImageSpotChannelEntry(mask, [], {
      id: 'spot-varnish',
      name: 'Varnish',
      color: { r: 20, g: 120, b: 220 },
      opacity: 0.75,
      solidity: 0.5,
      visible: true,
      now: 110,
    });

    expect(buildImageChannelPlanningDescriptor({
      width: 3,
      height: 2,
      activeColorChannel: 'blue',
      savedSelectionChannels: [saved],
      spotChannels: [spot],
      targetFormat: 'psd',
    })).toEqual({
      kind: 'channel-planning',
      dimensions: '3x2',
      readinessSignature: 'channels:3x2:blue:alpha-subject:spot-varnish:psd',
      directEdit: {
        rgb: {
          supported: true,
          enabled: true,
          status: 'supported',
          activeChannel: 'blue',
          editableComponents: ['blue'],
          signature: 'rgb-edit:blue:blue:3x2',
          caveats: ['Direct channel painting is limited to RGB brush and eraser routing.'],
        },
        alpha: {
          supported: false,
          enabled: false,
          status: 'unsupported',
          signature: 'alpha-edit:1:3x2:unsupported',
          reason: 'Direct alpha-channel painting is not implemented; save or load selections instead.',
        },
      },
      paintRouting: {
        kind: 'channel-paint-routing',
        dimensions: '3x2',
        activeRgbChannel: 'blue',
        activeRgbComponents: ['blue'],
        activeRgbRoute: {
          supported: true,
          enabled: true,
          route: 'rgb-component',
          paintTarget: 'active-pixel-layer',
          brushTool: 'brush',
          eraserTool: 'eraser',
          brushCompositing: 'source-over',
          eraserCompositing: 'source-over-channel-route',
          preservesAlpha: true,
          preservesInactiveComponents: true,
          summary: 'Brush and eraser strokes route to the blue component and preserve red, green, and alpha.',
          evidence: [
            'brushTool applies source-over paint then restores inactive RGB components.',
            'brushTool eraser uses source-over-channel-route for single RGB components.',
          ],
        },
        unsupportedTargets: {
          alpha: {
            supported: false,
            enabled: false,
            status: 'unsupported',
            fallback: 'save-or-load-selection',
            reason: 'Direct alpha-channel painting is not implemented; save or load selections instead.',
            availableActions: ['save-selection-as-alpha', 'load-alpha-as-selection', 'rename-alpha', 'delete-alpha'],
          },
          spot: {
            supported: false,
            enabled: false,
            status: 'metadata-only',
            fallback: 'selection-to-spot-metadata',
            reason: 'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
            availableActions: ['save-selection-as-spot', 'preview-rgb-tint', 'edit-spot-metadata', 'delete-spot'],
          },
        },
        signature: 'channel-paint-routing:v1:3x2:blue:blue:rgb-component:alpha-unsupported:spot-metadata-only',
      },
      previews: [
        { id: 'color-rgb', kind: 'rgb', signature: 'rgb-target:rgb:3x2:red+green+blue:inactive', ready: true },
        { id: 'color-red', kind: 'rgb', signature: 'rgb-target:red:3x2:red:inactive', ready: true },
        { id: 'color-green', kind: 'rgb', signature: 'rgb-target:green:3x2:green:inactive', ready: true },
        { id: 'color-blue', kind: 'rgb', signature: 'rgb-target:blue:3x2:blue:active', ready: true },
        { id: 'alpha-subject', kind: 'alpha', signature: 'alpha-preview:alpha-subject:3x2:2/6:0.3333', ready: true },
        { id: 'spot-varnish', kind: 'spot', signature: 'spot-preview:spot-varnish:3x2:20,120,220:0.75:0.5:visible', ready: true },
      ],
      selectionExchange: {
        canSaveSelection: true,
        canLoadSavedSelections: true,
        caveats: [
          'Saved alpha channels are selection masks; they do not preserve editable alpha paint strokes.',
          'Loading a saved alpha channel requires dimensions that match the current document.',
        ],
      },
      spotChannels: {
        count: 1,
        canCreateFromSelection: true,
        canPreview: true,
        caveats: [
          'Spot channel preview is an RGB tint overlay; it is not a native ink separation.',
          'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
        ],
      },
      printSeparation: {
        supported: false,
        status: 'metadata-only',
        warning: 'Channels, saved alpha masks, and spot-channel metadata do not emit native print plates or press-ready separations.',
      },
      exportReadiness: {
        targetFormat: 'psd',
        alpha: {
          channelCount: 1,
          status: 'metadata-only',
          warnings: [
            'PSD export preserves saved alpha selections only as Sloom Studio metadata; native alpha channels and print plates are not emitted.',
          ],
          summary: '1 saved alpha channel will be preserved as Sloom Studio metadata only; no native alpha plate is exported.',
        },
        spot: {
          channelCount: 1,
          status: 'metadata-only',
          warnings: [
            '1 spot channel is preserved only as Sloom Studio metadata; PSD export cannot emit native spot plates or press-ready separations.',
            'Use an external prepress tool for final spot-color separations before print handoff.',
          ],
          summary: '1 spot channel will be preserved as Sloom Studio metadata only; press-ready spot plates require external prepress.',
        },
        separation: {
          supported: false,
          status: 'metadata-only',
          warning: 'Channels, saved alpha masks, and spot-channel metadata do not emit native print plates or press-ready separations.',
          externalPrepressRequired: true,
          summary: 'Native alpha/spot separations are not emitted; export carries metadata warnings only.',
        },
        checks: [
          {
            code: 'alpha-export-metadata-only',
            target: 'alpha',
            severity: 'warning',
            ready: false,
            targetFormat: 'psd',
            channelCount: 1,
            status: 'metadata-only',
            message: 'PSD export preserves saved alpha selections only as Sloom Studio metadata; native alpha channels and print plates are not emitted.',
            signature: 'channel-export-check:alpha:psd:1:metadata-only:warning',
          },
          {
            code: 'spot-export-metadata-only',
            target: 'spot',
            severity: 'warning',
            ready: false,
            targetFormat: 'psd',
            channelCount: 1,
            status: 'metadata-only',
            message: '1 spot channel is preserved only as Sloom Studio metadata; PSD export cannot emit native spot plates or press-ready separations.',
            signature: 'channel-export-check:spot:psd:1:metadata-only:warning',
          },
          {
            code: 'spot-external-prepress-required',
            target: 'separation',
            severity: 'warning',
            ready: false,
            targetFormat: 'psd',
            channelCount: 1,
            status: 'unsupported',
            message: 'Use an external prepress tool for final spot-color separations before print handoff.',
            signature: 'channel-export-check:separation:psd:1:unsupported:warning',
          },
          {
            code: 'native-channel-plates-unsupported',
            target: 'separation',
            severity: 'warning',
            ready: false,
            targetFormat: 'psd',
            channelCount: 2,
            status: 'metadata-only',
            message: 'Channels, saved alpha masks, and spot-channel metadata do not emit native print plates or press-ready separations.',
            signature: 'channel-export-check:separation:psd:2:metadata-only:warning',
          },
        ],
        signature: 'channel-export-readiness:v1:psd:alpha=1:metadata-only:spot=1:metadata-only:warnings=3',
      },
      exportWarnings: [
        'PSD export preserves saved alpha selections only as Sloom Studio metadata; native alpha channels and print plates are not emitted.',
        '1 spot channel is preserved only as Sloom Studio metadata; PSD export cannot emit native spot plates or press-ready separations.',
        'Use an external prepress tool for final spot-color separations before print handoff.',
      ],
    });
  });

  it('describes channel paint route readiness for RGB targets while blocking alpha and spot paint', () => {
    const buildPaintRouting = (
      selectionChannels as typeof selectionChannels & {
        buildImageChannelPaintRoutingDescriptor?: (doc: {
          width: number;
          height: number;
          activeColorChannel?: string;
        }) => unknown;
      }
    ).buildImageChannelPaintRoutingDescriptor;

    expect(buildPaintRouting).toBeTypeOf('function');
    expect(buildPaintRouting?.({
      width: 4,
      height: 2,
      activeColorChannel: 'green',
    })).toEqual({
      kind: 'channel-paint-routing',
      dimensions: '4x2',
      activeRgbChannel: 'green',
      activeRgbComponents: ['green'],
      activeRgbRoute: {
        supported: true,
        enabled: true,
        route: 'rgb-component',
        paintTarget: 'active-pixel-layer',
        brushTool: 'brush',
        eraserTool: 'eraser',
        brushCompositing: 'source-over',
        eraserCompositing: 'source-over-channel-route',
        preservesAlpha: true,
        preservesInactiveComponents: true,
        summary: 'Brush and eraser strokes route to the green component and preserve red, blue, and alpha.',
        evidence: [
          'brushTool applies source-over paint then restores inactive RGB components.',
          'brushTool eraser uses source-over-channel-route for single RGB components.',
        ],
      },
      unsupportedTargets: {
        alpha: {
          supported: false,
          enabled: false,
          status: 'unsupported',
          fallback: 'save-or-load-selection',
          reason: 'Direct alpha-channel painting is not implemented; save or load selections instead.',
          availableActions: ['save-selection-as-alpha', 'load-alpha-as-selection', 'rename-alpha', 'delete-alpha'],
        },
        spot: {
          supported: false,
          enabled: false,
          status: 'metadata-only',
          fallback: 'selection-to-spot-metadata',
          reason: 'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
          availableActions: ['save-selection-as-spot', 'preview-rgb-tint', 'edit-spot-metadata', 'delete-spot'],
        },
      },
      signature: 'channel-paint-routing:v1:4x2:green:green:rgb-component:alpha-unsupported:spot-metadata-only',
    });
  });

  it('builds a deterministic channel workflow plan across RGB, alpha, and spot operations', () => {
    const selection = createMask(3, 2);
    setRect(selection, 0, 0, 2, 1, 255, false);
    const saved = {
      ...buildSavedSelectionChannel(selection, [], 'Subject'),
      id: 'alpha-subject',
      createdAt: 100,
    };
    const spot = buildImageSpotChannelEntry(selection, [], {
      id: 'spot-varnish',
      name: 'Varnish',
      color: { r: 20, g: 120, b: 220 },
      opacity: 0.75,
      solidity: 0.5,
      visible: true,
      now: 110,
    });

    expect(buildImageChannelWorkflowPlan({
      width: 3,
      height: 2,
      activeColorChannel: 'red',
      currentSelection: selection,
      preferredAlphaChannelName: 'Subject',
      loadSelectionMode: 'add',
      savedSelectionChannels: [saved],
      spotChannels: [spot],
      targetFormat: 'tiff',
    })).toEqual({
      kind: 'channel-workflow-plan',
      dimensions: '3x2',
      policySignature: 'channel-workflow:v1|doc=3x2|active=red|format=tiff|selection=2/6:0.3333|alpha=alpha-subject:2/6:0.3333|spot=spot-varnish:3x2:20,120,220:0.75:0.5:visible',
      activeRgbTarget: {
        channel: 'red',
        components: ['red'],
        directPaintSupported: true,
        previewSignature: 'rgb-target:red:3x2:red:active',
        editSignature: 'rgb-edit:red:red:3x2',
        summary: 'Brush and eraser strokes affect only the red component.',
      },
      selectionToChannel: {
        ready: true,
        channelName: 'Subject 2',
        selectedPixelCount: 2,
        pixelCount: 6,
        coverage: 0.3333,
        previewSignature: 'alpha-save:Subject 2:3x2:2/6:0.3333',
        summary: 'Save current selection as "Subject 2" alpha channel (2 of 6 pixels selected).',
        warnings: [],
      },
      channelToSelection: [
        {
          channelId: 'alpha-subject',
          channelName: 'Subject',
          mode: 'add',
          ready: true,
          selectedPixelCount: 2,
          pixelCount: 6,
          coverage: 0.3333,
          previewSignature: 'alpha-load:alpha-subject:add:3x2:2/6:0.3333',
          summary: 'Load "Subject" alpha channel into the selection using add mode (2 of 6 pixels selected).',
          warnings: [],
        },
      ],
      alphaPersistence: {
        ready: true,
        channelCount: 1,
        maxChannels: 12,
        remainingSlots: 11,
        invalidChannelIds: [],
        signature: 'alpha-persistence:1/12:alpha-subject:ready',
        caveats: [
          'Saved alpha channels persist as Sloom Studio document metadata.',
          'Native alpha-channel export and direct alpha painting are not implemented.',
        ],
      },
      spotChannels: {
        count: 1,
        canPreview: true,
        previewSignatures: ['spot-preview:spot-varnish:3x2:20,120,220:0.75:0.5:visible'],
        caveats: [
          'Spot channel preview is an RGB tint overlay; it is not a native ink separation.',
          'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
          'Sloom Studio does not emit native spot plates or press-ready separations.',
        ],
        exportWarnings: [
          '1 spot channel is preserved only as Sloom Studio metadata; TIFF export cannot emit native spot plates or press-ready separations.',
          'Use an external prepress tool for final spot-color separations before print handoff.',
        ],
      },
      directPainting: {
        rgb: {
          supported: true,
          enabled: true,
          signature: 'rgb-edit:red:red:3x2',
        },
        alpha: {
          supported: false,
          enabled: false,
          signature: 'alpha-edit:1:3x2:unsupported',
          reason: 'Direct alpha-channel painting is not implemented; save or load selections instead.',
        },
        spot: {
          supported: false,
          enabled: false,
          signature: 'spot-edit:1:unsupported',
          reason: 'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
        },
      },
      previews: {
        signatures: [
          'rgb-target:rgb:3x2:red+green+blue:inactive',
          'rgb-target:red:3x2:red:active',
          'rgb-target:green:3x2:green:inactive',
          'rgb-target:blue:3x2:blue:inactive',
          'alpha-preview:alpha-subject:3x2:2/6:0.3333',
          'spot-preview:spot-varnish:3x2:20,120,220:0.75:0.5:visible',
        ],
        policySignature: 'preview-policy:3x2:red:alpha-subject:spot-varnish:tiff',
      },
      warnings: [
        'TIFF export preserves saved alpha selections only as Sloom Studio metadata; native alpha channels and print plates are not emitted.',
        '1 spot channel is preserved only as Sloom Studio metadata; TIFF export cannot emit native spot plates or press-ready separations.',
        'Use an external prepress tool for final spot-color separations before print handoff.',
      ],
    });
  });

  it('reports unavailable selection saves and invalid alpha persistence without mutating channels', () => {
    const invalid = {
      id: 'alpha-broken',
      name: 'Broken',
      width: 2,
      height: 2,
      dataBase64: 'not valid',
      createdAt: 100,
    };

    expect(buildImageChannelWorkflowPlan({
      width: 2,
      height: 2,
      activeColorChannel: 'cyan',
      savedSelectionChannels: [invalid],
    })).toMatchObject({
      policySignature: 'channel-workflow:v1|doc=2x2|active=rgb|format=source|selection=none|alpha=alpha-broken:invalid|spot=none',
      activeRgbTarget: {
        channel: 'rgb',
        components: ['red', 'green', 'blue'],
        directPaintSupported: true,
      },
      selectionToChannel: {
        ready: false,
        channelName: 'Alpha 1',
        selectedPixelCount: 0,
        pixelCount: 0,
        coverage: 0,
        previewSignature: 'alpha-save:unavailable:2x2:none',
        warnings: ['No current selection mask is available to save as an alpha channel.'],
      },
      channelToSelection: [
        {
          channelId: 'alpha-broken',
          channelName: 'Broken',
          mode: 'replace',
          ready: false,
          warnings: ['Saved alpha channel data is invalid and cannot be loaded as a selection.'],
        },
      ],
      alphaPersistence: {
        ready: false,
        channelCount: 1,
        maxChannels: 12,
        remainingSlots: 11,
        invalidChannelIds: ['alpha-broken'],
        signature: 'alpha-persistence:1/12:alpha-broken:invalid',
      },
      spotChannels: {
        count: 0,
        canPreview: true,
        previewSignatures: [],
      },
    });
  });

  it('describes selection-channel roundtrip readiness with dimension blockers and stable signatures', () => {
    const mask = createMask(2, 2);
    setRect(mask, 0, 0, 1, 2, 255, false);
    const saved = {
      ...buildSavedSelectionChannel(mask, [], 'Subject'),
      id: 'alpha-subject',
      createdAt: 100,
    };

    expect(buildSelectionChannelRoundTripDescriptor(saved, { width: 3, height: 2 })).toEqual({
      kind: 'selection-channel-roundtrip',
      channelId: 'alpha-subject',
      channelName: 'Subject',
      sourceDimensions: '2x2',
      targetDimensions: '3x2',
      pixelCount: 4,
      selectedPixelCount: 2,
      coverage: 0.5,
      canRoundTrip: false,
      signature: 'selection-channel-roundtrip:alpha-subject:2x2:3x2:2/4:0.5:blocked',
      blockers: [
        {
          code: 'alpha-channel-size-mismatch',
          severity: 'blocker',
          channelId: 'alpha-subject',
          message: 'Saved alpha channel "Subject" is 2x2 but the active document is 3x2.',
        },
      ],
      warnings: [],
    });
  });

  it('builds channel readiness descriptors with RGB routing, alpha exchange, blockers, warnings, and signatures', () => {
    const selection = createMask(3, 2);
    setRect(selection, 0, 0, 2, 1, 255, false);
    const saved = {
      ...buildSavedSelectionChannel(selection, [], 'Subject'),
      id: 'alpha-subject',
      createdAt: 100,
    };
    const invalid = {
      id: 'alpha-broken',
      name: 'Broken',
      width: 3,
      height: 2,
      dataBase64: 'not valid',
      createdAt: 110,
    };
    const spot = buildImageSpotChannelEntry(selection, [], {
      id: 'spot-varnish',
      name: 'Varnish',
      color: { r: 20, g: 120, b: 220 },
      opacity: 0.75,
      solidity: 0.5,
      visible: true,
      now: 120,
    });

    expect(buildImageChannelReadinessDescriptor({
      width: 3,
      height: 2,
      activeColorChannel: 'green',
      currentSelection: selection,
      preferredAlphaChannelName: 'Subject',
      loadSelectionMode: 'intersect',
      savedSelectionChannels: [saved, invalid],
      spotChannels: [spot],
      targetFormat: 'psd',
    })).toEqual({
      kind: 'channel-readiness',
      dimensions: '3x2',
      targetFormat: 'psd',
      readinessSignature: 'channel-readiness:v1|workflow=channel-workflow:v1|doc=3x2|active=green|format=psd|selection=2/6:0.3333|alpha=alpha-subject:2/6:0.3333+alpha-broken:invalid|spot=spot-varnish:3x2:20,120,220:0.75:0.5:visible|spot=spot-readiness:psd:spot-varnish:3x2:20,120,220:0.75:0.5:visible:ready',
      activeRgbRouting: {
        channel: 'green',
        route: 'component',
        components: ['green'],
        directPaintSupported: true,
        previewSignature: 'rgb-target:green:3x2:green:active',
        editSignature: 'rgb-edit:green:green:3x2',
        signature: 'rgb-route:green:green:3x2:rgb-edit:green:green:3x2',
        blockers: [],
        warnings: [],
      },
      alpha: {
        save: {
          ready: true,
          channelName: 'Subject 2',
          selectedPixelCount: 2,
          pixelCount: 6,
          coverage: 0.3333,
          previewSignature: 'alpha-save:Subject 2:3x2:2/6:0.3333',
          signature: 'alpha-save:Subject 2:3x2:2/6:0.3333:ready',
          blockers: [],
          warnings: [],
        },
        load: [
          {
            channelId: 'alpha-subject',
            channelName: 'Subject',
            mode: 'intersect',
            ready: true,
            selectedPixelCount: 2,
            pixelCount: 6,
            coverage: 0.3333,
            previewSignature: 'alpha-load:alpha-subject:intersect:3x2:2/6:0.3333',
            signature: 'alpha-load:alpha-subject:intersect:3x2:2/6:0.3333:ready',
            blockers: [],
            warnings: [],
          },
          {
            channelId: 'alpha-broken',
            channelName: 'Broken',
            mode: 'intersect',
            ready: false,
            selectedPixelCount: 0,
            pixelCount: 6,
            coverage: 0,
            previewSignature: 'alpha-load:alpha-broken:intersect:3x2:0/6:0',
            signature: 'alpha-load:alpha-broken:intersect:3x2:0/6:0:blocked',
            blockers: [
              {
                code: 'alpha-channel-mask-invalid',
                severity: 'blocker',
                channelId: 'alpha-broken',
                message: 'Saved alpha channel "Broken" data is invalid and cannot be loaded as a selection.',
              },
            ],
            warnings: [],
          },
        ],
        persistence: {
          ready: false,
          channelCount: 2,
          maxChannels: 12,
          remainingSlots: 10,
          invalidChannelIds: ['alpha-broken'],
          signature: 'alpha-persistence:2/12:alpha-subject+alpha-broken:invalid',
          blockers: [
            {
              code: 'alpha-channel-mask-invalid',
              severity: 'blocker',
              channelId: 'alpha-broken',
              message: 'Saved alpha channel "Broken" data is invalid and cannot round-trip as a selection channel.',
            },
          ],
          warnings: [
            {
              code: 'alpha-channel-native-export-unsupported',
              severity: 'warning',
              message: 'Native alpha-channel export and direct alpha painting are not implemented.',
            },
          ],
        },
        roundTrip: [
          {
            kind: 'selection-channel-roundtrip',
            channelId: 'alpha-subject',
            channelName: 'Subject',
            sourceDimensions: '3x2',
            targetDimensions: '3x2',
            pixelCount: 6,
            selectedPixelCount: 2,
            coverage: 0.3333,
            canRoundTrip: true,
            signature: 'selection-channel-roundtrip:alpha-subject:3x2:3x2:2/6:0.3333:ready',
            blockers: [],
            warnings: [],
          },
          {
            kind: 'selection-channel-roundtrip',
            channelId: 'alpha-broken',
            channelName: 'Broken',
            sourceDimensions: '3x2',
            targetDimensions: '3x2',
            pixelCount: 6,
            selectedPixelCount: 0,
            coverage: 0,
            canRoundTrip: false,
            signature: 'selection-channel-roundtrip:alpha-broken:3x2:3x2:0/6:0:blocked',
            blockers: [
              {
                code: 'alpha-channel-mask-invalid',
                severity: 'blocker',
                channelId: 'alpha-broken',
                message: 'Saved alpha channel "Broken" data is invalid and cannot round-trip as a selection channel.',
              },
            ],
            warnings: [],
          },
        ],
      },
      spot: {
        channelCount: 1,
        previewReady: true,
        previewSignatures: ['spot-preview:spot-varnish:3x2:20,120,220:0.75:0.5:visible'],
        readinessSignature: 'spot-readiness:psd:spot-varnish:3x2:20,120,220:0.75:0.5:visible:ready',
        exportWarnings: [
          '1 spot channel is preserved only as Sloom Studio metadata; PSD export cannot emit native spot plates or press-ready separations.',
          'Use an external prepress tool for final spot-color separations before print handoff.',
        ],
        blockers: [],
        warnings: [
          {
            code: 'spot-channel-preview-rgb-only',
            severity: 'warning',
            message: 'Spot channel preview is an RGB tint overlay; it is not a native ink separation.',
          },
          {
            code: 'spot-channel-export-metadata-only',
            severity: 'warning',
            message: '1 spot channel is preserved only as Sloom Studio metadata; PSD export cannot emit native spot plates or press-ready separations.',
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
      },
      directPainting: {
        rgb: {
          supported: true,
          enabled: true,
          signature: 'rgb-edit:green:green:3x2',
        },
        alpha: {
          supported: false,
          enabled: false,
          signature: 'alpha-edit:2:3x2:unsupported',
          reason: 'Direct alpha-channel painting is not implemented; save or load selections instead.',
        },
        spot: {
          supported: false,
          enabled: false,
          signature: 'spot-edit:1:unsupported',
          reason: 'Direct spot-channel painting is not implemented; spot masks can be stored as metadata and previewed only.',
        },
      },
      stableSignatures: {
        workflow: 'channel-workflow:v1|doc=3x2|active=green|format=psd|selection=2/6:0.3333|alpha=alpha-subject:2/6:0.3333+alpha-broken:invalid|spot=spot-varnish:3x2:20,120,220:0.75:0.5:visible',
        preview: 'preview-policy:3x2:green:alpha-subject+alpha-broken:spot-varnish:psd',
        alphaPersistence: 'alpha-persistence:2/12:alpha-subject+alpha-broken:invalid',
        spot: 'spot-readiness:psd:spot-varnish:3x2:20,120,220:0.75:0.5:visible:ready',
        directPaint: 'direct-paint:rgb-edit:green:green:3x2|alpha-edit:2:3x2:unsupported|spot-edit:1:unsupported',
      },
      blockers: [
        {
          code: 'alpha-channel-mask-invalid',
          severity: 'blocker',
          channelId: 'alpha-broken',
          message: 'Saved alpha channel "Broken" data is invalid and cannot be loaded as a selection.',
        },
        {
          code: 'alpha-channel-mask-invalid',
          severity: 'blocker',
          channelId: 'alpha-broken',
          message: 'Saved alpha channel "Broken" data is invalid and cannot round-trip as a selection channel.',
        },
      ],
      warnings: [
        {
          code: 'alpha-channel-native-export-unsupported',
          severity: 'warning',
          message: 'Native alpha-channel export and direct alpha painting are not implemented.',
        },
        {
          code: 'alpha-channel-export-metadata-only',
          severity: 'warning',
          message: 'PSD export preserves saved alpha selections only as Sloom Studio metadata; native alpha channels and print plates are not emitted.',
        },
        {
          code: 'alpha-channel-direct-paint-unsupported',
          severity: 'warning',
          message: 'Direct alpha-channel painting is not implemented; save or load selections instead.',
        },
        {
          code: 'spot-channel-preview-rgb-only',
          severity: 'warning',
          message: 'Spot channel preview is an RGB tint overlay; it is not a native ink separation.',
        },
        {
          code: 'spot-channel-export-metadata-only',
          severity: 'warning',
          message: '1 spot channel is preserved only as Sloom Studio metadata; PSD export cannot emit native spot plates or press-ready separations.',
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
});
