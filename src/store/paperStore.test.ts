import { beforeEach, describe, expect, it } from 'vitest';
import { createPaperComicSfxDesign } from '../lib/paperComicSfx';
import { addFrameToPaperPage, createDefaultPaperDocument, parsePaperDocument } from '../lib/paperDocument';
import { createPaperWorkspaceSnapshotChange } from '../lib/paperDocumentNativeSync';
import { buildPaperPdfExportRequest } from '../lib/paperPdfExport';
import { createBinaryAssetRecord, type BinaryAssetRef } from '../shared/assets/contentAddressedAsset';
import { paperAssetRepository } from '../features/paper/assets/PaperAssetRuntime';
import type { SourceBinLibraryItem } from './sourceBinStore';
import type { PaperImportedFont } from '../types/paper';
import {
  capturePaperWorkspaceAuthorization,
  capturePaperInspectorStoreAuthority,
  isPaperInspectorStoreAuthorityCurrent,
  mergePersistedPaperWorkspace,
  projectPersistedPaperWorkspace,
  usePaperStore,
} from './paperStore';

function dirtyPaperTitles(): string[] {
  const state = usePaperStore.getState();
  return (state.exportSnapshot().documents ?? [])
    .filter((workspaceDocument) => state.isDocumentDirty(workspaceDocument.id))
    .map((workspaceDocument) => workspaceDocument.document.title);
}

function resetPaperStore() {
  const document = createDefaultPaperDocument({ title: 'Paper Store Test' });
  usePaperStore.setState({
    documents: [{
      id: document.id,
      document,
      assetIds: [],
      selectedPageId: document.pages[0].id,
      selectedFrameIds: [],
      tool: 'select',
      zoom: 0.8,
    }],
    activeDocumentId: document.id,
    document,
    selectedPageId: document.pages[0].id,
    selectedFrameId: null,
    selectedFrameIds: [],
    tool: 'select',
    zoom: 0.8,
    undoStack: [],
    redoStack: [],
    documentHistories: {},
    clipboardFrames: [],
    styleClipboard: null,
    recovery: null,
    discardedDocumentRecoveries: [],
  });
}

function fontAssetRef(): BinaryAssetRef {
  const sha256 = '3'.repeat(64);
  return { id: `sha256:${sha256}`, sha256, mimeType: 'font/ttf', byteLength: 4 };
}

function textItem(): SourceBinLibraryItem {
  return {
    id: 'script-line-1',
    label: 'Script line',
    kind: 'text',
    text: 'Panel narration from Flow.',
    createdAt: 1,
  };
}

function seedStackedFrames() {
  let document = createDefaultPaperDocument({ title: 'Paper Store Selection Test' });
  const pageId = document.pages[0].id;
  for (const [index, id] of ['frame-a', 'frame-b', 'frame-c', 'frame-d'].entries()) {
    const added = addFrameToPaperPage(document, pageId, {
      id,
      kind: index === 0 ? 'image' : 'caption',
      label: id,
      xMm: 12 + index * 10,
      yMm: 16 + index * 8,
      widthMm: 30,
      heightMm: 20,
      zIndex: index,
    });
    document = added.document;
  }
  usePaperStore.setState({
    documents: [{
      id: document.id,
      document,
      assetIds: [],
      selectedPageId: pageId,
      selectedFrameId: 'frame-a',
      selectedFrameIds: ['frame-a'],
      tool: 'select',
      zoom: 0.8,
    }],
    activeDocumentId: document.id,
    document,
    selectedPageId: pageId,
    selectedFrameId: 'frame-a',
    selectedFrameIds: ['frame-a'],
    tool: 'select',
    zoom: 0.8,
    undoStack: [],
    redoStack: [],
    documentHistories: {},
    clipboardFrames: [],
    styleClipboard: null,
  });
  return { pageId };
}

function stackOrder() {
  return [...usePaperStore.getState().document.pages[0].frames]
    .sort((a, b) => a.zIndex - b.zIndex)
    .map((frame) => frame.id);
}

function paperEditActions() {
  return usePaperStore.getState() as ReturnType<typeof usePaperStore.getState> & {
    chainSelectedBubbles: () => void;
    copySelection: () => void;
    cutSelection: () => void;
    pasteSelection: () => void;
    deleteSelection: () => void;
    unchainBubble: (frameId: string) => void;
    unchainSelectedBubbles: () => void;
    copySelectedFrameStyle: () => boolean;
    pasteFrameStyleToSelection: () => number;
    addComicSfx: (
      presetId: 'bang' | 'kapow' | 'screech' | 'whirrrrr' | 'boom' | 'crash' | 'zap' | 'slam',
      options?: { point?: { xMm: number; yMm: number }; text?: string },
    ) => string | undefined;
    undo: () => void;
    redo: () => void;
  };
}

function paperDirtyActions() {
  return usePaperStore.getState() as ReturnType<typeof usePaperStore.getState> & {
    isDocumentDirty: (documentId?: string) => boolean;
    markDocumentSaved: (
      documentId: string,
      baseline: { kind: 'project' | 'standalone'; path?: string },
    ) => void;
    captureDocumentRecovery: (
      documentIds: string[],
      reason: 'discard' | 'project-replacement' | 'shutdown' | 'baton-handoff',
    ) => string[];
    restoreDiscardedDocument: (recoveryId: string) => string | undefined;
    closeDocument: (
      documentId: string,
      options?: { discard?: boolean; recoveryReason?: 'discard' | 'project-replacement' | 'shutdown' | 'baton-handoff' },
    ) => boolean;
    discardedDocumentRecoveries: Array<{
      id: string;
      reason: string;
      snapshot: { id: string; document: { title: string } };
    }>;
  };
}

describe('paperStore boot baseline', () => {
  it('keeps an absent persisted profile on the clean boot baseline while user-created tabs stay dirty', () => {
    const initialState = usePaperStore.getState();
    expect(mergePersistedPaperWorkspace(undefined, initialState)).toBe(initialState);

    const bootDocumentId = usePaperStore.getState().activeDocumentId;
    expect(usePaperStore.getState().isDocumentDirty(bootDocumentId)).toBe(false);

    usePaperStore.getState().createNewDocument({ title: 'User-created unsaved layout' });
    expect(usePaperStore.getState().isDocumentDirty()).toBe(true);
    expect(usePaperStore.getState().isDocumentDirty(bootDocumentId)).toBe(false);
  });
});

describe('paperStore Inspector authority epoch', () => {
  beforeEach(resetPaperStore);

  it('revokes every document and selection authority transition, even if a later state could reuse IDs', () => {
    const expectRevokedBy = (transition: () => void) => {
      resetPaperStore();
      const authority = capturePaperInspectorStoreAuthority();
      transition();
      expect(isPaperInspectorStoreAuthorityCurrent(authority)).toBe(false);
    };

    expectRevokedBy(() => usePaperStore.setState((state) => ({ document: { ...state.document } })));
    expectRevokedBy(() => usePaperStore.setState({ activeDocumentId: 'replacement-document-tab' }));
    expectRevokedBy(() => usePaperStore.setState({ selectedPageId: 'replacement-page' }));
    expectRevokedBy(() => usePaperStore.setState({ selectedFrameId: 'replacement-frame' }));
    expectRevokedBy(() => usePaperStore.setState({ selectedFrameIds: ['secondary-selection'] }));
  });

  it('does not revoke Inspector authority for unrelated UI state or an equal selection projection', () => {
    const authority = capturePaperInspectorStoreAuthority();
    const selectedFrameIds = [...usePaperStore.getState().selectedFrameIds];

    usePaperStore.setState({ zoom: 1.25, tool: 'hand', selectedFrameIds });

    expect(isPaperInspectorStoreAuthorityCurrent(authority)).toBe(true);
  });
});

