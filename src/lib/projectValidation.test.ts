import { describe, expect, it } from 'vitest';
import { CURRENT_PROJECT_SCHEMA_VERSION, FLOW_NODE_TYPES } from './projectSchema';
import { sanitizePaperSnapshot, sanitizeProjectDocument } from './projectValidation';
import { MAX_TIMELINE_MARKERS, MAX_TIMELINE_MARKER_SECONDS } from './editorTimelineMarkers';
import {
  IMAGE_DOCUMENT_MAX_SNAPSHOT_LAYERS,
  IMAGE_SNAPSHOT_MAX_LAYERS,
} from '../components/ImageEditor/ImageSnapshots';

function projectWith(overrides: Record<string, unknown>) {
  return sanitizeProjectDocument({
    id: 'p1',
    name: 'Malformed Restore',
    savedAt: 1,
    flow: { version: 3, nodes: [], edges: [] },
    ...overrides,
  });
}

describe('sanitizeProjectDocument', () => {
  it('retains bounded Image Blend If and Layer Comp state through project restore', () => {
    const project = projectWith({
      imageEditor: {
        activeDocId: 'image-1',
        documents: [{
          id: 'image-1', title: 'Grade', width: 32, height: 32, activeLayerId: 'base',
          hasSelection: false, selectionVersion: 0, viewport: { zoom: 1, panX: 0, panY: 0 }, dirty: false,
          layers: [{ id: 'base', name: 'Base', type: 'image', visible: true, locked: false, opacity: 1, blendMode: 'normal', blendIf: { sourceBlack: -2, sourceWhite: 999 }, x: 0, y: 0, bitmapVersion: 0 }],
          layerComps: [{ id: 'night', name: 'Night', createdAt: 1, layers: [{ layerId: 'base', visible: false, opacity: 0.4, blendMode: 'screen' }] }],
        }],
      },
    });
    const document = project.imageEditor?.documents[0];
    expect(document?.layers[0]?.blendIf).toEqual({ sourceBlack: 0, sourceWhite: 255 });
    expect(document?.layerComps).toMatchObject([{ name: 'Night', layers: [{ layerId: 'base', visible: false, opacity: 0.4, blendMode: 'screen' }] }]);
  });

  it('migrates legacy documents without a top-level schema version to the current schema version', () => {
    const project = projectWith({});

    expect(project.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
  });

  it('migrates a legacy single-flow project into a main Flow workspace', () => {
    const project = projectWith({
      flow: {
        version: 3,
        nodes: [{ id: 'legacy-node', type: 'textNode', position: { x: 1, y: 2 }, data: {} }],
        edges: [],
      },
    });

    expect(project.flow.nodes.map((node) => node.id)).toEqual(['legacy-node']);
    expect(project).toMatchObject({
      activeFlowWorkspaceId: 'main',
      flowWorkspaces: [
        expect.objectContaining({
          id: 'main',
          name: 'Main Flow',
          flow: {
            version: 3,
            nodes: [expect.objectContaining({ id: 'legacy-node' })],
            edges: [],
          },
        }),
      ],
    });
  });

  it('hydrates the declared active Flow workspace instead of a stale top-level flow snapshot', () => {
    const project = sanitizeProjectDocument({
      id: 'p1',
      name: 'Multi Flow',
      savedAt: 1,
      flow: {
        version: 3,
        nodes: [{ id: 'stale-node', type: 'textNode', position: { x: 0, y: 0 }, data: {} }],
        edges: [],
      },
      activeFlowWorkspaceId: 'alt',
      flowWorkspaces: [
        {
          id: 'main',
          name: 'Main Flow',
          createdAt: 10,
          updatedAt: 11,
          flow: {
            version: 3,
            nodes: [{ id: 'main-node', type: 'textNode', position: { x: 10, y: 20 }, data: {} }],
            edges: [],
          },
        },
        {
          id: 'alt',
          name: 'Alt Flow',
          createdAt: 20,
          updatedAt: 21,
          flow: {
            version: 3,
            nodes: [{ id: 'alt-node', type: 'textNode', position: { x: 30, y: 40 }, data: {} }],
            edges: [],
          },
        },
      ],
    });

    expect(project.flow.nodes.map((node) => node.id)).toEqual(['alt-node']);
    expect(project).toMatchObject({
      activeFlowWorkspaceId: 'alt',
      flowWorkspaces: [
        expect.objectContaining({ id: 'main', name: 'Main Flow' }),
        expect.objectContaining({ id: 'alt', name: 'Alt Flow' }),
      ],
    });
  });

  it('preserves every current Flow node type during project restore sanitization', () => {
    const project = projectWith({
      flow: {
        version: 3,
        nodes: FLOW_NODE_TYPES.map((type, index) => ({
          id: `${type}-${index}`,
          type,
          position: { x: index, y: index + 1 },
          data: {},
        })),
        edges: [],
      },
    });

    expect(project.flow.nodes.map((node) => node.type)).toEqual(FLOW_NODE_TYPES);
  });

  it('deduplicates Composition audio migration warnings while sanitizing a project snapshot', () => {
    const project = projectWith({
      flow: {
        version: 3,
        nodes: [{
          id: 'composition-1',
          type: 'composition',
          position: { x: 0, y: 0 },
          data: {
            compositionAudioMigrationWarnings: [
              { handle: 'composition-audio-9', reason: 'overflow', message: 'First project warning.' },
              { handle: 'composition-audio-9', reason: 'overflow', message: 'Duplicate project warning.' },
            ],
          },
        }],
        edges: [],
      },
    });

    expect(project.flow.nodes[0].data.compositionAudioMigrationWarnings).toEqual([
      { handle: 'composition-audio-9', reason: 'overflow', message: 'First project warning.' },
    ]);
  });

  it('preserves complete point/range timeline markers through sanitize, save, and reopen', () => {
    const editorTimelineMarkers = [
      {
        id: 'point-comment', seconds: 1.25, label: 'Editorial note', color: '#22d3ee', kind: 'comment' as const,
        notes: 'Hold two frames', createdAt: 100, updatedAt: 200,
      },
      {
        id: 'range-review', seconds: 3.5, endSeconds: 8.75, label: 'Client review', color: '#f472b6', kind: 'review' as const,
        notes: 'Approved range', createdAt: 300, updatedAt: 400,
      },
    ];
    const saved = projectWith({
      flow: {
        version: 3,
        nodes: [{ id: 'composition-1', type: 'composition', position: { x: 0, y: 0 }, data: { editorTimelineMarkers } }],
        edges: [],
      },
    });
    const reopened = sanitizeProjectDocument(JSON.parse(JSON.stringify(saved)));
    const restoredMarkers = reopened.flow.nodes[0].data.editorTimelineMarkers;

    expect(JSON.parse(JSON.stringify(restoredMarkers))).toEqual(editorTimelineMarkers);
  });

  it('preserves clip-relative marker ownership and offsets through sanitize, save, and reopen', () => {
    const editorTimelineMarkers = [
      {
        id: 'clip-note', seconds: 4.25, label: 'Anchored', color: '#fbbf24', kind: 'edit' as const,
        notes: 'Moves with the clip', clipId: 'visual-1', clipOffsetMs: 1_250, createdAt: 100, updatedAt: 200,
      },
      {
        id: 'clip-legacy', seconds: 6, label: 'Legacy', color: '#22d3ee', kind: 'comment' as const,
        clipId: 'audio-1', createdAt: 300, updatedAt: 400,
      },
    ];
    const saved = projectWith({
      flow: {
        version: 3,
        nodes: [{ id: 'composition-1', type: 'composition', position: { x: 0, y: 0 }, data: { editorTimelineMarkers } }],
        edges: [],
      },
    });
    const reopened = sanitizeProjectDocument(JSON.parse(JSON.stringify(saved)));

    expect(JSON.parse(JSON.stringify(reopened.flow.nodes[0].data.editorTimelineMarkers))).toEqual(editorTimelineMarkers);
  });

  it('bounds restored clip offsets to the shared 12-hour project ceiling', () => {
    const editorTimelineMarkers = [
      {
        id: 'too-high', seconds: 1, label: 'High', color: '#22d3ee', clipId: 'visual-1',
        clipOffsetMs: MAX_TIMELINE_MARKER_SECONDS * 1_000 + 5_000,
      },
      { id: 'negative', seconds: 1, label: 'Low', color: '#22d3ee', clipId: 'visual-1', clipOffsetMs: -250 },
      { id: 'not-a-number', seconds: 1, label: 'Bad', color: '#22d3ee', clipId: 'visual-1', clipOffsetMs: Number.NaN },
    ];
    const project = projectWith({
      flow: {
        version: 3,
        nodes: [{ id: 'composition-1', type: 'composition', position: { x: 0, y: 0 }, data: { editorTimelineMarkers } }],
        edges: [],
      },
    });
    const restoredMarkers = project.flow.nodes[0].data.editorTimelineMarkers ?? [];

    expect(restoredMarkers.find((marker) => marker.id === 'too-high')?.clipOffsetMs).toBe(MAX_TIMELINE_MARKER_SECONDS * 1_000);
    expect(restoredMarkers.find((marker) => marker.id === 'negative')?.clipOffsetMs).toBe(0);
    expect(restoredMarkers.find((marker) => marker.id === 'not-a-number')?.clipOffsetMs).toBeUndefined();
  });

  it('applies the shared 20k marker capacity and finite 12-hour time bound during restore', () => {
    const editorTimelineMarkers = Array.from({ length: MAX_TIMELINE_MARKERS + 1 }, (_, index) => ({
      id: `marker-${index}`,
      seconds: index === 0 ? MAX_TIMELINE_MARKER_SECONDS + 1 : index / 1_000,
      label: `Marker ${index}`,
      color: '#22d3ee',
    }));
    const project = projectWith({
      flow: {
        version: 3,
        nodes: [{ id: 'composition-1', type: 'composition', position: { x: 0, y: 0 }, data: { editorTimelineMarkers } }],
        edges: [],
      },
    });
    const restoredMarkers = project.flow.nodes[0].data.editorTimelineMarkers ?? [];

    expect(restoredMarkers).toHaveLength(MAX_TIMELINE_MARKERS);
    expect(restoredMarkers.find((marker) => marker.id === 'marker-0')?.seconds).toBe(MAX_TIMELINE_MARKER_SECONDS);
    expect(restoredMarkers.some((marker) => marker.id === `marker-${MAX_TIMELINE_MARKERS}`)).toBe(false);

    const malformed = projectWith({
      flow: {
        version: 3,
        nodes: [{ id: 'composition-2', type: 'composition', position: { x: 0, y: 0 }, data: {
          editorTimelineMarkers: [
            { id: 'negative', seconds: -2, label: 'Clamp', color: '#22d3ee' },
            { id: 'non-finite', seconds: Number.POSITIVE_INFINITY, label: 'Drop', color: '#22d3ee' },
          ],
        } }],
        edges: [],
      },
    });
    expect(malformed.flow.nodes[0].data.editorTimelineMarkers?.map((marker) => [marker.id, marker.seconds])).toEqual([
      ['negative', 0],
    ]);
  });

  it('normalizes object-shaped resultHistory so usage rollups cannot crash', () => {
    const project = projectWith({
      flow: {
        version: 3,
        nodes: [{ id: 'image-1', type: 'imageGen', position: { x: 1, y: 2 }, data: { resultHistory: { bad: true } } }],
        edges: [],
      },
    });

    expect(project.flow.nodes[0].data.resultHistory).toEqual([]);
  });

  it('restores a selected Vision Verify Boolean result from history without string coercion', () => {
    const project = projectWith({
      flow: {
        version: 3,
        nodes: [{
          id: 'verify',
          type: 'visionVerifyNode',
          position: { x: 1, y: 2 },
          data: {
            selectedResultId: 'failed',
            resultHistory: [
              { id: 'failed', result: false, resultType: 'boolean', statusMessage: 'Verified: FALSE', createdAt: '2026-07-16T00:00:00.000Z' },
              { id: 'passed', result: true, resultType: 'boolean', statusMessage: 'Verified: TRUE', createdAt: '2026-07-16T00:01:00.000Z' },
            ],
          },
        }],
        edges: [],
      },
    });

    expect(project.flow.nodes[0].data).toMatchObject({ result: false, resultType: 'boolean', selectedResultId: 'failed' });
    expect(project.flow.nodes[0].data.resultHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'failed', result: false, resultType: 'boolean' }),
      expect.objectContaining({ id: 'passed', result: true, resultType: 'boolean' }),
    ]));
  });

  it.each([
    ['near-limit string', { note: 'x'.repeat(16 * 1024) }, true],
    ['over-limit string', { note: 'x'.repeat(16 * 1024 + 1) }, false],
    ['wide object', { ...Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`key-${index}`, index])) }, false],
    ['near-limit array', { values: Array.from({ length: 256 }, (_, index) => index) }, true],
    ['over-limit array', { values: Array.from({ length: 257 }, (_, index) => index) }, false],
    ['oversized key', { ['k'.repeat(513)]: true }, false],
    ['aggregate UTF-8 overflow', Object.fromEntries(Array.from({ length: 64 }, (_, index) => [`entry-${index}`, 'x'.repeat(16 * 1024)])), false],
    ['node-count overflow', { values: Array.from({ length: 256 }, () => [0, 0, 0, 0]) }, false],
  ])('keeps attempts but drops unsafe output metadata: %s', (_description, outputMetadata, preserved) => {
    const project = projectWith({
      flow: {
        version: 3,
        nodes: [{
          id: 'image-1', type: 'imageGen', position: { x: 1, y: 2 }, data: {
            selectedResultId: 'safe-result',
            resultHistory: [{
              id: 'safe-result', result: 'data:image/png;base64,SAFE', resultType: 'image', statusMessage: 'Generated',
              createdAt: '2026-07-16T00:00:00.000Z', outputMetadata,
            }],
          },
        }],
        edges: [],
      },
    });

    const attempt = project.flow.nodes[0].data.resultHistory?.[0];
    expect(attempt).toMatchObject({ id: 'safe-result', result: 'data:image/png;base64,SAFE', resultType: 'image' });
    expect(attempt?.outputMetadata === undefined).toBe(!preserved);
    expect(project.flow.nodes[0].data).toMatchObject({
      selectedResultId: 'safe-result', result: 'data:image/png;base64,SAFE', resultType: 'image',
    });
  });

  it('drops cyclic and custom-prototype metadata without dropping the renderer attempt', () => {
    const cyclic: Record<string, unknown> = { note: 'cycle' };
    cyclic.self = cyclic;
    class UntrustedMetadata { note = 'custom prototype'; }

    for (const outputMetadata of [cyclic, new UntrustedMetadata()]) {
      const project = projectWith({
        flow: {
          version: 3,
          nodes: [{
            id: 'image-1', type: 'imageGen', position: { x: 1, y: 2 }, data: {
              resultHistory: [{
                id: 'result', result: 'data:image/png;base64,SAFE', resultType: 'image', statusMessage: 'Generated',
                createdAt: '2026-07-16T00:00:00.000Z', outputMetadata,
              }],
            },
          }],
          edges: [],
        },
      });
      expect(project.flow.nodes[0].data.resultHistory?.[0]).toMatchObject({ id: 'result', outputMetadata: undefined });
    }
  });

  it.each([
    ['prototype keys from JSON', JSON.parse('{"safe":"value","__proto__":{"polluted":true}}')],
    ['nested constructor key', { safe: { constructor: { polluted: true } } }],
    ['nested prototype key', { safe: { prototype: { polluted: true } } }],
    ['enumerable throwing getter', (() => {
      const value: Record<string, unknown> = { safe: 'value' };
      Object.defineProperty(value, 'boom', { enumerable: true, get: () => { throw new Error('getter must not run'); } });
      return value;
    })()],
    ['throwing Proxy', new Proxy({ safe: 'value' }, { ownKeys: () => { throw new Error('proxy must not run'); } })],
  ])('fails closed for hostile metadata (%s) without losing its selected Boolean attempt', (_description, outputMetadata) => {
    const project = projectWith({
      flow: {
        version: 3,
        nodes: [{
          id: 'function', type: 'functionNode', position: { x: 1, y: 2 }, data: {
            selectedResultId: 'false-result',
            resultHistory: [{
              id: 'false-result', result: false, resultType: 'boolean', statusMessage: 'Completed',
              createdAt: '2026-07-16T00:00:00.000Z', mimeType: 'application/json', extension: 'json', fileName: 'decision.json',
              outputMetadata, variableName: 'is_safe', sourceBinItemId: 'boolean-source',
            }],
          },
        }],
        edges: [],
      },
    });

    const data = project.flow.nodes[0].data;
    expect(data).toMatchObject({
      selectedResultId: 'false-result', result: false, resultType: 'boolean', resultMimeType: 'application/json',
      resultExtension: 'json', resultFileName: 'decision.json',
    });
    expect(data.resultHistory?.[0]).toMatchObject({
      result: false, variableName: 'is_safe', sourceBinItemId: 'boolean-source', outputMetadata: undefined,
    });
  });

  it('retains valid null-prototype output metadata as own data without prototype pollution', () => {
    const metadata = Object.create(null) as Record<string, unknown>;
    metadata.safe = { mime: 'image/png', dimensions: [1024, 768] };
    const project = projectWith({
      flow: { version: 3, nodes: [{
        id: 'image', type: 'imageGen', position: { x: 1, y: 2 }, data: {
          result: 'data:image/png;base64,SAFE', resultType: 'image', resultOutputMetadata: metadata,
        },
      }], edges: [] },
    });

    const restored = project.flow.nodes[0].data.resultOutputMetadata as Record<string, unknown>;
    expect(restored).toEqual({ safe: { mime: 'image/png', dimensions: [1024, 768] } });
    expect(Object.getPrototypeOf(restored)).toBeNull();
    expect(Object.hasOwn(restored, '__proto__')).toBe(false);
  });

  it('drops over-depth nested metadata deterministically', () => {
    let outputMetadata: unknown = 'leaf';
    for (let index = 0; index < 14; index += 1) outputMetadata = { nested: outputMetadata };
    const project = projectWith({
      flow: {
        version: 3,
        nodes: [{
          id: 'image-1', type: 'imageGen', position: { x: 1, y: 2 }, data: {
            resultHistory: [{ id: 'result', result: 'data:image/png;base64,SAFE', resultType: 'image', statusMessage: 'Generated', createdAt: '2026-07-16T00:00:00.000Z', outputMetadata }],
          },
        }],
        edges: [],
      },
    });
    expect(project.flow.nodes[0].data.resultHistory?.[0]?.outputMetadata).toBeUndefined();
  });

  it('migrates legacy Vision Verify current and text-tagged history values, including a selected false attempt', () => {
    const project = projectWith({
      flow: {
        version: 3,
        nodes: [{
          id: 'verify',
          type: 'visionVerifyNode',
          position: { x: 1, y: 2 },
          data: {
            result: 'true',
            resultType: 'text',
            selectedResultId: 'false-attempt',
            resultHistory: [
              { id: 'true-attempt', result: 'true', resultType: 'text', statusMessage: 'TRUE', createdAt: '2026-07-16T00:00:00.000Z' },
              { id: 'false-attempt', result: 'false', resultType: 'text', statusMessage: 'FALSE', createdAt: '2026-07-16T00:01:00.000Z' },
            ],
          },
        }],
        edges: [],
      },
    });

    expect(project.flow.nodes[0].data).toMatchObject({ result: false, resultType: 'boolean', selectedResultId: 'false-attempt' });
    expect(project.flow.nodes[0].data.resultHistory).toEqual([
      expect.objectContaining({ id: 'true-attempt', result: true, resultType: 'boolean' }),
      expect.objectContaining({ id: 'false-attempt', result: false, resultType: 'boolean' }),
    ]);
  });

  it('does not reinterpret non-Vision text that happens to spell true', () => {
    const project = projectWith({
      flow: {
        version: 3,
        nodes: [{
          id: 'text', type: 'textNode', position: { x: 1, y: 2 },
          data: { result: 'true', resultType: 'text', resultHistory: [{ id: 'literal', result: 'true', resultType: 'text', statusMessage: 'Literal', createdAt: '2026-07-16T00:00:00.000Z' }] },
        }],
        edges: [],
      },
    });

    expect(project.flow.nodes[0].data).toMatchObject({ result: 'true', resultType: 'text' });
    expect(project.flow.nodes[0].data.resultHistory?.[0]).toMatchObject({ result: 'true', resultType: 'text' });
  });

  it.each([
    ['true', true],
    ['false', false],
  ])('restores exact legacy Boolean scalars for generic Function results without history: %s', (legacyResult, expected) => {
    const project = projectWith({
      flow: {
        version: 3,
        nodes: [{
          id: 'function', type: 'functionNode', position: { x: 1, y: 2 },
          data: { result: legacyResult, resultType: 'boolean' },
        }],
        edges: [],
      },
    });

    expect(project.flow.nodes[0].data).toMatchObject({ result: expected, resultType: 'boolean' });
  });

  it('restores a selected exact legacy Function Boolean attempt without losing literal false', () => {
    const project = projectWith({
      flow: {
        version: 3,
        nodes: [{
          id: 'function', type: 'functionNode', position: { x: 1, y: 2 },
          data: {
            selectedResultId: 'false-attempt',
            resultHistory: [{
              id: 'false-attempt', result: 'false', resultType: 'boolean', statusMessage: 'Completed',
              createdAt: '2026-07-16T00:00:00.000Z',
            }],
          },
        }],
        edges: [],
      },
    });

    expect(project.flow.nodes[0].data).toMatchObject({
      selectedResultId: 'false-attempt', result: false, resultType: 'boolean',
    });
    expect(project.flow.nodes[0].data.resultHistory?.[0]).toMatchObject({ result: false, resultType: 'boolean' });
  });

  it.each(['TRUE', ' false', 'false ', '0', 'yes', '', 0, null])(
    'rejects ambiguous generic Boolean scalars without reopening them through truthiness: %s',
    (legacyResult) => {
      const project = projectWith({
        flow: {
          version: 3,
          nodes: [{
            id: 'function', type: 'functionNode', position: { x: 1, y: 2 },
            data: { result: legacyResult, resultType: 'boolean' },
          }],
          edges: [],
        },
      });

      expect(project.flow.nodes[0].data).not.toHaveProperty('result');
      expect(project.flow.nodes[0].data).not.toHaveProperty('resultType');
    },
  );

  it('repairs null node position and null node data', () => {
    const project = projectWith({
      flow: {
        version: 3,
        nodes: [{ id: 'text-1', type: 'textNode', position: null, data: null }],
        edges: [],
      },
    });

    expect(project.flow.nodes[0].position).toEqual({ x: 0, y: 0 });
    expect(project.flow.nodes[0].data).toEqual({
      error: undefined,
      isRunning: undefined,
      statusMessage: undefined,
    });
  });

  it('drops unknown node types and edges attached to invalid nodes', () => {
    const project = projectWith({
      flow: {
        version: 3,
        nodes: [
          { id: 'good', type: 'textNode', position: { x: 0, y: 0 }, data: {} },
          { id: 'unknown', type: 'mysteryNode', position: { x: 10, y: 10 }, data: {} },
        ],
        edges: [
          { id: 'valid', source: 'good', target: 'good' },
          { id: 'bad-source', source: 'unknown', target: 'good' },
          { id: 'bad-target', source: 'good', target: 'missing' },
        ],
      },
    });

    expect(project.flow.nodes.map((node) => node.id)).toEqual(['good']);
    expect(project.flow.edges.map((edge) => edge.id)).toEqual(['valid']);
  });

  it('preserves reusable function and group nodes during project restore', () => {
    const project = projectWith({
      flow: {
        version: 3,
        nodes: [
          { id: 'group-1', type: 'groupNode', position: { x: 0, y: 0 }, data: {} },
          { id: 'function-1', type: 'functionNode', position: { x: 10, y: 10 }, data: {} },
        ],
        edges: [{ id: 'edge-1', source: 'function-1', target: 'group-1' }],
      },
    });

    expect(project.flow.nodes.map((node) => node.type)).toEqual(['groupNode', 'functionNode']);
    expect(project.flow.edges.map((edge) => edge.id)).toEqual(['edge-1']);
  });

  it('sanitizes malformed source-bin bins and items', () => {
    const project = projectWith({
      sourceBin: {
        dismissedSourceKeys: ['seen', null],
        bins: [
          null,
          {
            id: 'bin-1',
            name: 'Media',
            items: [
              null,
              { id: 'bad-kind', kind: 'weird', label: 'Bad', assetUrl: 'data:image/png;base64,AAA' },
              { id: 'missing-asset', kind: 'image', label: 'Missing' },
              { id: 'text-1', kind: 'text', label: 'Notes', text: 'hello' },
              { id: 'image-1', kind: 'image', label: 'Image', assetUrl: 'data:image/png;base64,AAA', isGenerated: true, envelopeCollapsed: true },
            ],
          },
        ],
      },
    });

    expect(project.sourceBin?.dismissedSourceKeys).toEqual(['seen']);
    expect(project.sourceBin?.bins).toHaveLength(1);
    expect(project.sourceBin?.bins?.[0].items.map((item) => item.id)).toEqual(['text-1', 'image-1']);
    expect(project.sourceBin?.bins?.[0].items[1]).toMatchObject({
      isGenerated: true,
      envelopeCollapsed: true,
    });
  });

  it('round-trips Image canvas view rotation through project restore sanitization', () => {
    const project = projectWith({
      imageEditor: {
        activeDocId: 'doc-rot',
        documents: [
          {
            id: 'doc-rot',
            title: 'Rotated view',
            width: 320,
            height: 240,
            layers: [],
            activeLayerId: null,
            hasSelection: false,
            selectionVersion: 0,
            viewport: { zoom: 1.5, panX: 12, panY: -8, rotationDeg: -90 },
            dirty: false,
          },
          {
            id: 'doc-upright',
            title: 'Upright view',
            width: 100,
            height: 100,
            layers: [],
            activeLayerId: null,
            hasSelection: false,
            selectionVersion: 0,
            viewport: { zoom: 2, panX: 0, panY: 0, rotationDeg: 0 },
            dirty: false,
          },
          {
            id: 'doc-bad-rotation',
            title: 'Corrupt rotation',
            width: 100,
            height: 100,
            layers: [],
            activeLayerId: null,
            hasSelection: false,
            selectionVersion: 0,
            viewport: { zoom: 1, panX: 0, panY: 0, rotationDeg: 'sideways' },
            dirty: false,
          },
        ],
      },
    });

    expect(project.imageEditor?.documents[0].viewport).toEqual({ zoom: 1.5, panX: 12, panY: -8, rotationDeg: -90 });
    expect(project.imageEditor?.documents[1].viewport).toEqual({ zoom: 2, panX: 0, panY: 0 });
    expect(project.imageEditor?.documents[2].viewport).toEqual({ zoom: 1, panX: 0, panY: 0 });
  });

  it('preserves Image layer color labels during project restore sanitization', () => {
    const project = projectWith({
      imageEditor: {
        activeDocId: 'doc-1',
        documents: [
          {
            id: 'doc-1',
            title: 'Layer labels',
            width: 320,
            height: 240,
            layers: [
              {
                id: 'layer-1',
                name: 'Character ink',
                type: 'image',
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: 'normal',
                x: 0,
                y: 0,
                bitmapVersion: 0,
                colorLabel: 'red',
              },
            ],
            activeLayerId: 'layer-1',
            hasSelection: false,
            selectionVersion: 0,
            viewport: { zoom: 1, panX: 0, panY: 0 },
            dirty: true,
          },
        ],
      },
    });

    expect(project.imageEditor?.documents[0].layers[0].colorLabel).toBe('red');
  });

  it('preserves Image layer clipping-mask flags during project restore sanitization', () => {
    const project = projectWith({
      imageEditor: {
        activeDocId: 'doc-1',
        documents: [
          {
            id: 'doc-1',
            title: 'Clipping stack',
            width: 320,
            height: 240,
            layers: [
              {
                id: 'base',
                name: 'Base shape',
                type: 'image',
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: 'normal',
                x: 0,
                y: 0,
                bitmapVersion: 0,
              },
              {
                id: 'shade',
                name: 'Clipped shading',
                type: 'image',
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: 'normal',
                x: 0,
                y: 0,
                bitmapVersion: 0,
                clippingMask: true,
              },
            ],
            activeLayerId: 'shade',
            hasSelection: false,
            selectionVersion: 0,
            viewport: { zoom: 1, panX: 0, panY: 0 },
            dirty: false,
          },
        ],
      },
    });

    expect(project.imageEditor?.documents[0].layers[1].clippingMask).toBe(true);
  });

  it('preserves and clamps Image layer mask density and feather during project restore sanitization', () => {
    const project = projectWith({
      imageEditor: {
        activeDocId: 'doc-1',
        documents: [
          {
            id: 'doc-1',
            title: 'Mask tuning',
            width: 320,
            height: 240,
            layers: [
              {
                id: 'valid-mask',
                name: 'Valid mask layer',
                type: 'image',
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: 'normal',
                x: 0,
                y: 0,
                bitmapVersion: 0,
                maskDensity: 0.35,
                maskFeather: 12,
              },
              {
                id: 'invalid-mask',
                name: 'Invalid mask layer',
                type: 'image',
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: 'normal',
                x: 0,
                y: 0,
                bitmapVersion: 0,
                maskDensity: -3,
                maskFeather: 'oops',
              },
            ],
            activeLayerId: 'valid-mask',
            hasSelection: false,
            selectionVersion: 0,
            viewport: { zoom: 1, panX: 0, panY: 0 },
            dirty: false,
          },
        ],
      },
    });

    expect(project.imageEditor?.documents[0].layers[0]).toMatchObject({
      maskDensity: 0.35,
      maskFeather: 12,
    });
    expect(project.imageEditor?.documents[0].layers[1]).toMatchObject({
      maskDensity: 0,
      maskFeather: 0,
    });
  });

  it('preserves and clamps Image layer skew, perspective, warp, and distort transform state during project restore sanitization', () => {
    const project = projectWith({
      imageEditor: {
        activeDocId: 'doc-1',
        documents: [
          {
            id: 'doc-1',
            title: 'Layer transform restore',
            width: 320,
            height: 240,
            layers: [
              {
                id: 'valid-transform',
                name: 'Valid transform layer',
                type: 'image',
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: 'normal',
                x: 0,
                y: 0,
                bitmapVersion: 0,
                skewXDeg: 18.25,
                skewYDeg: -12.5,
                perspectiveX: 0.25,
                perspectiveY: -0.125,
                warp: {
                  top: 0.25,
                  right: -0.5,
                  bottom: 0.1,
                  left: 0,
                },
                cornerOffsets: {
                  nw: { x: -4, y: -2 },
                  ne: { x: 8, y: -1 },
                  se: { x: 12, y: 5 },
                  sw: { x: -6, y: 4 },
                },
              },
              {
                id: 'invalid-transform',
                name: 'Invalid transform layer',
                type: 'image',
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: 'normal',
                x: 0,
                y: 0,
                bitmapVersion: 0,
                skewXDeg: 500,
                skewYDeg: 'oops',
                perspectiveX: 2,
                perspectiveY: 'bad',
                warp: {
                  top: 4,
                  right: 'oops',
                  bottom: -3,
                  left: Infinity,
                },
                cornerOffsets: {
                  nw: { x: 'bad', y: undefined },
                  ne: { x: Infinity, y: 1 },
                  se: { x: 2, y: NaN },
                  sw: null,
                },
              },
            ],
            activeLayerId: 'valid-transform',
            hasSelection: false,
            selectionVersion: 0,
            viewport: { zoom: 1, panX: 0, panY: 0 },
            dirty: false,
          },
        ],
      },
    });

    expect(project.imageEditor?.documents[0].layers[0]).toMatchObject({
      skewXDeg: 18.25,
      skewYDeg: -12.5,
      perspectiveX: 0.25,
      perspectiveY: -0.125,
      warp: {
        top: 0.25,
        right: -0.5,
        bottom: 0.1,
        left: 0,
      },
      cornerOffsets: {
        nw: { x: -4, y: -2 },
        ne: { x: 8, y: -1 },
        se: { x: 12, y: 5 },
        sw: { x: -6, y: 4 },
      },
    });
    expect(project.imageEditor?.documents[0].layers[1]).toMatchObject({
      skewXDeg: 75,
      skewYDeg: 0,
      perspectiveX: 0.95,
      perspectiveY: 0,
      warp: {
        top: 1,
        right: 0,
        bottom: -1,
        left: 0,
      },
      cornerOffsets: {
        nw: { x: 0, y: 0 },
        ne: { x: 0, y: 1 },
        se: { x: 2, y: 0 },
        sw: { x: 0, y: 0 },
      },
    });
  });

  it('sanitizes Image layer lock variants during project restore', () => {
    const project = projectWith({
      imageEditor: {
        activeDocId: 'doc-1',
        documents: [
          {
            id: 'doc-1',
            title: 'Layer lock variants',
            width: 320,
            height: 240,
            layers: [
              {
                id: 'paint',
                name: 'Paint layer',
                type: 'image',
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: 'normal',
                x: 0,
                y: 0,
                bitmapVersion: 0,
                locks: {
                  pixels: true,
                  position: 'yes',
                },
              },
              {
                id: 'move',
                name: 'Move layer',
                type: 'image',
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: 'normal',
                x: 0,
                y: 0,
                bitmapVersion: 0,
                locks: {
                  pixels: false,
                  position: true,
                },
              },
            ],
            activeLayerId: 'paint',
            hasSelection: false,
            selectionVersion: 0,
            viewport: { zoom: 1, panX: 0, panY: 0 },
            dirty: false,
          },
        ],
      },
    });

    expect(project.imageEditor?.documents[0].layers[0].locks).toEqual({ pixels: true });
    expect(project.imageEditor?.documents[0].layers[1].locks).toEqual({ position: true });
  });

  it('preserves valid Image layer groups and removes invalid group memberships during restore', () => {
    const project = projectWith({
      imageEditor: {
        activeDocId: 'doc-1',
        documents: [
          {
            id: 'doc-1',
            title: 'Layer groups',
            width: 320,
            height: 240,
            layers: [
              {
                id: 'paint',
                name: 'Paint layer',
                type: 'image',
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: 'normal',
                x: 0,
                y: 0,
                bitmapVersion: 0,
                groupId: 'group-1',
              },
              {
                id: 'bad-child',
                name: 'Bad child',
                type: 'image',
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: 'normal',
                x: 0,
                y: 0,
                bitmapVersion: 0,
                groupId: 'missing-group',
              },
              {
                id: 'group-1',
                name: 'Paint folder',
                type: 'group',
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: 'normal',
                x: 12,
                y: 18,
                bitmapVersion: 0,
                groupExpanded: false,
                bitmap: 'bad-runtime-data',
                mask: 'bad-mask',
              },
            ],
            activeLayerId: 'paint',
            hasSelection: false,
            selectionVersion: 0,
            viewport: { zoom: 1, panX: 0, panY: 0 },
            dirty: false,
          },
        ],
      },
    });

    const layers = project.imageEditor?.documents[0].layers;
    expect(layers?.map((layer) => [layer.id, layer.type, layer.groupId])).toEqual([
      ['paint', 'image', 'group-1'],
      ['bad-child', 'image', undefined],
      ['group-1', 'group', undefined],
    ]);
    expect(layers?.[2]).toMatchObject({
      groupExpanded: false,
      bitmap: null,
      mask: null,
      x: 0,
      y: 0,
    });
  });

  it('preserves Image linked-layer movement groups only when at least two layers share the group', () => {
    const project = projectWith({
      imageEditor: {
        activeDocId: 'doc-1',
        documents: [
          {
            id: 'doc-1',
            title: 'Layer links',
            width: 320,
            height: 240,
            layers: [
              {
                id: 'base',
                name: 'Base',
                type: 'image',
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: 'normal',
                x: 0,
                y: 0,
                bitmapVersion: 0,
                linkGroupId: 'link-a',
              },
              {
                id: 'paint',
                name: 'Paint',
                type: 'image',
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: 'normal',
                x: 0,
                y: 0,
                bitmapVersion: 0,
                linkGroupId: 'link-a',
              },
              {
                id: 'orphan',
                name: 'Orphan',
                type: 'image',
                visible: true,
                locked: false,
                opacity: 1,
                blendMode: 'normal',
                x: 0,
                y: 0,
                bitmapVersion: 0,
                linkGroupId: 'link-orphan',
              },
            ],
            activeLayerId: 'paint',
            hasSelection: false,
            selectionVersion: 0,
            viewport: { zoom: 1, panX: 0, panY: 0 },
            dirty: false,
          },
        ],
      },
    });

    expect(project.imageEditor?.documents[0].layers.map((layer) => [layer.id, layer.linkGroupId])).toEqual([
      ['base', 'link-a'],
      ['paint', 'link-a'],
      ['orphan', undefined],
    ]);
  });

  it('restores the active node result from the selected saved history attempt', () => {
    const project = projectWith({
      flow: {
        version: 3,
        nodes: [{
          id: 'image-1',
          type: 'imageGen',
          position: { x: 1, y: 2 },
          data: {
            selectedResultId: 'attempt-1',
            resultHistory: [
              { id: 'attempt-1', result: 'data:image/png;base64,ONE', resultType: 'image', statusMessage: 'First', createdAt: '2026-01-01T00:00:00.000Z' },
              { id: 'attempt-2', result: 'data:image/png;base64,TWO', resultType: 'image', statusMessage: 'Second', createdAt: '2026-01-02T00:00:00.000Z' },
            ],
          },
        }],
        edges: [],
      },
    });

    expect(project.flow.nodes[0].data).toMatchObject({
      selectedResultId: 'attempt-1',
      result: 'data:image/png;base64,ONE',
      resultType: 'image',
    });
  });

  it('repairs duplicate envelope indexes during project restore sanitization', () => {
    const project = projectWith({
      flow: {
        version: 3,
        nodes: [{
          id: 'envelope-1',
          type: 'envelope',
          position: { x: 1, y: 2 },
          data: {
            envelopeItems: [
              { id: 'a', index: 0, kind: 'image', label: 'A', value: 'signal-loom-asset://file/a' },
              { id: 'b', index: 0, kind: 'image', label: 'B', value: 'signal-loom-asset://file/b' },
              { id: 'c', index: 0, kind: 'image', label: 'C', value: 'signal-loom-asset://file/c' },
            ],
          },
        }],
        edges: [],
      },
    });

    expect(project.flow.nodes[0].data.envelopeItems?.map((item) => item.index)).toEqual([0, 1, 2]);
  });

  it('hydrates missing node result history from source-bin media saved with the originating node', () => {
    const project = projectWith({
      flow: {
        version: 3,
        nodes: [{ id: 'image-1', type: 'imageGen', position: { x: 1, y: 2 }, data: {} }],
        edges: [],
      },
      sourceBin: {
        bins: [{
          id: 'bin-1',
          name: 'Generated',
          items: [
            { id: 'run-1', kind: 'image', label: 'Run 1', assetUrl: 'data:image/png;base64,ONE', originNodeId: 'image-1', createdAt: 10 },
            { id: 'run-2', kind: 'image', label: 'Run 2', assetUrl: 'data:image/png;base64,TWO', originNodeId: 'image-1', createdAt: 20 },
          ],
        }],
      },
    });

    expect(project.flow.nodes[0].data.resultHistory).toEqual([
      expect.objectContaining({ id: 'source-run-1', result: 'data:image/png;base64,ONE', resultType: 'image' }),
      expect.objectContaining({ id: 'source-run-2', result: 'data:image/png;base64,TWO', resultType: 'image' }),
    ]);
    expect(project.flow.nodes[0].data).toMatchObject({
      selectedResultId: 'source-run-2',
      result: 'data:image/png;base64,TWO',
      resultType: 'image',
    });
  });

  it('hydrates only compatible media results and preserves selected Vision false through colliding Source items', () => {
    const project = projectWith({
      flow: {
        version: 3,
        nodes: [
          {
            id: 'verify', type: 'visionVerifyNode', position: { x: 0, y: 0 }, data: {
              selectedResultId: 'false-result',
              resultHistory: [{ id: 'false-result', result: false, resultType: 'boolean', statusMessage: 'Verified: FALSE', createdAt: '2026-07-16T00:00:00.000Z', sourceBinItemId: 'stale-link' }],
            },
          },
          { id: 'image', type: 'imageGen', position: { x: 1, y: 0 }, data: {} },
          { id: 'video', type: 'videoGen', position: { x: 2, y: 0 }, data: {} },
          { id: 'text', type: 'textNode', position: { x: 3, y: 0 }, data: {} },
        ],
        edges: [],
      },
      sourceBin: {
        items: [
          { id: 'verify-text', kind: 'text', label: 'False as text', text: 'false', originNodeId: 'verify', createdAt: 1 },
          { id: 'image-result', kind: 'image', label: 'Image', assetUrl: 'data:image/png;base64,IMAGE', originNodeId: 'image', createdAt: 2 },
          { id: 'video-result', kind: 'composition', label: 'Video', assetUrl: 'data:video/mp4;base64,VIDEO', originNodeId: 'video', createdAt: 3 },
          { id: 'text-result', kind: 'text', label: 'Text', text: 'must not hydrate', originNodeId: 'text', createdAt: 4 },
        ],
      },
    });

    const byId = new Map(project.flow.nodes.map((node) => [node.id, node.data]));
    expect(byId.get('verify')).toMatchObject({ selectedResultId: 'false-result', result: false, resultType: 'boolean' });
    expect(byId.get('verify')?.resultHistory).toEqual([expect.objectContaining({ id: 'false-result', result: false, sourceBinItemId: 'stale-link' })]);
    expect(byId.get('image')).toMatchObject({ result: 'data:image/png;base64,IMAGE', resultType: 'image' });
    expect(byId.get('video')).toMatchObject({ result: 'data:video/mp4;base64,VIDEO', resultType: 'video' });
    expect(byId.get('text')?.resultHistory).toBeUndefined();
  });

  it('reconstructs envelope items from source-bin batch entries on .sloom open', () => {
    const project = projectWith({
      flow: {
        version: 3,
        nodes: [{ id: 'batch-1', type: 'imageGen', position: { x: 1, y: 2 }, data: {} }],
        edges: [],
      },
      sourceBin: {
        items: [
          {
            id: 'batch-a',
            kind: 'image',
            label: 'Batch A',
            assetUrl: 'data:image/png;base64,A',
            originNodeId: 'batch-1',
            envelopeId: 'env-1',
            envelopeLabel: 'Batch images',
            envelopeIndex: 0,
            createdAt: 10,
          },
          {
            id: 'batch-b',
            kind: 'image',
            label: 'Batch B',
            assetUrl: 'data:image/png;base64,B',
            originNodeId: 'batch-1',
            envelopeId: 'env-1',
            envelopeLabel: 'Batch images',
            envelopeIndex: 1,
            createdAt: 20,
          },
        ],
      },
    });

    expect(project.flow.nodes[0].data.envelopeItems).toEqual([
      expect.objectContaining({ id: 'batch-a', index: 0, kind: 'image', label: 'Batch A', value: 'data:image/png;base64,A', sourceNodeId: 'batch-1' }),
      expect.objectContaining({ id: 'batch-b', index: 1, kind: 'image', label: 'Batch B', value: 'data:image/png;base64,B', sourceNodeId: 'batch-1' }),
    ]);
  });

  it('reconstructs batch entries whose source-bin origin ids include envelope item indexes', () => {
    const project = projectWith({
      flow: {
        version: 3,
        nodes: [{ id: 'batch-1', type: 'imageGen', position: { x: 1, y: 2 }, data: {} }],
        edges: [],
      },
      sourceBin: {
        items: [
          {
            id: 'batch-a',
            kind: 'image',
            label: 'Batch A',
            assetUrl: 'data:image/png;base64,A',
            originNodeId: 'batch-1:0',
            envelopeId: 'batch-1',
            envelopeLabel: 'Batch images',
            envelopeIndex: 0,
            createdAt: 10,
          },
          {
            id: 'batch-b',
            kind: 'image',
            label: 'Batch B',
            assetUrl: 'data:image/png;base64,B',
            originNodeId: 'batch-1:1',
            envelopeId: 'batch-1',
            envelopeLabel: 'Batch images',
            envelopeIndex: 1,
            createdAt: 20,
          },
        ],
      },
    });

    expect(project.flow.nodes[0].data.resultHistory).toEqual([
      expect.objectContaining({ id: 'source-batch-a', result: 'data:image/png;base64,A', resultType: 'image' }),
      expect.objectContaining({ id: 'source-batch-b', result: 'data:image/png;base64,B', resultType: 'image' }),
    ]);
    expect(project.flow.nodes[0].data.envelopeItems).toEqual([
      expect.objectContaining({ id: 'batch-a', index: 0, kind: 'image', label: 'Batch A', value: 'data:image/png;base64,A', sourceNodeId: 'batch-1:0' }),
      expect.objectContaining({ id: 'batch-b', index: 1, kind: 'image', label: 'Batch B', value: 'data:image/png;base64,B', sourceNodeId: 'batch-1:1' }),
    ]);
  });

  it('preserves Image editor vector/source metadata and snapshots while dropping runtime pixels', () => {
    const project = projectWith({
      imageEditor: {
        activeDocId: 'doc-image',
        documents: [{
          id: 'doc-image',
          title: 'Storyboard plate',
          width: 800,
          height: 600,
          sourceBinItemId: 'source-panel',
          metadata: { sourceFormat: 'SVG' },
          layers: [{
            id: 'vector-layer',
            name: 'Editable SFX',
            type: 'vector',
            visible: true,
            locked: false,
            opacity: 0.75,
            blendMode: 'screen',
            x: 12,
            y: 34,
            bitmap: { unsafe: 'runtime canvas should not survive JSON restore' },
            mask: { unsafe: 'runtime mask should not survive JSON restore' },
            bitmapVersion: 9,
            metadata: {
              originalSvgSource: '<svg><text>Bang</text></svg>',
              smartLinkedSourceId: 'source-panel',
              sourceLink: {
                id: 'source-panel',
                label: 'Panel.svg',
                width: 800,
                height: 600,
                status: 'linked',
                relinkHistory: [{ sourceId: 'old-panel', label: 'Old.svg', at: 5 }],
              },
            },
            vectorRecipe: '<svg><text>Bang</text></svg>',
          }],
          activeLayerId: 'vector-layer',
          hasSelection: true,
          selectionVersion: 3,
          savedSelectionChannels: [
            {
              id: 'alpha-1',
              name: 'Saved outline',
              width: 800,
              height: 600,
              dataBase64: 'AQIDBA==',
              createdAt: 11,
            },
            {
              id: 'broken-alpha',
              name: '',
              width: 0,
              height: -1,
              dataBase64: 12,
              createdAt: 'bad',
            },
          ],
          spotChannels: [
            {
              id: 'spot-1',
              name: 'Varnish',
              width: 800,
              height: 600,
              color: { r: 20, g: 120, b: 220 },
              opacity: 0.75,
              solidity: 0.5,
              visible: false,
              dataBase64: 'AQIDBA==',
              createdAt: 12,
              updatedAt: 13,
            },
            {
              id: 'broken-spot',
              name: '',
              width: 0,
              height: -1,
              color: { r: 300, g: 'bad', b: -10 },
              opacity: 2,
              solidity: -1,
              dataBase64: 12,
              createdAt: 'bad',
            },
          ],
          viewport: { zoom: 2, panX: 10, panY: 20 },
          dirty: true,
          snapshots: [{
            id: 'snap-1',
            name: 'Before lettering',
            createdAt: 10,
            updatedAt: 15,
            pixelState: 'complete',
            width: 800,
            height: 600,
            layers: [{
              id: 'vector-layer',
              name: 'Editable SFX',
              type: 'vector',
              visible: true,
              locked: false,
              opacity: 0.75,
              blendMode: 'screen',
              x: 12,
              y: 34,
              bitmap: { unsafe: true },
              mask: { unsafe: true },
              bitmapData: 'data:image/png;base64,SNAPSHOT_BITMAP',
              maskData: 'data:image/png;base64,SNAPSHOT_MASK',
              bitmapVersion: 9,
              metadata: { originalSvgSource: '<svg><text>Bang</text></svg>' },
              vectorRecipe: '<svg><text>Bang</text></svg>',
            }],
            activeLayerId: 'vector-layer',
            hasSelection: false,
            selectionVersion: 2,
            integrity: {
              version: 2,
              layers: [{
                layerId: 'vector-layer',
                bitmap: { present: true, width: 800, height: 600, contentDigest: `sha256:${'a'.repeat(64)}` },
                mask: { present: true, width: 800, height: 600, contentDigest: `sha256:${'b'.repeat(64)}` },
              }],
              selection: { present: false, width: 0, height: 0, byteLength: 0 },
            },
          }],
        }],
      },
    });

    const doc = project.imageEditor?.documents[0];
    expect(doc?.sourceBinItemId).toBe('source-panel');
    expect(doc?.metadata?.sourceFormat).toBe('SVG');
    expect((doc as unknown as {
      savedSelectionChannels?: Array<{ id: string; name: string; dataBase64: string }>;
    })?.savedSelectionChannels).toEqual([
      expect.objectContaining({
        id: 'alpha-1',
        name: 'Saved outline',
        dataBase64: 'AQIDBA==',
      }),
    ]);
    expect((doc as unknown as {
      spotChannels?: Array<{ id: string; name: string; dataBase64: string; opacity: number; solidity: number; visible: boolean }>;
    })?.spotChannels).toEqual([
      expect.objectContaining({
        id: 'spot-1',
        name: 'Varnish',
        dataBase64: 'AQIDBA==',
        opacity: 0.75,
        solidity: 0.5,
        visible: false,
      }),
    ]);
    expect(doc?.layers[0]).toMatchObject({
      id: 'vector-layer',
      type: 'vector',
      bitmap: null,
      mask: null,
      bitmapVersion: 9,
      metadata: {
        smartLinkedSourceId: 'source-panel',
        sourceLink: {
          id: 'source-panel',
          label: 'Panel.svg',
          status: 'linked',
          relinkHistory: [{ sourceId: 'old-panel', label: 'Old.svg', at: 5 }],
        },
      },
      vectorRecipe: '<svg><text>Bang</text></svg>',
    });
    expect(doc?.snapshots).toHaveLength(1);
    expect(doc?.snapshots?.[0]).toMatchObject({
      id: 'snap-1',
      name: 'Before lettering',
      updatedAt: 15,
      width: 800,
      height: 600,
      activeLayerId: 'vector-layer',
      pixelState: 'complete',
      layers: [{
        id: 'vector-layer',
        type: 'vector',
        bitmap: null,
        mask: null,
        bitmapData: 'data:image/png;base64,SNAPSHOT_BITMAP',
        maskData: 'data:image/png;base64,SNAPSHOT_MASK',
        vectorRecipe: '<svg><text>Bang</text></svg>',
      }],
    });
  });

  it('migrates legacy metadata-only Image snapshots to an explicit unavailable pixel state', () => {
    const project = projectWith({
      imageEditor: {
        activeDocId: 'legacy-image',
        documents: [{
          id: 'legacy-image',
          title: 'Legacy image',
          width: 1,
          height: 1,
          layers: [],
          activeLayerId: null,
          hasSelection: false,
          selectionVersion: 0,
          viewport: { zoom: 1, panX: 0, panY: 0 },
          dirty: false,
          snapshots: [{
            id: 'legacy-snapshot',
            name: 'Legacy metadata',
            createdAt: 1,
            width: 1,
            height: 1,
            layers: [],
            activeLayerId: null,
            hasSelection: false,
            selectionVersion: 0,
          }],
        }],
      },
    });

    expect(project.imageEditor?.documents[0].snapshots?.[0]?.pixelState).toBe('unavailable');
  });

  it('rejects malformed or missing current-format Image snapshot content digests', () => {
    const currentSnapshotProject = (contentDigest?: string) => projectWith({
      imageEditor: {
        activeDocId: 'digest-doc',
        documents: [{
          id: 'digest-doc', title: 'Digest', width: 1, height: 1,
          layers: [], activeLayerId: null, hasSelection: false, selectionVersion: 0,
          viewport: { zoom: 1, panX: 0, panY: 0 }, dirty: false,
          snapshots: [{
            id: 'digest-snapshot', name: 'Digest', createdAt: 1, width: 1, height: 1,
            layers: [{
              id: 'digest-layer', name: 'Digest layer', type: 'image', visible: true, locked: false,
              opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: null, mask: null,
              bitmapData: 'AAAA', bitmapVersion: 0,
            }],
            activeLayerId: 'digest-layer', hasSelection: false, selectionVersion: 0,
            pixelState: 'complete',
            integrity: {
              version: 2,
              layers: [{
                layerId: 'digest-layer',
                bitmap: { present: true, width: 1, height: 1, ...(contentDigest ? { contentDigest } : {}) },
                mask: { present: false, width: 0, height: 0 },
              }],
              selection: { present: false, width: 0, height: 0, byteLength: 0 },
            },
          }],
        }],
      },
    });

    expect(() => currentSnapshotProject('not-a-digest')).toThrow(/malformed cryptographic/i);
    expect(() => currentSnapshotProject()).toThrow(/malformed cryptographic/i);
  });

  it('requires a one-to-one current snapshot layer/proof identity match in project JSON', () => {
    const makeInput = () => ({
      imageEditor: {
        activeDocId: 'identity-doc',
        documents: [{
          id: 'identity-doc', title: 'Identity', width: 1, height: 1,
          layers: [], activeLayerId: null, hasSelection: false, selectionVersion: 0,
          viewport: { zoom: 1, panX: 0, panY: 0 }, dirty: false,
          snapshots: [{
            id: 'identity-snapshot', name: 'Identity', createdAt: 1, width: 1, height: 1,
            layers: ['layer-a', 'layer-b'].map((id) => ({
              id, name: id, type: 'image', visible: true, locked: false, opacity: 1,
              blendMode: 'normal', x: 0, y: 0, bitmap: null, mask: null,
              bitmapData: 'AAAA', bitmapVersion: 0,
            })),
            activeLayerId: 'layer-a', hasSelection: false, selectionVersion: 0,
            pixelState: 'complete',
            integrity: {
              version: 2,
              layers: ['layer-a', 'layer-b'].map((layerId, index) => ({
                layerId,
                bitmap: { present: true, width: 1, height: 1, contentDigest: `sha256:${String(index + 1).repeat(64)}` },
                mask: { present: false, width: 0, height: 0 },
              })),
              selection: { present: false, width: 0, height: 0, byteLength: 0 },
            },
          }],
        }],
      },
    });
    const mutateAndSanitize = (mutate: (namedSnapshot: Record<string, unknown>) => void) => {
      const input = makeInput();
      const namedSnapshot = input.imageEditor.documents[0].snapshots[0] as unknown as Record<string, unknown>;
      mutate(namedSnapshot);
      return projectWith(input);
    };

    expect(() => mutateAndSanitize((namedSnapshot) => {
      (namedSnapshot.layers as Array<{ id: string }>)[1].id = 'layer-a';
    })).toThrow(/identity|duplicate/i);
    expect(() => mutateAndSanitize((namedSnapshot) => {
      const integrity = namedSnapshot.integrity as { layers: Array<{ layerId: string }> };
      integrity.layers[1] = structuredClone(integrity.layers[0]);
    })).toThrow(/identity|duplicate/i);
    expect(() => mutateAndSanitize((namedSnapshot) => {
      (namedSnapshot.integrity as { layers: unknown[] }).layers.pop();
    })).toThrow(/identity|count|missing/i);
    expect(() => mutateAndSanitize((namedSnapshot) => {
      const layers = (namedSnapshot.integrity as { layers: Array<Record<string, unknown>> }).layers;
      layers.push({ ...structuredClone(layers[0]), layerId: 'unused-proof' });
    })).toThrow(/identity|count|extra/i);

    const reordered = mutateAndSanitize((namedSnapshot) => {
      (namedSnapshot.integrity as { layers: unknown[] }).layers.reverse();
    });
    expect(reordered.imageEditor?.documents[0].snapshots?.[0].pixelState).toBe('complete');
  });

  it('rejects hostile project snapshot count, dimensions, and aggregate decoded bytes before decode', () => {
    const base = {
      id: 'bounded', name: 'Bounded', createdAt: 1, width: 1, height: 1,
      layers: [], activeLayerId: null, hasSelection: false, selectionVersion: 0,
      pixelState: 'unavailable',
    };
    const wrap = (snapshots: unknown[]) => projectWith({
      imageEditor: {
        activeDocId: 'bounded-doc',
        documents: [{
          id: 'bounded-doc', title: 'Bounded', width: 1, height: 1,
          layers: [], activeLayerId: null, hasSelection: false, selectionVersion: 0,
          viewport: { zoom: 1, panX: 0, panY: 0 }, dirty: false, snapshots,
        }],
      },
    });
    expect(() => wrap(Array.from({ length: 13 }, (_, index) => ({ ...base, id: `bounded-${index}` }))))
      .toThrow(/count exceeds/i);

    const hostile = {
      ...base,
      pixelState: 'complete',
      layers: [{
        id: 'large', name: 'Large', type: 'image', visible: true, locked: false,
        opacity: 1, blendMode: 'normal', x: 0, y: 0, bitmap: null, mask: null,
        bitmapData: 'AAAA', bitmapVersion: 0,
      }],
      integrity: {
        version: 2,
        layers: [{
          layerId: 'large',
          bitmap: { present: true, width: 1, height: 1, contentDigest: `sha256:${'1'.repeat(64)}` },
          mask: { present: false, width: 0, height: 0 },
        }],
        selection: { present: false, width: 0, height: 0, byteLength: 0 },
      },
    };
    expect(() => wrap([{ ...hostile, width: 16_385 }])).toThrow(/16384/i);

    const aggregate = structuredClone(hostile);
    aggregate.width = 12_000;
    aggregate.height = 12_000;
    aggregate.layers.push({ ...structuredClone(aggregate.layers[0]), id: 'large-2' });
    aggregate.integrity.layers = ['large', 'large-2'].map((layerId) => ({
      layerId,
      bitmap: { present: true, width: 12_000, height: 12_000, contentDigest: `sha256:${'2'.repeat(64)}` },
      mask: { present: false, width: 0, height: 0 },
    }));
    expect(() => wrap([aggregate])).toThrow(/aggregate pixels exceed/i);

    const oneLarge = structuredClone(hostile);
    oneLarge.width = 12_000;
    oneLarge.height = 12_000;
    oneLarge.integrity.layers[0].bitmap.width = 12_000;
    oneLarge.integrity.layers[0].bitmap.height = 12_000;
    expect(() => projectWith({
      imageEditor: {
        activeDocId: 'bounded-doc-a',
        documents: ['a', 'b'].map((suffix) => ({
          id: `bounded-doc-${suffix}`, title: 'Bounded', width: 1, height: 1,
          layers: [], activeLayerId: null, hasSelection: false, selectionVersion: 0,
          viewport: { zoom: 1, panX: 0, panY: 0 }, dirty: false,
          snapshots: [{ ...structuredClone(oneLarge), id: `large-${suffix}` }],
        })),
      },
    })).toThrow(/aggregate pixels exceed/i);
  });

  it('bounds unavailable and legacy project snapshot structure at the exact layer limit', () => {
    const layer = (index: number) => ({
      id: `bounded-layer-${index}`,
      name: `Layer ${index}`,
      type: 'image',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      bitmap: null,
      mask: null,
      bitmapVersion: 0,
    });
    const snapshot = (
      layerCount: number,
      variant: 'unavailable' | 'legacy',
      overrides: Record<string, unknown> = {},
    ) => ({
      id: `${variant}-${layerCount}`,
      name: `${variant} ${layerCount}`,
      createdAt: 1,
      width: 1,
      height: 1,
      layers: Array.from({ length: layerCount }, (_, index) => layer(index)),
      activeLayerId: null,
      hasSelection: false,
      selectionVersion: 0,
      ...(variant === 'unavailable'
        ? { pixelState: 'unavailable' }
        : { integrity: { version: 1, layers: [], selection: null } }),
      ...overrides,
    });
    const openSnapshots = (snapshots: unknown[]) => projectWith({
      imageEditor: {
        activeDocId: 'structural-bounds-doc',
        documents: [{
          id: 'structural-bounds-doc', title: 'Structural bounds', width: 1, height: 1,
          layers: [], activeLayerId: null, hasSelection: false, selectionVersion: 0,
          viewport: { zoom: 1, panX: 0, panY: 0 }, dirty: false,
          snapshots,
        }],
      },
    });
    const open = (namedSnapshot: unknown) => openSnapshots([namedSnapshot]);

    expect(open(snapshot(IMAGE_SNAPSHOT_MAX_LAYERS, 'unavailable')).imageEditor?.documents[0].snapshots?.[0].layers)
      .toHaveLength(IMAGE_SNAPSHOT_MAX_LAYERS);
    expect(open(snapshot(IMAGE_SNAPSHOT_MAX_LAYERS, 'legacy')).imageEditor?.documents[0].snapshots?.[0].layers)
      .toHaveLength(IMAGE_SNAPSHOT_MAX_LAYERS);
    expect(() => open(snapshot(IMAGE_SNAPSHOT_MAX_LAYERS + 1, 'unavailable'))).toThrow(/layer count exceeds/i);
    expect(() => open(snapshot(IMAGE_SNAPSHOT_MAX_LAYERS + 1, 'legacy'))).toThrow(/layer count exceeds/i);
    expect(() => open(snapshot(IMAGE_SNAPSHOT_MAX_LAYERS + 1, 'unavailable', {
      hasSelection: true,
      selectionMaskData: 'AQ==',
    }))).toThrow(/layer count exceeds/i);
    expect(() => open(snapshot(IMAGE_SNAPSHOT_MAX_LAYERS + 1, 'unavailable', {
      pixelState: 'complete',
      integrity: {
        version: 2,
        layers: [],
        selection: { present: false, width: 0, height: 0, byteLength: 0 },
      },
    }))).toThrow(/layer count exceeds/i);
    const duplicateProof = {
      layerId: 'duplicate-proof',
      bitmap: { present: false, width: 0, height: 0 },
      mask: { present: false, width: 0, height: 0 },
    };
    expect(() => open(snapshot(IMAGE_SNAPSHOT_MAX_LAYERS + 1, 'unavailable', {
      pixelState: 'complete',
      integrity: {
        version: 2,
        layers: [duplicateProof, duplicateProof],
        selection: { present: true, width: 1, height: 1, byteLength: 1 },
      },
      hasSelection: true,
      selectionMaskData: 'AQ==',
    }))).toThrow(/layer count exceeds/i);

    const aggregateAtLimit = Array.from(
      { length: IMAGE_DOCUMENT_MAX_SNAPSHOT_LAYERS / IMAGE_SNAPSHOT_MAX_LAYERS },
      (_, index) => ({ ...snapshot(IMAGE_SNAPSHOT_MAX_LAYERS, 'unavailable'), id: `aggregate-${index}` }),
    );
    expect(openSnapshots(aggregateAtLimit).imageEditor?.documents[0].snapshots
      ?.reduce((total, namedSnapshot) => total + namedSnapshot.layers.length, 0))
      .toBe(IMAGE_DOCUMENT_MAX_SNAPSHOT_LAYERS);
    expect(() => openSnapshots([
      ...aggregateAtLimit,
      snapshot(1, 'unavailable'),
    ])).toThrow(/aggregate layer count exceeds/i);

    const proofFlood = (proofCount: number) => snapshot(1, 'legacy', {
      integrity: {
        version: 1,
        layers: Array.from(
          { length: proofCount },
          (_, index) => ({ layerId: `unused-proof-${index}` }),
        ),
        selection: null,
      },
    });
    expect(open(proofFlood(IMAGE_SNAPSHOT_MAX_LAYERS)).imageEditor?.documents[0].snapshots).toHaveLength(1);
    expect(() => open(proofFlood(IMAGE_SNAPSHOT_MAX_LAYERS + 1))).toThrow(/proof count exceeds/i);
  });

  it('rejects documents without array-shaped flow snapshots', () => {
    expect(() => projectWith({ flow: { nodes: {}, edges: [] } })).toThrow('flow nodes and edges must be arrays');
  });
});

