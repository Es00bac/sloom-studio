import { describe, expect, it } from 'vitest';
import {
  MAX_VIDEO_SEQUENCE_NESTING_DEPTH,
  buildVideoSequenceEquivalenceDescriptor,
  buildVideoSequenceInvalidationInputs,
  buildVideoSequenceStructuralHash,
  canAddVideoSequenceReference,
  createVideoSequenceGraph,
  flattenVideoSequenceReference,
  nestVideoSequenceClips,
  planAdjustmentLayerRenderSpans,
  validateVideoSequenceGraph,
  type VideoSequenceClip,
  type VideoSequenceGraph,
  type VideoSequenceNode,
} from './videoNestedSequences';

function mediaClip(id: string, startMs: number, durationMs: number, trackOrder = 0): VideoSequenceClip {
  return {
    id,
    kind: 'media',
    sourceId: `source-${id}`,
    trackId: `v${trackOrder + 1}`,
    trackOrder,
    startMs,
    durationMs,
    sourceInMs: 100,
  };
}

function rootWithClips(clips: VideoSequenceClip[]): VideoSequenceNode {
  return { id: 'root', name: 'Feature', durationMs: 120_000, revision: 1, clips };
}

describe('video nested sequences', () => {
  it('nests selected clips and flattening preserves their edit-equivalence descriptor', () => {
    const originalClips = [mediaClip('a', 2_000, 4_000, 0), mediaClip('b', 3_000, 2_000, 1)];
    const graph = createVideoSequenceGraph(rootWithClips(originalClips));
    const nested = nestVideoSequenceClips(graph, 'root', ['a', 'b'], {
      sequenceId: 'scene-1',
      name: 'Scene 1',
      referenceClipId: 'scene-1-ref',
    });
    expect(graph.sequences.root.clips).toHaveLength(2);
    expect(nested.graph.sequences.root.clips).toEqual([expect.objectContaining({
      id: 'scene-1-ref',
      kind: 'sequence',
      startMs: 2_000,
      durationMs: 4_000,
    })]);
    expect(nested.graph.sequences['scene-1'].clips.map((clip) => clip.startMs)).toEqual([0, 1_000]);
    const flattened = flattenVideoSequenceReference(nested.graph, 'root', 'scene-1-ref');
    expect(buildVideoSequenceEquivalenceDescriptor(flattened.graph.sequences.root.clips))
      .toEqual(buildVideoSequenceEquivalenceDescriptor(originalClips));
  });

  it('creates a compound reference and deterministically trims a partial flatten window', () => {
    const graph = createVideoSequenceGraph(rootWithClips([mediaClip('a', 1_000, 1_000), mediaClip('b', 2_000, 2_000)]));
    const nested = nestVideoSequenceClips(graph, 'root', ['a', 'b'], {
      sequenceId: 'compound-source',
      name: 'Compound',
      referenceClipId: 'compound-ref',
      asCompound: true,
    });
    const reference = nested.graph.sequences.root.clips[0];
    reference.sourceInMs = 500;
    reference.durationMs = 1_000;
    const flattened = flattenVideoSequenceReference(nested.graph, 'root', reference.id);
    expect(flattened.graph.sequences.root.clips).toEqual([
      expect.objectContaining({ sourceId: 'source-a', startMs: 1_000, durationMs: 500, sourceInMs: 600 }),
      expect.objectContaining({ sourceId: 'source-b', startMs: 1_500, durationMs: 500, sourceInMs: 100 }),
    ]);
  });

  it('detects direct and indirect cycles before references are added', () => {
    const a: VideoSequenceNode = {
      id: 'a', name: 'A', durationMs: 1_000, revision: 1,
      clips: [{ id: 'a-b', kind: 'sequence', sourceId: 'b', trackId: 'v1', trackOrder: 0, startMs: 0, durationMs: 1_000, sourceInMs: 0 }],
    };
    const b: VideoSequenceNode = {
      id: 'b', name: 'B', durationMs: 1_000, revision: 1,
      clips: [{ id: 'b-a', kind: 'sequence', sourceId: 'a', trackId: 'v1', trackOrder: 0, startMs: 0, durationMs: 1_000, sourceInMs: 0 }],
    };
    const graph: VideoSequenceGraph = { version: 1, rootSequenceId: 'a', sequences: { a, b } };
    expect(validateVideoSequenceGraph(graph)).toMatchObject({ valid: false, depthExceeded: false });
    const acyclic: VideoSequenceGraph = { ...graph, sequences: { a: { ...a, clips: [] }, b: { ...b, clips: [] } } };
    expect(canAddVideoSequenceReference(acyclic, 'a', 'b')).toBe(true);
    acyclic.sequences.a.clips.push({ id: 'a-b', kind: 'sequence', sourceId: 'b', trackId: 'v1', trackOrder: 0, startMs: 0, durationMs: 1, sourceInMs: 0 });
    expect(canAddVideoSequenceReference(acyclic, 'b', 'a')).toBe(false);
  });

  it('enforces a maximum nesting depth of eight', () => {
    const sequences: VideoSequenceGraph['sequences'] = {};
    for (let index = 0; index < MAX_VIDEO_SEQUENCE_NESTING_DEPTH + 1; index += 1) {
      const childId = `s${index + 1}`;
      sequences[`s${index}`] = {
        id: `s${index}`,
        name: `S${index}`,
        durationMs: 1_000,
        revision: 1,
        clips: index < MAX_VIDEO_SEQUENCE_NESTING_DEPTH
          ? [{ id: `ref${index}`, kind: 'sequence', sourceId: childId, trackId: 'v1', trackOrder: 0, startMs: 0, durationMs: 1_000, sourceInMs: 0 }]
          : [],
      };
    }
    const validation = validateVideoSequenceGraph({ version: 1, rootSequenceId: 's0', sequences });
    expect(validation.maximumDepth).toBe(MAX_VIDEO_SEQUENCE_NESTING_DEPTH + 1);
    expect(validation).toMatchObject({ valid: false, depthExceeded: true });
  });

  it('plans adjustment render intersections only against lower tracks', () => {
    const sequence = rootWithClips([
      mediaClip('base', 0, 5_000, 0),
      mediaClip('upper', 1_000, 1_000, 3),
      {
        id: 'grade', kind: 'adjustment', sourceId: 'grade-preset', trackId: 'v3', trackOrder: 2,
        startMs: 1_000, durationMs: 3_000, sourceInMs: 0, effectSignature: 'lut:v2',
      },
    ]);
    expect(planAdjustmentLayerRenderSpans(sequence)).toEqual([
      { adjustmentClipId: 'grade', targetClipId: 'base', startMs: 1_000, endMs: 4_000, effectSignature: 'lut:v2' },
    ]);
  });

  it('propagates nested structural changes into root invalidation inputs', () => {
    const root = rootWithClips([{
      id: 'nested-ref', kind: 'sequence', sourceId: 'child', trackId: 'v1', trackOrder: 0,
      startMs: 0, durationMs: 1_000, sourceInMs: 0,
    }]);
    const child: VideoSequenceNode = { id: 'child', name: 'Child', durationMs: 1_000, revision: 1, clips: [mediaClip('shot', 0, 1_000)] };
    const graph: VideoSequenceGraph = { version: 1, rootSequenceId: 'root', sequences: { root, child } };
    const before = buildVideoSequenceInvalidationInputs(graph);
    const changed: VideoSequenceGraph = {
      ...graph,
      sequences: { ...graph.sequences, child: { ...child, clips: [{ ...child.clips[0], effectSignature: 'grade:v2' }] } },
    };
    expect(buildVideoSequenceStructuralHash(changed, 'root')).not.toBe(before.rootHash);
    expect(before.sourceAssetIds).toEqual(['source-shot']);
  });
});