describe('paperStore interaction actions', () => {
  beforeEach(resetPaperStore);

  it('marks only the exact Paper content submitted to a project save as clean', () => {
    usePaperStore.getState().restoreSnapshot(usePaperStore.getState().exportSnapshot());
    usePaperStore.setState((state) => ({
      document: { ...state.document, title: 'Submitted title' },
    }));
    const submitted = usePaperStore.getState().exportSnapshot();
    usePaperStore.getState().markAllDocumentsProjectSaved(submitted);
    expect(dirtyPaperTitles()).toEqual([]);

    const beforeConcurrentEdit = usePaperStore.getState().exportSnapshot();
    usePaperStore.setState((state) => ({
      document: { ...state.document, title: 'Edited while save was pending' },
    }));
    usePaperStore.getState().markAllDocumentsProjectSaved(beforeConcurrentEdit);
    expect(dirtyPaperTitles()).toEqual(['Edited while save was pending']);
  });

  it('adds and updates ruler-created guides on the selected page', () => {
    const pageId = usePaperStore.getState().selectedPageId;
    usePaperStore.setState((state) => ({
      document: {
        ...state.document,
        view: {
          ...state.document.view,
          showGuides: false,
        },
      },
    }));

    const guideId = usePaperStore.getState().addGuideToPage(pageId, {
      orientation: 'vertical',
      positionMm: 21,
      label: 'Dragged vertical',
    });

    expect(guideId).toBeDefined();
    expect(usePaperStore.getState().document.view.showGuides).toBe(true);
    expect(usePaperStore.getState().document.pages[0].guides).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: guideId,
          orientation: 'vertical',
          positionMm: 21,
          label: 'Dragged vertical',
        }),
      ]),
    );

    usePaperStore.getState().updateGuide(pageId, guideId!, { positionMm: 44 });
    expect(
      usePaperStore.getState().document.pages[0].guides.find((guide) => guide.id === guideId)?.positionMm,
    ).toBe(44);
  });

  it('places source-library text on the page and lets arrow-key nudging move the selected frame', () => {
    const pageId = usePaperStore.getState().selectedPageId;

    usePaperStore.getState().placeSourceAssetAt({
      pageId,
      item: textItem(),
      point: { xMm: 30, yMm: 40 },
    });

    const selectedFrameId = usePaperStore.getState().selectedFrameId;
    const placedFrame = usePaperStore.getState().document.pages[0].frames.find((frame) => frame.id === selectedFrameId);
    expect(placedFrame).toMatchObject({
      kind: 'text',
      xMm: 30,
      yMm: 40,
      text: 'Panel narration from Flow.',
    });

    usePaperStore.getState().nudgeSelectedFrame(1.25, -0.5);
    const nudgedFrame = usePaperStore.getState().document.pages[0].frames.find((frame) => frame.id === selectedFrameId);
    expect(nudgedFrame).toMatchObject({
      xMm: 31.25,
      yMm: 39.5,
    });
  });

  it('supports additive and toggle frame selection for modifier-click workflows', () => {
    seedStackedFrames();
    const state = usePaperStore.getState() as typeof usePaperStore extends { getState: () => infer T }
      ? T & {
          selectFrameWithMode: (
            frameId: string | null,
            mode?: 'replace' | 'add' | 'toggle',
          ) => void;
        }
      : never;

    state.selectFrameWithMode('frame-b', 'add');
    expect(usePaperStore.getState().selectedFrameIds).toEqual(['frame-a', 'frame-b']);
    expect(usePaperStore.getState().selectedFrameId).toBe('frame-b');

    (usePaperStore.getState() as typeof state).selectFrameWithMode('frame-a', 'toggle');
    expect(usePaperStore.getState().selectedFrameIds).toEqual(['frame-b']);

    (usePaperStore.getState() as typeof state).selectFrameWithMode('frame-c');
    expect(usePaperStore.getState().selectedFrameIds).toEqual(['frame-c']);
  });

  it('applies stacking actions to the selected frame group while preserving relative order', () => {
    const { pageId } = seedStackedFrames();
    usePaperStore.setState({
      selectedFrameId: 'frame-b',
      selectedFrameIds: ['frame-a', 'frame-b'],
    });

    usePaperStore.getState().runFrameContextAction(pageId, 'frame-b', 'bring-to-front');
    expect(stackOrder()).toEqual(['frame-c', 'frame-d', 'frame-a', 'frame-b']);
    expect(usePaperStore.getState().selectedFrameIds).toEqual(['frame-a', 'frame-b']);

    usePaperStore.getState().runFrameContextAction(pageId, 'frame-a', 'send-backward');
    expect(stackOrder()).toEqual(['frame-c', 'frame-a', 'frame-b', 'frame-d']);
    expect(usePaperStore.getState().selectedFrameIds).toEqual(['frame-a', 'frame-b']);
  });

  it('copies and pastes selected Paper frames on the current page', () => {
    seedStackedFrames();

    paperEditActions().copySelection();
    paperEditActions().pasteSelection();

    const state = usePaperStore.getState();
    const page = state.document.pages[0];
    const pastedFrame = page.frames.find((frame) => frame.id === state.selectedFrameId);

    expect(page.frames).toHaveLength(5);
    expect(pastedFrame).toMatchObject({
      kind: 'image',
      label: 'frame-a copy',
      xMm: 16,
      yMm: 20,
    });
    expect(pastedFrame?.id).not.toBe('frame-a');
    expect(state.selectedFrameIds).toEqual([pastedFrame?.id]);
  });

  it('copies the active frame style and pastes it to every selected frame as one undoable edit', () => {
    const { pageId } = seedStackedFrames();
    paperEditActions().updateFrame(pageId, 'frame-a', {
      fillColor: '#fbe400',
      fillOpacity: 0.92,
      strokeColor: '#101010',
      strokeOpacity: 0.75,
      strokeWidthMm: 2.4,
      strokeStyle: 'dashed',
      cornerRadiusMm: 3,
      opacity: 0.84,
      typography: {
        fontFamily: 'Impact, sans-serif',
        fontSizePt: 36,
        fontWeight: '900',
        fontStyle: 'normal',
        leadingPt: 34,
        align: 'center',
        color: '#111111',
        tracking: 1.5,
        hyphenate: false,
      },
      textStrokeColor: '#ffffff',
      textStrokeWidthMm: 0.8,
      textShadowColor: 'rgba(0,0,0,0.55)',
      textShadowOffsetXMm: 1.2,
      textShadowOffsetYMm: 1.6,
      textShadowBlurMm: 0.4,
      textSkewXDeg: -8,
      textScaleX: 1.14,
    });

    usePaperStore.setState({
      selectedFrameId: 'frame-a',
      selectedFrameIds: ['frame-a'],
      undoStack: [],
      redoStack: [],
    });

    expect(paperEditActions().copySelectedFrameStyle()).toBe(true);

    usePaperStore.setState({
      selectedFrameId: 'frame-c',
      selectedFrameIds: ['frame-b', 'frame-c'],
    });

    expect(paperEditActions().pasteFrameStyleToSelection()).toBe(2);
    const styledFrames = usePaperStore.getState().document.pages[0].frames
      .filter((frame) => frame.id === 'frame-b' || frame.id === 'frame-c');
    expect(styledFrames).toHaveLength(2);
    for (const frame of styledFrames) {
      expect(frame).toMatchObject({
        fillColor: '#fbe400',
        fillOpacity: 0.92,
        strokeColor: '#101010',
        strokeOpacity: 0.75,
        strokeWidthMm: 2.4,
        strokeStyle: 'dashed',
        cornerRadiusMm: 3,
        opacity: 0.84,
        textStrokeColor: '#ffffff',
        textStrokeWidthMm: 0.8,
        textShadowColor: 'rgba(0,0,0,0.55)',
        textShadowOffsetXMm: 1.2,
        textShadowOffsetYMm: 1.6,
        textShadowBlurMm: 0.4,
        textSkewXDeg: -8,
        textScaleX: 1.14,
      });
      expect(frame.typography.fontFamily).toBe('Impact, sans-serif');
      expect(frame.typography.fontSizePt).toBe(36);
      expect(frame.typography.tracking).toBe(1.5);
      expect(frame.text).toBe('Narration caption');
      expect(frame.xMm).not.toBe(12);
    }
    expect(usePaperStore.getState().undoStack).toHaveLength(1);

    paperEditActions().undo();
    const restoredFrame = usePaperStore.getState().document.pages[0].frames.find((frame) => frame.id === 'frame-b');
    expect(restoredFrame?.fillColor).not.toBe('#fbe400');
    expect(restoredFrame?.typography.fontFamily).not.toBe('Impact, sans-serif');
  });

  it('adds a comic sound-effect preset as one selected undoable decal frame', () => {
    const pageId = usePaperStore.getState().selectedPageId;

    const primaryFrameId = paperEditActions().addComicSfx('kapow', {
      point: { xMm: 36, yMm: 42 },
      text: 'Kablam!',
    });

    const state = usePaperStore.getState();
    const page = state.document.pages.find((candidate) => candidate.id === pageId);
    expect(primaryFrameId).toMatch(/^sfx-kapow-/);
    expect(page?.frames).toHaveLength(1);
    expect(state.selectedPageId).toBe(pageId);
    expect(state.selectedFrameId).toBe(primaryFrameId);
    expect(state.selectedFrameIds).toEqual([primaryFrameId]);
    expect(state.undoStack).toHaveLength(1);

    const primaryFrame = page?.frames.find((frame) => frame.id === primaryFrameId);
    expect(primaryFrame).toMatchObject({
      kind: 'image',
      fit: 'stretch',
      xMm: 36,
      yMm: 42,
      comicSfxDesign: {
        presetId: 'kapow',
        text: 'KABLAM!',
      },
    });
    expect(primaryFrame?.asset?.mimeType).toBe('image/svg+xml');
    expect(primaryFrame?.asset?.locator).toBeUndefined();

    paperEditActions().undo();
    expect(usePaperStore.getState().document.pages.find((candidate) => candidate.id === pageId)?.frames).toHaveLength(0);
  });

  it('adds customized comic sound-effect designer output as one selected undoable decal frame', () => {
    const pageId = usePaperStore.getState().selectedPageId;
    const design = createPaperComicSfxDesign('zap', {
      text: 'bzzt',
      fillColor: '#22d3ee',
      strokeColor: '#082f49',
      speedLinesEnabled: true,
      speedLineCount: 6,
      burstEnabled: false,
      halftoneEnabled: true,
      halftoneCount: 5,
    });

    const primaryFrameId = paperEditActions().addComicSfx('zap', {
      point: { xMm: 18, yMm: 19 },
      design,
    });

    const state = usePaperStore.getState();
    const page = state.document.pages.find((candidate) => candidate.id === pageId);
    expect(primaryFrameId).toMatch(/^sfx-zap-/);
    expect(page?.frames).toHaveLength(1);
    expect(page?.frames.find((frame) => frame.id === primaryFrameId)).toMatchObject({
      kind: 'image',
      label: 'BZZT Comic SFX',
      comicSfxDesign: {
        text: 'BZZT',
        fillColor: '#22d3ee',
        strokeColor: '#082f49',
        speedLineCount: 6,
        halftoneCount: 5,
        burstEnabled: false,
      },
    });
    expect(page?.frames.find((frame) => frame.id === primaryFrameId)?.asset?.locator).toBeUndefined();
    expect(state.selectedFrameIds).toEqual([primaryFrameId]);
  });

  it('cuts, deletes, undoes, and redoes selected Paper frames', () => {
    seedStackedFrames();

    paperEditActions().cutSelection();
    expect(usePaperStore.getState().document.pages[0].frames.map((frame) => frame.id)).not.toContain('frame-a');

    paperEditActions().pasteSelection();
    expect(usePaperStore.getState().document.pages[0].frames).toHaveLength(4);

    paperEditActions().deleteSelection();
    expect(usePaperStore.getState().document.pages[0].frames).toHaveLength(3);

    paperEditActions().undo();
    expect(usePaperStore.getState().document.pages[0].frames).toHaveLength(4);

    paperEditActions().redo();
    expect(usePaperStore.getState().document.pages[0].frames).toHaveLength(3);
  });

  it('undoes direct frame edits and document setup changes from keyboard-triggered undo', () => {
    seedStackedFrames();
    const pageId = usePaperStore.getState().document.pages[0].id;

    paperEditActions().updateFrame(pageId, 'frame-a', { xMm: 42 });
    expect(usePaperStore.getState().document.pages[0].frames.find((frame) => frame.id === 'frame-a')?.xMm).toBe(42);

    paperEditActions().undo();
    expect(usePaperStore.getState().document.pages[0].frames.find((frame) => frame.id === 'frame-a')?.xMm).toBe(12);

    paperEditActions().updateDocumentSetup({ dpi: 450 });
    expect(usePaperStore.getState().document.page.dpi).toBe(450);

    paperEditActions().undo();
    expect(usePaperStore.getState().document.page.dpi).toBe(300);
  });

  it('does not emit history or state changes for unchanged frame patches', () => {
    const { pageId } = seedStackedFrames();
    const before = usePaperStore.getState();
    const notifications: Array<ReturnType<typeof usePaperStore.getState>> = [];
    const unsubscribe = usePaperStore.subscribe((state) => {
      notifications.push(state);
    });

    try {
      before.updateFrame(pageId, 'frame-a', { xMm: 12 });
    } finally {
      unsubscribe();
    }

    const after = usePaperStore.getState();
    expect(after.document).toBe(before.document);
    expect(after.undoStack).toBe(before.undoStack);
    expect(notifications).toHaveLength(0);
  });

  it('chains and unchains selected speech or thought bubbles in one undoable edit', () => {
    let document = createDefaultPaperDocument({ title: 'Bubble Chains' });
    const pageId = document.pages[0].id;
    for (const [index, id] of ['bubble-a', 'bubble-b', 'bubble-c'].entries()) {
      document = addFrameToPaperPage(document, pageId, {
        id,
        kind: index === 2 ? 'thoughtBubble' : 'speechBubble',
        label: id,
        xMm: 12 + index * 36,
        yMm: 24,
        widthMm: 30,
        heightMm: 18,
        zIndex: index,
      }).document;
    }
    usePaperStore.setState({
      document,
      selectedPageId: pageId,
      selectedFrameId: 'bubble-c',
      selectedFrameIds: ['bubble-b', 'bubble-a', 'bubble-c'],
      undoStack: [],
      redoStack: [],
    });

    paperEditActions().chainSelectedBubbles();

    const chainedState = usePaperStore.getState();
    const frames = chainedState.document.pages[0].frames;
    const chainId = frames.find((frame) => frame.id === 'bubble-a')?.bubbleChainId;
    expect(chainId).toMatch(/^bubble-chain-/);
    expect(frames.map((frame) => [frame.id, frame.bubbleChainId, frame.bubbleChainOrder])).toEqual([
      ['bubble-a', chainId, 2],
      ['bubble-b', chainId, 1],
      ['bubble-c', chainId, 3],
    ]);
    expect(chainedState.undoStack).toHaveLength(1);

    paperEditActions().unchainSelectedBubbles();
    expect(usePaperStore.getState().document.pages[0].frames.map((frame) => frame.bubbleChainId)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);

    paperEditActions().undo();
    expect(usePaperStore.getState().document.pages[0].frames.map((frame) => frame.bubbleChainId)).toEqual([
      chainId,
      chainId,
      chainId,
    ]);
  });

  it('joins the selected bubble to an Inspector-picked bubble chain and reorders it atomically', () => {
    let document = createDefaultPaperDocument({ title: 'Inspector Bubble Chain' });
    const pageId = document.pages[0].id;
    for (const [index, id] of ['bubble-a', 'bubble-b', 'bubble-c'].entries()) {
      document = addFrameToPaperPage(document, pageId, {
        id,
        kind: 'speechBubble',
        label: id,
        xMm: 12 + index * 36,
        yMm: 24,
        widthMm: 30,
        heightMm: 18,
        zIndex: index,
        ...(index < 2 ? {
          bubbleChainId: 'existing-speaker',
          bubbleChainOrder: index + 1,
          bubbleConnectorStyle: 'line' as const,
        } : {}),
      }).document;
    }
    usePaperStore.setState({
      document,
      selectedPageId: pageId,
      selectedFrameId: 'bubble-c',
      selectedFrameIds: ['bubble-c'],
      undoStack: [],
      redoStack: [],
    });

    paperEditActions().chainSelectedBubbleWith('bubble-a', 'bridge');

    const joined = usePaperStore.getState();
    expect(joined.undoStack).toHaveLength(1);
    expect(joined.document.pages[0].frames.map((frame) => [
      frame.id,
      frame.bubbleChainId,
      frame.bubbleChainOrder,
      frame.bubbleConnectorStyle,
    ])).toEqual([
      ['bubble-a', 'existing-speaker', 1, 'bridge'],
      ['bubble-b', 'existing-speaker', 2, 'bridge'],
      ['bubble-c', 'existing-speaker', 3, 'bridge'],
    ]);

    paperEditActions().moveSelectedBubbleInChain('earlier');
    expect(usePaperStore.getState().document.pages[0].frames.map((frame) => [frame.id, frame.bubbleChainOrder])).toEqual([
      ['bubble-a', 1],
      ['bubble-b', 3],
      ['bubble-c', 2],
    ]);
    expect(usePaperStore.getState().undoStack).toHaveLength(2);

    paperEditActions().moveSelectedBubbleInChain('later');
    expect(usePaperStore.getState().document.pages[0].frames.map((frame) => [frame.id, frame.bubbleChainOrder])).toEqual([
      ['bubble-a', 1],
      ['bubble-b', 2],
      ['bubble-c', 3],
    ]);

    usePaperStore.setState({ selectedFrameIds: ['bubble-a', 'bubble-c'] });
    paperEditActions().unchainBubble('bubble-c');
    expect(usePaperStore.getState().document.pages[0].frames.map((frame) => [frame.id, frame.bubbleChainId])).toEqual([
      ['bubble-a', 'existing-speaker'],
      ['bubble-b', 'existing-speaker'],
      ['bubble-c', undefined],
    ]);

    const beforeLockedAttempt = usePaperStore.getState();
    usePaperStore.setState({
      document: {
        ...beforeLockedAttempt.document,
        pages: beforeLockedAttempt.document.pages.map((page) => ({
          ...page,
          frames: page.frames.map((frame) => frame.id === 'bubble-b' ? { ...frame, locked: true } : frame),
        })),
      },
    });
    const undoCount = usePaperStore.getState().undoStack.length;
    paperEditActions().unchainBubble('bubble-a');
    expect(usePaperStore.getState().undoStack).toHaveLength(undoCount);
    expect(usePaperStore.getState().document.pages[0].frames[0].bubbleChainId).toBe('existing-speaker');

    usePaperStore.setState((state) => ({
      document: {
        ...state.document,
        pages: state.document.pages.map((page) => ({
          ...page,
          frames: page.frames.map((frame) => frame.id === 'bubble-b' ? { ...frame, locked: false } : frame),
        })),
      },
    }));
    paperEditActions().unchainBubble('bubble-a');
    expect(usePaperStore.getState().document.pages[0].frames.slice(0, 2).map((frame) => frame.bubbleChainId)).toEqual([
      undefined,
      undefined,
    ]);
  });

  it('merges complete existing bubble chains from the multi-selection without leaving orphan members', () => {
    let document = createDefaultPaperDocument({ title: 'Merge Existing Bubble Chains' });
    const pageId = document.pages[0].id;
    const chains = [
      ['bubble-a', 'speaker-a', 1],
      ['bubble-b', 'speaker-a', 2],
      ['bubble-c', 'speaker-b', 1],
      ['bubble-d', 'speaker-b', 2],
    ] as const;
    for (const [index, [id, bubbleChainId, bubbleChainOrder]] of chains.entries()) {
      document = addFrameToPaperPage(document, pageId, {
        id,
        kind: 'speechBubble',
        label: id,
        xMm: 12 + index * 34,
        yMm: 24,
        widthMm: 28,
        heightMm: 18,
        zIndex: index,
        bubbleChainId,
        bubbleChainOrder,
        bubbleConnectorStyle: 'line',
      }).document;
    }
    usePaperStore.setState({
      document,
      selectedPageId: pageId,
      selectedFrameId: 'bubble-c',
      selectedFrameIds: ['bubble-a', 'bubble-c'],
      undoStack: [],
      redoStack: [],
    });

    paperEditActions().chainSelectedBubbles();

    const frames = usePaperStore.getState().document.pages[0].frames;
    const mergedId = frames[0].bubbleChainId;
    expect(frames.map((frame) => [frame.id, frame.bubbleChainId, frame.bubbleChainOrder])).toEqual([
      ['bubble-a', mergedId, 1],
      ['bubble-b', mergedId, 2],
      ['bubble-c', mergedId, 3],
      ['bubble-d', mergedId, 4],
    ]);
  });

  it('threads and unthreads selected text frames in one undoable edit', () => {
    let document = createDefaultPaperDocument({ title: 'Text Threads' });
    const pageId = document.pages[0].id;
    for (const [index, id] of ['text-a', 'text-b', 'text-c'].entries()) {
      document = addFrameToPaperPage(document, pageId, {
        id,
        kind: 'text',
        label: id,
        xMm: 12 + index * 36,
        yMm: 24,
        widthMm: 30,
        heightMm: 40,
        zIndex: index,
      }).document;
    }
    usePaperStore.setState({
      document,
      selectedPageId: pageId,
      selectedFrameId: 'text-a',
      selectedFrameIds: ['text-a', 'text-b', 'text-c'],
      undoStack: [],
      redoStack: [],
    });

    paperEditActions().threadSelectedFrames();

    const threadedState = usePaperStore.getState();
    const frames = threadedState.document.pages[0].frames;
    const threadId = frames.find((frame) => frame.id === 'text-a')?.threadId;
    expect(threadId).toMatch(/^text-thread-/);
    expect(frames.map((frame) => [frame.id, frame.threadId, frame.threadOrder])).toEqual([
      ['text-a', threadId, 1],
      ['text-b', threadId, 2],
      ['text-c', threadId, 3],
    ]);
    expect(threadedState.undoStack).toHaveLength(1);

    paperEditActions().unthreadSelectedFrames();
    expect(usePaperStore.getState().document.pages[0].frames.map((frame) => frame.threadId)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);

    paperEditActions().undo();
    expect(usePaperStore.getState().document.pages[0].frames.map((frame) => frame.threadId)).toEqual([
      threadId,
      threadId,
      threadId,
    ]);
  });

  it('persists layer operations as undoable edits and enforces layer locks at store boundaries', () => {
    const pageId = usePaperStore.getState().selectedPageId;
    const frameId = usePaperStore.getState().addFrame('text', { id: 'layered-copy', text: 'Locked copy' })!;
    usePaperStore.setState({ undoStack: [], redoStack: [] });

    const layerId = usePaperStore.getState().addLayer('Lettering')!;
    usePaperStore.getState().renameLayer(layerId, 'Dialogue');
    usePaperStore.getState().moveLayer(layerId, 'backward');
    usePaperStore.getState().setLayerVisibility(layerId, false);
    // The frame is still on the default layer until assignment, so hiding the empty layer keeps selection.
    usePaperStore.getState().setLayerVisibility(layerId, true);
    usePaperStore.getState().setLayerPrintability(layerId, false);
    usePaperStore.getState().assignSelectionToLayer(layerId);
    usePaperStore.getState().setLayerVisibility(layerId, false);
    expect(usePaperStore.getState().selectedFrameId).toBeNull();
    expect(usePaperStore.getState().selectedFrameIds).toEqual([]);
    usePaperStore.getState().setLayerVisibility(layerId, true);
    usePaperStore.getState().selectFrame(frameId);
    usePaperStore.getState().setLayerLocked(layerId, true);

    let state = usePaperStore.getState();
    expect(state.document.layers[0]).toEqual(expect.objectContaining({
      id: layerId,
      name: 'Dialogue',
      visible: true,
      printable: false,
      locked: true,
    }));
    expect(state.document.pages[0].frames.find((frame) => frame.id === frameId)?.layerId).toBe(layerId);
    expect(state.undoStack).toHaveLength(10);

    const historyLength = state.undoStack.length;
    state.updateFrame(pageId, frameId, { text: 'This edit must be blocked' });
    state.nudgeSelectedFrame(5, 5);
    state.runFrameContextAction(pageId, frameId, 'bring-to-front');
    state.runFrameContextAction(pageId, frameId, 'duplicate-frame');
    expect(state.replaceAllInPaperText('Locked', 'Changed')).toBe(0);
    state.deleteSelection();
    state = usePaperStore.getState();
    expect(state.document.pages[0].frames.find((frame) => frame.id === frameId)?.text).toBe('Locked copy');
    expect(state.document.pages[0].frames).toHaveLength(1);
    expect(state.document.pages[0].frames.some((frame) => frame.id === frameId)).toBe(true);
    expect(state.undoStack).toHaveLength(historyLength);

    state.undo();
    expect(usePaperStore.getState().document.layers.find((layer) => layer.id === layerId)?.locked).toBe(false);
  });

  it('restores a safe default from malformed paper document and layout state', () => {
    usePaperStore.getState().restoreSnapshot({
      document: {
        id: 'broken',
        page: null,
        pages: [{ id: 'page-1', frames: null }],
      },
      selectedPageId: 'missing-page',
      selectedFrameId: 'missing-frame',
      tool: 'bad-tool',
      zoom: Number.POSITIVE_INFINITY,
    } as never);

    const state = usePaperStore.getState();
    expect(state.document.pages.length).toBeGreaterThan(0);
    expect(state.selectedPageId).toBe(state.document.pages[0].id);
    expect(state.selectedFrameId).toBeNull();
    expect(state.tool).toBe('select');
    expect(state.zoom).toBe(0.8);
  });
});

