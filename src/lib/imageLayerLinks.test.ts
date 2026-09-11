import { describe, expect, it } from 'vitest';
import type { ImageLayer } from '../types/imageEditor';
import {
  getImageLayerLinkGroupMembers,
  isImageLayerLinked,
  linkImageLayers,
  translateLinkedImageLayers,
  unlinkImageLayer,
} from './imageLayerLinks';
import * as imageLayerLinks from './imageLayerLinks';

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

type LinkWorkflowDescriptorFn = (
  layers: readonly ImageLayer[],
  layerId: string,
  options?: unknown,
) => unknown;

function describeLinkWorkflow(
  layers: readonly ImageLayer[],
  layerId: string,
  options?: unknown,
): unknown {
  const describe = (imageLayerLinks as typeof imageLayerLinks & {
    describeImageLayerLinkWorkflow?: LinkWorkflowDescriptorFn;
  }).describeImageLayerLinkWorkflow;
  return describe?.(layers, layerId, options);
}

describe('imageLayerLinks', () => {
  it('links two pixel layers into the same movement group', () => {
    const linked = linkImageLayers(
      [
        layer({ id: 'base', name: 'Base' }),
        layer({ id: 'paint', name: 'Paint' }),
      ],
      'paint',
      'base',
      () => 'link-a',
    );

    expect(linked.map((entry) => [entry.id, entry.linkGroupId])).toEqual([
      ['base', 'link-a'],
      ['paint', 'link-a'],
    ]);
    expect(getImageLayerLinkGroupMembers(linked[1], linked).map((entry) => entry.id)).toEqual(['base', 'paint']);
    expect(isImageLayerLinked(linked[0])).toBe(true);
  });

  it('unlinks a layer and clears orphaned one-member link groups', () => {
    const unlinked = unlinkImageLayer([
      layer({ id: 'base', name: 'Base', linkGroupId: 'link-a' }),
      layer({ id: 'paint', name: 'Paint', linkGroupId: 'link-a' }),
    ], 'paint');

    expect(unlinked.map((entry) => [entry.id, entry.linkGroupId])).toEqual([
      ['base', undefined],
      ['paint', undefined],
    ]);
  });

  it('translates moveable linked companions by the same delta while leaving locked companions in place', () => {
    const translated = translateLinkedImageLayers([
      layer({ id: 'base', name: 'Base', x: 10, y: 20, linkGroupId: 'link-a' }),
      layer({ id: 'locked', name: 'Locked', x: 40, y: 50, linkGroupId: 'link-a', locks: { position: true } }),
      layer({ id: 'paint', name: 'Paint', x: 100, y: 120, linkGroupId: 'link-a' }),
      layer({ id: 'loose', name: 'Loose', x: 0, y: 0 }),
    ], 'paint', { x: 5, y: -7 });

    expect(translated.map((entry) => [entry.id, entry.x, entry.y])).toEqual([
      ['base', 15, 13],
      ['locked', 40, 50],
      ['paint', 105, 113],
      ['loose', 0, 0],
    ]);
  });

  it('describes linked movement groups with locked stationary members and transform warnings', () => {
    const layers = [
      layer({ id: 'base', name: 'Base', x: 10, y: 20, linkGroupId: 'link-a' }),
      layer({ id: 'locked', name: 'Locked', x: 40, y: 50, linkGroupId: 'link-a', locks: { position: true } }),
      layer({ id: 'paint', name: 'Paint', x: 100, y: 120, linkGroupId: 'link-a' }),
      layer({ id: 'loose', name: 'Loose', x: 0, y: 0 }),
    ];

    expect(describeLinkWorkflow(layers, 'paint')).toEqual({
      activeLayerId: 'paint',
      groupId: 'link-a',
      linked: true,
      memberCount: 3,
      memberLayerIds: ['base', 'locked', 'paint'],
      movableLayerIds: ['base', 'paint'],
      stationaryLayerIds: ['locked'],
      movementSupported: true,
      transformSupported: false,
      members: [
        {
          layerId: 'base',
          layerName: 'Base',
          layerType: 'image',
          linked: true,
          canMove: true,
        },
        {
          layerId: 'locked',
          layerName: 'Locked',
          layerType: 'image',
          linked: true,
          canMove: false,
          stationaryReason: 'position-lock',
        },
        {
          layerId: 'paint',
          layerName: 'Paint',
          layerType: 'image',
          linked: true,
          canMove: true,
        },
      ],
      warnings: [
        {
          code: 'unsupported-linked-transform-semantics',
          severity: 'warning',
          layerIds: ['base', 'locked', 'paint'],
          message: 'Linked layer groups currently move together, but scale, rotate, skew, perspective, and warp transforms are not propagated across linked members.',
        },
      ],
      previewSignature: 'active:paint|group:link-a|members:base,locked,paint|movable:base,paint|stationary:locked|warnings:unsupported-linked-transform-semantics',
    });
  });

  it('warns when descriptor metadata represents unsupported batch link operations', () => {
    const layers = [
      layer({ id: 'base', name: 'Base' }),
      layer({ id: 'paint', name: 'Paint' }),
      layer({ id: 'detail', name: 'Detail' }),
    ];

    expect(describeLinkWorkflow(layers, 'base', {
      requestedOperation: 'batch-link',
      selectedLayerIds: ['base', 'paint', 'detail', 'paint'],
    })).toMatchObject({
      activeLayerId: 'base',
      linked: false,
      memberLayerIds: ['base'],
      warnings: [
        {
          code: 'unsupported-batch-link-operation',
          severity: 'warning',
          layerIds: ['base', 'paint', 'detail'],
          message: 'Link helpers currently create or merge one pair at a time; multi-select batch link operations are descriptor-only.',
        },
      ],
      previewSignature: 'active:base|group:none|members:base|movable:base|stationary:none|warnings:unsupported-batch-link-operation',
    });
  });

  it('summarizes link group batches with locked member warnings and stable signatures', () => {
    const layers = [
      layer({ id: 'base', name: 'Base', linkGroupId: 'link-a' }),
      layer({ id: 'locked', name: 'Locked', linkGroupId: 'link-a', locks: { position: true } }),
      layer({ id: 'paint', name: 'Paint', linkGroupId: 'link-a' }),
      layer({ id: 'loose', name: 'Loose' }),
    ];

    expect(imageLayerLinks.buildImageLayerLinkBatchPlanningDescriptor(layers, {
      activeLayerId: 'paint',
      selectedLayerIds: ['paint', 'loose', 'locked', 'paint'],
      requestedOperation: 'batch-link',
    })).toEqual({
      activeLayerId: 'paint',
      selectedLayerIds: ['paint', 'loose', 'locked'],
      linkGroupSummaries: [
        {
          groupId: 'link-a',
          memberLayerIds: ['base', 'locked', 'paint'],
          movableLayerIds: ['base', 'paint'],
          stationaryLayerIds: ['locked'],
        },
      ],
      unlinkedLayerIds: ['loose'],
      warningCodes: [
        'unsupported-linked-transform-semantics',
        'unsupported-batch-link-operation',
      ],
      previewSignature: 'active:paint|selected:paint,loose,locked|groups:link-a[base,locked,paint/movable=base,paint/stationary=locked]|unlinked:loose|warnings:unsupported-linked-transform-semantics,unsupported-batch-link-operation',
    });
  });

  it('describes linked-layer parity readiness for multi-layer move, transform blockers, and batch replay', () => {
    const layers = [
      layer({ id: 'base', name: 'Base', linkGroupId: 'link-a' }),
      layer({ id: 'locked', name: 'Locked', linkGroupId: 'link-a', locks: { position: true } }),
      layer({ id: 'paint', name: 'Paint', linkGroupId: 'link-a' }),
      layer({ id: 'folder', name: 'Folder', type: 'group', bitmap: null }),
    ];

    expect(imageLayerLinks.describeImageLayerLinkParityReadiness(layers, {
      activeLayerId: 'paint',
      selectedLayerIds: ['paint', 'locked', 'folder'],
      requestedOperation: 'transform',
      actionPlayback: true,
    })).toEqual({
      descriptorId: 'image-layer-link-parity-readiness:v1',
      activeLayerId: 'paint',
      selectedLayerIds: ['paint', 'locked', 'folder'],
      supportedOperations: ['link-pair', 'unlink-single', 'move-linked-members'],
      unsupportedPhotoshopStates: ['linked-scale-rotate-skew-perspective-warp', 'batch-link-selected-layers', 'linked-group-layer-members'],
      invalidBlockers: ['linked-transform-unsupported', 'stationary-linked-members', 'group-layer-selected'],
      movableLayerIds: ['base', 'paint'],
      stationaryLayerIds: ['locked'],
      actionSuitability: {
        recordable: true,
        playbackSafe: false,
        reason: 'Linked layer transforms and batch link selection are descriptor-only; only linked movement replay is safe.',
      },
      batchSuitability: {
        supported: false,
        selectedCount: 3,
        reason: 'Batch link helpers can summarize selections but only pairwise link creation is implemented.',
      },
      previewSignature: 'link-parity:v1|active:paint|selected:paint,locked,folder|supported:link-pair,unlink-single,move-linked-members|unsupported:linked-scale-rotate-skew-perspective-warp,batch-link-selected-layers,linked-group-layer-members|movable:base,paint|stationary:locked|blockers:linked-transform-unsupported,stationary-linked-members,group-layer-selected|action:unsafe|batch:unsupported',
    });
  });
});
