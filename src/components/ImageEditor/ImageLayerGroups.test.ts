import { describe, expect, it } from 'vitest';
import type { ImageDocument, ImageLayer, LayerBitmap } from '../../types/imageEditor';
import { createEmptyImageDocument } from '../../store/imageEditorStore';
import { createEmptyLayer } from './LayerOps';
import {
  getImageLayerPanelRows,
  getImageLayerGroupOptions,
  getImageLayerGroupDescendantLayers,
  getImageLayerGroupInheritanceSummary,
  hasImageLayerGroupHierarchy,
  buildImageLayerGroupPlanningDescriptor,
  canAssignImageLayerGroup,
  describeImageLayerGroupedStackReadiness,
  describeImageLayerGroupHierarchyReadiness,
  isImageLayerEffectivelyVisible,
  normalizeImageLayerGroupTree,
  planImageLayerGroupFlatten,
  planImageLayerGroupUngroup,
} from './ImageLayerGroups';

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

function doc(layers: ImageLayer[]): ImageDocument {
  return {
    ...createEmptyImageDocument({
      id: 'doc-groups',
      title: 'Layer groups',
      width: 800,
      height: 600,
    }),
    layers,
    activeLayerId: layers.at(-1)?.id ?? null,
  };
}

const testMask = {} as NonNullable<ImageLayer['mask']>;

function bitmap(width: number, height: number): LayerBitmap {
  return { width, height } as LayerBitmap;
}