describe('paperStore document swatches', () => {
  beforeEach(resetPaperStore);

  it('adds and removes document swatches with undo history', () => {
    expect(usePaperStore.getState().document.swatches ?? []).toEqual([]);

    usePaperStore.getState().addPaperSwatch({
      id: 'sw1',
      name: 'Hot Pink',
      type: 'process',
      model: 'cmyk',
      rgb: { r: 255, g: 0, b: 128 },
      cmyk: { c: 0, m: 100, y: 50, k: 0 },
    });
    expect(usePaperStore.getState().document.swatches?.map((swatch) => swatch.id)).toEqual(['sw1']);

    usePaperStore.getState().removePaperSwatch('sw1');
    expect(usePaperStore.getState().document.swatches).toEqual([]);

    // History is preserved: undoing the removal brings the swatch back.
    usePaperStore.getState().undo();
    expect(usePaperStore.getState().document.swatches?.map((swatch) => swatch.id)).toEqual(['sw1']);
  });

  it('adds, replaces by family+style, and removes imported fonts with history', () => {
    const face = (id: string, patch: Partial<PaperImportedFont> = {}): PaperImportedFont => ({
      id, familyId: 'brandon', familyName: 'Brandon', postscriptName: 'Brandon-Regular',
      weight: 400, style: 'normal', stretchPercent: 100, collectionIndex: 0, variableAxes: {},
      unicodeRanges: [{ start: 0x20, end: 0x7e }], format: 'truetype', fontAsset: fontAssetRef(),
      embeddability: 'installable', canSubset: true, source: { kind: 'user-import' }, license: {}, ...patch,
    });
    const ids = () => usePaperStore.getState().document.importedFonts?.map((f) => f.id);

    usePaperStore.getState().addImportedFont(face('a'));
    expect(ids()).toEqual(['a']);
    // Re-importing the same family+style replaces in place (no duplicate).
    usePaperStore.getState().addImportedFont(face('b'));
    expect(ids()).toEqual(['b']);
    // A different exact face (bold) coexists.
    usePaperStore.getState().addImportedFont(face('c', { weight: 700 }));
    expect(ids()).toEqual(['b', 'c']);

    // Collection faces can share a family/style tuple but still identify different exact source faces.
    usePaperStore.getState().addImportedFont(face('d', { collectionIndex: 1 }));
    expect(ids()).toEqual(['b', 'c', 'd']);

    usePaperStore.getState().removeImportedFont('b');
    expect(ids()).toEqual(['c', 'd']);
    // Undo restores the removed font.
    usePaperStore.getState().undo();
    expect(ids()).toEqual(['b', 'c', 'd']);
  });
});