describe('sanitizePaperSnapshot', () => {
  it('preserves multiple Paper tabs and validates their union of managed assets', () => {
    const firstAssetId = `sha256:${'1'.repeat(64)}`;
    const secondAssetId = `sha256:${'2'.repeat(64)}`;
    const makeDocument = (id: string, title: string, assetId: string) => ({
      id,
      title,
      pages: [{
        id: `${id}-page`,
        frames: [{
          id: `${id}-frame`,
          asset: {
            label: title,
            kind: 'image',
            locator: {
              kind: 'managed',
              ref: {
                id: assetId,
                sha256: assetId.slice('sha256:'.length),
                mimeType: 'image/png',
                byteLength: 3,
              },
            },
          },
        }],
      }],
    });
    const english = makeDocument('paper-en', 'English', firstAssetId);
    const japanese = makeDocument('paper-ja', '日本語', secondAssetId);

    const snapshot = sanitizePaperSnapshot({
      document: japanese,
      documents: [
        { id: 'tab-en', document: english, assetIds: [firstAssetId], tool: 'select', zoom: 0.8 },
        { id: 'tab-ja', document: japanese, assetIds: [secondAssetId], tool: 'text', zoom: 1.2 },
      ],
      activeDocumentId: 'tab-ja',
      assetIds: [firstAssetId, secondAssetId],
    });

    expect(snapshot?.documents?.map((candidate) => candidate.document.title)).toEqual(['English', '日本語']);
    expect(snapshot?.activeDocumentId).toBe('tab-ja');
    expect(snapshot?.document?.title).toBe('日本語');
    expect(snapshot?.assetIds).toEqual([firstAssetId, secondAssetId]);
  });

  it('rejects malformed Paper asset references on project restore', () => {
    expect(sanitizePaperSnapshot({
      document: {
        id: 'paper-1',
        title: 'Malformed asset reference',
        pages: [{
          id: 'page-1',
          frames: [{
            id: 'frame-1',
            asset: {
              label: 'Panel',
              kind: 'image',
              locator: {
                kind: 'managed',
                ref: {
                  id: 'sha256:not-a-hash',
                  sha256: 'not-a-hash',
                  mimeType: 'image/png',
                  byteLength: 3,
                },
              },
            },
          }],
        }],
      },
    })).toBeUndefined();
  });

  it('rejects an inline URL persisted in a Paper asset locator', () => {
    expect(sanitizePaperSnapshot({
      document: {
        id: 'paper-1',
        title: 'Inline asset reference',
        pages: [{
          id: 'page-1',
          frames: [{
            id: 'frame-1',
            asset: {
              label: 'Panel',
              kind: 'image',
              locator: { kind: 'external', url: 'data:image/png;base64,AQID' },
            },
          }],
        }],
      },
    })).toBeUndefined();
  });

  it('preserves legacy inline Paper fields only until the restore migration can convert them', () => {
    const snapshot = sanitizePaperSnapshot({
      document: {
        id: 'paper-legacy',
        title: 'Legacy inline asset',
        pages: [{
          id: 'page-1',
          frames: [{
            id: 'frame-1',
            asset: {
              label: 'Legacy panel',
              kind: 'image',
              src: 'data:image/png;base64,AQID',
            },
          }],
        }],
        importedFonts: [{
          id: 'legacy-face',
          familyName: 'Legacy Face',
          bold: false,
          italic: false,
          format: 'truetype',
          embeddable: true,
          canSubset: true,
          dataBase64: 'BAUG',
        }],
      },
      tool: 'select',
      zoom: 0.8,
    });

    expect(snapshot).toBeDefined();
    expect(snapshot?.assetIds).toEqual([]);
    expect((snapshot?.document?.pages[0]?.frames[0]?.asset as { src?: string } | undefined)?.src)
      .toBe('data:image/png;base64,AQID');
  });

  it('includes managed parent-page assets in the restored snapshot reachability list', () => {
    const assetId = 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const snapshot = sanitizePaperSnapshot({
      document: {
        id: 'paper-1',
        title: 'Parent asset reference',
        pages: [],
        parentPages: [{
          id: 'parent-1',
          frames: [{
            id: 'frame-1',
            asset: {
              label: 'Parent panel',
              kind: 'image',
              locator: {
                kind: 'managed',
                ref: { id: assetId, sha256: assetId.slice('sha256:'.length), mimeType: 'image/png', byteLength: 3 },
              },
            },
          }],
        }],
      },
      assetIds: [assetId],
    });

    expect(snapshot?.assetIds).toEqual([assetId]);
  });

  it('includes an exact managed ICC profile asset in restored snapshot reachability', () => {
    const assetId = 'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    const snapshot = sanitizePaperSnapshot({
      document: {
        id: 'paper-icc',
        title: 'Managed output profile',
        pages: [],
        managedIccProfiles: [{
          id: assetId,
          asset: { id: assetId, sha256: assetId.slice('sha256:'.length), mimeType: 'application/vnd.iccprofile', byteLength: 12 },
          description: 'Exact CMYK profile',
          deviceClass: 'prtr',
          colorSpace: 'CMYK',
          pcs: 'Lab ',
          outputConditionId: 'FOGRA51',
          source: { kind: 'user-import' },
        }],
      },
      assetIds: [assetId],
    });

    expect(snapshot?.assetIds).toEqual([assetId]);
  });

  it('preserves valid Paper tabs and quarantines a malformed tab with explicit recovery info', () => {
    const makeDocument = (id: string, title: string) => ({ id, title, pages: [{ id: `${id}-page`, frames: [] }] });
    const snapshot = sanitizePaperSnapshot({
      document: makeDocument('paper-a', 'First'),
      documents: [
        { id: 'tab-a', document: makeDocument('paper-a', 'First'), tool: 'select', zoom: 0.8 },
        { id: 'tab-broken', document: { id: 'paper-broken', title: 'Broken tab', pages: 'not-an-array' }, tool: 'select', zoom: 0.8 },
        { id: 'tab-b', document: makeDocument('paper-b', 'Second'), tool: 'text', zoom: 1.1 },
      ],
      activeDocumentId: 'tab-broken',
    });

    expect(snapshot).toBeDefined();
    expect(snapshot?.documents?.map((candidate) => candidate.id)).toEqual(['tab-a', 'tab-b']);
    expect(snapshot?.activeDocumentId).toBe('tab-a');
    expect(snapshot?.document?.title).toBe('First');
    expect(snapshot?.recovery?.quarantinedDocuments).toHaveLength(1);
    expect(snapshot?.recovery?.quarantinedDocuments[0]).toMatchObject({
      index: 1,
      id: 'tab-broken',
      reason: 'malformed-document',
    });
    expect(snapshot?.recovery?.quarantinedDocuments[0]?.payloadJson).toContain('Broken tab');
  });

  it('quarantines a tab with invalid managed asset references instead of blanking every tab', () => {
    const validDocument = { id: 'paper-a', title: 'Valid', pages: [{ id: 'page-a', frames: [] }] };
    const invalidDocument = {
      id: 'paper-bad-asset',
      title: 'Bad asset',
      pages: [{
        id: 'page-bad',
        frames: [{
          id: 'frame-bad',
          asset: {
            label: 'Panel',
            kind: 'image',
            locator: {
              kind: 'managed',
              ref: { id: 'sha256:not-a-hash', sha256: 'not-a-hash', mimeType: 'image/png', byteLength: 3 },
            },
          },
        }],
      }],
    };
    const snapshot = sanitizePaperSnapshot({
      document: validDocument,
      documents: [
        { id: 'tab-a', document: validDocument, tool: 'select', zoom: 0.8 },
        { id: 'tab-bad', document: invalidDocument, tool: 'select', zoom: 0.8 },
      ],
      activeDocumentId: 'tab-a',
    });

    expect(snapshot?.documents?.map((candidate) => candidate.id)).toEqual(['tab-a']);
    expect(snapshot?.recovery?.quarantinedDocuments).toHaveLength(1);
    expect(snapshot?.recovery?.quarantinedDocuments[0]).toMatchObject({
      index: 1,
      id: 'tab-bad',
      reason: 'invalid-asset-reference',
    });
    expect(snapshot?.recovery?.quarantinedDocuments[0]?.payloadJson).toContain('sha256:not-a-hash');
  });

  it('renames duplicate Paper tab ids and keeps both tabs instead of discarding the workspace', () => {
    const makeDocument = (id: string, title: string) => ({ id, title, pages: [{ id: `${id}-page`, frames: [] }] });
    const snapshot = sanitizePaperSnapshot({
      document: makeDocument('paper-a', 'First'),
      documents: [
        { id: 'tab-a', document: makeDocument('paper-a', 'First'), tool: 'select', zoom: 0.8 },
        { id: 'tab-a', document: makeDocument('paper-dup', 'Duplicate'), tool: 'select', zoom: 0.8 },
        { id: 'tab-b', document: makeDocument('paper-b', 'Second'), tool: 'select', zoom: 0.8 },
      ],
      activeDocumentId: 'tab-a',
    });

    expect(snapshot?.documents?.map((candidate) => candidate.id)).toEqual(['tab-a', 'tab-a-2', 'tab-b']);
    expect(snapshot?.documents?.map((candidate) => candidate.document.title)).toEqual(['First', 'Duplicate', 'Second']);
    expect(snapshot?.activeDocumentId).toBe('tab-a');
    expect(snapshot?.recovery?.repairs.some((repair) => repair.includes('tab-a'))).toBe(true);
  });

  it('repairs a stale declared Paper asset inventory instead of discarding the snapshot', () => {
    const staleAssetId = `sha256:${'d'.repeat(64)}`;
    const document = {
      id: 'paper-a',
      title: 'Linked',
      pages: [{
        id: 'page-a',
        frames: [{
          id: 'frame-a',
          asset: {
            sourceBinItemId: 'source-1',
            label: 'Panel',
            kind: 'image',
            locator: { kind: 'external', url: 'signal-loom-asset://file/panel-one' },
          },
        }],
      }],
    };
    const snapshot = sanitizePaperSnapshot({
      document,
      documents: [{ id: 'tab-a', document, assetIds: [staleAssetId], tool: 'select', zoom: 0.8 }],
      activeDocumentId: 'tab-a',
      assetIds: [staleAssetId],
    });

    expect(snapshot).toBeDefined();
    expect(snapshot?.documents?.map((candidate) => candidate.id)).toEqual(['tab-a']);
    expect(snapshot?.documents?.[0]?.assetIds).toEqual([]);
    expect(snapshot?.assetIds).toEqual([]);
    expect(snapshot?.recovery?.repairs.length).toBeGreaterThan(0);
    expect(snapshot?.recovery?.quarantinedDocuments).toHaveLength(0);
  });

  it('recovers valid tabs when only the denormalized active document copy is corrupt', () => {
    const makeDocument = (id: string, title: string) => ({ id, title, pages: [{ id: `${id}-page`, frames: [] }] });
    const snapshot = sanitizePaperSnapshot({
      document: { id: 'paper-corrupt', pages: 'not-an-array' },
      documents: [
        { id: 'tab-a', document: makeDocument('paper-a', 'First'), tool: 'select', zoom: 0.8 },
        { id: 'tab-b', document: makeDocument('paper-b', 'Second'), tool: 'select', zoom: 0.8 },
      ],
      activeDocumentId: 'tab-a',
    });

    expect(snapshot?.documents?.map((candidate) => candidate.id)).toEqual(['tab-a', 'tab-b']);
    expect(snapshot?.document?.title).toBe('First');
  });

  it('returns explicit recovery info when every tab is corrupt and carries prior recovery through revalidation', () => {
    const allCorrupt = sanitizePaperSnapshot({
      document: { id: 'paper-corrupt', pages: 'not-an-array' },
      documents: [
        { id: 'tab-x', document: { id: 'paper-x', pages: 'nope' }, tool: 'select', zoom: 0.8 },
        { id: 'tab-y', document: { id: 'paper-y', pages: 42 }, tool: 'select', zoom: 0.8 },
      ],
      activeDocumentId: 'tab-x',
    });
    expect(allCorrupt?.document).toBeUndefined();
    expect(allCorrupt?.recovery?.quarantinedDocuments).toHaveLength(2);

    const priorRecovery = {
      quarantinedDocuments: [{ index: 1, id: 'tab-broken', reason: 'malformed-document', payloadJson: '{"id":"tab-broken"}' }],
      repairs: [],
    };
    const carried = sanitizePaperSnapshot({
      document: { id: 'paper-a', title: 'Kept', pages: [{ id: 'page-a', frames: [] }] },
      documents: [{ id: 'tab-a', document: { id: 'paper-a', title: 'Kept', pages: [{ id: 'page-a', frames: [] }] }, tool: 'select', zoom: 0.8 }],
      activeDocumentId: 'tab-a',
      recovery: priorRecovery,
    });
    expect(carried?.documents?.map((candidate) => candidate.id)).toEqual(['tab-a']);
    expect(carried?.recovery?.quarantinedDocuments).toHaveLength(1);
    expect(carried?.recovery?.quarantinedDocuments[0]?.id).toBe('tab-broken');
    expect(carried?.recovery?.quarantinedDocuments[0]?.payloadJson).toBe('{"id":"tab-broken"}');
  });
});
