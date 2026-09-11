import { describe, expect, it } from 'vitest';
import type { Connection, Edge } from '@xyflow/react';
import type { AppNode } from '../types/flow';
import {
  normalizeCompositionConnectionTargetHandle,
  normalizeCompositionEdges,
  normalizeCompositionEdgesWithDiagnostics,
  surfaceCompositionEdgeDiagnostics,
} from './compositionEdgeMigration';

function createNode(id: string, type: AppNode['type']): AppNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data: {},
  };
}

describe('normalizeCompositionConnectionTargetHandle', () => {
  it('pins video and composition sources onto the composition video handle', () => {
    const nodes = [createNode('video-1', 'videoGen'), createNode('composition-1', 'composition')];
    const connection: Connection = {
      source: 'video-1',
      sourceHandle: null,
      target: 'composition-1',
      targetHandle: null,
    };

    expect(normalizeCompositionConnectionTargetHandle(connection, nodes, [])).toMatchObject({
      targetHandle: 'composition-video',
    });
  });

  it('routes unhandled audio connections to the first open audio track', () => {
    const nodes = [createNode('audio-1', 'audioGen'), createNode('composition-1', 'composition')];
    const edges: Edge[] = [
      {
        id: 'existing-audio',
        source: 'audio-existing',
        target: 'composition-1',
        targetHandle: 'composition-audio-1',
      },
    ];
    const connection: Connection = {
      source: 'audio-1',
      sourceHandle: null,
      target: 'composition-1',
      targetHandle: null,
    };

    expect(normalizeCompositionConnectionTargetHandle(connection, nodes, edges)).toMatchObject({
      targetHandle: 'composition-audio-2',
    });
  });

  it('leaves an explicit out-of-range audio handle untouched instead of silently renumbering it', () => {
    const nodes = [createNode('audio-1', 'audioGen'), createNode('composition-1', 'composition')];
    const connection: Connection = {
      source: 'audio-1',
      sourceHandle: null,
      target: 'composition-1',
      targetHandle: 'composition-audio-7',
    };

    expect(normalizeCompositionConnectionTargetHandle(connection, nodes, [])).toEqual(connection);
  });
});