describe('paperStore managed assets', () => {
  beforeEach(resetPaperStore);

  it('exports Paper snapshots with references but no binary strings', async () => {
    const record = await createBinaryAssetRecord(new Uint8Array([4, 5, 6]), { mimeType: 'image/png' });
    let document = createDefaultPaperDocument({ title: 'Managed asset snapshot' });
    const pageId = document.pages[0].id;
    document = addFrameToPaperPage(document, pageId, {
      kind: 'image',
      xMm: 0,
      yMm: 0,
      widthMm: 40,
      heightMm: 30,
      asset: {
        label: 'Managed panel',
        kind: 'image',
        locator: { kind: 'managed', ref: record.ref },
      },
    } as never).document;
    usePaperStore.setState({ document });

    const snapshot = usePaperStore.getState().exportSnapshot();

    expect(JSON.stringify(snapshot)).not.toMatch(/base64|data:image|blob:/i);
    expect((snapshot as unknown as { assetIds?: string[] }).assetIds).toEqual([record.ref.id]);
  });

  it('migrates legacy inline Paper JSON into repository records before importing it', async () => {
    const legacy = createDefaultPaperDocument({ title: 'Legacy import' });
    legacy.pages[0].frames = [{
      id: 'legacy-panel',
      kind: 'image',
      xMm: 10,
      yMm: 10,
      widthMm: 40,
      heightMm: 30,
      asset: {
        label: 'Legacy panel',
        kind: 'image',
        src: 'data:image/png;base64,AQID',
      },
    }] as never;

    await usePaperStore.getState().importDocumentJson(JSON.stringify(legacy));

    const asset = usePaperStore.getState().document.pages[0].frames[0].asset;
    expect(asset?.locator).toMatchObject({ kind: 'managed' });
    expect(JSON.stringify(usePaperStore.getState().document)).not.toMatch(/data:image|base64/i);
    const ref = asset?.locator?.kind === 'managed' ? asset.locator.ref : undefined;
    expect(ref).toBeDefined();
    expect(await paperAssetRepository.get(ref!.id)).toMatchObject({ bytes: new Uint8Array([1, 2, 3]) });
    await paperAssetRepository.delete(ref!.id);
  });
});