describe('ImageLayerGroups', () => {
  it('keeps explicit and orphaned group hierarchy off the flat worker payload', () => {
    expect(hasImageLayerGroupHierarchy([
      layer({ id: 'plain' }),
    ])).toBe(false);
    expect(hasImageLayerGroupHierarchy([
      layer({ id: 'folder', type: 'group', bitmap: null }),
    ])).toBe(true);
    expect(hasImageLayerGroupHierarchy([
      layer({ id: 'orphaned-child', groupId: 'missing-folder' }),
    ])).toBe(true);
  });

  it('creates document groups as non-pixel folder layers', () => {
    const group = createEmptyLayer(doc([]), 'group' as ImageLayer['type'], 'Paint Pass');

    expect(group).toMatchObject({
      name: 'Paint Pass',
      type: 'group',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      bitmap: null,
      mask: null,
      groupExpanded: true,
    });
  });

  it('returns group options and hides children under collapsed groups in panel rows', () => {
    const layers = [
      layer({ id: 'background', name: 'Background' }),
      layer({ id: 'paint', name: 'Paint', groupId: 'group-1' }),
      layer({ id: 'line', name: 'Line art', groupId: 'group-1' }),
      layer({ id: 'group-1', name: 'Inks', type: 'group' as ImageLayer['type'], bitmap: null, groupExpanded: false }),
      layer({ id: 'caption', name: 'Caption' }),
    ];

    expect(getImageLayerGroupOptions(layers)).toEqual([
      { id: 'group-1', name: 'Inks' },
    ]);
    expect(getImageLayerPanelRows([...layers].reverse()).map((row) => [row.layer.id, row.depth])).toEqual([
      ['caption', 0],
      ['group-1', 0],
      ['background', 0],
    ]);
  });

  it('reports children of hidden groups as not effectively visible', () => {
    const layers = [
      layer({ id: 'child', name: 'Child', groupId: 'group-hidden' }),
      layer({ id: 'group-hidden', name: 'Hidden group', type: 'group' as ImageLayer['type'], bitmap: null, visible: false }),
    ];

    expect(isImageLayerEffectivelyVisible(layers[0], layers)).toBe(false);
    expect(isImageLayerEffectivelyVisible(layers[1], layers)).toBe(false);
  });

  it('normalizes nested group trees deterministically and reports invalid parent links', () => {
    const layers = [
      layer({ id: 'paint', name: 'Paint', groupId: 'details' }),
      layer({ id: 'orphan', name: 'Orphan', groupId: 'missing-group' }),
      layer({ id: 'details', name: 'Details', type: 'group' as ImageLayer['type'], bitmap: null, groupId: 'root' }),
      layer({ id: 'root', name: 'Root', type: 'group' as ImageLayer['type'], bitmap: null, groupExpanded: undefined }),
      layer({ id: 'self', name: 'Self', type: 'group' as ImageLayer['type'], bitmap: null, groupId: 'self' }),
    ];

    const normalized = normalizeImageLayerGroupTree(layers);

    expect(normalized.layers.map((entry) => [entry.id, entry.groupId, entry.groupExpanded])).toEqual([
      ['paint', 'details', undefined],
      ['orphan', undefined, undefined],
      ['details', 'root', true],
      ['root', undefined, true],
      ['self', undefined, true],
    ]);
    expect(normalized.roots.map((node) => [node.layer.id, node.depth, node.childLayerIds])).toEqual([
      ['orphan', 0, []],
      ['root', 0, ['details']],
      ['self', 0, []],
    ]);
    expect(normalized.nodesById.details.childLayerIds).toEqual(['paint']);
    expect(normalized.warnings.map((warning) => warning.code)).toEqual([
      'missing-parent',
      'self-parent',
    ]);
  });

  it('allows a folder to be nested under another folder while rejecting self and ancestor cycles', () => {
    const layers = [
      layer({ id: 'root', name: 'Root', type: 'group', bitmap: null }),
      layer({ id: 'child', name: 'Child', type: 'group', bitmap: null, groupId: 'root' }),
      layer({ id: 'paint', name: 'Paint', groupId: 'child' }),
    ];

    expect(canAssignImageLayerGroup(layers[1]!, 'root', layers)).toBe(true);
    expect(canAssignImageLayerGroup(layers[0]!, 'child', layers)).toBe(false);
    expect(canAssignImageLayerGroup(layers[0]!, 'root', layers)).toBe(false);
  });

  it('summarizes visibility lock and opacity inherited from parent folders', () => {
    const layers = [
      layer({ id: 'paint', name: 'Paint', groupId: 'details', opacity: 0.8, locks: { pixels: true } }),
      layer({
        id: 'details',
        name: 'Details',
        type: 'group' as ImageLayer['type'],
        bitmap: null,
        groupId: 'root',
        locked: true,
        opacity: 0.5,
      }),
      layer({
        id: 'root',
        name: 'Root',
        type: 'group' as ImageLayer['type'],
        bitmap: null,
        visible: false,
        opacity: 0.25,
        locks: { position: true },
      }),
    ];

    expect(getImageLayerGroupInheritanceSummary(layers[0], layers)).toEqual({
      layerId: 'paint',
      ancestorGroupIds: ['details', 'root'],
      effectiveVisible: false,
      hiddenByLayerIds: ['root'],
      effectiveLocked: true,
      effectiveLocks: {
        full: true,
        pixels: true,
        position: true,
      },
      lockedByLayerIds: ['paint', 'details', 'root'],
      effectiveOpacity: 0.1,
      opacityChain: [
        { layerId: 'paint', opacity: 0.8 },
        { layerId: 'details', opacity: 0.5 },
        { layerId: 'root', opacity: 0.25 },
      ],
      warnings: [],
    });
  });

  it('returns deterministic leaf and nested descendant layers for group-aware clipping bases', () => {
    const layers = [
      layer({ id: 'background', name: 'Background' }),
      layer({ id: 'paint', name: 'Paint', groupId: 'details' }),
      layer({ id: 'details', name: 'Details', type: 'group', bitmap: null, groupId: 'root' }),
      layer({ id: 'line', name: 'Line', groupId: 'root' }),
      layer({ id: 'root', name: 'Root', type: 'group', bitmap: null }),
      layer({ id: 'caption', name: 'Caption' }),
    ];

    expect(getImageLayerGroupDescendantLayers(layers, 'root').map((entry) => entry.id)).toEqual([
      'paint',
      'details',
      'line',
    ]);
    expect(getImageLayerGroupDescendantLayers(layers, 'details').map((entry) => entry.id)).toEqual([
      'paint',
    ]);
  });

  it('plans flatten and ungroup metadata with warnings for unsupported live folder parity', () => {
    const layers = [
      layer({ id: 'background', name: 'Background' }),
      layer({ id: 'paint', name: 'Paint', groupId: 'details' }),
      layer({ id: 'details', name: 'Details', type: 'group' as ImageLayer['type'], bitmap: null, groupId: 'root', opacity: 0.5 }),
      layer({ id: 'line', name: 'Line', groupId: 'root' }),
      layer({ id: 'root', name: 'Root', type: 'group' as ImageLayer['type'], bitmap: null, opacity: 0.75, blendMode: 'multiply' }),
    ];

    const flattenPlan = planImageLayerGroupFlatten(layers, 'root');

    expect(flattenPlan).toMatchObject({
      kind: 'flatten',
      groupId: 'root',
      groupName: 'Root',
      insertionIndex: 4,
      descendantLayerIds: ['paint', 'line'],
      descendantGroupIds: ['details'],
      affectedLayerIds: ['paint', 'details', 'line', 'root'],
      outputLayerName: 'Root (flattened)',
      effectiveVisible: true,
      effectiveLocked: false,
      effectiveOpacity: 0.75,
    });
    expect(flattenPlan.warnings.map((warning) => warning.code)).toEqual([
      'nested-live-folder-parity',
      'group-opacity-live-parity',
      'group-blend-live-parity',
    ]);

    const ungroupPlan = planImageLayerGroupUngroup(layers, 'root');

    expect(ungroupPlan).toMatchObject({
      kind: 'ungroup',
      groupId: 'root',
      groupName: 'Root',
      removedGroupId: 'root',
      promotedToGroupId: null,
      directChildIds: ['details', 'line'],
      descendantLayerIds: ['paint', 'line'],
      descendantGroupIds: ['details'],
    });
    expect(ungroupPlan.layers.map((entry) => [entry.id, entry.groupId])).toEqual([
      ['background', undefined],
      ['paint', 'details'],
      ['details', undefined],
      ['line', undefined],
    ]);
  });

  it('builds deterministic nested tree summaries and unsupported group mask/pass-through warnings', () => {
    const layers = [
      layer({ id: 'background', name: 'Background' }),
      layer({ id: 'paint', name: 'Paint', groupId: 'details', mask: testMask }),
      layer({ id: 'details', name: 'Details', type: 'group', bitmap: null, groupId: 'root', opacity: 0.5 }),
      layer({ id: 'line', name: 'Line', groupId: 'root' }),
      layer({
        id: 'root',
        name: 'Root',
        type: 'group',
        bitmap: null,
        blendMode: 'multiply',
        mask: testMask,
      }),
    ];

    expect(buildImageLayerGroupPlanningDescriptor(layers)).toEqual({
      rootLayerIds: ['background', 'root'],
      groupLayerIds: ['details', 'root'],
      leafLayerIds: ['background', 'paint', 'line'],
      maxDepth: 2,
      nodeCount: 5,
      treeSummary: [
        { layerId: 'background', parentGroupId: null, depth: 0, childLayerIds: [], descendantLayerIds: [] },
        { layerId: 'root', parentGroupId: null, depth: 0, childLayerIds: ['details', 'line'], descendantLayerIds: ['details', 'paint', 'line'] },
        { layerId: 'details', parentGroupId: 'root', depth: 1, childLayerIds: ['paint'], descendantLayerIds: ['paint'] },
        { layerId: 'paint', parentGroupId: 'details', depth: 2, childLayerIds: [], descendantLayerIds: [] },
        { layerId: 'line', parentGroupId: 'root', depth: 1, childLayerIds: [], descendantLayerIds: [] },
      ],
      unsupported: {
        passThroughBlendGroupIds: ['root'],
        maskedGroupIds: ['root'],
        maskedChildLayerIds: ['paint'],
      },
      warnings: [
        {
          code: 'group-pass-through-unsupported',
          layerId: 'root',
          message: 'Folder blend mode/pass-through behavior is summarized for planning; live Photoshop pass-through group compositing is not yet supported.',
        },
        {
          code: 'group-mask-unsupported',
          layerId: 'root',
          message: 'Layer group masks are detected for planning, but live folder mask compositing is not yet supported.',
        },
      ],
      previewSignature: 'roots:background,root|groups:details,root|leaves:background,paint,line|maxDepth:2|unsupported:pass-through=root;group-masks=root;child-masks=paint|warnings:group-pass-through-unsupported,group-mask-unsupported',
    });
  });

  it('describes nested group hierarchy readiness with inherited state and stable signatures', () => {
    const layers = [
      layer({ id: 'background', name: 'Background' }),
      layer({ id: 'paint', name: 'Paint', groupId: 'details', opacity: 0.8, locks: { pixels: true } }),
      layer({
        id: 'details',
        name: 'Details',
        type: 'group',
        bitmap: null,
        groupId: 'root',
        opacity: 0.5,
        locked: true,
      }),
      layer({ id: 'line', name: 'Line', groupId: 'root' }),
      layer({
        id: 'root',
        name: 'Root',
        type: 'group',
        bitmap: null,
        visible: false,
        opacity: 0.25,
        locks: { position: true },
        blendMode: 'multiply',
        mask: testMask,
      }),
    ];

    const readiness = describeImageLayerGroupHierarchyReadiness(layers, {
      selectedLayerIds: ['paint', 'line'],
      requestedBatchOperations: ['move', 'transform', 'visibility'],
    });

    expect(readiness).toMatchObject({
      descriptorId: 'image-layer-group-hierarchy-readiness:v1',
      ready: false,
      tree: {
        rootLayerIds: ['background', 'root'],
        groupLayerIds: ['details', 'root'],
        nestedGroupIds: ['details'],
        leafLayerIds: ['background', 'paint', 'line'],
        maxDepth: 2,
        warningCodes: ['group-pass-through-unsupported', 'group-mask-unsupported'],
      },
      unsupported: {
        passThroughBlendGroupIds: ['root'],
        maskedGroupIds: ['root'],
        maskedChildLayerIds: [],
      },
      inheritance: [
        {
          layerId: 'paint',
          ancestorGroupIds: ['details', 'root'],
          effectiveVisible: false,
          hiddenByLayerIds: ['root'],
          effectiveLocked: true,
          lockedByLayerIds: ['paint', 'details', 'root'],
          effectiveOpacity: 0.1,
        },
        {
          layerId: 'line',
          ancestorGroupIds: ['root'],
          effectiveVisible: false,
          hiddenByLayerIds: ['root'],
          effectiveLocked: true,
          lockedByLayerIds: ['root'],
          effectiveOpacity: 0.25,
        },
      ],
      batchOperations: {
        selectedLayerIds: ['paint', 'line'],
        requestedOperations: ['move', 'transform', 'visibility'],
        crossGroupBoundaries: true,
        nestedSelection: true,
        blockedOperationIds: ['move', 'transform', 'visibility'],
        blockerCodes: [
          'batch-cross-group-boundary',
          'batch-nested-group-selection',
          'batch-pass-through-group',
          'batch-group-mask',
          'batch-inherited-lock',
        ],
      },
      caveats: [
        'nested-group-normalized',
        'pass-through-group-metadata-only',
        'group-mask-metadata-only',
        'inherited-locks-block-batch',
        'inherited-opacity-preview-only',
      ],
    });
    expect(readiness.previewSignatures.tree).toBe('roots:background,root|groups:details,root|leaves:background,paint,line|maxDepth:2|unsupported:pass-through=root;group-masks=root;child-masks=none|warnings:group-pass-through-unsupported,group-mask-unsupported');
    expect(readiness.previewSignatures.readiness).toBe('image-layer-group-hierarchy-readiness:v1:{"roots":["background","root"],"groups":["details","root"],"nested":["details"],"selection":["paint","line"],"blocked":["move","transform","visibility"],"blockers":["batch-cross-group-boundary","batch-nested-group-selection","batch-pass-through-group","batch-group-mask","batch-inherited-lock"],"warnings":["group-pass-through-unsupported","group-mask-unsupported"],"effective":["paint:false:true:0.1","line:false:true:0.25"]}');
  });

  it('surfaces normalized tree warnings and blocks missing selection batch requests', () => {
    const layers = [
      layer({ id: 'orphan', name: 'Orphan', groupId: 'missing-group' }),
      layer({ id: 'self', name: 'Self', type: 'group', bitmap: null, groupId: 'self' }),
      layer({ id: 'plain', name: 'Plain' }),
    ];

    const readiness = describeImageLayerGroupHierarchyReadiness(layers, {
      selectedLayerIds: ['orphan', 'missing-layer'],
      requestedBatchOperations: ['delete', 'duplicate'],
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.tree.warningCodes).toEqual([
      'missing-parent',
      'self-parent',
    ]);
    expect(readiness.batchOperations).toMatchObject({
      selectedLayerIds: ['orphan', 'missing-layer'],
      missingSelectedLayerIds: ['missing-layer'],
      blockedOperationIds: ['delete', 'duplicate'],
      blockerCodes: [
        'batch-selection-missing-layer',
        'tree-has-normalization-warnings',
      ],
    });
    expect(readiness.caveats).toEqual(['tree-normalized-with-warnings']);
    expect(readiness.previewSignatures.readiness).toBe('image-layer-group-hierarchy-readiness:v1:{"roots":["orphan","self","plain"],"groups":["self"],"nested":[],"selection":["orphan","missing-layer"],"blocked":["delete","duplicate"],"blockers":["batch-selection-missing-layer","tree-has-normalization-warnings"],"warnings":["missing-parent","self-parent"],"effective":["orphan:true:false:1"]}');
  });

  it('describes Photoshop-style grouped stack readiness with bounds, compositing caveats, masks, and batch blockers', () => {
    const layers = [
      layer({ id: 'paper', name: 'Paper', bitmap: bitmap(300, 200) }),
      layer({ id: 'root', name: 'Root group', type: 'group', bitmap: null, mask: bitmap(180, 120) }),
      layer({ id: 'paint', name: 'Paint', groupId: 'root', x: 10, y: 20, bitmap: bitmap(50, 30) }),
      layer({ id: 'effects', name: 'Effects', type: 'group', bitmap: null, groupId: 'root', blendMode: 'multiply' }),
      layer({ id: 'glow', name: 'Glow', groupId: 'effects', x: -5, y: 16, bitmap: bitmap(25, 80) }),
      layer({ id: 'empty', name: 'Empty group', type: 'group', bitmap: null, groupId: 'root' }),
    ];

    const readiness = describeImageLayerGroupedStackReadiness(layers, {
      selectedLayerIds: ['paint', 'glow'],
      requestedBatchOperations: ['move', 'flatten'],
    });

    expect(readiness).toMatchObject({
      descriptorId: 'image-layer-grouped-stack-readiness:v1',
      ready: false,
      groupCount: 3,
      groups: [
        {
          groupId: 'root',
          parentGroupId: null,
          depth: 0,
          blendMode: 'normal',
          compositing: {
            mode: 'normal',
            caveat: 'normal-group-isolated-metadata',
          },
          directChildLayerIds: ['paint', 'effects', 'empty'],
          descendantGroupIds: ['effects', 'empty'],
          leafLayerIds: ['paint', 'glow'],
          bounds: { x: -5, y: 16, width: 65, height: 80 },
          mask: {
            present: true,
            size: { width: 180, height: 120 },
            readiness: 'metadata-only',
          },
          caveats: [
            'normal-group-isolated-metadata',
            'nested-group-bounds-derived-from-descendants',
            'group-mask-metadata-only',
            'batch-operation-blocked',
          ],
        },
        {
          groupId: 'effects',
          parentGroupId: 'root',
          depth: 1,
          blendMode: 'multiply',
          compositing: {
            mode: 'pass-through',
            caveat: 'pass-through-group-metadata-only',
          },
          directChildLayerIds: ['glow'],
          descendantGroupIds: [],
          leafLayerIds: ['glow'],
          bounds: { x: -5, y: 16, width: 25, height: 80 },
          mask: {
            present: false,
            size: null,
            readiness: 'none',
          },
          caveats: [
            'pass-through-group-metadata-only',
            'batch-operation-blocked',
          ],
        },
        {
          groupId: 'empty',
          parentGroupId: 'root',
          depth: 1,
          bounds: null,
          caveats: [
            'normal-group-isolated-metadata',
            'empty-group-bounds-unavailable',
          ],
        },
      ],
      batchOperations: {
        selectedLayerIds: ['paint', 'glow'],
        requestedOperations: ['move', 'flatten'],
        blockerCodes: [
          'batch-cross-group-boundary',
          'batch-nested-group-selection',
          'batch-pass-through-group',
          'batch-group-mask',
        ],
      },
      caveats: [
        'normal-group-isolated-metadata',
        'nested-group-bounds-derived-from-descendants',
        'group-mask-metadata-only',
        'batch-operation-blocked',
        'pass-through-group-metadata-only',
        'empty-group-bounds-unavailable',
      ],
    });
    expect(readiness.previewSignature).toBe(
      'image-layer-grouped-stack-readiness:v1|groups=root:normal:-5,16,65,80:mask=1:children=paint+effects+empty;effects:pass-through:-5,16,25,80:mask=0:children=glow;empty:normal:none:mask=0:children=none|batch=move,flatten|blockers=batch-cross-group-boundary,batch-nested-group-selection,batch-pass-through-group,batch-group-mask|caveats=normal-group-isolated-metadata,nested-group-bounds-derived-from-descendants,group-mask-metadata-only,batch-operation-blocked,pass-through-group-metadata-only,empty-group-bounds-unavailable|masks=metadata=root,live=none,native-risk=root|source=linked=none,selected=none,blockers=none|unsupported=pass-through-blend-fidelity,live-photoshop-group-mask-parity,deep-native-psd-group-mask-roundtrip,destructive-batch-operations',
    );
  });

  it('plans group masks and source-linked batch safety with explicit unsupported native parity states', () => {
    const layers = [
      layer({
        id: 'source-leaf',
        name: 'Source leaf',
        groupId: 'root',
        bitmap: bitmap(24, 24),
        metadata: { smartLinkedSourceId: 'src-leaf' },
      }),
      layer({ id: 'normal-group', name: 'Normal group', type: 'group', bitmap: null, groupId: 'root' }),
      layer({ id: 'normal-child', name: 'Normal child', groupId: 'normal-group', bitmap: bitmap(8, 8) }),
      layer({ id: 'passthrough', name: 'Pass-through', type: 'group', bitmap: null, groupId: 'root', blendMode: 'screen' }),
      layer({ id: 'effect-child', name: 'Effect child', groupId: 'passthrough', bitmap: bitmap(12, 12) }),
      layer({ id: 'root', name: 'Masked root', type: 'group', bitmap: null, mask: bitmap(100, 50) }),
    ];

    const readiness = describeImageLayerGroupedStackReadiness(layers, {
      selectedLayerIds: ['source-leaf', 'effect-child'],
      requestedBatchOperations: ['flatten', 'delete'],
    });

    expect(readiness.groupMaskPlan).toEqual({
      maskedGroupIds: ['root'],
      metadataOnlyGroupIds: ['root'],
      liveRenderableGroupIds: [],
      nativeRoundtripRiskGroupIds: ['root'],
      unsupportedStateCodes: [
        'live-photoshop-group-mask-parity',
        'deep-native-psd-group-mask-roundtrip',
      ],
    });
    expect(readiness.sourceSafety).toEqual({
      sourceLinkedLayerIds: ['source-leaf'],
      selectedSourceLinkedLayerIds: ['source-leaf'],
      destructiveBatchSafe: false,
      blockers: ['source-linked-layer-destructive-batch'],
    });
    expect(readiness.unsupportedStateSummary).toEqual([
      'pass-through-blend-fidelity',
      'live-photoshop-group-mask-parity',
      'deep-native-psd-group-mask-roundtrip',
      'destructive-batch-operations',
      'source-linked-destructive-batch',
    ]);
    expect(readiness.previewSignature).toBe(
      'image-layer-grouped-stack-readiness:v1|groups=normal-group:normal:0,0,8,8:mask=0:children=normal-child;passthrough:pass-through:0,0,12,12:mask=0:children=effect-child;root:normal:0,0,24,24:mask=1:children=source-leaf+normal-group+passthrough|batch=flatten,delete|blockers=batch-cross-group-boundary,batch-nested-group-selection,batch-pass-through-group,batch-group-mask|caveats=normal-group-isolated-metadata,pass-through-group-metadata-only,batch-operation-blocked,nested-group-bounds-derived-from-descendants,group-mask-metadata-only|masks=metadata=root,live=none,native-risk=root|source=linked=source-leaf,selected=source-leaf,blockers=source-linked-layer-destructive-batch|unsupported=pass-through-blend-fidelity,live-photoshop-group-mask-parity,deep-native-psd-group-mask-roundtrip,destructive-batch-operations,source-linked-destructive-batch',
    );
  });

  it('keeps deep hierarchy readiness bounded to one normalization pass', () => {
    const layers: ImageLayer[] = [];
    let parentId: string | undefined;
    for (let depth = 0; depth < 401; depth += 1) {
      const id = `deep-group-${depth}`;
      layers.push(layer({
        id,
        name: id,
        type: 'group',
        bitmap: null,
        ...(parentId ? { groupId: parentId } : {}),
      }));
      parentId = id;
    }
    layers.push(layer({ id: 'deep-leaf', name: 'Deep leaf', groupId: parentId }));

    const startedAt = performance.now();
    const readiness = describeImageLayerGroupHierarchyReadiness(layers);
    const elapsedMs = performance.now() - startedAt;

    expect(readiness.tree.maxDepth).toBe(401);
    expect(readiness.tree.nodeCount).toBe(402);
    expect(readiness.inheritance).toHaveLength(402);
    expect(elapsedMs).toBeLessThan(1500);
  });
});