describe('normalizeCompositionEdges', () => {
  it('repairs legacy composition video edges that were saved without the video handle', () => {
    const nodes = [createNode('video-1', 'videoGen'), createNode('composition-1', 'composition')];
    const edges: Edge[] = [
      {
        id: 'legacy-video',
        source: 'video-1',
        target: 'composition-1',
      },
    ];

    expect(normalizeCompositionEdges(nodes, edges)).toEqual([
      expect.objectContaining({
        id: 'legacy-video',
        source: 'video-1',
        target: 'composition-1',
        targetHandle: 'composition-video',
      }),
    ]);
  });

  it('assigns legacy audio edges to the next available composition audio lane', () => {
    const nodes = [
      createNode('audio-1', 'audioGen'),
      createNode('audio-2', 'audioGen'),
      createNode('composition-1', 'composition'),
    ];
    const edges: Edge[] = [
      {
        id: 'explicit-audio',
        source: 'audio-1',
        target: 'composition-1',
        targetHandle: 'composition-audio-1',
      },
      {
        id: 'legacy-audio',
        source: 'audio-2',
        target: 'composition-1',
      },
    ];

    expect(normalizeCompositionEdges(nodes, edges)).toEqual([
      expect.objectContaining({
        id: 'explicit-audio',
        targetHandle: 'composition-audio-1',
      }),
      expect.objectContaining({
        id: 'legacy-audio',
        targetHandle: 'composition-audio-2',
      }),
    ]);
  });

  it('assigns stable, non-colliding handles to multiple legacy audio edges across repeated normalization', () => {
    const nodes = [
      createNode('audio-1', 'audioGen'),
      createNode('audio-2', 'audioGen'),
      createNode('audio-3', 'audioGen'),
      createNode('composition-1', 'composition'),
    ];
    const edges: Edge[] = [
      { id: 'legacy-a', source: 'audio-1', target: 'composition-1' },
      { id: 'legacy-b', source: 'audio-2', target: 'composition-1' },
      { id: 'legacy-c', source: 'audio-3', target: 'composition-1' },
    ];

    const once = normalizeCompositionEdges(nodes, edges);
    expect(once).toEqual([
      expect.objectContaining({ id: 'legacy-a', targetHandle: 'composition-audio-1' }),
      expect.objectContaining({ id: 'legacy-b', targetHandle: 'composition-audio-2' }),
      expect.objectContaining({ id: 'legacy-c', targetHandle: 'composition-audio-3' }),
    ]);

    const twice = normalizeCompositionEdges(nodes, once);
    expect(twice).toEqual(once);
  });

  it('rejects an already-persisted explicit handle beyond track 4 with a diagnostic instead of renumbering it into range', () => {
    const nodes = [createNode('audio-1', 'audioGen'), createNode('composition-1', 'composition')];
    const edges: Edge[] = [
      { id: 'overflow-audio', source: 'audio-1', target: 'composition-1', targetHandle: 'composition-audio-9' },
    ];

    const result = normalizeCompositionEdgesWithDiagnostics(nodes, edges);
    expect(result.edges).toEqual([]);
    expect(result.diagnostics).toEqual([
      { targetNodeId: 'composition-1', edgeId: 'overflow-audio', handle: 'composition-audio-9', reason: 'overflow' },
    ]);
  });

  it('rejects a malformed audio handle (non-positive index) with a diagnostic', () => {
    const nodes = [createNode('audio-1', 'audioGen'), createNode('composition-1', 'composition')];
    const edges: Edge[] = [
      { id: 'malformed-audio', source: 'audio-1', target: 'composition-1', targetHandle: 'composition-audio-0' },
    ];

    const result = normalizeCompositionEdgesWithDiagnostics(nodes, edges);
    expect(result.edges).toEqual([]);
    expect(result.diagnostics).toEqual([
      { targetNodeId: 'composition-1', edgeId: 'malformed-audio', handle: 'composition-audio-0', reason: 'malformed' },
    ]);
  });

  it('does not disturb explicit valid handles while also migrating a legacy edge in the same pass', () => {
    const nodes = [
      createNode('audio-1', 'audioGen'),
      createNode('audio-2', 'audioGen'),
      createNode('composition-1', 'composition'),
    ];
    const edges: Edge[] = [
      { id: 'explicit-3', source: 'audio-1', target: 'composition-1', targetHandle: 'composition-audio-3' },
      { id: 'legacy', source: 'audio-2', target: 'composition-1' },
    ];

    expect(normalizeCompositionEdges(nodes, edges)).toEqual([
      expect.objectContaining({ id: 'explicit-3', targetHandle: 'composition-audio-3' }),
      expect.objectContaining({ id: 'legacy', targetHandle: 'composition-audio-1' }),
    ]);
  });

  it.each(['composition-audio-x', 'composition-audio--1', 'composition-audio-1.5'])(
    'drops a persisted nonnumeric malformed audio handle %s with a diagnostic (FBL-019 correction)',
    (handle) => {
      const nodes = [createNode('audio-1', 'audioGen'), createNode('composition-1', 'composition')];
      const edges: Edge[] = [{ id: 'bad-edge', source: 'audio-1', target: 'composition-1', targetHandle: handle }];

      const result = normalizeCompositionEdgesWithDiagnostics(nodes, edges);
      expect(result.edges).toEqual([]);
      expect(result.diagnostics).toEqual([
        { targetNodeId: 'composition-1', edgeId: 'bad-edge', handle, reason: 'malformed' },
      ]);
    },
  );

  it('rejects an arbitrary non-null handle on an audio-producing source that is not shaped like a composition-audio handle (FBL-019 correction)', () => {
    const nodes = [createNode('audio-1', 'audioGen'), createNode('composition-1', 'composition')];
    const edges: Edge[] = [
      { id: 'weird-handle', source: 'audio-1', target: 'composition-1', targetHandle: 'banana' },
    ];

    const result = normalizeCompositionEdgesWithDiagnostics(nodes, edges);
    expect(result.edges).toEqual([]);
    expect(result.diagnostics).toEqual([
      { targetNodeId: 'composition-1', edgeId: 'weird-handle', handle: 'banana', reason: 'malformed' },
    ]);
  });

  it('rejects an overflow audio handle from a functionNode audio-producing source the same way as audioGen (FBL-019 correction)', () => {
    const nodes = [createNode('fn-1', 'functionNode'), createNode('composition-1', 'composition')];
    const edges: Edge[] = [
      { id: 'fn-overflow', source: 'fn-1', target: 'composition-1', targetHandle: 'composition-audio-9' },
    ];

    const result = normalizeCompositionEdgesWithDiagnostics(nodes, edges);
    expect(result.edges).toEqual([]);
    expect(result.diagnostics).toEqual([
      { targetNodeId: 'composition-1', edgeId: 'fn-overflow', handle: 'composition-audio-9', reason: 'overflow' },
    ]);
  });

  it('rejects a malformed audio handle from a functionNode audio-producing source (FBL-019 correction)', () => {
    const nodes = [createNode('fn-1', 'functionNode'), createNode('composition-1', 'composition')];
    const edges: Edge[] = [
      { id: 'fn-malformed', source: 'fn-1', target: 'composition-1', targetHandle: 'composition-audio-x' },
    ];

    const result = normalizeCompositionEdgesWithDiagnostics(nodes, edges);
    expect(result.edges).toEqual([]);
    expect(result.diagnostics).toEqual([
      { targetNodeId: 'composition-1', edgeId: 'fn-malformed', handle: 'composition-audio-x', reason: 'malformed' },
    ]);
  });

  it('does not touch a valid functionNode audio edge, mirroring audioGen', () => {
    const nodes = [createNode('fn-1', 'functionNode'), createNode('composition-1', 'composition')];
    const edges: Edge[] = [
      { id: 'fn-valid', source: 'fn-1', target: 'composition-1', targetHandle: 'composition-audio-2' },
    ];

    expect(normalizeCompositionEdges(nodes, edges)).toEqual(edges);
  });

  it('leaves a legacy null-handle edge from a functionNode source untouched instead of auto-assigning it (ambiguous with video)', () => {
    const nodes = [createNode('fn-1', 'functionNode'), createNode('composition-1', 'composition')];
    const edges: Edge[] = [{ id: 'fn-legacy', source: 'fn-1', target: 'composition-1' }];

    expect(normalizeCompositionEdges(nodes, edges)).toEqual(edges);
  });

  it('leaves a functionNode edge explicitly targeting the video handle untouched (not misclassified as audio)', () => {
    const nodes = [createNode('fn-1', 'functionNode'), createNode('composition-1', 'composition')];
    const edges: Edge[] = [
      { id: 'fn-video', source: 'fn-1', target: 'composition-1', targetHandle: 'composition-video' },
    ];

    expect(normalizeCompositionEdges(nodes, edges)).toEqual(edges);
  });

  it('leaves unrelated Composition video-handle migration unchanged', () => {
    const nodes = [
      createNode('video-1', 'videoGen'),
      createNode('video-2', 'videoGen'),
      createNode('composition-1', 'composition'),
    ];
    const edges: Edge[] = [
      { id: 'legacy-video-1', source: 'video-1', target: 'composition-1' },
      { id: 'legacy-video-2', source: 'video-2', target: 'composition-1' },
    ];

    // Only the most recently saved legacy video edge wins the single video handle — unrelated to
    // the audio overflow/malformed handling above.
    expect(normalizeCompositionEdges(nodes, edges)).toEqual([
      expect.objectContaining({ id: 'legacy-video-2', targetHandle: 'composition-video' }),
    ]);
  });
});