describe('paperStore document tabs', () => {
  beforeEach(resetPaperStore);

  it('keeps the current document open when a new Paper tab is created', () => {
    const firstId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().setZoom(1.25);

    usePaperStore.getState().createNewDocument({ title: '日本語版' });

    expect(usePaperStore.getState().documents).toHaveLength(2);
    expect(usePaperStore.getState().document.title).toBe('日本語版');
    expect(usePaperStore.getState().activeDocumentId).not.toBe(firstId);

    usePaperStore.getState().setActiveDocument(firstId);
    expect(usePaperStore.getState().document.title).toBe('Paper Store Test');
    expect(usePaperStore.getState().zoom).toBe(1.25);
  });

  it('opens .slppr content additively and assigns a unique tab id', async () => {
    const first = usePaperStore.getState().document;
    const imported = createDefaultPaperDocument({ title: 'Imported feature' });
    imported.id = first.id;

    const openedId = usePaperStore.getState().openDocumentJson(JSON.stringify(imported), {
      authorization: capturePaperWorkspaceAuthorization(),
    });

    expect(usePaperStore.getState().documents).toHaveLength(2);
    expect(openedId).not.toBe(first.id);
    expect(usePaperStore.getState().activeDocumentId).toBe(openedId);
    expect(usePaperStore.getState().document.title).toBe('Imported feature');
  });

  it('closes tabs predictably and always leaves one Paper document open', () => {
    const firstId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().createNewDocument({ title: 'Second' });
    const secondId = usePaperStore.getState().activeDocumentId;

    usePaperStore.getState().closeDocument(secondId, { discard: true });
    expect(usePaperStore.getState().activeDocumentId).toBe(firstId);
    expect(usePaperStore.getState().documents).toHaveLength(1);

    usePaperStore.getState().closeDocument(firstId, { discard: true });
    expect(usePaperStore.getState().documents).toHaveLength(1);
    expect(usePaperStore.getState().document.title).toBe('Untitled Paper Layout');
  });

  it('round-trips every open Paper tab through a project snapshot', () => {
    usePaperStore.setState((state) => ({
      document: { ...state.document, title: 'English edition' },
    }));
    const englishId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().createNewDocument({ title: '日本語版' });
    const japaneseId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().setZoom(1.4);
    const snapshot = usePaperStore.getState().exportSnapshot();

    resetPaperStore();
    usePaperStore.getState().restoreSnapshot(snapshot);

    expect(usePaperStore.getState().documents.map((candidate) => candidate.document.title)).toEqual([
      'English edition',
      '日本語版',
    ]);
    expect(usePaperStore.getState().activeDocumentId).toBe(japaneseId);
    expect(usePaperStore.getState().zoom).toBe(1.4);
    usePaperStore.getState().setActiveDocument(englishId);
    expect(usePaperStore.getState().document.title).toBe('English edition');
  });

  it('round-trips snapshot recovery diagnostics through restore and export', () => {
    const document = createDefaultPaperDocument({ title: 'Recovered workspace' });
    const recovery = {
      quarantinedDocuments: [{
        index: 1,
        id: 'tab-broken',
        reason: 'malformed-document',
        payloadJson: '{"id":"tab-broken"}',
      }],
      repairs: ['tab-a: declared asset inventory was stale; recomputed from document content.'],
    };

    usePaperStore.getState().restoreSnapshot({ document, tool: 'select', zoom: 0.8, recovery } as never);

    expect(usePaperStore.getState().document.title).toBe('Recovered workspace');
    expect(usePaperStore.getState().recovery).toMatchObject(recovery);
    expect(usePaperStore.getState().exportSnapshot().recovery).toMatchObject(recovery);

    usePaperStore.getState().restoreSnapshot(undefined);
    expect(usePaperStore.getState().recovery).toBeNull();
    expect(usePaperStore.getState().exportSnapshot().recovery).toBeUndefined();
  });

  it('derives dirty truth from authored content while ignoring navigation and view-only state', () => {
    const initial = usePaperStore.getState().exportSnapshot();
    usePaperStore.getState().restoreSnapshot(initial);
    const documentId = usePaperStore.getState().activeDocumentId;

    expect(paperDirtyActions().isDocumentDirty(documentId)).toBe(false);
    usePaperStore.getState().setZoom(1.3);
    usePaperStore.getState().setTool('hand');
    usePaperStore.getState().selectPage(usePaperStore.getState().document.pages[0].id);
    usePaperStore.getState().toggleViewOption('showGrid');
    expect(paperDirtyActions().isDocumentDirty(documentId)).toBe(false);

    usePaperStore.getState().addFrame('text', { text: 'Authored copy' });
    expect(paperDirtyActions().isDocumentDirty(documentId)).toBe(true);
    usePaperStore.getState().undo();
    expect(paperDirtyActions().isDocumentDirty(documentId)).toBe(false);
  });

  it('detects document, frame, style, thread, guide, asset-reference, and binding mutations', () => {
    const assertMutationDirties = (mutate: () => void) => {
      const document = createDefaultPaperDocument({ title: 'Mutation baseline' });
      usePaperStore.getState().restoreSnapshot({ document, tool: 'select', zoom: 0.8 });
      mutate();
      expect(paperDirtyActions().isDocumentDirty()).toBe(true);
    };

    assertMutationDirties(() => usePaperStore.getState().updateDocumentSetup({ dpi: 450 }));
    assertMutationDirties(() => usePaperStore.getState().addFrame('text', { text: 'Frame mutation' }));
    assertMutationDirties(() => usePaperStore.getState().addPaperSwatch({
      id: 'brand-cyan',
      name: 'Brand cyan',
      color: '#22d3ee',
      model: 'rgb',
    } as never));
    assertMutationDirties(() => {
      const pageId = usePaperStore.getState().selectedPageId;
      usePaperStore.getState().addGuideToPage(pageId, { orientation: 'vertical', positionMm: 24 });
    });
    assertMutationDirties(() => usePaperStore.getState().placeSourceAssetAt({
      item: textItem(),
      point: { xMm: 10, yMm: 10 },
    }));
    assertMutationDirties(() => usePaperStore.getState().toggleViewOption('startOnRight'));

    const threaded = createDefaultPaperDocument({ title: 'Thread baseline' });
    usePaperStore.getState().restoreSnapshot({ document: threaded, tool: 'select', zoom: 0.8 });
    const firstFrame = usePaperStore.getState().addFrame('text', { text: 'First' })!;
    const secondFrame = usePaperStore.getState().addFrame('text', { text: 'Second' })!;
    paperDirtyActions().markDocumentSaved(usePaperStore.getState().activeDocumentId, { kind: 'project' });
    usePaperStore.getState().selectFrame(firstFrame);
    usePaperStore.getState().selectFrameWithMode(secondFrame, 'add');
    usePaperStore.getState().threadSelectedFrames();
    expect(paperDirtyActions().isDocumentDirty()).toBe(true);
  });

  it('distinguishes new unsaved, imported standalone, and project-backed baselines', async () => {
    usePaperStore.getState().createNewDocument({ title: 'Never saved' });
    expect(paperDirtyActions().isDocumentDirty()).toBe(true);

    const imported = createDefaultPaperDocument({ title: 'Imported standalone' });
    const importedId = usePaperStore.getState().openDocumentJson(
      JSON.stringify(imported),
      {
        authorization: capturePaperWorkspaceAuthorization(),
        source: 'standalone',
        path: '/layouts/imported.slppr',
      },
    );
    expect(paperDirtyActions().isDocumentDirty(importedId)).toBe(false);

    usePaperStore.getState().restoreSnapshot({
      document: createDefaultPaperDocument({ title: 'Saved project tab' }),
      tool: 'select',
      zoom: 0.8,
    });
    expect(paperDirtyActions().isDocumentDirty()).toBe(false);
  });

  it('does not clear dirty truth when a project snapshot or flattened export is merely built', () => {
    const documentId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().addPage();
    expect(paperDirtyActions().isDocumentDirty(documentId)).toBe(true);

    const projectSnapshot = usePaperStore.getState().exportSnapshot();
    usePaperStore.getState().exportDocumentJson();
    expect(buildPaperPdfExportRequest(usePaperStore.getState().document).html).toContain('<!doctype html>');
    expect(projectSnapshot.documents?.every((document) => document.persistence === undefined)).toBe(true);
    expect(paperDirtyActions().isDocumentDirty(documentId)).toBe(true);

    paperDirtyActions().markDocumentSaved(documentId, { kind: 'project' });
    expect(paperDirtyActions().isDocumentDirty(documentId)).toBe(false);
  });

  it('keeps edits made after a project snapshot dirty when that exact snapshot is acknowledged', () => {
    const documentId = usePaperStore.getState().activeDocumentId;
    paperDirtyActions().addPage();
    const persistedSnapshot = paperDirtyActions().exportSnapshot();
    paperDirtyActions().addPage();

    paperDirtyActions().markAllDocumentsProjectSaved(persistedSnapshot);

    expect(paperDirtyActions().isDocumentDirty(documentId)).toBe(true);
  });

  it('marks only the acknowledged standalone tab clean', () => {
    const firstId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().addPage();
    usePaperStore.getState().createNewDocument({ title: 'Second dirty tab' });
    const secondId = usePaperStore.getState().activeDocumentId;

    paperDirtyActions().markDocumentSaved(secondId, {
      kind: 'standalone',
      path: '/layouts/second.slppr',
    });

    expect(paperDirtyActions().isDocumentDirty(firstId)).toBe(true);
    expect(paperDirtyActions().isDocumentDirty(secondId)).toBe(false);
  });

  it('refuses an unacknowledged dirty close, closes clean tabs directly, and preserves tab order', () => {
    const firstId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().restoreSnapshot(usePaperStore.getState().exportSnapshot());
    usePaperStore.getState().createNewDocument({ title: 'Dirty middle' });
    const middleId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().createNewDocument({ title: 'Clean end after save' });
    const endId = usePaperStore.getState().activeDocumentId;
    paperDirtyActions().markDocumentSaved(endId, { kind: 'standalone', path: '/layouts/end.slppr' });

    expect(paperDirtyActions().closeDocument(middleId)).toBe(false);
    expect(usePaperStore.getState().documents.map((entry) => entry.id)).toEqual([firstId, middleId, endId]);
    expect(paperDirtyActions().closeDocument(endId)).toBe(true);
    expect(usePaperStore.getState().documents.map((entry) => entry.id)).toEqual([firstId, middleId]);
  });

  it('captures a deliberate discard and restores the exact document into its original order', () => {
    const firstId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().createNewDocument({ title: 'Recover me' });
    const discardedId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().addFrame('text', { id: 'recovery-copy', text: 'Exact recovery text' });
    usePaperStore.getState().createNewDocument({ title: 'Last tab' });

    expect(paperDirtyActions().closeDocument(discardedId, {
      discard: true,
      recoveryReason: 'discard',
    })).toBe(true);
    const recovery = paperDirtyActions().discardedDocumentRecoveries.at(-1);
    expect(recovery?.snapshot.document.title).toBe('Recover me');
    expect(usePaperStore.getState().documents.map((entry) => entry.id)).not.toContain(discardedId);

    const restoredId = paperDirtyActions().restoreDiscardedDocument(recovery!.id);
    expect(restoredId).toBe(discardedId);
    expect(usePaperStore.getState().documents.map((entry) => entry.id)).toEqual([
      firstId,
      discardedId,
      expect.any(String),
    ]);
    expect(usePaperStore.getState().document.pages[0].frames.some((frame) => frame.id === 'recovery-copy')).toBe(true);
    expect(paperDirtyActions().isDocumentDirty(discardedId)).toBe(true);
  });

  it('caps deliberate recovery history instead of growing without bound', () => {
    for (let index = 0; index < 12; index += 1) {
      usePaperStore.getState().createNewDocument({ title: `Discard ${index}` });
      const id = usePaperStore.getState().activeDocumentId;
      expect(paperDirtyActions().closeDocument(id, { discard: true })).toBe(true);
    }

    expect(paperDirtyActions().discardedDocumentRecoveries.length).toBeLessThanOrEqual(8);
    expect(paperDirtyActions().discardedDocumentRecoveries.at(-1)?.snapshot.document.title).toBe('Discard 11');
  });

  it('treats accepted remote authored changes as dirty without changing local view state', () => {
    const documentId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().restoreSnapshot(usePaperStore.getState().exportSnapshot());
    usePaperStore.getState().setZoom(1.55);
    const pageId = usePaperStore.getState().document.pages[0].id;

    expect(usePaperStore.getState().applyRemotePaperDocumentChange({
      type: 'paper-document-snapshot',
      document: {
        ...usePaperStore.getState().document,
        title: 'Remote authored title',
      },
    } as never)).toBe(true);

    expect(paperDirtyActions().isDocumentDirty(documentId)).toBe(true);
    expect(usePaperStore.getState().zoom).toBe(1.55);
    expect(usePaperStore.getState().selectedPageId).toBe(pageId);
  });
});

