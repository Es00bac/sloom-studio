import { describe, expect, it } from 'vitest';
import {
  applyPaperLiveAgentOperation,
  buildPaperLiveAgentSnapshot,
  createPaperLiveAgentContext,
  parsePaperLiveAgentTurn,
  PaperLiveAgentValidationError,
  type PaperLiveAgentOperation,
} from './paperLiveLayoutAgent';
import { createDefaultPaperDocument } from './paperDocument';
import type { SourceBinLibraryItem } from '../store/sourceBinStore';

function makeSourceItem(id: string, label = 'Plate'): SourceBinLibraryItem {
  return {
    id,
    label,
    kind: 'image',
    addedAt: 0,
    updatedAt: 0,
  } as unknown as SourceBinLibraryItem;
}

function agentFrameOp(overrides: Record<string, unknown> = {}): PaperLiveAgentOperation {
  return {
    op: 'addFrame',
    id: 'agent-frame-1',
    pageId: '',
    kind: 'text',
    label: 'Title',
    geometry: { xMm: 20, yMm: 20, widthMm: 80, heightMm: 20 },
    text: 'Hello',
    ...overrides,
  } as PaperLiveAgentOperation;
}

describe('parsePaperLiveAgentTurn', () => {
  it('parses a strict JSON turn', () => {
    const turn = parsePaperLiveAgentTurn(JSON.stringify({
      status: 'working',
      message: 'Laying out page one.',
      operations: [{ op: 'setBackground', color: '#101010' }],
    }));
    expect(turn.status).toBe('working');
    expect(turn.operations).toHaveLength(1);
  });

  it('rejects fenced or commented responses', () => {
    expect(() => parsePaperLiveAgentTurn('```json\n{"status":"done","operations":[]}\n```'))
      .toThrow(PaperLiveAgentValidationError);
    expect(() => parsePaperLiveAgentTurn('Here you go: {"status":"done","operations":[]}'))
      .toThrow(PaperLiveAgentValidationError);
  });

  it('rejects operations outside the agent ID namespace', () => {
    expect(() => parsePaperLiveAgentTurn(JSON.stringify({
      status: 'working',
      operations: [agentFrameOp({ id: 'frame-user-owned' })],
    }))).toThrow(PaperLiveAgentValidationError);
  });

  it('rejects active content in strings', () => {
    expect(() => parsePaperLiveAgentTurn(JSON.stringify({
      status: 'working',
      operations: [agentFrameOp({ text: 'visit https://evil.example' })],
    }))).toThrow(PaperLiveAgentValidationError);
    expect(() => parsePaperLiveAgentTurn(JSON.stringify({
      status: 'working',
      operations: [agentFrameOp({ label: '<script>alert(1)</script>' })],
    }))).toThrow(PaperLiveAgentValidationError);
  });

  it('rejects unknown operations and extra keys', () => {
    expect(() => parsePaperLiveAgentTurn(JSON.stringify({
      status: 'working',
      operations: [{ op: 'deleteEverything' }],
    }))).toThrow(PaperLiveAgentValidationError);
    expect(() => parsePaperLiveAgentTurn(JSON.stringify({
      status: 'working',
      operations: [{ op: 'setBackground', color: '#ffffff', execute: 'rm -rf /' }],
    }))).toThrow(PaperLiveAgentValidationError);
  });

  it('caps operations per turn', () => {
    const operations = Array.from({ length: 41 }, () => ({ op: 'setBackground', color: '#ffffff' }));
    try {
      parsePaperLiveAgentTurn(JSON.stringify({ status: 'working', operations }));
      expect.unreachable('expected the turn to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(PaperLiveAgentValidationError);
      expect((error as PaperLiveAgentValidationError).issues.some((issue) => issue.message.includes('0-40'))).toBe(true);
    }
  });
});

describe('applyPaperLiveAgentOperation', () => {
  it('adds a page and resolves its alias for later frames', () => {
    const doc = createDefaultPaperDocument({ title: 'Agent test' });
    const context = createPaperLiveAgentContext(() => undefined);
    const pageResult = applyPaperLiveAgentOperation(doc, { op: 'addPage', id: 'agent-page-2' }, context);
    expect(pageResult.changed).toBe(true);
    expect(pageResult.document.pages).toHaveLength(doc.pages.length + 1);

    const frameResult = applyPaperLiveAgentOperation(
      pageResult.document,
      agentFrameOp({ pageId: 'agent-page-2' }),
      context,
    );
    expect(frameResult.changed).toBe(true);
    const lastPage = frameResult.document.pages[frameResult.document.pages.length - 1];
    expect(lastPage.frames).toHaveLength(1);
    expect(lastPage.frames[0].id).toBe('agent-frame-1');
    expect(lastPage.frames[0].text).toBe('Hello');
    expect(context.ownedFrameIds.has('agent-frame-1')).toBe(true);
  });

  it('applies style and typography to new frames', () => {
    const doc = createDefaultPaperDocument({ title: 'Agent test' });
    const context = createPaperLiveAgentContext(() => undefined);
    const pageId = doc.pages[0].id;
    const result = applyPaperLiveAgentOperation(doc, agentFrameOp({
      pageId,
      style: {
        fill: { kind: 'hex', value: '#FF0000' },
        strokeWidthMm: 0.5,
        typography: { fontSizePt: 24, align: 'center', color: '#00FF00', fontWeight: 700 },
      },
    }), context);
    const frame = result.document.pages[0].frames.find((candidate) => candidate.id === 'agent-frame-1');
    expect(frame?.fillColor).toBe('#ff0000');
    expect(frame?.typography?.fontSizePt).toBe(24);
    expect(frame?.typography?.align).toBe('center');
    expect(frame?.typography?.fontWeight).toBe('700');
  });

  it('updates and removes only agent-owned frames', () => {
    const doc = createDefaultPaperDocument({ title: 'Agent test' });
    const context = createPaperLiveAgentContext(() => undefined);
    const pageId = doc.pages[0].id;
    const added = applyPaperLiveAgentOperation(doc, agentFrameOp({ pageId }), context);

    const updated = applyPaperLiveAgentOperation(added.document, {
      op: 'updateFrame',
      frameId: 'agent-frame-1',
      patch: { text: 'Revised', geometry: { xMm: 30, yMm: 30, widthMm: 90, heightMm: 25 } },
    }, context);
    const frame = updated.document.pages[0].frames.find((candidate) => candidate.id === 'agent-frame-1');
    expect(frame?.text).toBe('Revised');
    expect(frame?.xMm).toBe(30);

    const removed = applyPaperLiveAgentOperation(updated.document, { op: 'removeFrame', frameId: 'agent-frame-1' }, context);
    expect(removed.changed).toBe(true);
    expect(removed.document.pages[0].frames.some((candidate) => candidate.id === 'agent-frame-1')).toBe(false);
    expect(context.ownedFrameIds.size).toBe(0);
  });

  it('refuses to touch frames the agent did not create', () => {
    const doc = createDefaultPaperDocument({ title: 'Agent test' });
    const context = createPaperLiveAgentContext(() => undefined);
    const pageId = doc.pages[0].id;
    const added = applyPaperLiveAgentOperation(doc, agentFrameOp({ pageId }), context);
    const foreign = createPaperLiveAgentContext(() => undefined);

    const result = applyPaperLiveAgentOperation(added.document, {
      op: 'updateFrame',
      frameId: 'agent-frame-1',
      patch: { text: 'Hijacked' },
    }, foreign);
    expect(result.changed).toBe(false);
    const frame = result.document.pages[0].frames.find((candidate) => candidate.id === 'agent-frame-1');
    expect(frame?.text).toBe('Hello');
  });

  it('places a source asset only into owned image frames', () => {
    const doc = createDefaultPaperDocument({ title: 'Agent test' });
    const item = makeSourceItem('src-plate-1', 'Cover plate');
    const context = createPaperLiveAgentContext((id) => (id === 'src-plate-1' ? item : undefined));
    const pageId = doc.pages[0].id;
    const added = applyPaperLiveAgentOperation(doc, agentFrameOp({ pageId, kind: 'image', text: undefined }), context);

    const placed = applyPaperLiveAgentOperation(added.document, {
      op: 'placeSourceAsset',
      frameId: 'agent-frame-1',
      sourceItemId: 'src-plate-1',
    }, context);
    expect(placed.changed).toBe(true);
    const frame = placed.document.pages[0].frames.find((candidate) => candidate.id === 'agent-frame-1');
    expect(frame?.asset?.label).toBe('Cover plate');

    const missing = applyPaperLiveAgentOperation(added.document, {
      op: 'placeSourceAsset',
      frameId: 'agent-frame-1',
      sourceItemId: 'src-nope',
    }, context);
    expect(missing.changed).toBe(false);
  });

  it('sets background and margins through the document setup path', () => {
    const doc = createDefaultPaperDocument({ title: 'Agent test' });
    const context = createPaperLiveAgentContext(() => undefined);
    const bg = applyPaperLiveAgentOperation(doc, { op: 'setBackground', color: '#112233' }, context);
    expect(bg.document.background.color).toBe('#112233');
    const margins = applyPaperLiveAgentOperation(bg.document, {
      op: 'setMargins',
      margins: { top: 10, right: 12, bottom: 10, left: 12 },
    }, context);
    expect(margins.document.layout.marginsMm.left).toBe(12);
  });
});

describe('buildPaperLiveAgentSnapshot', () => {
  it('lists pages, frames with ownership, and source items', () => {
    const doc = createDefaultPaperDocument({ title: 'Agent test' });
    const context = createPaperLiveAgentContext(() => undefined);
    const added = applyPaperLiveAgentOperation(doc, agentFrameOp({ pageId: doc.pages[0].id }), context);
    const snapshot = buildPaperLiveAgentSnapshot(added.document, context, [
      { id: 'src-plate-1', label: 'Cover plate', kind: 'image' },
    ]);
    expect(snapshot).toContain('PAGE[1]');
    expect(snapshot).toContain('agent-frame-1');
    expect(snapshot).toContain('agent-owned');
    expect(snapshot).toContain('src-plate-1');
  });
});