describe('surfaceCompositionEdgeDiagnostics (FBL-019 gap 3 + correction)', () => {
  it('sets a bounded, typed, persisted warning on the target node describing the dropped handle, not data.error', () => {
    const nodes = [createNode('composition-1', 'composition'), createNode('other', 'composition')];

    const patched = surfaceCompositionEdgeDiagnostics(nodes, [
      { targetNodeId: 'composition-1', edgeId: 'overflow-audio', handle: 'composition-audio-9', reason: 'overflow' },
    ]);

    const patchedTarget = patched.find((node) => node.id === 'composition-1')!;
    expect(patchedTarget.data.error).toBeUndefined();
    expect(patchedTarget.data.compositionAudioMigrationWarnings).toEqual([
      { handle: 'composition-audio-9', reason: 'overflow', message: expect.stringContaining('composition-audio-9') },
    ]);
    // Unrelated nodes are untouched.
    const other = patched.find((node) => node.id === 'other')!;
    expect(other.data.error).toBeUndefined();
    expect(other.data.compositionAudioMigrationWarnings).toBeUndefined();
  });

  it('combines multiple diagnostics for the same target into one warning list', () => {
    const nodes = [createNode('composition-1', 'composition')];

    const patched = surfaceCompositionEdgeDiagnostics(nodes, [
      { targetNodeId: 'composition-1', edgeId: 'bad-1', handle: 'composition-audio-9', reason: 'overflow' },
      { targetNodeId: 'composition-1', edgeId: 'bad-2', handle: 'composition-audio-0', reason: 'malformed' },
    ]);

    const warnings = patched.find((node) => node.id === 'composition-1')!.data.compositionAudioMigrationWarnings!;
    expect(warnings.map((warning) => warning.handle).sort()).toEqual(['composition-audio-0', 'composition-audio-9']);
  });

  it('is a no-op returning the same nodes array when there are no diagnostics', () => {
    const nodes = [createNode('composition-1', 'composition')];
    expect(surfaceCompositionEdgeDiagnostics(nodes, [])).toBe(nodes);
  });

  it('merges new diagnostics with a node\'s existing persisted warnings instead of replacing them (durability)', () => {
    const nodes = [createNode('composition-1', 'composition')];
    const firstPass = surfaceCompositionEdgeDiagnostics(nodes, [
      { targetNodeId: 'composition-1', edgeId: 'e1', handle: 'composition-audio-9', reason: 'overflow' },
    ]);

    // Simulate reopening: the bad edge is already gone, so no new diagnostics fire this pass.
    const secondPass = surfaceCompositionEdgeDiagnostics(firstPass, []);
    expect(secondPass).toBe(firstPass);
    expect(secondPass.find((node) => node.id === 'composition-1')!.data.compositionAudioMigrationWarnings).toHaveLength(1);

    // A different bad edge shows up later — it should be appended, not replace the first.
    const thirdPass = surfaceCompositionEdgeDiagnostics(secondPass, [
      { targetNodeId: 'composition-1', edgeId: 'e2', handle: 'composition-audio-0', reason: 'malformed' },
    ]);
    const warnings = thirdPass.find((node) => node.id === 'composition-1')!.data.compositionAudioMigrationWarnings!;
    expect(warnings).toHaveLength(2);
    expect(warnings.map((warning) => warning.handle).sort()).toEqual(['composition-audio-0', 'composition-audio-9']);
  });

  it('does not erase an existing warning on a node when new diagnostics target a different node', () => {
    const nodes = [createNode('composition-1', 'composition'), createNode('composition-2', 'composition')];
    const firstPass = surfaceCompositionEdgeDiagnostics(nodes, [
      { targetNodeId: 'composition-1', edgeId: 'e1', handle: 'composition-audio-9', reason: 'overflow' },
    ]);
    const secondPass = surfaceCompositionEdgeDiagnostics(firstPass, [
      { targetNodeId: 'composition-2', edgeId: 'e2', handle: 'composition-audio-x', reason: 'malformed' },
    ]);

    const node1 = secondPass.find((node) => node.id === 'composition-1')!;
    expect(node1.data.compositionAudioMigrationWarnings).toHaveLength(1);
    expect(node1.data.compositionAudioMigrationWarnings![0].handle).toBe('composition-audio-9');
  });

  it('truncates a hostile long handle string instead of persisting it verbatim', () => {
    const nodes = [createNode('composition-1', 'composition')];
    const hostileHandle = `composition-audio-${'x'.repeat(5000)}`;

    const patched = surfaceCompositionEdgeDiagnostics(nodes, [
      { targetNodeId: 'composition-1', edgeId: 'hostile', handle: hostileHandle, reason: 'malformed' },
    ]);

    const warning = patched.find((node) => node.id === 'composition-1')!.data.compositionAudioMigrationWarnings![0];
    expect(warning.handle.length).toBeLessThan(100);
    expect(warning.message.length).toBeLessThan(300);
  });

  it('bounds and deduplicates warnings deterministically when many diagnostics accumulate', () => {
    const nodes = [createNode('composition-1', 'composition')];
    const diagnostics = Array.from({ length: 12 }, (_, index) => ({
      targetNodeId: 'composition-1',
      edgeId: `edge-${index}`,
      handle: `composition-audio-${100 + index}`,
      reason: 'overflow' as const,
    }));

    const patched = surfaceCompositionEdgeDiagnostics(nodes, diagnostics);
    const warnings = patched.find((node) => node.id === 'composition-1')!.data.compositionAudioMigrationWarnings!;
    expect(warnings.length).toBeLessThanOrEqual(8);

    const patchedAgain = surfaceCompositionEdgeDiagnostics(nodes, diagnostics);
    expect(patchedAgain.find((node) => node.id === 'composition-1')!.data.compositionAudioMigrationWarnings)
      .toEqual(warnings);

    const withDuplicate = surfaceCompositionEdgeDiagnostics(nodes, [
      ...diagnostics.slice(0, 3),
      { targetNodeId: 'composition-1', edgeId: 'dup', handle: 'composition-audio-100', reason: 'overflow' },
    ]);
    const dedupedWarnings = withDuplicate.find((node) => node.id === 'composition-1')!.data.compositionAudioMigrationWarnings!;
    expect(dedupedWarnings.filter((warning) => warning.handle === 'composition-audio-100')).toHaveLength(1);
  });

  it('canonicalizes truncation-colliding diagnostics before they count toward the unique warning cap', () => {
    const existingWarnings = Array.from({ length: 7 }, (_, index) => ({
      handle: `unique-existing-${index + 1}`,
      reason: 'overflow' as const,
      message: `Existing warning ${index + 1}.`,
    }));
    const nodes = [{
      ...createNode('composition-1', 'composition'),
      data: { compositionAudioMigrationWarnings: existingWarnings },
    }];
    const sharedPrefix = 'x'.repeat(64);
    const diagnostics = Array.from({ length: 8 }, (_, index) => ({
      targetNodeId: 'composition-1',
      edgeId: `colliding-edge-${index}`,
      handle: `${sharedPrefix}${index}`,
      reason: 'malformed' as const,
    }));

    const warnings = surfaceCompositionEdgeDiagnostics(nodes, diagnostics)[0]
      .data.compositionAudioMigrationWarnings!;

    expect(warnings).toHaveLength(8);
    expect(warnings.map((warning) => warning.handle)).toEqual([
      ...existingWarnings.map((warning) => warning.handle),
      `${sharedPrefix}…`,
    ]);
  });

  it('preserves an existing warning message and order when a new diagnostic has the same canonical identity', () => {
    const existingWarnings = [
      { handle: 'composition-audio-9', reason: 'overflow' as const, message: 'First-seen persisted message.' },
      { handle: 'composition-audio-x', reason: 'malformed' as const, message: 'Second persisted message.' },
    ];
    const nodes = [{
      ...createNode('composition-1', 'composition'),
      data: { compositionAudioMigrationWarnings: existingWarnings },
    }];

    const warnings = surfaceCompositionEdgeDiagnostics(nodes, [
      { targetNodeId: 'composition-1', edgeId: 'duplicate-edge', handle: 'composition-audio-9', reason: 'overflow' },
      { targetNodeId: 'composition-1', edgeId: 'new-edge', handle: 'composition-audio-0', reason: 'malformed' },
    ])[0].data.compositionAudioMigrationWarnings;

    expect(warnings).toEqual([
      ...existingWarnings,
      expect.objectContaining({ handle: 'composition-audio-0', reason: 'malformed' }),
    ]);
  });

  it('fills but never exceeds the unique cap when incoming diagnostics mix canonical collisions and unique handles', () => {
    const existingWarnings = [
      { handle: 'existing-1', reason: 'overflow' as const, message: 'Existing 1.' },
      { handle: 'existing-2', reason: 'malformed' as const, message: 'Existing 2.' },
    ];
    const nodes = [{
      ...createNode('composition-1', 'composition'),
      data: { compositionAudioMigrationWarnings: existingWarnings },
    }];
    const sharedPrefix = 'y'.repeat(64);
    const collidingDiagnostics = Array.from({ length: 4 }, (_, index) => ({
      targetNodeId: 'composition-1',
      edgeId: `collision-${index}`,
      handle: `${sharedPrefix}${index}`,
      reason: 'malformed' as const,
    }));
    const uniqueDiagnostics = Array.from({ length: 7 }, (_, index) => ({
      targetNodeId: 'composition-1',
      edgeId: `unique-${index}`,
      handle: `new-unique-${index + 1}`,
      reason: 'overflow' as const,
    }));

    const warnings = surfaceCompositionEdgeDiagnostics(
      nodes,
      [...collidingDiagnostics, ...uniqueDiagnostics],
    )[0].data.compositionAudioMigrationWarnings!;

    expect(warnings).toHaveLength(8);
    expect(warnings.map((warning) => warning.handle)).toEqual([
      'existing-1',
      'existing-2',
      `${sharedPrefix}…`,
      'new-unique-1',
      'new-unique-2',
      'new-unique-3',
      'new-unique-4',
      'new-unique-5',
    ]);
  });
});