describe('paperStore per-document undo/redo ownership', () => {
  beforeEach(resetPaperStore);

  const frameIdsOnFirstPage = () =>
    usePaperStore.getState().document.pages[0].frames.map((frame) => frame.id);
  const storedHistoryIds = () => Object.keys(usePaperStore.getState().documentHistories);

  it('preserves local undo/redo history while applying a cross-device workspace update', () => {
    usePaperStore.getState().addFrame('text', { id: 'history-a', text: 'A' });
    usePaperStore.getState().addFrame('text', { id: 'history-b', text: 'B' });
    paperEditActions().undo();
    expect(usePaperStore.getState().undoStack).toHaveLength(1);
    expect(usePaperStore.getState().redoStack).toHaveLength(1);

    const snapshot = usePaperStore.getState().exportSnapshot();
    const remoteDocument = { ...snapshot.document, title: 'Remote title' };
    const change = createPaperWorkspaceSnapshotChange({
      ...snapshot,
      document: remoteDocument,
      documents: snapshot.documents?.map((candidate) => candidate.id === snapshot.activeDocumentId
        ? { ...candidate, document: remoteDocument }
        : candidate),
    });
    expect(usePaperStore.getState().applyRemotePaperWorkspaceSnapshot(change.workspace)).toBe(true);

    expect(usePaperStore.getState().document.title).toBe('Remote title');
    expect(usePaperStore.getState().undoStack).toHaveLength(1);
    expect(usePaperStore.getState().redoStack).toHaveLength(1);
  });

  it('keeps undo/redo history owned by each document across tab switches', () => {
    const aId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().addFrame('text', { id: 'a-frame', text: 'A copy' });
    expect(usePaperStore.getState().undoStack).toHaveLength(1);

    usePaperStore.getState().createNewDocument({ title: 'Document B' });
    const bId = usePaperStore.getState().activeDocumentId;
    expect(usePaperStore.getState().undoStack).toHaveLength(0);
    usePaperStore.getState().addFrame('text', { id: 'b-frame-1', text: 'B copy' });
    usePaperStore.getState().addFrame('text', { id: 'b-frame-2', text: 'B copy 2' });
    expect(usePaperStore.getState().undoStack).toHaveLength(2);

    usePaperStore.getState().setActiveDocument(aId);
    expect(usePaperStore.getState().undoStack).toHaveLength(1);
    paperEditActions().undo();
    expect(frameIdsOnFirstPage()).not.toContain('a-frame');
    expect(frameIdsOnFirstPage()).not.toContain('b-frame-1');
    paperEditActions().redo();
    expect(frameIdsOnFirstPage()).toContain('a-frame');

    usePaperStore.getState().setActiveDocument(bId);
    expect(usePaperStore.getState().undoStack).toHaveLength(2);
    paperEditActions().undo();
    expect(frameIdsOnFirstPage()).toContain('b-frame-1');
    expect(frameIdsOnFirstPage()).not.toContain('b-frame-2');
    expect(frameIdsOnFirstPage()).not.toContain('a-frame');
  });

  it('preserves a populated redo stack across an A→B→A round trip', () => {
    const aId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().addFrame('text', { id: 'a-frame', text: 'A copy' });
    paperEditActions().undo();
    expect(usePaperStore.getState().redoStack).toHaveLength(1);

    usePaperStore.getState().createNewDocument({ title: 'Document B' });
    usePaperStore.getState().setActiveDocument(aId);

    expect(usePaperStore.getState().redoStack).toHaveLength(1);
    paperEditActions().redo();
    expect(frameIdsOnFirstPage()).toContain('a-frame');
  });

  it('closing a tab removes only its history and a reused document id starts clean', async () => {
    const aId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().addFrame('text', { id: 'a-frame', text: 'A copy' });

    const imported = createDefaultPaperDocument({ title: 'Reused tab' });
    imported.id = 'reused-tab';
    const openedId = usePaperStore.getState().openDocumentJson(JSON.stringify(imported), {
      authorization: capturePaperWorkspaceAuthorization(),
    });
    expect(openedId).toBe('reused-tab');
    usePaperStore.getState().addFrame('text', { id: 'reused-frame', text: 'Reused copy' });

    usePaperStore.getState().setActiveDocument(aId);
    expect(usePaperStore.getState().closeDocument('reused-tab', { discard: true })).toBe(true);
    expect(usePaperStore.getState().undoStack).toHaveLength(1);
    expect(storedHistoryIds()).not.toContain('reused-tab');

    const reopened = createDefaultPaperDocument({ title: 'Reused tab again' });
    reopened.id = 'reused-tab';
    const reopenedId = usePaperStore.getState().openDocumentJson(JSON.stringify(reopened), {
      authorization: capturePaperWorkspaceAuthorization(),
    });
    expect(reopenedId).toBe('reused-tab');
    expect(usePaperStore.getState().undoStack).toHaveLength(0);
    expect(storedHistoryIds()).not.toContain('reused-tab');

    usePaperStore.getState().setActiveDocument(aId);
    expect(usePaperStore.getState().undoStack).toHaveLength(1);
  });

  it('replacing one tab clears only that tab’s history', () => {
    const aId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().addFrame('text', { id: 'a-frame', text: 'A copy' });

    usePaperStore.getState().createNewDocument({ title: 'Document B' });
    const bId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().addFrame('text', { id: 'b-frame', text: 'B copy' });
    usePaperStore.getState().setActiveDocument(aId);

    const authorization = capturePaperWorkspaceAuthorization();
    const replacement = createDefaultPaperDocument({ title: 'Replaced B' });
    expect(usePaperStore.getState().replaceDocument(bId, replacement, { authorization })).toBe(true);
    expect(storedHistoryIds()).not.toContain(bId);
    expect(usePaperStore.getState().undoStack).toHaveLength(1);

    usePaperStore.getState().setActiveDocument(bId);
    expect(usePaperStore.getState().undoStack).toHaveLength(0);
    usePaperStore.getState().setActiveDocument(aId);
    expect(usePaperStore.getState().undoStack).toHaveLength(1);
  });

  it('opens an authorized generated layout as a new dirty tab without replacing the active document', () => {
    const previousId = usePaperStore.getState().activeDocumentId;
    const authorization = capturePaperWorkspaceAuthorization();
    const generated = createDefaultPaperDocument({ title: 'Assisted layout' });
    generated.id = 'assisted-layout';

    const generatedId = usePaperStore.getState().addGeneratedDocument(generated, { authorization });

    expect(generatedId).toMatch(/^paper-document-/);
    expect(generatedId).not.toBe('assisted-layout');
    expect(usePaperStore.getState().activeDocumentId).toBe(generatedId);
    expect(usePaperStore.getState().documents.map((entry) => entry.id)).toContain(previousId);
    expect(usePaperStore.getState().document.id).toBe(generatedId);
    expect(usePaperStore.getState().isDocumentDirty(generatedId!)).toBe(true);
    expect(usePaperStore.getState().undoStack).toHaveLength(0);
  });

  it('freshens the complete identity graph when the same generated proposal is opened twice', () => {
    let generated = createDefaultPaperDocument({ title: 'Repeatable assisted layout' });
    generated.id = 'provider-document';
    generated.pages[0].id = 'provider-page';
    generated = addFrameToPaperPage(generated, 'provider-page', {
      id: 'provider-frame',
      kind: 'text',
      text: 'Generated copy',
      xMm: 10,
      yMm: 10,
      widthMm: 80,
      heightMm: 20,
    }).document;

    const firstId = usePaperStore.getState().addGeneratedDocument(generated, {
      authorization: capturePaperWorkspaceAuthorization(),
    })!;
    const first = usePaperStore.getState().document;
    const secondId = usePaperStore.getState().addGeneratedDocument(generated, {
      authorization: capturePaperWorkspaceAuthorization(),
    })!;
    const second = usePaperStore.getState().document;

    expect(secondId).not.toBe(firstId);
    expect(second.id).not.toBe(first.id);
    expect(second.pages.map((page) => page.id)).not.toEqual(first.pages.map((page) => page.id));
    expect(second.pages.flatMap((page) => page.frames.map((frame) => frame.id)))
      .not.toEqual(first.pages.flatMap((page) => page.frames.map((frame) => frame.id)));
    expect(new Set(usePaperStore.getState().documents.map((entry) => entry.document.id)).size)
      .toBe(usePaperStore.getState().documents.length);
  });

  it('caps each document’s history independently at the 50-entry bound', () => {
    const aId = usePaperStore.getState().activeDocumentId;
    for (let index = 0; index < 55; index += 1) {
      usePaperStore.getState().updateDocumentSetup({ dpi: 300 + index });
    }
    expect(usePaperStore.getState().undoStack).toHaveLength(50);

    usePaperStore.getState().createNewDocument({ title: 'Document B' });
    const bId = usePaperStore.getState().activeDocumentId;
    for (let index = 0; index < 55; index += 1) {
      usePaperStore.getState().updateDocumentSetup({ dpi: 300 + index });
    }
    expect(usePaperStore.getState().undoStack).toHaveLength(50);

    usePaperStore.getState().setActiveDocument(aId);
    expect(usePaperStore.getState().undoStack).toHaveLength(50);
    usePaperStore.getState().setActiveDocument(bId);
    expect(usePaperStore.getState().undoStack).toHaveLength(50);
  });

  it('keeps runtime history out of project snapshots and the persisted projection', () => {
    const aId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().addFrame('text', { id: 'a-frame', text: 'A copy' });
    usePaperStore.getState().createNewDocument({ title: 'Document B' });
    usePaperStore.getState().addFrame('text', { id: 'b-frame', text: 'B copy' });
    usePaperStore.getState().setActiveDocument(aId);
    expect(usePaperStore.getState().undoStack).toHaveLength(1);

    const snapshotJson = JSON.stringify(usePaperStore.getState().exportSnapshot());
    expect(snapshotJson).not.toContain('"undoStack"');
    expect(snapshotJson).not.toContain('"redoStack"');
    expect(snapshotJson).not.toContain('"documentHistories"');

    const persisted = projectPersistedPaperWorkspace(usePaperStore.getState());
    expect(Object.keys(persisted)).not.toContain('undoStack');
    expect(Object.keys(persisted)).not.toContain('redoStack');
    expect(Object.keys(persisted)).not.toContain('documentHistories');

    // Even a hostile persisted record carrying history payloads cannot resurrect them at boot.
    const merged = mergePersistedPaperWorkspace(
      {
        ...persisted,
        undoStack: usePaperStore.getState().undoStack,
        documentHistories: usePaperStore.getState().documentHistories,
      },
      usePaperStore.getState(),
    );
    expect(merged.undoStack).toEqual([]);
    expect(merged.redoStack).toEqual([]);
    expect(merged.documentHistories).toEqual({});
  });

  it('keeps captured recovery history out of the persisted projection and rehydrate', () => {
    const aId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().addFrame('text', { id: 'a-frame', text: 'A copy' });
    usePaperStore.getState().createNewDocument({ title: 'Document B' });
    const bId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().addFrame('text', { id: 'b-frame', text: 'B copy' });
    usePaperStore.getState().setActiveDocument(aId);

    const recoveryIds = paperDirtyActions().captureDocumentRecovery([bId], 'baton-handoff');
    expect(recoveryIds).toHaveLength(1);
    const liveRecovery = usePaperStore.getState().discardedDocumentRecoveries
      .find((candidate) => candidate.id === recoveryIds[0]);
    expect(liveRecovery?.undoStack).toHaveLength(1);

    const persisted = projectPersistedPaperWorkspace(usePaperStore.getState());
    const persistedJson = JSON.stringify(persisted);
    expect(persistedJson).not.toContain('"undoStack"');
    expect(persistedJson).not.toContain('"redoStack"');
    expect(persistedJson).not.toContain('"documentHistories"');

    // Rehydrate must ignore history fields even when an older or hostile stored record has them.
    const merged = mergePersistedPaperWorkspace(
      { ...persisted, discardedDocumentRecoveries: usePaperStore.getState().discardedDocumentRecoveries },
      usePaperStore.getState(),
    );
    expect(merged.discardedDocumentRecoveries).toHaveLength(1);
    expect(merged.discardedDocumentRecoveries[0].undoStack).toBeUndefined();
    expect(merged.discardedDocumentRecoveries[0].redoStack).toBeUndefined();
    expect(merged.discardedDocumentRecoveries[0].snapshot.document.title).toBe('Document B');

    // Same-session deliberate restore still hands the tab its own history back.
    const restoredId = paperDirtyActions().restoreDiscardedDocument(recoveryIds[0]);
    expect(restoredId).toBeDefined();
    expect(usePaperStore.getState().undoStack).toHaveLength(1);
    paperEditActions().undo();
    expect(frameIdsOnFirstPage()).not.toContain('b-frame');
  });

  it('captures and restores an inactive tab’s own history through deliberate recovery', () => {
    const aId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().addFrame('text', { id: 'a-frame', text: 'A copy' });

    usePaperStore.getState().createNewDocument({ title: 'Inactive target' });
    const targetId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().addFrame('text', { id: 'target-frame', text: 'Target copy' });

    usePaperStore.getState().setActiveDocument(aId);
    usePaperStore.getState().addFrame('text', { id: 'a-second-frame', text: 'A second copy' });

    const recoveryIds = paperDirtyActions().captureDocumentRecovery([targetId], 'baton-handoff');
    expect(recoveryIds).toHaveLength(1);
    const recovery = usePaperStore.getState().discardedDocumentRecoveries
      .find((candidate) => candidate.id === recoveryIds[0]);
    expect(recovery?.undoStack).toHaveLength(1);
    expect(recovery?.undoStack?.[0].document.title).toBe('Inactive target');

    const restoredId = paperDirtyActions().restoreDiscardedDocument(recoveryIds[0]);
    expect(restoredId).toBeDefined();
    expect(usePaperStore.getState().undoStack).toHaveLength(1);
    paperEditActions().undo();
    expect(frameIdsOnFirstPage()).not.toContain('target-frame');

    usePaperStore.getState().setActiveDocument(aId);
    expect(usePaperStore.getState().undoStack).toHaveLength(2);
  });

  it('whole-workspace restore resets runtime history without leaking the prior workspace', () => {
    const aId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().addFrame('text', { id: 'a-frame', text: 'A copy' });
    usePaperStore.getState().createNewDocument({ title: 'Document B' });
    const bId = usePaperStore.getState().activeDocumentId;
    usePaperStore.getState().addFrame('text', { id: 'b-frame', text: 'B copy' });
    usePaperStore.getState().setActiveDocument(aId);
    expect(usePaperStore.getState().undoStack).toHaveLength(1);
    expect(storedHistoryIds()).toContain(bId);

    usePaperStore.getState().restoreSnapshot(usePaperStore.getState().exportSnapshot());

    expect(usePaperStore.getState().undoStack).toEqual([]);
    expect(usePaperStore.getState().redoStack).toEqual([]);
    expect(usePaperStore.getState().documentHistories).toEqual({});

    usePaperStore.getState().setActiveDocument(bId);
    expect(usePaperStore.getState().undoStack).toEqual([]);
    expect(usePaperStore.getState().redoStack).toEqual([]);
  });
});

