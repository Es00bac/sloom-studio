// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectEffectiveRichEditorSelectionTypographies, createRichEditorBase, richTextToEditorHtml, serializeRichEditor } from '../../../lib/paperRichTextDom';
import { paperManagedFontFamilyAlias, requestedExactPaperManagedFacesForTypographyPatch, verifyExactPaperManagedFaceRegistration } from '../../../lib/paperExactManagedFonts';
import type { PaperManagedFontFace, PaperTypography } from '../../../types/paper';
import {
  applyTypographyToActiveRichEditor,
  applyTypographyPatchToDomSelection,
  applyTypographyToDomSelection,
  registerPaperRichEditorSession,
  resolvePaperRichEditorTypographyUpdate,
  runPaperRichEditorCommand,
} from './paperRichEditorSession';

const TYPOGRAPHY: PaperTypography = {
  fontFamily: 'Inter', fontSizePt: 12, leadingPt: 15, tracking: 0, fontKerning: 'auto', align: 'left',
  hyphenate: true, color: '#111111', fontWeight: '400', fontStyle: 'normal', numericStyle: 'normal',
};

function editorWith(text: string): HTMLDivElement {
  const editor = document.createElement('div');
  editor.innerHTML = richTextToEditorHtml([{ runs: [{ text }] }], 1);
  document.body.append(editor);
  return editor;
}

function textNodeContaining(root: HTMLElement, value: string): Text {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode() as Text | null;
  while (node) {
    if (node.data.includes(value)) return node;
    node = walker.nextNode() as Text | null;
  }
  throw new Error(`No text node containing ${value}`);
}

function expectSynchronous<T>(value: T | Promise<T>): T {
  if (value instanceof Promise) throw new Error('Expected a synchronous rich-editor transaction.');
  return value;
}

afterEach(() => { document.body.replaceChildren(); });

function managedVariableFace(): PaperManagedFontFace {
  const sha256 = 'b'.repeat(64);
  return {
    id: 'managed-variable-640',
    familyId: 'managed-variable',
    familyName: 'Managed Variable',
    postscriptName: 'ManagedVariable-Oblique',
    weight: 640,
    style: 'oblique',
    obliqueAngleDeg: 12,
    stretchPercent: 75,
    collectionIndex: 0,
    variableAxes: {
      wdth: { min: 50, default: 100, max: 200 },
      wght: { min: 100, default: 400, max: 900 },
    },
    variationSettings: { wdth: 75, wght: 640 },
    unicodeRanges: [{ start: 0x20, end: 0x7e }],
    format: 'truetype',
    fontAsset: { id: `sha256:${sha256}`, sha256, mimeType: 'font/ttf', byteLength: 3 },
    embeddability: 'installable',
    canSubset: true,
    source: { kind: 'user-import' },
    license: {},
  };
}

function managedFamilyFace(
  family: 'Atlas Serif' | 'Beacon Sans',
  variant: 'regular' | 'bold' | 'italic',
): PaperManagedFontFace {
  const familyKey = family === 'Atlas Serif' ? 'atlas' : 'beacon';
  const sha256 = (familyKey === 'atlas' ? (variant === 'regular' ? '1' : variant === 'bold' ? '2' : '3') : (variant === 'regular' ? '4' : variant === 'bold' ? '5' : '6')).repeat(64);
  return {
    id: `${familyKey}-${variant}`,
    familyId: familyKey,
    familyName: family,
    postscriptName: `${family.replace(' ', '')}-${variant}`,
    weight: variant === 'bold' ? 700 : 400,
    style: variant === 'italic' ? 'italic' : 'normal',
    stretchPercent: 100,
    collectionIndex: 0,
    variableAxes: {},
    unicodeRanges: [],
    format: 'truetype',
    fontAsset: { id: `sha256:${sha256}`, sha256, mimeType: 'font/ttf', byteLength: 3 },
    embeddability: 'installable',
    canSubset: true,
    source: { kind: 'user-import' },
    license: {},
  };
}

