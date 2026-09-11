import { describe, expect, it } from 'vitest';
import type { ImageLayer } from '../../types/imageEditor';
import {
  IMAGE_LAYER_COLOR_LABELS,
  buildImageLayerOrganizationWorkflowMetadata,
  buildImageLayerOrganizationPlanningSummary,
  describeImageLayerOrganizationParityReadiness,
  describeImageLayerStackOrganizationReadiness,
  filterImageLayersForPanel,
  imageLayerColorLabelById,
} from './ImageLayerOrganization';
import { getImageLayerWorkflowBadges } from './ImageLayerWorkflowMetadata';

function layer(patch: Partial<ImageLayer>): ImageLayer {
  return {
    id: patch.id ?? 'layer',
    name: patch.name ?? 'Layer',
    type: patch.type ?? 'image',
    visible: patch.visible ?? true,
    locked: patch.locked ?? false,
    opacity: patch.opacity ?? 1,
    blendMode: patch.blendMode ?? 'normal',
    x: patch.x ?? 0,
    y: patch.y ?? 0,
    bitmap: patch.bitmap ?? null,
    bitmapVersion: patch.bitmapVersion ?? 0,
    mask: patch.mask ?? null,
    ...patch,
  };
}

describe('ImageLayerOrganization', () => {
  const layers = [
    layer({ id: 'base', name: 'Background plate', type: 'image', colorLabel: 'blue' }),
    layer({ id: 'ink', name: 'Character ink', type: 'image', locked: true, colorLabel: 'red' }),
    layer({ id: 'title', name: 'Title type', type: 'text', visible: false, colorLabel: 'violet' }),
    layer({
      id: 'linked',
      name: 'Generated source panel',
      type: 'image',
      metadata: { smartLinkedSourceId: 'source-1', sourceLabel: 'Prompt result' },
      colorLabel: 'green',
    }),
    layer({ id: 'levels', name: 'Levels correction', type: 'adjustment' }),
  ];

  it('filters display-order layers by search text, type, visibility, lock state, source links, and color labels', () => {
    expect(filterImageLayersForPanel(layers, { query: 'char' }).map((entry) => entry.id)).toEqual(['ink']);
    expect(filterImageLayersForPanel(layers, { type: 'text' }).map((entry) => entry.id)).toEqual(['title']);
    expect(filterImageLayersForPanel(layers, { visibility: 'hidden' }).map((entry) => entry.id)).toEqual(['title']);
    expect(filterImageLayersForPanel(layers, { lockState: 'locked' }).map((entry) => entry.id)).toEqual(['ink']);
    expect(filterImageLayersForPanel(layers, { source: 'linked' }).map((entry) => entry.id)).toEqual(['linked']);
    expect(filterImageLayersForPanel(layers, { colorLabel: 'green' }).map((entry) => entry.id)).toEqual(['linked']);
  });

  it('treats pixel and position lock variants as locked layer state for filtering', () => {
    const variantLockedLayers = [
      layer({ id: 'paint-lock', name: 'Paint lock', locks: { pixels: true } } as Partial<ImageLayer>),
      layer({ id: 'move-lock', name: 'Move lock', locks: { position: true } } as Partial<ImageLayer>),
      layer({ id: 'open-layer', name: 'Editable' }),
    ];

    expect(filterImageLayersForPanel(variantLockedLayers, { lockState: 'locked' }).map((entry) => entry.id)).toEqual([
      'paint-lock',
      'move-lock',
    ]);
    expect(filterImageLayersForPanel(variantLockedLayers, { lockState: 'unlocked' }).map((entry) => entry.id)).toEqual([
      'open-layer',
    ]);
  });

  it('matches source labels and reports active filter counts without mutating layer objects', () => {
    const before = JSON.stringify(layers);
    const result = filterImageLayersForPanel(layers, {
      query: 'prompt',
      source: 'linked',
      colorLabel: 'green',
    });

    expect(result.map((entry) => entry.id)).toEqual(['linked']);
    expect(JSON.stringify(layers)).toBe(before);
  });

  it('exposes stable Photoshop-style color label metadata for UI menus and persistence', () => {
    expect(IMAGE_LAYER_COLOR_LABELS.map((label) => label.id)).toEqual([
      'none',
      'red',
      'orange',
      'yellow',
      'green',
      'blue',
      'violet',
      'gray',
    ]);
    expect(imageLayerColorLabelById('blue')).toMatchObject({ id: 'blue', swatch: '#3b82f6' });
    expect(imageLayerColorLabelById('bad-id')).toMatchObject({ id: 'none' });
  });

  it('treats invalid restored color label metadata as no label while filtering', () => {
    const restoredLayers = [
      layer({ id: 'bad-label', name: 'Restored layer', colorLabel: 'bad-id' as ImageLayer['colorLabel'] }),
    ];

    expect(filterImageLayersForPanel(restoredLayers, { colorLabel: 'none' }).map((entry) => entry.id)).toEqual([
      'bad-label',
    ]);
  });

  it('includes group folders in type filters and text search', () => {
    const groupedLayers = [
      layer({ id: 'group-1', name: 'Paint folder', type: 'group' as ImageLayer['type'], bitmap: null }),
      layer({ id: 'paint', name: 'Paint child', groupId: 'group-1' }),
    ];

    expect(filterImageLayersForPanel(groupedLayers, { type: 'group' as ImageLayer['type'] }).map((entry) => entry.id)).toEqual([
      'group-1',
    ]);
    expect(filterImageLayersForPanel(groupedLayers, { query: 'folder' }).map((entry) => entry.id)).toEqual([
      'group-1',
    ]);
  });

  it('builds deterministic organization descriptors for labels, locks, links, groups, source links, and filters', () => {
    const organizedLayers = [
      layer({ id: 'group-1', name: 'Artwork folder', type: 'group', bitmap: null, groupExpanded: false }),
      layer({
        id: 'ink',
        name: 'Ink prompt result',
        colorLabel: 'red',
        locks: { pixels: true },
        linkGroupId: 'link-a',
        groupId: 'group-1',
        metadata: {
          smartLinkedSourceId: 'src-ink',
          sourceLabel: 'Prompt source',
          sourceFormat: 'png',
          sourceMimeType: 'image/png',
          sourceWarnings: ['low-resolution-source'],
          sourceLink: {
            id: 'src-ink',
            label: 'Prompt source',
            width: 640,
            height: 480,
            status: 'missing',
            relinkHistory: [],
          },
        },
      }),
      layer({ id: 'shadow', name: 'Linked shadow', linkGroupId: 'link-a' }),
      layer({ id: 'paint', name: 'Paint detail', colorLabel: 'green' }),
    ];

    const metadata = buildImageLayerOrganizationWorkflowMetadata(organizedLayers, {
      filters: {
        query: 'prompt',
        source: 'linked',
        colorLabel: 'red',
      },
    });
    const inkDescriptor = metadata.descriptors.find((entry) => entry.layerId === 'ink');
    const groupDescriptor = metadata.descriptors.find((entry) => entry.layerId === 'group-1');

    expect(metadata.descriptors.map((entry) => entry.layerId)).toEqual(['group-1', 'ink', 'shadow', 'paint']);
    expect(metadata.filteredLayerIds).toEqual(['ink']);
    expect(metadata.visibleLayerIds).toEqual([]);
    expect(inkDescriptor).toMatchObject({
      layerId: 'ink',
      colorLabel: {
        id: 'red',
        label: 'Red',
        swatch: '#ef4444',
        applied: true,
      },
      locks: {
        locked: true,
        full: false,
        pixels: true,
        position: false,
        labels: ['Pixel edits locked'],
      },
      link: {
        linked: true,
        groupId: 'link-a',
        memberCount: 2,
        memberLayerIds: ['ink', 'shadow'],
      },
      group: {
        isGroup: false,
        groupId: 'group-1',
        groupName: 'Artwork folder',
        depth: 1,
        ancestorGroupIds: ['group-1'],
      },
      source: {
        linked: true,
        sourceId: 'src-ink',
        label: 'Prompt source',
        status: 'missing',
        sizeLabel: '640x480',
        format: 'png',
        mimeType: 'image/png',
        warnings: ['low-resolution-source'],
      },
      searchFilter: {
        query: 'prompt',
        activeFilterCount: 3,
        matchesFilters: true,
        hiddenByCollapsedGroup: true,
        visibleInFilteredPanel: false,
      },
    });
    expect(inkDescriptor?.searchableText).toBe('ink prompt result image prompt source src-ink png image/png link-a');
    expect(groupDescriptor).toMatchObject({
      group: {
        isGroup: true,
        expanded: false,
        childLayerIds: ['ink'],
        descendantLayerIds: ['ink'],
      },
    });
  });

  it('warns when helper metadata represents unsupported multi-select and batch organization parity', () => {
    const organizedLayers = [
      layer({ id: 'base', name: 'Base', colorLabel: 'blue', linkGroupId: 'link-a' }),
      layer({
        id: 'linked',
        name: 'Linked source',
        linkGroupId: 'link-a',
        metadata: { smartLinkedSourceId: 'source-1', sourceLabel: 'Prompt result' },
      }),
      layer({ id: 'group-1', name: 'Folder', type: 'group', bitmap: null }),
    ];

    const metadata = buildImageLayerOrganizationWorkflowMetadata(organizedLayers, {
      selectedLayerIds: ['base', 'linked'],
      requestedBatchOperations: ['label', 'lock', 'link', 'group', 'source-link'],
    });

    expect(metadata.selectedLayerIds).toEqual(['base', 'linked']);
    expect(metadata.warnings.map((warning) => warning.code)).toEqual([
      'multi-select-label-unsupported',
      'multi-select-lock-unsupported',
      'multi-select-link-unsupported',
      'multi-select-group-unsupported',
      'multi-select-source-link-unsupported',
    ]);
    expect(metadata.warnings.every((warning) => warning.layerIds.join(',') === 'base,linked')).toBe(true);
  });

  it('summarizes multi-select boundaries and nested/group-pass-through/mask caveats', () => {
    const testMask = {} as NonNullable<ImageLayer['mask']>;
    const organizedLayers = [
      layer({ id: 'group-a', name: 'Folder A', type: 'group', bitmap: null, blendMode: 'multiply' }),
      layer({ id: 'group-b', name: 'Folder B', type: 'group', bitmap: null, mask: testMask }),
      layer({ id: 'a-child', name: 'A child', groupId: 'group-a' }),
      layer({ id: 'b-child', name: 'B child', groupId: 'group-b' }),
      layer({ id: 'parent', name: 'Parent group', type: 'group', bitmap: null }),
      layer({ id: 'nested', name: 'Nested child', groupId: 'parent' }),
    ];

    const metadata = buildImageLayerOrganizationWorkflowMetadata(organizedLayers, {
      selectedLayerIds: ['a-child', 'b-child', 'parent', 'nested'],
      requestedBatchOperations: ['label'],
    });

    expect(metadata.selectionSummary).toMatchObject({
      selectedCount: 4,
      selectedLayerIds: ['a-child', 'b-child', 'parent', 'nested'],
      boundaries: [
        {
          groupId: null,
          selectedLayerIds: ['parent'],
          passThroughGroupIds: [],
          maskedGroupIds: [],
          nestedSelection: false,
        },
        {
          groupId: 'parent',
          selectedLayerIds: ['nested'],
          passThroughGroupIds: [],
          maskedGroupIds: [],
          nestedSelection: true,
        },
        {
          groupId: 'group-b',
          selectedLayerIds: ['b-child'],
          passThroughGroupIds: [],
          maskedGroupIds: ['group-b'],
          nestedSelection: false,
        },
        {
          groupId: 'group-a',
          selectedLayerIds: ['a-child'],
          passThroughGroupIds: ['group-a'],
          maskedGroupIds: [],
          nestedSelection: false,
        },
      ].sort((a, b) => {
        if (a.groupId === null) return -1;
        if (b.groupId === null) return 1;
        return a.groupId.localeCompare(b.groupId);
      }),
      crossGroupBoundaries: true,
      nestedSelection: true,
      passThroughGroupIds: ['group-a'],
      maskedGroupIds: ['group-b'],
    });
    expect(metadata.warnings.map((warning) => warning.code)).toEqual([
      'multi-select-label-unsupported',
      'multi-select-cross-group-boundaries-unsupported',
      'multi-select-nested-group-unsupported',
      'multi-select-group-pass-through-unsupported',
      'multi-select-group-mask-unsupported',
    ]);
    expect(metadata.warnings.every((warning) => warning.layerIds.join(',') === 'a-child,b-child,parent,nested')).toBe(true);
  });

  it('derives workflow badges from organization descriptors while keeping existing text and source badges', () => {
    const badgeLayers = [
      layer({ id: 'group-1', name: 'Folder', type: 'group', bitmap: null }),
      layer({
        id: 'title',
        name: 'Title',
        type: 'text',
        colorLabel: 'violet',
        locks: { pixels: true, position: true },
        linkGroupId: 'link-a',
        groupId: 'group-1',
        metadata: { editableText: true, smartLinkedSourceId: 'source-1', sourceLabel: 'Prompt result' },
      }),
      layer({ id: 'shadow', name: 'Shadow', linkGroupId: 'link-a' }),
    ];

    expect(getImageLayerWorkflowBadges(badgeLayers[1], badgeLayers).map((badge) => badge.id)).toEqual([
      'editable-text',
      'smart-linked-source',
      'color-label-violet',
      'lock-pixels',
      'lock-position',
      'linked-layer-group',
      'layer-group-child',
    ]);
  });

  it('keeps one-argument workflow badge output compatible with the legacy text and source metadata badges', () => {
    expect(getImageLayerWorkflowBadges(layer({
      id: 'decorated',
      name: 'Decorated layer',
      colorLabel: 'red',
      locks: { pixels: true },
      linkGroupId: 'link-a',
      metadata: {
        sourceLink: {
          id: 'source-link-only',
          label: 'Linked only',
          status: 'linked',
          relinkHistory: [],
        },
      },
    })).map((badge) => badge.id)).toEqual([]);

    expect(getImageLayerWorkflowBadges(layer({
      id: 'title',
      name: 'Title',
      type: 'text',
      colorLabel: 'violet',
      locks: { pixels: true },
      metadata: { editableText: true, smartLinkedSourceId: 'source-1', sourceLabel: 'Prompt result' },
    })).map((badge) => badge.id)).toEqual(['editable-text', 'smart-linked-source']);
  });

  it('builds stable label/filter summaries and multi-select limitation preview signatures', () => {
    const organizedLayers = [
      layer({ id: 'group-1', name: 'Folder', type: 'group', bitmap: null, groupExpanded: false }),
      layer({ id: 'ink', name: 'Ink prompt result', colorLabel: 'red', locks: { pixels: true }, linkGroupId: 'link-a', groupId: 'group-1' }),
      layer({ id: 'shadow', name: 'Shadow', colorLabel: 'red', visible: false, linkGroupId: 'link-a' }),
      layer({ id: 'paint', name: 'Paint detail', colorLabel: 'green' }),
    ];

    expect(buildImageLayerOrganizationPlanningSummary(organizedLayers, {
      filters: { query: 'ink', colorLabel: 'red', lockState: 'locked' },
      selectedLayerIds: ['ink', 'shadow', 'ink'],
      requestedBatchOperations: ['label', 'lock', 'link'],
    })).toMatchObject({
      totalLayerCount: 4,
      filteredLayerIds: ['ink'],
      visibleLayerIds: [],
      selectedLayerIds: ['ink', 'shadow'],
      labelSummary: {
        appliedCount: 3,
        countsByLabel: {
          none: 1,
          red: 2,
          orange: 0,
          yellow: 0,
          green: 1,
          blue: 0,
          violet: 0,
          gray: 0,
        },
      },
      filterSummary: {
        query: 'ink',
        activeFilterCount: 3,
        hiddenByCollapsedGroupIds: ['ink'],
        matchingLayerIds: ['ink'],
      },
      multiSelect: {
        enabled: true,
        selectedCount: 2,
        unsupportedOperations: ['label', 'lock', 'link'],
      },
      warningCodes: [
        'multi-select-label-unsupported',
        'multi-select-lock-unsupported',
        'multi-select-link-unsupported',
        'multi-select-cross-group-boundaries-unsupported',
      ],
      previewSignature: 'layers:4|filtered:ink|visible:none|selected:ink,shadow|selection:boundaries=ungrouped:{shadow} pass-through=none masked=none nested=0;group-1:{ink} pass-through=none masked=none nested=0,cross=1,nested=0,pass-through=none,masked=none|labels:none=1,red=2,orange=0,yellow=0,green=1,blue=0,violet=0,gray=0|filters:query=ink,count=3,hidden=ink|unsupported:label,lock,link',
    });
  });

  it('describes deterministic layer stack readiness for grouping, search, labels, locks, links, clipping masks, and caveats', () => {
    const groupedLayers = [
      layer({ id: 'group-a', name: 'Paint group', type: 'group', bitmap: null, blendMode: 'multiply', groupExpanded: false }),
      layer({ id: 'ink', name: 'Ink pass', colorLabel: 'red', locks: { pixels: true }, linkGroupId: 'link-a', groupId: 'group-a' }),
      layer({ id: 'clip', name: 'Clipped tone', clippingMask: true, linkGroupId: 'link-a', groupId: 'group-a' }),
      layer({ id: 'base', name: 'Tone base', colorLabel: 'blue', locked: true }),
      layer({ id: 'group-b', name: 'Masked group', type: 'group', bitmap: null, mask: {} as NonNullable<ImageLayer['mask']> }),
      layer({ id: 'detail', name: 'Masked detail', groupId: 'group-b' }),
    ];

    const readiness = describeImageLayerStackOrganizationReadiness(groupedLayers, {
      filters: { query: 'ink', colorLabel: 'red', lockState: 'locked' },
      selectedLayerIds: ['ink', 'detail', 'base'],
      requestedBatchOperations: ['label', 'lock', 'group'],
    });

    expect(readiness).toMatchObject({
      ready: false,
      layerCount: 6,
      groups: {
        groupCount: 2,
        groupLayerIds: ['group-a', 'group-b'],
        collapsedGroupIds: ['group-a'],
        passThroughGroupIds: ['group-a'],
        maskedGroupIds: ['group-b'],
        nestedGroupIds: [],
      },
      multiSelect: {
        enabled: true,
        selectedCount: 3,
        selectedLayerIds: ['ink', 'detail', 'base'],
        crossGroupBoundaries: true,
        nestedSelection: false,
        unsupportedOperations: ['label', 'lock', 'group'],
      },
      searchFilter: {
        query: 'ink',
        activeFilterCount: 3,
        filteredLayerIds: ['ink'],
        visibleLayerIds: [],
        hiddenByCollapsedGroupIds: ['ink', 'clip'],
      },
      labels: {
        appliedCount: 2,
        countsByLabel: {
          none: 4,
          red: 1,
          orange: 0,
          yellow: 0,
          green: 0,
          blue: 1,
          violet: 0,
          gray: 0,
        },
      },
      locks: {
        lockedLayerIds: ['ink', 'base'],
        fullyLockedLayerIds: ['base'],
        pixelLockedLayerIds: ['ink'],
        positionLockedLayerIds: [],
      },
      links: {
        linkedLayerIds: ['ink', 'clip'],
        linkGroupIds: ['link-a'],
        linkGroups: [{ groupId: 'link-a', memberLayerIds: ['ink', 'clip'], memberCount: 2 }],
      },
      clippingMasks: {
        clippedLayerIds: ['clip'],
        baseLayerIds: ['ink'],
      },
      batchOperationCaveats: [
        'multi-select-label-unsupported',
        'multi-select-lock-unsupported',
        'multi-select-group-unsupported',
        'multi-select-cross-group-boundaries-unsupported',
        'multi-select-group-pass-through-unsupported',
        'multi-select-group-mask-unsupported',
      ],
      blockers: [
        'multi-select-cross-group-boundaries-unsupported',
        'multi-select-group-pass-through-unsupported',
        'multi-select-group-mask-unsupported',
      ],
      unsupportedGroupedTransformStates: [],
    });
    expect(readiness.previewSignatures.stack).toBe(
      'stack:layers=6|groups=group-a,group-b|collapsed=group-a|pass-through=group-a|masked=group-b|selected=ink,detail,base|filtered=ink|labels=none=4,red=1,orange=0,yellow=0,green=0,blue=1,violet=0,gray=0|locks=ink,base|links=link-a:ink+clip|clipping=clip->ink|blockers=multi-select-cross-group-boundaries-unsupported,multi-select-group-pass-through-unsupported,multi-select-group-mask-unsupported|unsupported-transforms=none',
    );
  });

  it('reports nested group and unsupported grouped transform blockers without changing layer order', () => {
    const sourceLayers = [
      layer({ id: 'parent', name: 'Parent group', type: 'group', bitmap: null, rotationDeg: 8 }),
      layer({ id: 'child-group', name: 'Child group', type: 'group', bitmap: null, groupId: 'parent', cornerOffsets: { nw: { x: 1, y: 0 }, ne: { x: 0, y: 0 }, se: { x: 0, y: 0 }, sw: { x: 0, y: 0 } } }),
      layer({ id: 'paint', name: 'Paint child', groupId: 'child-group', warp: { top: 1, right: 0, bottom: 0, left: 0 } }),
    ];

    const readiness = describeImageLayerStackOrganizationReadiness(sourceLayers, {
      selectedLayerIds: ['parent', 'paint'],
      requestedBatchOperations: ['group'],
    });

    expect(sourceLayers.map((entry) => entry.id)).toEqual(['parent', 'child-group', 'paint']);
    expect(readiness.groups.nestedGroupIds).toEqual(['child-group']);
    expect(readiness.blockers).toEqual([
      'multi-select-cross-group-boundaries-unsupported',
      'multi-select-nested-group-unsupported',
      'unsupported-grouped-transform-state',
    ]);
    expect(readiness.unsupportedGroupedTransformStates).toEqual([
      {
        layerId: 'parent',
        layerName: 'Parent group',
        groupId: null,
        reasons: ['group-transform'],
      },
      {
        layerId: 'child-group',
        layerName: 'Child group',
        groupId: 'parent',
        reasons: ['group-transform', 'nested-group-transform'],
      },
      {
        layerId: 'paint',
        layerName: 'Paint child',
        groupId: 'child-group',
        reasons: ['descendant-transform-in-group'],
      },
    ]);
    expect(readiness.previewSignatures.stack).toContain(
      'unsupported-transforms=parent:group-transform;child-group:group-transform+nested-group-transform;paint:descendant-transform-in-group',
    );
  });

  it('describes clipping mask chain readiness, invalid blockers, suite handoff caveats, and action suitability', () => {
    const sourceLayers = [
      layer({ id: 'orphan', name: 'Orphan clipping layer', clippingMask: true }),
      layer({ id: 'base', name: 'Base pixels', linkGroupId: 'link-a' }),
      layer({ id: 'shade', name: 'Shade', clippingMask: true, linkGroupId: 'link-a' }),
      layer({ id: 'adjust', name: 'Adjustment', type: 'adjustment', clippingMask: true }),
      layer({ id: 'group-base', name: 'Group base', type: 'group', bitmap: null }),
      layer({ id: 'child', name: 'Group child', groupId: 'group-base' }),
      layer({ id: 'texture', name: 'Texture', clippingMask: true }),
    ];

    expect(describeImageLayerOrganizationParityReadiness(sourceLayers, {
      selectedLayerIds: ['shade', 'adjust', 'texture'],
      requestedBatchOperations: ['label', 'lock', 'link', 'group'],
      requestedAction: 'create-clipping-mask',
      suiteHandoffTarget: 'psd-export',
    })).toEqual({
      descriptorId: 'image-layer-organization-parity-readiness:v1',
      layerCount: 7,
      selectedLayerIds: ['shade', 'adjust', 'texture'],
      supportedLayerOrganization: [
        'single-layer-labels',
        'full-pixel-position-locks',
        'pairwise-linked-layer-movement',
        'multi-select-linked-movement',
        'multi-select-sibling-transform',
        'single-level-layer-groups',
        'one-level-clipping-mask-rendering',
      ],
      unsupportedPhotoshopStates: [
        'multi-select-batch-layer-operations',
        'linked-layer-transform-propagation',
        'nested-clipping-mask-chain-editing',
        'native-psd-clipping-group-roundtrip',
        'pass-through-group-compositing',
        'group-mask-rendering',
      ],
      invalidBlockers: ['clipping-mask-missing-base', 'clipping-mask-group-base-handoff'],
      clippingMasks: {
        chains: [
          { baseLayerId: null, clippedLayerIds: ['orphan'], valid: false },
          { baseLayerId: 'base', clippedLayerIds: ['shade', 'adjust'], valid: true },
          { baseLayerId: 'group-base', clippedLayerIds: ['texture'], valid: true },
        ],
        clippedLayerIds: ['orphan', 'shade', 'adjust', 'texture'],
        baseLayerIds: ['base', 'group-base'],
        invalidLayerIds: ['orphan'],
        groupBaseLayerIds: ['group-base'],
        visibleGroupBaseLayerIds: ['group-base'],
        hiddenGroupBaseLayerIds: [],
        hiddenBaseLayerIds: [],
        groupBaseVisibility: [
          {
            baseLayerId: 'group-base',
            effectiveVisible: true,
            visibleDescendantLayerIds: ['child'],
            hiddenDescendantLayerIds: [],
            bounds: null,
          },
        ],
      },
      multiLayerOperations: {
        selectedCount: 3,
        supportedOperations: [],
        unsupportedOperations: ['label', 'lock', 'link', 'group'],
      },
      actionSuitability: {
        recordable: true,
        playbackSafe: false,
        blockers: ['clipping-mask-missing-base', 'clipping-mask-group-base-handoff'],
      },
      batchSuitability: {
        supported: false,
        blockers: [
          'multi-select-label-unsupported',
          'multi-select-lock-unsupported',
          'multi-select-link-unsupported',
          'multi-select-group-unsupported',
        ],
      },
      suiteHandoffCaveats: [
        'PSD export preserves clipping-mask flags as Sloom Studio metadata, but native Photoshop clipping groups are not guaranteed.',
        'Group-base clipping masks flatten through visible descendant alpha for preview/export handoff.',
      ],
      previewSignature: 'layer-organization-parity:v1|layers:7|selected:shade,adjust,texture|clipping:orphan->none,shade+adjust->base,texture->group-base|group-base-visibility:group-base=visible:child:none:none|invalid:clipping-mask-missing-base,clipping-mask-group-base-handoff|batch:multi-select-label-unsupported,multi-select-lock-unsupported,multi-select-link-unsupported,multi-select-group-unsupported|action:unsafe|handoff:psd-export',
    });
  });

  it('carries clipping base visibility through group bases into parity readiness signatures', () => {
    const sourceLayers = [
      layer({ id: 'visible-child', name: 'Visible child', groupId: 'visible-group', x: 4, y: 5, bitmap: { width: 12, height: 6 } as ImageLayer['bitmap'] }),
      layer({ id: 'hidden-child', name: 'Hidden child', groupId: 'visible-group', visible: false, bitmap: { width: 5, height: 5 } as ImageLayer['bitmap'] }),
      layer({ id: 'visible-group', name: 'Visible group base', type: 'group', bitmap: null }),
      layer({ id: 'texture', name: 'Texture', clippingMask: true }),
      layer({ id: 'hidden-base-child', name: 'Hidden base child', groupId: 'hidden-group', bitmap: { width: 20, height: 10 } as ImageLayer['bitmap'] }),
      layer({ id: 'hidden-group', name: 'Hidden group base', type: 'group', bitmap: null, visible: false }),
      layer({ id: 'shade', name: 'Shade', clippingMask: true }),
    ];

    const readiness = describeImageLayerOrganizationParityReadiness(sourceLayers, {
      suiteHandoffTarget: 'source-library',
    });

    expect(readiness.invalidBlockers).toEqual([
      'clipping-mask-hidden-base',
      'clipping-mask-group-base-handoff',
    ]);
    expect(readiness.clippingMasks).toMatchObject({
      groupBaseLayerIds: ['visible-group', 'hidden-group'],
      visibleGroupBaseLayerIds: ['visible-group'],
      hiddenGroupBaseLayerIds: ['hidden-group'],
      invalidLayerIds: ['shade'],
      groupBaseVisibility: [
        {
          baseLayerId: 'visible-group',
          effectiveVisible: true,
          visibleDescendantLayerIds: ['visible-child'],
          hiddenDescendantLayerIds: ['hidden-child'],
          bounds: { x: 4, y: 5, width: 12, height: 6 },
        },
        {
          baseLayerId: 'hidden-group',
          effectiveVisible: false,
          visibleDescendantLayerIds: [],
          hiddenDescendantLayerIds: ['hidden-base-child'],
          bounds: null,
        },
      ],
    });
    expect(readiness.previewSignature).toBe(
      'layer-organization-parity:v1|layers:7|selected:none|clipping:texture->visible-group,shade->hidden-group|group-base-visibility:visible-group=visible:visible-child:hidden-child:4,5,12,6;hidden-group=hidden:none:hidden-base-child:none|invalid:clipping-mask-hidden-base,clipping-mask-group-base-handoff|batch:none|action:unsafe|handoff:source-library',
    );
  });
});