describe('paperStore review comments', () => {
  beforeEach(() => {
    resetPaperStore();
  });

  it('adds, replies, resolves, reopens, and deletes review threads as undoable document edits', () => {
    const pageId = usePaperStore.getState().selectedPageId;
    const actions = usePaperStore.getState();

    const commentId = actions.addReviewComment({ pageId, author: 'Vera', body: 'Check the margin.' });
    expect(commentId).toBeTruthy();
    expect(usePaperStore.getState().document.reviewComments).toHaveLength(1);

    const replyId = usePaperStore.getState().addReviewReply(commentId!, { author: 'Sol', body: 'On it.' });
    expect(replyId).toBeTruthy();
    expect(usePaperStore.getState().document.reviewComments?.[0]?.replies).toHaveLength(1);

    usePaperStore.getState().setReviewCommentResolved(commentId!, true);
    expect(usePaperStore.getState().document.reviewComments?.[0]?.resolvedAt).toBeGreaterThan(0);

    usePaperStore.getState().setReviewCommentResolved(commentId!, false);
    expect(usePaperStore.getState().document.reviewComments?.[0]?.resolvedAt).toBeUndefined();

    // Each of the four actions above pushed exactly one undo entry and touching the comment
    // list never changed pages, frames, or layout state.
    expect(usePaperStore.getState().undoStack).toHaveLength(4);
    expect(usePaperStore.getState().document.pages[0].frames).toEqual([]);

    paperEditActions().undo();
    expect(usePaperStore.getState().document.reviewComments?.[0]?.resolvedAt).toBeGreaterThan(0);

    // Undoing reopen restores doc-with-reply; the next undo removes the resolve stamp; then
    // the reply; then the thread itself.
    paperEditActions().undo();
    expect(usePaperStore.getState().document.reviewComments?.[0]?.resolvedAt).toBeUndefined();
    expect(usePaperStore.getState().document.reviewComments?.[0]?.replies).toHaveLength(1);

    paperEditActions().undo();
    expect(usePaperStore.getState().document.reviewComments?.[0]?.replies).toHaveLength(0);

    paperEditActions().undo();
    expect(usePaperStore.getState().document.reviewComments).toBeUndefined();

    // The store actions keep the bounds contract: blank bodies create nothing and push nothing.
    const before = usePaperStore.getState();
    expect(before.addReviewComment({ pageId, author: 'X', body: '   ' })).toBeUndefined();
    expect(usePaperStore.getState().undoStack).toHaveLength(0);
    expect(usePaperStore.getState().document).toBe(before.document);
  });

  it('deletes one review thread as a single undoable edit', () => {
    const pageId = usePaperStore.getState().selectedPageId;
    const state = usePaperStore.getState();
    const a = state.addReviewComment({ pageId, author: 'A', body: 'One' });
    const b = usePaperStore.getState().addReviewComment({ pageId, author: 'B', body: 'Two' });
    usePaperStore.getState().deleteReviewComment(a!);

    expect(usePaperStore.getState().document.reviewComments?.map((comment) => comment.id)).toEqual([b]);
    expect(usePaperStore.getState().undoStack).toHaveLength(3);

    paperEditActions().undo();
    expect(
      usePaperStore.getState().document.reviewComments?.map((comment) => comment.id).sort(),
    ).toEqual([a, b].sort());
  });
});