describe('active rich editor Inspector formatting', () => {
  it('resolves face-changing selection edits from each effective run and preserves mixed managed families', () => {
    const faces = (['Atlas Serif', 'Beacon Sans'] as const).flatMap((family) => [
      managedFamilyFace(family, 'regular'),
      managedFamilyFace(family, 'bold'),
    ]);
    const editor = document.createElement('div');
    editor.innerHTML = richTextToEditorHtml([{ runs: [
      { text: 'Atlas', fontFamily: 'Atlas Serif' },
      { text: ' Beacon', fontFamily: 'Beacon Sans' },
    ] }], 1, { typography: TYPOGRAPHY, managedFonts: faces });
    document.body.append(editor);
    const atlasText = textNodeContaining(editor, 'Atlas');
    const beaconText = textNodeContaining(editor, ' Beacon');
    const range = document.createRange();
    range.setStart(atlasText, 0);
    range.setEnd(beaconText, beaconText.length);
    const base = createRichEditorBase(TYPOGRAPHY, 1, faces);

    const effective = collectEffectiveRichEditorSelectionTypographies(editor, range, TYPOGRAPHY, base);
    expect(effective.map((item) => item.fontFamily)).toEqual(['Atlas Serif', 'Beacon Sans']);
    expect(requestedExactPaperManagedFacesForTypographyPatch(effective, { fontWeight: '700' }, faces).map((face) => face.id))
      .toEqual(['atlas-bold', 'beacon-bold']);

    const applied = applyTypographyPatchToDomSelection(
      editor,
      range,
      { fontWeight: '700' },
      1,
      { typography: TYPOGRAPHY, managedFonts: faces },
    );
    expect(applied?.applied).toBe(true);
    const painted = Array.from(editor.querySelectorAll<HTMLSpanElement>('span[data-paper-font-family]'))
      .filter((span) => span.style.fontWeight === '700');
    expect(painted.map((span) => [span.dataset.paperFontFamily, span.style.fontFamily])).toEqual([
      ['Atlas Serif', `"${paperManagedFontFamilyAlias(faces[1])}"`],
      ['Beacon Sans', `"${paperManagedFontFamilyAlias(faces[3])}"`],
    ]);
    const serialized = serializeRichEditor(editor, base);
    expect(serialized[0].runs.map((run) => [run.text, run.fontFamily, run.fontWeight])).toEqual([
      ['Atlas', 'Atlas Serif', '700'],
      [' Beacon', 'Beacon Sans', '700'],
    ]);
  });

  it.each(['bold', 'italic'] as const)('authenticates every managed %s target before executing and leaves the DOM unchanged on rejection', async (command) => {
    const faces = (['Atlas Serif', 'Beacon Sans'] as const).flatMap((family) => [
      managedFamilyFace(family, 'regular'),
      managedFamilyFace(family, command === 'bold' ? 'bold' : 'italic'),
    ]);
    const editor = document.createElement('div');
    editor.innerHTML = richTextToEditorHtml([{ runs: [
      { text: 'Atlas', fontFamily: 'Atlas Serif' },
      { text: ' Beacon', fontFamily: 'Beacon Sans' },
    ] }], 1, { typography: TYPOGRAPHY, managedFonts: faces });
    document.body.append(editor);
    const atlasText = textNodeContaining(editor, 'Atlas');
    const beaconText = textNodeContaining(editor, ' Beacon');
    const range = document.createRange();
    range.setStart(atlasText, 0);
    range.setEnd(beaconText, beaconText.length);
    const before = editor.innerHTML;
    const executeCommand = vi.fn();

    await expect(runPaperRichEditorCommand({
      editor,
      range,
      typography: TYPOGRAPHY,
      zoom: 1,
      managedFonts: faces,
      command,
      isCommandActive: () => false,
      authenticateFace: async (face) => {
        if (face.familyName === 'Beacon Sans') throw new Error('Beacon target unavailable');
      },
      executeCommand,
    })).rejects.toThrow('Beacon target unavailable');

    expect(executeCommand).not.toHaveBeenCalled();
    expect(editor.innerHTML).toBe(before);
  });

  it('uses the authenticated managed Bold face patch instead of letting execCommand synthesize a face', async () => {
    const faces = [managedFamilyFace('Atlas Serif', 'regular'), managedFamilyFace('Atlas Serif', 'bold')];
    const editor = document.createElement('div');
    editor.innerHTML = richTextToEditorHtml([{ runs: [{ text: 'Atlas', fontFamily: 'Atlas Serif' }] }], 1, {
      typography: TYPOGRAPHY,
      managedFonts: faces,
    });
    document.body.append(editor);
    const text = textNodeContaining(editor, 'Atlas');
    const range = document.createRange();
    range.selectNodeContents(text);
    const executeFacePatch = vi.fn();
    const executeCommand = vi.fn();

    await runPaperRichEditorCommand({
      editor,
      range,
      typography: TYPOGRAPHY,
      zoom: 1,
      managedFonts: faces,
      command: 'bold',
      isCommandActive: () => false,
      authenticateFace: async () => undefined,
      executeFacePatch,
      executeCommand,
    });

    expect(executeFacePatch).toHaveBeenCalledWith({ fontWeight: '700' });
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('authenticates and selects the exact target alias for a managed Bold command at a caret', async () => {
    const faces = [managedFamilyFace('Atlas Serif', 'regular'), managedFamilyFace('Atlas Serif', 'bold')];
    const editor = document.createElement('div');
    editor.innerHTML = richTextToEditorHtml([{ runs: [{ text: 'Atlas', fontFamily: 'Atlas Serif' }] }], 1, {
      typography: TYPOGRAPHY,
      managedFonts: faces,
    });
    document.body.append(editor);
    const text = textNodeContaining(editor, 'Atlas');
    const caret = document.createRange();
    caret.setStart(text, 2);
    caret.collapse(true);
    const executeCollapsedManagedCommand = vi.fn();
    const executeCommand = vi.fn();

    await runPaperRichEditorCommand({
      editor,
      range: caret,
      typography: TYPOGRAPHY,
      zoom: 1,
      managedFonts: faces,
      command: 'bold',
      isCommandActive: () => false,
      authenticateFace: async () => undefined,
      executeCollapsedManagedCommand,
      executeCommand,
    });

    expect(executeCollapsedManagedCommand).toHaveBeenCalledWith(faces[1], { fontWeight: '700' });
    expect(executeCommand).not.toHaveBeenCalled();
  });

  it('awaits exact alias authentication and preserves Managed Variable 640/75 wdth/wght oblique 12deg through DOM, serialization, and reopen', async () => {
    const face = managedVariableFace();
    const alias = paperManagedFontFamilyAlias(face);
    const editor = editorWith('Managed Variable');
    const text = textNodeContaining(editor, 'Managed Variable');
    const range = document.createRange();
    range.selectNodeContents(text);
    let releaseLoad!: (faces: Set<FontFace>) => void;
    const loadPromise = new Promise<Set<FontFace>>((resolve) => { releaseLoad = resolve; });
    const descriptors: string[] = [];
    const fonts = {
      ready: Promise.resolve(),
      load: (descriptor: string) => {
        descriptors.push(descriptor);
        return loadPromise;
      },
      check: () => true,
    };
    const target = { fonts } as unknown as Document;
    const next: PaperTypography = {
      ...TYPOGRAPHY,
      fontFamily: 'Managed Variable',
      fontWeight: '640',
      fontStretch: '75%',
      fontStyle: 'oblique 12deg',
      fontVariationSettings: { wdth: 75, wght: 640 },
    };
    const dispose = registerPaperRichEditorSession('managed-variable', {
      applyTypography: async (previous, requested) => {
        await verifyExactPaperManagedFaceRegistration(target, face);
        const applied = applyTypographyToDomSelection(
          editor,
          range,
          previous,
          requested,
          1,
          { typography: previous, managedFonts: [face] },
        );
        if (!applied) return null;
        const richText = serializeRichEditor(editor, createRichEditorBase(previous, 1, [face]));
        return { richText, text: 'Managed Variable' };
      },
    });

    const pending = resolvePaperRichEditorTypographyUpdate(
      'managed-variable',
      TYPOGRAPHY,
      next,
      [{ runs: [{ text: 'Managed Variable' }] }],
    );
    expect(pending).toBeInstanceOf(Promise);
    expect(editor.querySelector(`[style*="${alias}"]`)).toBeNull();
    releaseLoad(new Set([{ family: alias, status: 'loaded' } as FontFace]));
    const resolved = await pending;

    expect(descriptors).toEqual([`oblique 12deg 640 condensed 16px "${alias}"`]);
    const painted = editor.querySelector<HTMLSpanElement>(`span[data-paper-font-family="Managed Variable"]`);
    expect(painted).not.toBeNull();
    expect(painted!.style.fontFamily).toBe(`"${alias}"`);
    expect(painted!.style.fontWeight).toBe('640');
    expect(painted!.style.fontStretch).toBe('75%');
    expect(painted!.style.getPropertyValue('font-variation-settings')).toContain('"wdth" 75');
    expect(painted!.dataset.paperFontStyle).toBe('oblique 12deg');
    expect(resolved.typography).toMatchObject(next);
    expect(resolved.richText?.[0].runs[0]).toMatchObject({
      text: 'Managed Variable',
      fontFamily: 'Managed Variable',
      fontWeight: '640',
      fontStretch: '75%',
      fontStyle: 'oblique 12deg',
      fontVariationSettings: { wdth: 75, wght: 640 },
    });

    const reopened = document.createElement('div');
    reopened.innerHTML = richTextToEditorHtml(resolved.richText ?? [], 1, { typography: next, managedFonts: [face] });
    const reopenedSpan = reopened.querySelector<HTMLSpanElement>('span');
    expect(reopenedSpan?.style.fontFamily).toBe(`"${alias}"`);
    expect(reopenedSpan?.dataset.paperFontFamily).toBe('Managed Variable');
    expect(reopenedSpan?.dataset.paperFontStyle).toBe('oblique 12deg');
    dispose();
  });

  it('retains a range edit while persisting vertical writing on and off', () => {
    const editor = editorWith('Selected rich words');
    const text = textNodeContaining(editor, 'Selected rich words');
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 8);
    const dispose = registerPaperRichEditorSession('vertical-range', {
      applyTypography: (previous, next) => {
        const applied = applyTypographyToDomSelection(editor, range, previous, next, 1);
        if (!applied) return null;
        const richText = serializeRichEditor(editor, {
          colorHex: '#111111', fontFamily: 'Inter', fontSizePx: 12 * 1.333, leadingPx: 15 * 1.333, zoom: 1,
        });
        return { richText, text: 'Selected rich words' };
      },
    });
    const vertical = { ...TYPOGRAPHY, writingMode: 'vertical-rl' as const, align: 'center' as const };

    const enabled = expectSynchronous(resolvePaperRichEditorTypographyUpdate('vertical-range', TYPOGRAPHY, vertical, [{ runs: [{ text: 'stale' }] }]));
    expect(enabled.typography.writingMode).toBe('vertical-rl');
    expect(enabled.richText?.[0]).toMatchObject({ align: 'center' });
    expect(enabled.richText?.[0].runs.map((run) => run.text).join('')).toBe('Selected rich words');

    const disabled = expectSynchronous(resolvePaperRichEditorTypographyUpdate('vertical-range', vertical, TYPOGRAPHY, enabled.richText));
    expect(disabled.typography.writingMode).toBeUndefined();
    expect(disabled.richText?.[0].runs.map((run) => run.text).join('')).toBe('Selected rich words');
    dispose();
  });

  it('persists vertical writing at a collapsed caret without discarding current rich content', () => {
    const editor = editorWith('Caret preserves rich text');
    const text = textNodeContaining(editor, 'Caret preserves rich text');
    const caret = document.createRange();
    caret.setStart(text, 3);
    caret.collapse(true);
    const dispose = registerPaperRichEditorSession('vertical-caret', {
      applyTypography: (previous, next) => {
        const applied = applyTypographyToDomSelection(editor, caret, previous, next, 1);
        if (!applied) return null;
        const richText = serializeRichEditor(editor, {
          colorHex: '#111111', fontFamily: 'Inter', fontSizePx: 12 * 1.333, leadingPx: 15 * 1.333, zoom: 1,
        });
        return { richText, text: 'Caret preserves rich text' };
      },
    });
    const next = { ...TYPOGRAPHY, writingMode: 'vertical-rl' as const, align: 'center' as const };

    const result = expectSynchronous(resolvePaperRichEditorTypographyUpdate('vertical-caret', TYPOGRAPHY, next, [{ runs: [{ text: 'stale' }] }]));
    expect(result.typography.writingMode).toBe('vertical-rl');
    expect(result.richText?.[0]).toMatchObject({ align: 'center' });
    expect(result.richText?.[0].runs.map((run) => run.text).join('')).toBe('Caret preserves rich text');
    dispose();
  });

  it('persists vertical writing on and off with no active editor while preserving saved rich content', () => {
    const richText = [{ runs: [{ text: 'Saved rich content', fontWeight: '700' }] }];
    const vertical = { ...TYPOGRAPHY, writingMode: 'vertical-rl' as const };

    const enabled = expectSynchronous(resolvePaperRichEditorTypographyUpdate('inactive-frame', TYPOGRAPHY, vertical, richText));
    expect(enabled.typography.writingMode).toBe('vertical-rl');
    expect(enabled.richText).toEqual(richText);
    const disabled = expectSynchronous(resolvePaperRichEditorTypographyUpdate('inactive-frame', vertical, TYPOGRAPHY, enabled.richText));
    expect(disabled.typography.writingMode).toBeUndefined();
    expect(disabled.richText).toEqual(richText);
  });

  it('authors color, tracking, kerning, and exact size on only the highlighted words', () => {
    const editor = editorWith('Hello selected words');
    const text = textNodeContaining(editor, 'Hello selected words');
    const range = document.createRange();
    range.setStart(text, 6);
    range.setEnd(text, 14);
    const next: PaperTypography = {
      ...TYPOGRAPHY,
      color: '#ef4444',
      tracking: 80,
      fontKerning: 'none',
      fontSizePt: 18,
    };
    const applied = applyTypographyToDomSelection(editor, range, TYPOGRAPHY, next, 1);
    expect(applied?.applied).toBe(true);

    const rich = serializeRichEditor(editor, {
      colorHex: '#111111', fontFamily: 'Inter', fontSizePx: 12 * 1.333, leadingPx: 15 * 1.333,
      fontWeight: '400', fontStyle: 'normal', fontKerning: 'auto', tracking: 0, numericStyle: 'normal', zoom: 1,
    });
    expect(rich[0].runs.map((run) => run.text).join('')).toBe('Hello selected words');
    const selected = rich[0].runs.find((run) => run.text === 'selected');
    expect(selected).toMatchObject({ color: '#ef4444', tracking: 80, fontKerning: 'none' });
    expect(selected?.fontSizePt).toBeCloseTo(18, 1);
    expect(rich[0].runs[0]).toEqual({ text: 'Hello ' });
  });

  it('authors lower leading on only the highlighted run without replacing paragraph leading', () => {
    const editor = document.createElement('div');
    editor.innerHTML = richTextToEditorHtml([{
      leadingPt: 22,
      runs: [{ text: 'Before selected after' }],
    }], 1);
    document.body.append(editor);
    const text = textNodeContaining(editor, 'Before selected after');
    const range = document.createRange();
    range.setStart(text, 7);
    range.setEnd(text, 15);

    const applied = applyTypographyPatchToDomSelection(editor, range, { leadingPt: 11 }, 1);

    expect(applied?.applied).toBe(true);
    const rich = serializeRichEditor(editor, createRichEditorBase(TYPOGRAPHY, 1));
    expect(rich).toEqual([{
      leadingPt: 22,
      runs: [
        { text: 'Before ' },
        { text: 'selected', leadingPt: 11 },
        { text: ' after' },
      ],
    }]);

    const trailing = textNodeContaining(editor, ' after');
    const adjacentRange = document.createRange();
    adjacentRange.selectNodeContents(trailing);
    expect(applyTypographyPatchToDomSelection(editor, adjacentRange, { leadingPt: 11 }, 1)?.applied).toBe(true);
    const merged = serializeRichEditor(editor, createRichEditorBase(TYPOGRAPHY, 1));
    expect(merged).toEqual([{
      leadingPt: 22,
      runs: [
        { text: 'Before ' },
        { text: 'selected after', leadingPt: 11 },
      ],
    }]);

    const reopened = document.createElement('div');
    reopened.innerHTML = richTextToEditorHtml(merged, 1);
    expect(serializeRichEditor(reopened, createRichEditorBase(TYPOGRAPHY, 1))).toEqual(merged);
  });

  it('applies paragraph typesetting at a caret without rewriting character styles', () => {
    const editor = editorWith('Paragraph text');
    const text = textNodeContaining(editor, 'Paragraph text');
    const range = document.createRange();
    range.setStart(text, 4);
    range.collapse(true);
    const next = { ...TYPOGRAPHY, align: 'justify' as const, leadingPt: 19, spaceAfterMm: 3, hyphenate: false };
    const applied = applyTypographyToDomSelection(editor, range, TYPOGRAPHY, next, 1);
    expect(applied?.applied).toBe(true);
    const rich = serializeRichEditor(editor, {
      colorHex: '#111111', fontFamily: 'Inter', fontSizePx: 12 * 1.333, leadingPx: 15 * 1.333, zoom: 1,
    });
    expect(rich[0]).toMatchObject({ align: 'justify', leadingPt: 19, spaceAfterMm: 3, hyphenate: false });
    expect(rich[0].runs).toEqual([{ text: 'Paragraph text' }]);
  });

  it('falls back to frame formatting for a collapsed character selection', () => {
    const editor = editorWith('Caret');
    const text = textNodeContaining(editor, 'Caret');
    const range = document.createRange();
    range.setStart(text, 2);
    range.collapse(true);
    expect(applyTypographyToDomSelection(editor, range, TYPOGRAPHY, { ...TYPOGRAPHY, color: '#ffffff' }, 1)).toBeNull();
  });

  it('registers and removes the active editor by frame id', () => {
    const dispose = registerPaperRichEditorSession('frame-a', {
      applyTypography: () => ({ text: 'updated', richText: [{ runs: [{ text: 'updated' }] }] }),
    });
    expect(expectSynchronous(applyTypographyToActiveRichEditor('frame-a', TYPOGRAPHY, { ...TYPOGRAPHY, tracking: 20 }))?.text).toBe('updated');
    dispose();
    expect(applyTypographyToActiveRichEditor('frame-a', TYPOGRAPHY, { ...TYPOGRAPHY, tracking: 20 })).toBeNull();
  });
});
