import { describe, expect, it } from 'vitest';
import type { ImageLayer } from '../types/imageEditor';
import * as imageLayerLocks from './imageLayerLocks';

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

type LockWorkflowDescriptorFn = (target: ImageLayer) => unknown;

function describeLockWorkflow(target: ImageLayer): unknown {
  const describe = (imageLayerLocks as typeof imageLayerLocks & {
    describeImageLayerLockWorkflow?: LockWorkflowDescriptorFn;
  }).describeImageLayerLockWorkflow;
  return describe?.(target);
}

describe('imageLayerLocks', () => {
  it('protects editable Tiltmark surface pixels except for its own engine and explicit conversion', () => {
    const surface = layer({
      metadata: {
        tiltmark: {
          schemaVersion: 1,
          role: 'surface',
          materialState: 'physical',
        },
      },
    });

    expect(imageLayerLocks.canEditImageLayerPixels(surface)).toBe(false);
    expect(imageLayerLocks.canEditImageLayerPixels(surface, { allowTiltmarkSurface: true })).toBe(true);
  });

  it('describes full, pixel, and position lock behavior in deterministic order', () => {
    expect(describeLockWorkflow(layer({
      id: 'paint',
      name: 'Paint',
      locked: true,
      locks: { pixels: true, position: true },
    }))).toEqual({
      layerId: 'paint',
      layerType: 'image',
      locked: true,
      full: true,
      pixels: true,
      position: true,
      canEditPixels: false,
      canMove: false,
      labels: ['Fully locked', 'Pixel edits locked', 'Position locked'],
      blockedOperations: ['pixel-edit', 'move', 'transform'],
      variants: [
        {
          kind: 'full',
          label: 'Full lock',
          enabled: true,
          persistedAs: 'locked',
          blocksPixelEdits: true,
          blocksMovement: true,
          blocksTransforms: true,
        },
        {
          kind: 'pixels',
          label: 'Pixel edits locked',
          enabled: true,
          persistedAs: 'locks.pixels',
          blocksPixelEdits: true,
          blocksMovement: false,
          blocksTransforms: false,
        },
        {
          kind: 'position',
          label: 'Position locked',
          enabled: true,
          persistedAs: 'locks.position',
          blocksPixelEdits: false,
          blocksMovement: true,
          blocksTransforms: true,
        },
      ],
      previewSignature: 'layer:paint|type:image|locks:full,pixels,position|blocked:pixel-edit,move,transform',
    });
  });

  it('keeps pixel edits available for a position-only lock descriptor', () => {
    expect(describeLockWorkflow(layer({
      id: 'title',
      name: 'Title',
      type: 'text',
      locks: { position: true },
    }))).toMatchObject({
      layerId: 'title',
      layerType: 'text',
      locked: true,
      full: false,
      pixels: false,
      position: true,
      canEditPixels: true,
      canMove: false,
      labels: ['Position locked'],
      blockedOperations: ['move', 'transform'],
      previewSignature: 'layer:title|type:text|locks:position|blocked:move,transform',
    });
  });

  it('summarizes lock batch planning warnings and deterministic signatures without mutating layers', () => {
    const layers = [
      layer({ id: 'paint', name: 'Paint', locks: { pixels: true } }),
      layer({ id: 'title', name: 'Title', type: 'text', locks: { position: true } }),
      layer({ id: 'folder', name: 'Folder', type: 'group', bitmap: null, locked: true }),
    ];
    const before = JSON.stringify(layers);

    expect(imageLayerLocks.buildImageLayerLockBatchPlanningDescriptor(layers, {
      selectedLayerIds: ['paint', 'title', 'paint', 'missing'],
      requestedOperation: 'toggle-position',
    })).toEqual({
      selectedLayerIds: ['paint', 'title'],
      selectedCount: 2,
      requestedOperation: 'toggle-position',
      lockedLayerIds: ['paint', 'title'],
      blockedOperationSummary: {
        'pixel-edit': ['paint'],
        move: ['title'],
        transform: ['title'],
      },
      warnings: [
        {
          code: 'unsupported-lock-batch-operation',
          severity: 'warning',
          layerIds: ['paint', 'title'],
          message: 'Layer lock helpers describe multi-select lock changes, but batch lock application is not yet wired into the Image workspace UI.',
        },
      ],
      previewSignature: 'selected:paint,title|operation:toggle-position|locked:paint,title|blocked:pixel-edit=paint;move=title;transform=title|warnings:unsupported-lock-batch-operation',
    });
    expect(JSON.stringify(layers)).toBe(before);
  });

  it('describes Photoshop-equivalent lock parity gaps and action suitability with stable signatures', () => {
    expect(imageLayerLocks.describeImageLayerLockParityReadiness(layer({
      id: 'paint',
      name: 'Paint',
      locks: { pixels: true },
    }), {
      requestedOperation: 'toggle-transparent-pixels',
      actionPlayback: true,
    })).toEqual({
      descriptorId: 'image-layer-lock-parity-readiness:v1',
      layerId: 'paint',
      supportedLockStates: ['full', 'pixels', 'position'],
      unsupportedPhotoshopStates: ['transparent-pixels-lock', 'image-pixels-lock', 'artboard-lock', 'lock-all-linked-layers'],
      invalidBlockers: ['unsupported-transparent-pixels-lock'],
      actionSuitability: {
        recordable: true,
        playbackSafe: false,
        reason: 'Unsupported Photoshop lock states are descriptor-only and cannot be replayed as live layer mutations.',
      },
      previewSignature: 'lock-parity:v1|layer:paint|supported:full,pixels,position|unsupported:transparent-pixels-lock,image-pixels-lock,artboard-lock,lock-all-linked-layers|blockers:unsupported-transparent-pixels-lock|action:unsafe',
    });
  });
});
