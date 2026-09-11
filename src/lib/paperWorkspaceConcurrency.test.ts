import { describe, expect, it } from 'vitest';
import { createDefaultPaperDocument, addFrameToPaperPage, updatePaperFrame } from './paperDocument';
import { createPaperWorkspaceSnapshotChange } from './paperDocumentNativeSync';
import { paperWorkspaceAuthoredFingerprint, rebasePaperWorkspace } from './paperWorkspaceConcurrency';

function workspace(title = 'Shared') {
  let document = createDefaultPaperDocument({ title });
  document = addFrameToPaperPage(document, document.pages[0].id, {
    id: 'frame-a', kind: 'text', text: 'A', xMm: 10, yMm: 10, widthMm: 30, heightMm: 20,
  }).document;
  document = addFrameToPaperPage(document, document.pages[0].id, {
    id: 'frame-b', kind: 'text', text: 'B', xMm: 50, yMm: 10, widthMm: 30, heightMm: 20,
  }).document;
  return createPaperWorkspaceSnapshotChange({
    document,
    documents: [{
      id: 'tab', document, selectedPageId: document.pages[0].id,
      selectedFrameIds: [], tool: 'select', zoom: 0.8,
    }],
    activeDocumentId: 'tab', selectedPageId: document.pages[0].id,
    selectedFrameIds: [], tool: 'select', zoom: 0.8,
  }).workspace;
}

describe('Paper simultaneous workspace rebase', () => {
  it('keeps unrelated local and remote frame edits and preserves this device view state', () => {
    const baseline = workspace();
    const local = structuredClone(baseline);
    local.documents[0].document = updatePaperFrame(
      local.documents[0].document,
      local.documents[0].document.pages[0].id,
      'frame-a',
      { text: 'local A' },
    );
    local.documents[0].selectedFrameId = 'frame-a';
    local.documents[0].selectedFrameIds = ['frame-a'];
    local.documents[0].tool = 'text';
    local.documents[0].zoom = 1.75;

    const remote = structuredClone(baseline);
    remote.documents[0].document = updatePaperFrame(
      remote.documents[0].document,
      remote.documents[0].document.pages[0].id,
      'frame-b',
      { text: 'remote B' },
    );
    remote.documents[0].selectedFrameId = 'frame-b';
    remote.documents[0].selectedFrameIds = ['frame-b'];
    remote.documents[0].tool = 'hand';
    remote.documents[0].zoom = 0.4;

    const merged = rebasePaperWorkspace(baseline, local, remote);
    const frames = merged.documents[0].document.pages[0].frames;
    expect(frames.find(({ id }) => id === 'frame-a')?.text).toBe('local A');
    expect(frames.find(({ id }) => id === 'frame-b')?.text).toBe('remote B');
    expect(merged.documents[0]).toMatchObject({
      selectedFrameId: 'frame-a', selectedFrameIds: ['frame-a'], tool: 'text', zoom: 1.75,
    });
  });

  it('keeps independent additions and resolves a same-field conflict to the pending local edit', () => {
    const baseline = workspace();
    const local = structuredClone(baseline);
    local.documents[0].document = addFrameToPaperPage(
      updatePaperFrame(local.documents[0].document, local.documents[0].document.pages[0].id, 'frame-a', { text: 'local wins' }),
      local.documents[0].document.pages[0].id,
      { id: 'local-added', kind: 'text', text: 'local', xMm: 10, yMm: 40, widthMm: 30, heightMm: 20 },
    ).document;
    const remote = structuredClone(baseline);
    remote.documents[0].document = addFrameToPaperPage(
      updatePaperFrame(remote.documents[0].document, remote.documents[0].document.pages[0].id, 'frame-a', { text: 'remote first' }),
      remote.documents[0].document.pages[0].id,
      { id: 'remote-added', kind: 'text', text: 'remote', xMm: 50, yMm: 40, widthMm: 30, heightMm: 20 },
    ).document;

    const merged = rebasePaperWorkspace(baseline, local, remote);
    const frames = merged.documents[0].document.pages[0].frames;
    expect(frames.map(({ id }) => id)).toEqual(expect.arrayContaining(['local-added', 'remote-added']));
    expect(frames.find(({ id }) => id === 'frame-a')?.text).toBe('local wins');
  });

  it('does not treat selection, tool, zoom, or active-tab changes as authored project edits', () => {
    const baseline = workspace();
    const local = structuredClone(baseline);
    local.documents[0].selectedFrameId = 'frame-a';
    local.documents[0].selectedFrameIds = ['frame-a'];
    local.documents[0].tool = 'text';
    local.documents[0].zoom = 2;
    expect(paperWorkspaceAuthoredFingerprint(local)).toBe(paperWorkspaceAuthoredFingerprint(baseline));
  });

  it('preserves an authority deletion while replaying an unrelated local edit', () => {
    const baseline = workspace();
    const local = structuredClone(baseline);
    local.documents[0].document = updatePaperFrame(
      local.documents[0].document,
      local.documents[0].document.pages[0].id,
      'frame-a',
      { text: 'local A' },
    );
    const remote = structuredClone(baseline);
    remote.documents[0].document.pages[0].frames = remote.documents[0].document.pages[0].frames
      .filter(({ id }) => id !== 'frame-b');

    const merged = rebasePaperWorkspace(baseline, local, remote);
    expect(merged.documents[0].document.pages[0].frames.map(({ id }) => id)).toEqual(['frame-a']);
    expect(merged.documents[0].document.pages[0].frames[0].text).toBe('local A');
  });

  it('keeps a pending local deletion when the peer concurrently edits the deleted entity', () => {
    const baseline = workspace();
    const local = structuredClone(baseline);
    local.documents[0].document.pages[0].frames = local.documents[0].document.pages[0].frames
      .filter(({ id }) => id !== 'frame-b');
    const remote = structuredClone(baseline);
    remote.documents[0].document = updatePaperFrame(
      remote.documents[0].document,
      remote.documents[0].document.pages[0].id,
      'frame-b',
      { text: 'remote edit before delete' },
    );

    const merged = rebasePaperWorkspace(baseline, local, remote);
    expect(merged.documents[0].document.pages[0].frames.map(({ id }) => id)).toEqual(['frame-a']);
  });
});