describe('Paper data merge store actions', () => {
  beforeEach(resetPaperStore);

  function frameWithToken() {
    const document = usePaperStore.getState().document;
    return addFrameToPaperPage(document, document.pages[0].id, {
      kind: 'text', xMm: 12, yMm: 12, widthMm: 80, heightMm: 30, text: 'Hi {{merge:name}}',
    }).document;
  }

  it('attaches a bounded source as one undoable, persisted edit', () => {
    usePaperStore.setState({ document: frameWithToken() });
    const before = usePaperStore.getState().document;

    usePaperStore.getState().updatePaperDataMerge({
      version: 1,
      name: 'Guests',
      columns: [{ name: 'name' }],
      records: [{ id: 'ada', values: { name: 'Ada' } }],
    });

    const attached = usePaperStore.getState().document;
    expect(attached).not.toBe(before);
    expect(attached.dataMerge?.name).toBe('Guests');
    expect(attached.dataMerge?.records.map((record) => record.id)).toEqual(['ada']);
    expect(before.dataMerge).toBeUndefined();
    expect(usePaperStore.getState().undoStack).toHaveLength(1);

    usePaperStore.getState().undo();
    expect('dataMerge' in usePaperStore.getState().document).toBe(false);
  });

  it('clears the source on null, undefined, empty collections, and invalid payloads', () => {
    usePaperStore.setState({ document: frameWithToken() });
    usePaperStore.getState().updatePaperDataMerge({
      version: 1, name: 'Guests', columns: [{ name: 'name' }], records: [{ id: 'ada', values: { name: 'Ada' } }],
    });
    expect(usePaperStore.getState().document.dataMerge).toBeDefined();

    for (const payload of [null, undefined, '', [], {}, { version: 1, name: '', columns: [], records: [] }]) {
      const previous = usePaperStore.getState().document;
      usePaperStore.getState().updatePaperDataMerge(payload);
      expect('dataMerge' in usePaperStore.getState().document).toBe(false);
      // A clear is a real state change that can be undone back to the prior source.
      expect(usePaperStore.getState().document).not.toBe(previous);
      paperEditActions().undo();
      expect(usePaperStore.getState().document.dataMerge?.name).toBe('Guests');
    }
  });

  it('survives save/reopen with the source and rehydrates a cleared document without any data-merge key', () => {
    usePaperStore.setState({ document: frameWithToken() });
    usePaperStore.getState().updatePaperDataMerge({
      version: 1, name: 'Recipients', columns: [{ name: 'name' }], records: [{ id: 'ada', values: { name: 'Ada' } }],
    });
    const saved = usePaperStore.getState().exportDocumentJson();
    expect(parsePaperDocument(saved).dataMerge?.name).toBe('Recipients');

    usePaperStore.getState().updatePaperDataMerge(null);
    const clearedJson = usePaperStore.getState().exportDocumentJson();
    expect(clearedJson.includes('"dataMerge"')).toBe(false);
    expect(parsePaperDocument(clearedJson).dataMerge).toBeUndefined();
  });
});
