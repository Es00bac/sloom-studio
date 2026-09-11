#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { packMagazineContainer } from './create-signaloom-magazine-demo.mjs';

const PAGE_W = 210;
const PAGE_H = 297;
const BLEED = 3;
const NOW = 1_784_188_800_000;
const FONT_ROOT_DEFAULT = '/home/cabewse/work_SPaC3/fonts';
const ICC_PATH = resolve(new URL('../public/icc/FOGRA39L_coated.icc', import.meta.url).pathname);

const FONT = {
  sans: '"IBM Plex Sans Condensed", "Liberation Sans Narrow", sans-serif',
  serif: '"Newsreader", "Source Serif 4", serif',
  display: '"Abril Fatface", "Bodoni Moda", serif',
  mono: '"IBM Plex Mono", "Liberation Mono", monospace',
  jp: '"Noto Sans JP", "Noto Sans CJK JP", sans-serif',
};

const C = {
  paper: '#f4f0e6',
  white: '#ffffff',
  ink: '#101218',
  muted: '#656976',
  cobalt: '#143dbb',
  cyan: '#16d6dc',
  coral: '#ff5c55',
  orange: '#ff9a43',
  magenta: '#e31b70',
  blueBlack: '#071426',
  midnight: '#050910',
  mist: '#dce5e8',
};

const DEFAULT_TYPOGRAPHY = {
  fontFamily: FONT.serif,
  fontSizePt: 9,
  leadingPt: 12,
  tracking: 0,
  align: 'left',
  alignLast: 'left',
  hyphenate: true,
  color: C.ink,
  fontWeight: '400',
  fontStyle: 'normal',
  firstLineIndentMm: 0,
  smallCaps: false,
  numericStyle: 'normal',
  dropCapLines: 0,
  spaceBeforeMm: 0,
  spaceAfterMm: 0,
  lineBreak: 'pretty',
  writingMode: 'horizontal-tb',
  textOrientation: 'mixed',
  lineBreakStrict: false,
  emphasis: 'none',
};

function flattenRichText(richText) {
  return richText.map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');
}

function frame(id, kind, xMm, yMm, widthMm, heightMm, options = {}) {
  const richText = options.richText;
  const image = kind === 'image';
  const shape = kind === 'shape' || kind === 'panel';
  return {
    id,
    kind: kind === 'shape' ? 'panel' : kind,
    label: options.label ?? id,
    xMm,
    yMm,
    widthMm,
    heightMm,
    rotationDeg: options.rotationDeg ?? 0,
    locked: options.locked ?? false,
    text: richText ? flattenRichText(richText) : (options.text ?? ''),
    ...(richText ? { richText } : {}),
    ...(options.asset ? { asset: options.asset } : {}),
    fit: options.fit ?? (image ? 'cover' : 'contain'),
    imageScale: options.imageScale ?? 1,
    imageOffsetXPercent: options.imageOffsetXPercent ?? 0,
    imageOffsetYPercent: options.imageOffsetYPercent ?? 0,
    imageRotationDeg: options.imageRotationDeg ?? 0,
    imageFlipX: false,
    imageFlipY: false,
    columns: options.columns ?? 1,
    ...(options.columnGutterMm !== undefined ? { columnGutterMm: options.columnGutterMm } : {}),
    ...(options.columnRule !== undefined ? { columnRule: options.columnRule } : {}),
    ...(options.columnBalance !== undefined ? { columnBalance: options.columnBalance } : {}),
    ...(options.threadId ? { threadId: options.threadId, threadOrder: options.threadOrder ?? 0 } : {}),
    typography: { ...DEFAULT_TYPOGRAPHY, ...options.typography },
    fillColor: options.fillColor ?? (image ? C.blueBlack : shape ? C.paper : 'transparent'),
    fillOpacity: options.fillOpacity ?? (kind === 'text' ? 0 : 1),
    ...(options.fillGradient ? { fillGradient: options.fillGradient } : {}),
    strokeColor: options.strokeColor ?? 'transparent',
    strokeOpacity: options.strokeOpacity ?? 1,
    strokeWidthMm: options.strokeWidthMm ?? 0,
    strokeStyle: options.strokeStyle ?? 'solid',
    cornerRadiusMm: options.cornerRadiusMm ?? 0,
    opacity: options.opacity ?? 1,
    textBoxXPercent: options.textBoxXPercent ?? 0,
    textBoxYPercent: options.textBoxYPercent ?? 0,
    textBoxWidthPercent: options.textBoxWidthPercent ?? 100,
    textBoxHeightPercent: options.textBoxHeightPercent ?? 100,
    textRotationDeg: options.textRotationDeg ?? 0,
    textVerticalAlign: options.textVerticalAlign ?? 'top',
    zIndex: options.zIndex ?? 1,
    ...(options.paragraphStyleId ? { paragraphStyleId: options.paragraphStyleId } : {}),
    ...(options.characterStyleId ? { characterStyleId: options.characterStyleId } : {}),
    ...(options.objectStyleId ? { objectStyleId: options.objectStyleId } : {}),
    inherited: false,
  };
}

function page(number, frames, { parentPageId = 'parent-editorial', guides = [] } = {}) {
  return {
    id: `zine-page-${number}`,
    pageNumber: number,
    ...(parentPageId ? { parentPageId } : {}),
    guides: [...baseGuides(), ...guides],
    frames,
  };
}

function baseGuides() {
  return [
    { id: 'live-left', orientation: 'vertical', positionMm: 14, label: 'Live left' },
    { id: 'col-1', orientation: 'vertical', positionMm: 58.5, label: 'Column 1' },
    { id: 'center', orientation: 'vertical', positionMm: 105, label: 'Center' },
    { id: 'col-3', orientation: 'vertical', positionMm: 151.5, label: 'Column 3' },
    { id: 'live-right', orientation: 'vertical', positionMm: 196, label: 'Live right' },
    { id: 'live-top', orientation: 'horizontal', positionMm: 14, label: 'Live top' },
    { id: 'live-bottom', orientation: 'horizontal', positionMm: 283, label: 'Live bottom' },
  ];
}

function running(number, section, { inverse = false, top = 10 } = {}) {
  const color = inverse ? C.white : C.cobalt;
  return [
    frame(`p${number}-run-rule`, 'shape', 14, top, 182, 0.55, { fillColor: inverse ? C.cyan : C.cobalt, zIndex: 20 }),
    frame(`p${number}-run-section`, 'text', 14, top + 3, 140, 7, {
      text: section.toUpperCase(), paragraphStyleId: 'p-running',
      typography: { fontFamily: FONT.mono, fontSizePt: 6.2, leadingPt: 7, tracking: 105, fontWeight: '600', color, hyphenate: false }, zIndex: 21,
    }),
    frame(`p${number}-folio`, 'text', 181, top + 3, 15, 7, {
      text: String(number).padStart(2, '0'), paragraphStyleId: 'p-running',
      typography: { fontFamily: FONT.mono, fontSizePt: 6.4, leadingPt: 7, tracking: 70, align: 'right', fontWeight: '700', color, hyphenate: false }, zIndex: 21,
    }),
  ];
}

function imageAsset(record, label, pixelWidth, pixelHeight) {
  return {
    label,
    kind: 'image',
    locator: { kind: 'managed', ref: record.ref },
    mimeType: record.ref.mimeType,
    pixelWidth,
    pixelHeight,
    embeddedAt: NOW,
  };
}

function textPanel(id, x, y, w, h, text, options = {}) {
  return frame(id, 'text', x, y, w, h, {
    text,
    typography: {
      fontFamily: options.fontFamily ?? FONT.serif,
      fontSizePt: options.fontSizePt ?? 8.8,
      leadingPt: options.leadingPt ?? 11.8,
      columns: options.columns,
      align: options.align ?? 'left',
      alignLast: options.alignLast ?? 'left',
      hyphenate: options.hyphenate ?? true,
      color: options.color ?? C.ink,
      fontWeight: options.fontWeight ?? '400',
      fontStyle: options.fontStyle ?? 'normal',
      tracking: options.tracking ?? 0,
      lineBreak: options.lineBreak ?? 'pretty',
      writingMode: options.writingMode ?? 'horizontal-tb',
      textOrientation: 'mixed',
      lineBreakStrict: options.lineBreakStrict ?? false,
      ...(options.dropCapLines ? { dropCapLines: options.dropCapLines } : {}),
    },
    columns: options.columns ?? 1,
    columnGutterMm: options.columnGutterMm ?? 6,
    columnRule: options.columnRule ?? false,
    columnBalance: options.columnBalance ?? false,
    ...(options.threadId ? { threadId: options.threadId, threadOrder: options.threadOrder ?? 0 } : {}),
    zIndex: options.zIndex ?? 6,
    paragraphStyleId: options.paragraphStyleId ?? 'p-body',
  });
}

function coverPage(a) {
  const cover = imageAsset(a.cover, 'Flow · Sloom Studio origin cover composite · print-resampled', 2688, 3600);
  return page(1, [
    frame('p1-cover-image', 'image', -BLEED, -BLEED, 216, 303, { asset: cover, fit: 'cover', imageScale: 1.02, zIndex: 1 }),
    frame('p1-left-fade', 'shape', -BLEED, -BLEED, 121, 303, {
      fillColor: C.midnight, fillOpacity: 0.93, fillGradient: { type: 'linear', fromColor: '#050910f5', toColor: '#05091000', angleDeg: 90 }, zIndex: 3,
    }),
    frame('p1-top-band', 'shape', 0, 0, 210, 3, { fillColor: C.cyan, zIndex: 9 }),
    frame('p1-masthead', 'text', 14, 15, 164, 31, {
      richText: [{ runs: [
        { text: 'SLOOM', fontFamily: FONT.sans, fontSizePt: 48, fontWeight: '700', tracking: -35, color: C.white },
        { text: ' / ', fontFamily: FONT.mono, fontSizePt: 12, fontWeight: '400', tracking: 0, color: C.cyan },
        { text: 'STUDIO', fontFamily: FONT.display, fontSizePt: 38, fontWeight: '400', fontStyle: 'normal', tracking: -10, color: C.white },
      ] }],
      typography: { fontFamily: FONT.sans, fontSizePt: 42, leadingPt: 43, fontWeight: '700', color: C.white, hyphenate: false, lineBreak: 'balance' }, zIndex: 10,
    }),
    frame('p1-issue', 'text', 14, 52, 95, 8, {
      text: 'ORIGIN ISSUE  /  01  /  DEMONSTRATION EDITION',
      typography: { fontFamily: FONT.mono, fontSizePt: 6.2, leadingPt: 7, tracking: 95, fontWeight: '600', color: C.cyan, hyphenate: false }, zIndex: 10,
    }),
    frame('p1-title', 'text', 14, 174, 119, 52, {
      text: 'THE STUDIO\nTHAT GREW\nSIDEWAYS', paragraphStyleId: 'p-cover',
      typography: { fontFamily: FONT.sans, fontSizePt: 31, leadingPt: 30, tracking: -22, fontWeight: '700', color: C.white, hyphenate: false, lineBreak: 'balance' }, zIndex: 10,
    }),
    frame('p1-deck', 'text', 15, 232, 100, 25, {
      text: 'How one personal node graph became four connected creative rooms—and, eventually, a place to finish the page.',
      typography: { fontFamily: FONT.serif, fontSizePt: 10.2, leadingPt: 13, fontWeight: '400', color: C.white, hyphenate: false, lineBreak: 'pretty' }, zIndex: 10,
    }),
    frame('p1-jp', 'text', 181, 25, 14, 112, {
      text: '信号《しんごう》を\n織《お》り、\n創作《そうさく》を\n頁《ページ》へ。',
      typography: { fontFamily: FONT.jp, fontSizePt: 10.5, leadingPt: 16, tracking: 35, fontWeight: '700', color: C.coral, writingMode: 'vertical-rl', textOrientation: 'mixed', lineBreakStrict: true, hyphenate: false }, zIndex: 10,
    }),
    frame('p1-coverline', 'text', 14, 272, 119, 12, {
      text: 'FLOW → VIDEO → IMAGE → PAPER',
      typography: { fontFamily: FONT.mono, fontSizePt: 7, leadingPt: 8, tracking: 110, fontWeight: '700', color: C.orange, hyphenate: false }, zIndex: 10,
    }),
    frame('p1-demo', 'text', 148, 279, 48, 8, {
      text: 'CONCEPT PUBLICATION · NOT FOR SALE',
      typography: { fontFamily: FONT.mono, fontSizePt: 5.4, leadingPt: 6.2, tracking: 40, align: 'right', fontWeight: '600', color: C.white, hyphenate: false }, zIndex: 10,
    }),
  ], { parentPageId: null });
}

function insideCoverPage(a) {
  const logo = imageAsset(a.logo, 'Sloom Studio official logo', 512, 512);
  return page(2, [
    frame('p2-bg', 'shape', -BLEED, -BLEED, 216, 303, { fillColor: C.cobalt, zIndex: 0 }),
    frame('p2-signal', 'shape', 14, 16, 2, 150, { fillColor: C.coral, zIndex: 2 }),
    frame('p2-manifesto', 'text', 25, 18, 165, 111, {
      richText: [
        { runs: [{ text: 'MAKE THE PATH ', fontFamily: FONT.sans, fontSizePt: 39, fontWeight: '700', tracking: -25, color: C.white }, { text: 'VISIBLE.', fontFamily: FONT.display, fontSizePt: 39, fontWeight: '400', color: C.cyan }] },
        { runs: [{ text: 'KEEP THE MATERIAL ', fontFamily: FONT.sans, fontSizePt: 39, fontWeight: '700', tracking: -25, color: C.white }, { text: 'MOVING.', fontFamily: FONT.display, fontSizePt: 39, fontWeight: '400', color: C.orange }] },
        { runs: [{ text: 'FINISH THE ', fontFamily: FONT.sans, fontSizePt: 39, fontWeight: '700', tracking: -25, color: C.white }, { text: 'PAGE.', fontFamily: FONT.display, fontSizePt: 39, fontWeight: '400', color: C.coral }] },
      ],
      typography: { fontFamily: FONT.sans, fontSizePt: 39, leadingPt: 39, fontWeight: '700', color: C.white, hyphenate: false, lineBreak: 'balance' }, zIndex: 4,
    }),
    frame('p2-logo', 'image', 25, 155, 28, 28, { asset: logo, fit: 'contain', zIndex: 4 }),
    frame('p2-note', 'text', 62, 156, 128, 35, {
      text: 'This is a demonstration zine made in Sloom Studio Paper from assets built in named Flow workspaces. Its advertisements and products are fictional. Its story is grounded in the creator’s account.',
      typography: { fontFamily: FONT.serif, fontSizePt: 10.2, leadingPt: 13.5, fontWeight: '400', color: C.white, hyphenate: false, lineBreak: 'pretty' }, zIndex: 4,
    }),
    frame('p2-colophon-rule', 'shape', 25, 213, 165, 0.5, { fillColor: C.cyan, zIndex: 4 }),
    frame('p2-colophon-head', 'text', 25, 220, 35, 8, {
      text: 'COLOPHON', typography: { fontFamily: FONT.mono, fontSizePt: 6.5, leadingPt: 7, tracking: 120, fontWeight: '700', color: C.cyan, hyphenate: false }, zIndex: 4,
    }),
    frame('p2-colophon', 'text', 62, 220, 128, 50, {
      text: 'Story and art direction / Sloom Studio demo\nGenerated image assets / Atlas Cloud nodes in Flow\nLayout and production / Paper workspace\nType / IBM Plex Sans Condensed, Newsreader, Abril Fatface, IBM Plex Mono, Noto Sans JP\nOutput intent / FOGRA39 · 300% TAC · 3 mm bleed',
      columns: 2, columnGutterMm: 8, columnBalance: true,
      typography: { fontFamily: FONT.mono, fontSizePt: 6.4, leadingPt: 9.4, tracking: 15, fontWeight: '400', color: C.white, hyphenate: false }, zIndex: 4,
    }),
    frame('p2-folio', 'text', 181, 282, 15, 7, { text: '02', typography: { fontFamily: FONT.mono, fontSizePt: 6.4, leadingPt: 7, align: 'right', fontWeight: '700', color: C.white, hyphenate: false }, zIndex: 4 }),
  ], { parentPageId: null });
}

function contentsPage(a) {
  const kern = imageAsset(a.kernProduct, 'Flow · KERN/01 product reference', 896, 1200);
  const lamp = imageAsset(a.afterimageProduct, 'Flow · AFTERIMAGE product reference', 896, 1200);
  const sloan = imageAsset(a.sloanAd, 'Flow · Sloan Studio campaign', 1264, 848);
  const entries = [
    ['04', 'THE NAME WAS TAKEN. THE IDEA WASN’T.', 'The origin of Flow, Signal Loom, and a studio assembled one need at a time.'],
    ['08', 'FOUR ROOMS, ONE SOURCE', 'A system essay about material moving from graph to timeline to image to page.'],
    ['10', 'KERN / 01', 'A fictional field-notes campaign built from a product reference and an environment reference.'],
    ['11', 'THE PAGE IS A MACHINE FOR ATTENTION', 'On type, rhythm, and why Paper had to become more than a canvas.'],
    ['13', 'PORTS ARE PROMISES', 'Typed data, mixed references, and the responsibility of a visible connection.'],
    ['14', 'AFTERIMAGE / SLOAN STUDIO', 'Two fictional campaigns, two Flow graphs, one shared source library.'],
  ];
  const frames = [
    ...running(3, 'Contents / Origin Issue'),
    frame('p3-title', 'text', 14, 27, 130, 24, { text: 'ISSUE MAP', paragraphStyleId: 'p-display', typography: { fontFamily: FONT.display, fontSizePt: 33, leadingPt: 34, fontWeight: '400', color: C.ink, hyphenate: false }, zIndex: 5 }),
    frame('p3-deck', 'text', 149, 29, 47, 22, { text: 'Sixteen pages. Four workspaces. Three fictional campaigns. One origin story.', typography: { fontFamily: FONT.sans, fontSizePt: 8.4, leadingPt: 10.2, fontWeight: '600', color: C.cobalt, hyphenate: false }, zIndex: 5 }),
  ];
  entries.forEach(([folio, title, deck], index) => {
    const y = 63 + index * 27;
    frames.push(
      frame(`p3-entry-${index}-rule`, 'shape', 14, y - 3, 182, 0.35, { fillColor: index % 2 ? C.cyan : C.coral, zIndex: 2 }),
      frame(`p3-entry-${index}-folio`, 'text', 14, y, 19, 16, { text: folio, typography: { fontFamily: FONT.display, fontSizePt: 19, leadingPt: 20, fontWeight: '400', color: C.cobalt, hyphenate: false }, zIndex: 4 }),
      frame(`p3-entry-${index}-title`, 'text', 39, y, 93, 9, { text: title, typography: { fontFamily: FONT.sans, fontSizePt: 9, leadingPt: 10, tracking: 30, fontWeight: '700', color: C.ink, hyphenate: false }, zIndex: 4 }),
      frame(`p3-entry-${index}-deck`, 'text', 39, y + 10, 93, 12, { text: deck, typography: { fontFamily: FONT.serif, fontSizePt: 7.6, leadingPt: 9.4, fontWeight: '400', color: C.muted, hyphenate: false }, zIndex: 4 }),
    );
  });
  frames.push(
    frame('p3-thumb-kern', 'image', 143, 64, 53, 58, { asset: kern, fit: 'cover', imageScale: 1.2, imageOffsetYPercent: -8, zIndex: 3 }),
    frame('p3-thumb-lamp', 'image', 143, 128, 53, 58, { asset: lamp, fit: 'cover', imageScale: 1.18, zIndex: 3 }),
    frame('p3-thumb-sloan', 'image', 143, 192, 53, 64, { asset: sloan, fit: 'cover', imageScale: 1.4, imageOffsetXPercent: 20, zIndex: 3 }),
    frame('p3-jp-note', 'text', 149, 263, 41, 19, { text: '目次《もくじ》\nつくる道筋《みちすじ》を見せる。', typography: { fontFamily: FONT.jp, fontSizePt: 7.8, leadingPt: 10.8, fontWeight: '600', color: C.coral, lineBreakStrict: true, hyphenate: false }, zIndex: 4 }),
  );
  return page(3, frames);
}

function featurePageFour(a) {
  const hero = imageAsset(a.hero, 'Flow · original Signaloom loom hero · print-resampled', 2688, 3600);
  return page(4, [
    ...running(4, 'Origin / The name was taken'),
    frame('p4-kicker', 'text', 14, 27, 70, 8, { text: 'THE BEGINNING / 01', typography: { fontFamily: FONT.mono, fontSizePt: 6.3, leadingPt: 7, tracking: 110, fontWeight: '700', color: C.coral, hyphenate: false }, zIndex: 5 }),
    frame('p4-title', 'text', 14, 39, 182, 51, {
      richText: [{ runs: [
        { text: 'THE NAME WAS\n', fontFamily: FONT.sans, fontSizePt: 41, fontWeight: '700', tracking: -25, color: C.ink },
        { text: 'TAKEN.', fontFamily: FONT.display, fontSizePt: 42, fontWeight: '400', color: C.cobalt },
        { text: ' THE IDEA\nWASN’T.', fontFamily: FONT.sans, fontSizePt: 41, fontWeight: '700', tracking: -25, color: C.ink },
      ] }],
      typography: { fontFamily: FONT.sans, fontSizePt: 41, leadingPt: 39, fontWeight: '700', color: C.ink, hyphenate: false, lineBreak: 'balance' }, zIndex: 5,
    }),
    frame('p4-deck-rule', 'shape', 14, 101, 3, 48, { fillColor: C.coral, zIndex: 4 }),
    frame('p4-deck', 'text', 24, 102, 80, 45, { text: 'Before Sloom Studio had workspaces, a source library, or a page to lay out, it had a modest name: Flow. It also had a single purpose—to make generative experiments visible enough to enjoy.', typography: { fontFamily: FONT.serif, fontSizePt: 12.6, leadingPt: 16.2, fontWeight: '400', color: C.ink, hyphenate: false, lineBreak: 'pretty' }, zIndex: 5 }),
    frame('p4-aside', 'shape', 118, 101, 78, 45, { fillColor: C.cobalt, cornerRadiusMm: 1.2, zIndex: 3 }),
    frame('p4-aside-text', 'text', 126, 109, 62, 30, { text: '“FLOW” WAS ALREADY TAKEN.\nGO FIGURE.', typography: { fontFamily: FONT.mono, fontSizePt: 9, leadingPt: 12, tracking: 55, fontWeight: '700', color: C.white, hyphenate: false }, zIndex: 5 }),
    frame('p4-hero', 'image', -BLEED, 159, 216, 141, { asset: hero, fit: 'cover', imageScale: 1.03, imageOffsetYPercent: -12, zIndex: 1 }),
    frame('p4-hero-fade', 'shape', -BLEED, 159, 216, 48, { fillColor: C.paper, fillOpacity: 0.97, fillGradient: { type: 'linear', fromColor: '#f4f0e6ff', toColor: '#f4f0e600', angleDeg: 180 }, zIndex: 2 }),
    frame('p4-caption', 'text', 126, 269, 70, 14, { text: 'A GENERATED LOOM BECAME THE VISUAL METAPHOR: SIGNALS AS THREAD, CONNECTIONS AS STRUCTURE.', typography: { fontFamily: FONT.mono, fontSizePt: 5.7, leadingPt: 7.4, tracking: 30, fontWeight: '600', color: C.white, hyphenate: false }, zIndex: 4 }),
  ]);
}

function featurePageFive(a) {
  const hero = imageAsset(a.hero, 'Flow · original Signaloom loom hero · print-resampled', 2688, 3600);
  const story = `The first version was small enough to explain in one breath. It was a node-based workflow for making images and video with a personal Gemini API key. The goal was not a company or a product line. It was personal entertainment: connect a prompt, choose a model, run the graph, and see what happened.\n\nThat simplicity mattered. A prompt stopped being a disposable line in a chat box and became a piece of material with a visible route. A model became a node. An output could be traced back to the choices that made it. Even when the result was playful, the graph carried a serious idea: creative systems are easier to understand when their decisions have shape.\n\nThe name “Flow” described the feeling perfectly—and, predictably, someone else had already claimed it. The rename to Signal Loom did more than avoid a collision. It supplied a metaphor sturdy enough to grow with the software. Signals could pass through a loom. Prompts could become threads. Nodes could become tools arranged around a common table.\n\nNothing in that first graph promised a full studio. It only made one creative act repeatable. But once an image or a clip existed, the next question arrived immediately: what do you do with it?`;
  return page(5, [
    frame('p5-bg', 'shape', -BLEED, -BLEED, 216, 303, { fillColor: C.blueBlack, zIndex: 0 }),
    ...running(5, 'Origin / The first graph', { inverse: true }),
    frame('p5-hero-slice', 'image', 122, 0, 91, 297, { asset: hero, fit: 'cover', imageScale: 1.15, imageOffsetXPercent: 9, zIndex: 1 }),
    frame('p5-hero-shade', 'shape', 108, 0, 105, 297, { fillColor: C.blueBlack, fillOpacity: 0.9, fillGradient: { type: 'linear', fromColor: '#071426ff', toColor: '#07142600', angleDeg: 90 }, zIndex: 2 }),
    frame('p5-label', 'text', 14, 30, 91, 8, { text: 'ONE KEY. ONE GRAPH. ONE QUESTION.', typography: { fontFamily: FONT.mono, fontSizePt: 6.3, leadingPt: 7, tracking: 90, fontWeight: '700', color: C.coral, hyphenate: false }, zIndex: 5 }),
    textPanel('p5-story', 14, 44, 96, 218, story, { fontFamily: FONT.serif, fontSizePt: 9.2, leadingPt: 12.4, color: C.white, hyphenate: true, dropCapLines: 3, threadId: 'origin-story', threadOrder: 0, paragraphStyleId: 'p-body-inverse' }),
    frame('p5-pull', 'text', 125, 178, 65, 45, { text: 'A PROMPT STOPPED BEING DISPOSABLE AND BECAME MATERIAL WITH A ROUTE.', typography: { fontFamily: FONT.sans, fontSizePt: 17.5, leadingPt: 18.2, tracking: -8, fontWeight: '700', color: C.white, hyphenate: false, lineBreak: 'balance' }, zIndex: 5 }),
    frame('p5-pull-rule', 'shape', 119, 177, 2.2, 47, { fillColor: C.coral, zIndex: 5 }),
    frame('p5-jp', 'text', 181, 227, 12, 47, { text: '最初《さいしょ》の\n信号《しんごう》', typography: { fontFamily: FONT.jp, fontSizePt: 8.5, leadingPt: 13, fontWeight: '700', color: C.cyan, writingMode: 'vertical-rl', textOrientation: 'mixed', lineBreakStrict: true, hyphenate: false }, zIndex: 5 }),
  ], { parentPageId: null });
}

function featurePageSix() {
  const stages = [
    ['01', 'FLOW', 'A personal Gemini-key graph for making images and videos.'],
    ['02', 'VIDEO', 'The second workspace: assemble clips, trim time, and turn outputs into a sequence.'],
    ['03', 'IMAGE', 'The third workspace: retouch, composite, and answer the “may as well get Photoshop” impulse.'],
    ['04', 'PAPER', 'The fourth workspace: hierarchy, type, spreads, print production—the “may as well get InDesign” turn.'],
  ];
  const frames = [
    ...running(6, 'Origin / Four rooms arrive'),
    frame('p6-title', 'text', 14, 29, 182, 29, { text: 'THE SOFTWARE GREW\nONE NEED AT A TIME.', typography: { fontFamily: FONT.sans, fontSizePt: 28, leadingPt: 28, tracking: -18, fontWeight: '700', color: C.ink, hyphenate: false }, zIndex: 5 }),
    frame('p6-intro', 'text', 14, 66, 130, 22, { text: 'The order matters because it records the problem being solved, not a product roadmap invented after the fact.', typography: { fontFamily: FONT.serif, fontSizePt: 11, leadingPt: 14, fontStyle: 'italic', fontWeight: '400', color: C.cobalt, hyphenate: false }, zIndex: 5 }),
    frame('p6-vertical', 'text', 181, 28, 13, 70, { text: '必要《ひつよう》が、部屋《へや》を増《ふ》やした。', typography: { fontFamily: FONT.jp, fontSizePt: 8.5, leadingPt: 13, fontWeight: '700', color: C.coral, writingMode: 'vertical-rl', textOrientation: 'mixed', lineBreakStrict: true, hyphenate: false }, zIndex: 5 }),
  ];
  stages.forEach(([num, title, body], i) => {
    const y = 103 + i * 43;
    const color = [C.cobalt, C.cyan, C.orange, C.coral][i];
    frames.push(
      frame(`p6-stage-${i}-num`, 'text', 14, y, 27, 26, { text: num, typography: { fontFamily: FONT.display, fontSizePt: 25, leadingPt: 26, fontWeight: '400', color, hyphenate: false }, zIndex: 5 }),
      frame(`p6-stage-${i}-bar`, 'shape', 45, y + 2, 2, 31, { fillColor: color, zIndex: 4 }),
      frame(`p6-stage-${i}-title`, 'text', 54, y, 47, 10, { text: title, typography: { fontFamily: FONT.sans, fontSizePt: 12, leadingPt: 13, tracking: 45, fontWeight: '700', color: C.ink, hyphenate: false }, zIndex: 5 }),
      frame(`p6-stage-${i}-body`, 'text', 104, y, 92, 29, { text: body, typography: { fontFamily: FONT.serif, fontSizePt: 8.5, leadingPt: 11, fontWeight: '400', color: C.ink, hyphenate: false }, zIndex: 5 }),
      frame(`p6-stage-${i}-rule`, 'shape', 54, y + 34, 142, 0.35, { fillColor: '#aeb5be', zIndex: 2 }),
    );
  });
  return page(6, frames);
}

function featurePageSeven() {
  const story = `The video workspace arrived second because generated clips wanted time. They needed to be placed beside one another, trimmed, heard, and changed. The reasoning was disarmingly practical: if the graph could make the material, why stop just before it became a sequence? Premiere already existed on the creator’s machine, but building the workspace inside Signal Loom kept the source and the decisions close together.\n\nImage came third. The same logic repeated with a wink: if there was already an Adobe Premiere analogue, the studio might as well get its Photoshop. Still images needed retouching, layers, masks, text, and compositing. A generated output was not sacred. It was raw material.\n\nPaper followed as the fourth room. Once Image existed, “may as well get InDesign” was almost inevitable. This turn reached further back than software. In high school yearbook, layout and desktop publishing had been genuinely enjoyable—the negotiation between copy, photograph, white space, hierarchy, and deadline. Illustration and graphic design had felt like possible directions, but art school was not financially available.\n\nThat history gives Paper a different emotional charge. It is not just another destination node. It returns to a kind of work that once felt vivid and possible: arranging a page until information becomes an experience. The studio did not appear because every feature had been planned. It appeared because each finished thing exposed the next unfinished thing.\n\nSeen from the present, the sequence looks strategic. Lived forward, it was closer to curiosity with momentum: I have already made this, so I may as well keep going.`;
  return page(7, [
    frame('p7-bg', 'shape', -BLEED, -BLEED, 216, 303, { fillColor: C.paper, zIndex: 0 }),
    ...running(7, 'Origin / May as well keep going'),
    frame('p7-title', 'text', 14, 29, 88, 39, { text: '“MAY AS WELL”\nAS A METHOD.', typography: { fontFamily: FONT.display, fontSizePt: 28, leadingPt: 29, fontWeight: '400', color: C.cobalt, hyphenate: false }, zIndex: 5 }),
    frame('p7-quote', 'shape', 111, 28, 85, 43, { fillColor: C.coral, cornerRadiusMm: 1.2, zIndex: 2 }),
    frame('p7-quote-text', 'text', 120, 36, 67, 28, { text: 'EACH FINISHED THING EXPOSED THE NEXT UNFINISHED THING.', typography: { fontFamily: FONT.sans, fontSizePt: 13.5, leadingPt: 14.5, tracking: -4, fontWeight: '700', color: C.white, hyphenate: false, lineBreak: 'balance' }, zIndex: 5 }),
    textPanel('p7-story', 14, 85, 182, 176, story, { columns: 2, columnGutterMm: 9, columnRule: true, columnBalance: true, fontFamily: FONT.serif, fontSizePt: 9.2, leadingPt: 12.3, threadId: 'origin-story', threadOrder: 1 }),
    frame('p7-note-rule', 'shape', 14, 269, 182, 0.5, { fillColor: C.cobalt, zIndex: 4 }),
    frame('p7-note', 'text', 14, 273, 182, 12, { text: 'CREATIVE EDUCATION, REFRAMED: THE STUDIO BECAME A PLACE TO LEARN BY MAKING THE TOOL THAT THE NEXT ACT REQUIRED.', typography: { fontFamily: FONT.mono, fontSizePt: 5.9, leadingPt: 7.7, tracking: 38, fontWeight: '600', color: C.cobalt, hyphenate: false }, zIndex: 5 }),
  ]);
}

function systemPageEight(a) {
  const graph = imageAsset(a.flowCover, 'Flow workspace · cover reference graph', 3841, 1892);
  return page(8, [
    frame('p8-bg', 'shape', -BLEED, -BLEED, 216, 303, { fillColor: C.midnight, zIndex: 0 }),
    ...running(8, 'System / Four rooms, one source', { inverse: true }),
    frame('p8-title', 'text', 14, 28, 142, 34, { text: 'FOUR ROOMS.\nONE SOURCE.', typography: { fontFamily: FONT.sans, fontSizePt: 34, leadingPt: 33, tracking: -22, fontWeight: '700', color: C.white, hyphenate: false }, zIndex: 5 }),
    frame('p8-index', 'text', 167, 31, 29, 29, { text: '04\n→ 01', typography: { fontFamily: FONT.display, fontSizePt: 19, leadingPt: 17, align: 'right', fontWeight: '400', color: C.coral, hyphenate: false }, zIndex: 5 }),
    frame('p8-graph', 'image', 14, 76, 182, 92, { asset: graph, fit: 'cover', imageScale: 1.01, zIndex: 2, strokeColor: '#294254', strokeWidthMm: 0.4 }),
    frame('p8-graph-label', 'text', 20, 149, 166, 12, { text: 'NAMED FLOW WORKSPACE / COVER COMPOSITE / IMAGE + TEXT REFERENCES', typography: { fontFamily: FONT.mono, fontSizePt: 5.4, leadingPt: 7, tracking: 45, fontWeight: '600', color: C.cyan, hyphenate: false }, zIndex: 5 }),
    frame('p8-pull-rule', 'shape', 14, 185, 2.3, 55, { fillColor: C.coral, zIndex: 4 }),
    frame('p8-pull', 'text', 25, 184, 77, 58, { text: 'THE SOURCE LIBRARY IS THE HALLWAY. MATERIAL CAN LEAVE ONE ROOM WITHOUT LOSING ITS NAME.', typography: { fontFamily: FONT.sans, fontSizePt: 18, leadingPt: 19, tracking: -8, fontWeight: '700', color: C.white, hyphenate: false, lineBreak: 'balance' }, zIndex: 5 }),
    frame('p8-body', 'text', 112, 184, 84, 72, { text: 'Flow makes intention visible. Video gives the material duration. Image gives it a surface. Paper gives it sequence, scale, hierarchy, and an audience. The source library is what keeps these rooms from becoming four unrelated applications: one generated result can remain itself while its role changes.', typography: { fontFamily: FONT.serif, fontSizePt: 9.1, leadingPt: 12.2, fontWeight: '400', color: C.white, hyphenate: true }, zIndex: 5 }),
    frame('p8-jp', 'text', 24, 263, 160, 18, { text: '一《ひと》つの素材《そざい》、四《よっ》つの部屋《へや》、終《お》わりまで続《つづ》く文脈《ぶんみゃく》。', typography: { fontFamily: FONT.jp, fontSizePt: 8.4, leadingPt: 11, tracking: 20, align: 'center', fontWeight: '600', color: C.orange, lineBreakStrict: true, hyphenate: false }, zIndex: 5 }),
  ], { parentPageId: null });
}

function systemPageNine() {
  const rooms = [
    ['FLOW', 'INTENTION', 'A visible graph preserves prompts, models, references, typed ports, and the path from input to result.'],
    ['VIDEO', 'DURATION', 'Clips become a sequence. Time, sound, transitions, titles, and revision turn isolated generations into motion.'],
    ['IMAGE', 'SURFACE', 'Layers, selections, masks, paint, type, and compositing treat generated images as editable material.'],
    ['PAPER', 'CONSEQUENCE', 'Pages establish order. Type becomes voice. Bleed, profiles, fonts, and export carry the work toward print.'],
  ];
  const frames = [
    ...running(9, 'System / The rooms in use'),
    frame('p9-title', 'text', 14, 29, 182, 29, { text: 'A STUDIO IS NOT FOUR ICONS.\nIT IS THE MOVEMENT BETWEEN THEM.', typography: { fontFamily: FONT.sans, fontSizePt: 25, leadingPt: 25.5, tracking: -16, fontWeight: '700', color: C.ink, hyphenate: false }, zIndex: 5 }),
    frame('p9-deck', 'text', 14, 65, 137, 22, { text: 'The promise is continuity: outputs should stay identifiable, editable, and ready for another kind of attention.', typography: { fontFamily: FONT.serif, fontSizePt: 11.3, leadingPt: 14.5, fontStyle: 'italic', fontWeight: '400', color: C.cobalt, hyphenate: false }, zIndex: 5 }),
  ];
  rooms.forEach(([name, noun, body], i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 14 + col * 93;
    const y = 101 + row * 78;
    const color = [C.cobalt, C.cyan, C.orange, C.coral][i];
    frames.push(
      frame(`p9-room-${i}-card`, 'shape', x, y, 85, 66, { fillColor: i === 1 ? '#d9f7f4' : i === 2 ? '#fff0df' : '#e7eaf8', cornerRadiusMm: 1.5, strokeColor: color, strokeWidthMm: 0.35, zIndex: 2 }),
      frame(`p9-room-${i}-name`, 'text', x + 7, y + 7, 70, 12, { text: name, typography: { fontFamily: FONT.sans, fontSizePt: 14, leadingPt: 15, tracking: 75, fontWeight: '700', color, hyphenate: false }, zIndex: 5 }),
      frame(`p9-room-${i}-noun`, 'text', x + 7, y + 21, 70, 8, { text: noun, typography: { fontFamily: FONT.mono, fontSizePt: 5.8, leadingPt: 7, tracking: 120, fontWeight: '700', color: C.muted, hyphenate: false }, zIndex: 5 }),
      frame(`p9-room-${i}-body`, 'text', x + 7, y + 32, 70, 26, { text: body, typography: { fontFamily: FONT.serif, fontSizePt: 7.8, leadingPt: 10, fontWeight: '400', color: C.ink, hyphenate: false }, zIndex: 5 }),
    );
  });
  frames.push(
    frame('p9-close-rule', 'shape', 14, 264, 182, 0.45, { fillColor: C.cobalt, zIndex: 3 }),
    frame('p9-close', 'text', 14, 270, 182, 15, { text: 'ONE SOURCE SYSTEM  /  MANY FORMS OF FINISH', typography: { fontFamily: FONT.mono, fontSizePt: 7.1, leadingPt: 8, tracking: 110, align: 'center', fontWeight: '700', color: C.cobalt, hyphenate: false }, zIndex: 5 }),
  );
  return page(9, frames);
}

function kernAdPage(a) {
  const ad = imageAsset(a.kernAd, 'Flow · KERN/01 fictional advertisement composite · print-resampled', 3792, 2544);
  return page(10, [
    frame('p10-image', 'image', -BLEED, -BLEED, 216, 303, { asset: ad, fit: 'cover', imageScale: 1.08, imageOffsetXPercent: 3, zIndex: 1 }),
    frame('p10-mask', 'shape', -BLEED, -BLEED, 100, 303, { fillColor: C.paper, fillOpacity: 0.98, zIndex: 2 }),
    frame('p10-top-rule', 'shape', 0, 0, 210, 3, { fillColor: C.cobalt, zIndex: 5 }),
    frame('p10-ad-label', 'text', 14, 18, 74, 8, { text: 'ADVERTISEMENT / FICTIONAL DEMO', typography: { fontFamily: FONT.mono, fontSizePt: 5.8, leadingPt: 7, tracking: 85, fontWeight: '700', color: C.cobalt, hyphenate: false }, zIndex: 6 }),
    frame('p10-title', 'text', 14, 46, 77, 62, { richText: [{ runs: [{ text: 'KERN', fontFamily: FONT.sans, fontSizePt: 43, fontWeight: '700', tracking: -30, color: C.ink }, { text: '/01', fontFamily: FONT.display, fontSizePt: 36, fontWeight: '400', color: C.cobalt }] }], typography: { fontFamily: FONT.sans, fontSizePt: 41, leadingPt: 42, fontWeight: '700', color: C.ink, hyphenate: false }, zIndex: 6 }),
    frame('p10-product', 'text', 14, 108, 75, 22, { text: 'FIELD NOTES\nFOR THE SPACE BETWEEN LETTERS.', typography: { fontFamily: FONT.sans, fontSizePt: 13, leadingPt: 14.5, tracking: 15, fontWeight: '700', color: C.ink, hyphenate: false }, zIndex: 6 }),
    frame('p10-copy', 'text', 14, 151, 70, 70, { text: 'A lay-flat notebook, a folding type gauge, and two brass sorts for anyone who still believes spacing is a form of thinking.\n\nGraphite linen. Cobalt elastic. Pages ruled just enough to help—and quiet enough to disappear.', typography: { fontFamily: FONT.serif, fontSizePt: 9.6, leadingPt: 13, fontWeight: '400', color: C.ink, hyphenate: false }, zIndex: 6 }),
    frame('p10-price', 'text', 14, 239, 71, 18, { text: 'KERN EVERYTHING.\nMEASURE NOTHING TWICE.', typography: { fontFamily: FONT.mono, fontSizePt: 7.4, leadingPt: 10, tracking: 65, fontWeight: '700', color: C.cobalt, hyphenate: false }, zIndex: 6 }),
    frame('p10-legal', 'text', 14, 275, 150, 11, { text: 'CONCEPT DEMO · NOT A REAL PRODUCT · NOT FOR SALE · ARTWORK GENERATED IN FLOW FROM PRODUCT + ENVIRONMENT REFERENCES', typography: { fontFamily: FONT.mono, fontSizePt: 5.2, leadingPt: 6.6, tracking: 28, fontWeight: '600', color: C.ink, hyphenate: false }, zIndex: 6 }),
    frame('p10-folio', 'text', 181, 280, 15, 7, { text: '10', typography: { fontFamily: FONT.mono, fontSizePt: 6.4, leadingPt: 7, align: 'right', fontWeight: '700', color: C.ink, hyphenate: false }, zIndex: 6 }),
  ], { parentPageId: null });
}

function typePageEleven() {
  return page(11, [
    ...running(11, 'Typography / The page is a machine'),
    frame('p11-kicker', 'text', 14, 28, 75, 7, { text: 'TYPE SPECIMEN / FIVE VOICES', typography: { fontFamily: FONT.mono, fontSizePt: 6.1, leadingPt: 7, tracking: 105, fontWeight: '700', color: C.coral, hyphenate: false }, zIndex: 5 }),
    frame('p11-title', 'text', 14, 42, 182, 50, { richText: [{ runs: [
      { text: 'THE PAGE IS A ', fontFamily: FONT.sans, fontSizePt: 35, fontWeight: '700', tracking: -20, color: C.ink },
      { text: 'MACHINE', fontFamily: FONT.display, fontSizePt: 37, fontWeight: '400', color: C.cobalt },
      { text: '\nFOR ATTENTION.', fontFamily: FONT.sans, fontSizePt: 35, fontWeight: '700', tracking: -20, color: C.ink },
    ] }], typography: { fontFamily: FONT.sans, fontSizePt: 35, leadingPt: 36, fontWeight: '700', color: C.ink, hyphenate: false }, zIndex: 5 }),
    frame('p11-sans', 'text', 14, 107, 182, 31, { text: 'IBM PLEX SANS CONDENSED  /  STRUCTURE', typography: { fontFamily: FONT.sans, fontSizePt: 21, leadingPt: 24, tracking: -12, fontWeight: '700', color: C.cobalt, hyphenate: false }, zIndex: 5 }),
    frame('p11-serif', 'text', 14, 143, 182, 30, { text: 'Newsreader gives the argument air.', typography: { fontFamily: FONT.serif, fontSizePt: 23, leadingPt: 27, fontStyle: 'italic', fontWeight: '400', color: C.ink, hyphenate: false }, zIndex: 5 }),
    frame('p11-display', 'text', 14, 177, 182, 34, { text: 'Abril Fatface interrupts.', typography: { fontFamily: FONT.display, fontSizePt: 28, leadingPt: 31, fontWeight: '400', color: C.coral, hyphenate: false }, zIndex: 5 }),
    frame('p11-mono', 'text', 14, 216, 182, 18, { text: 'IBM PLEX MONO / MEASURES / LABELS / FOLIOS / PROOF', typography: { fontFamily: FONT.mono, fontSizePt: 9.1, leadingPt: 11, tracking: 75, fontWeight: '600', color: C.cobalt, hyphenate: false }, zIndex: 5 }),
    frame('p11-jp', 'text', 14, 242, 182, 25, { text: '日本語《にほんご》の組版《くみはん》は、余白《よはく》にも声《こえ》を与《あた》える。', typography: { fontFamily: FONT.jp, fontSizePt: 14, leadingPt: 19, tracking: 20, fontWeight: '700', color: C.ink, lineBreakStrict: true, hyphenate: false }, zIndex: 5 }),
    frame('p11-scale', 'text', 14, 273, 182, 11, { text: '06  07  08  09  10  12  14  18  24  36  48  72  /  TRACKING −30 → +120  /  LEADING AS RHYTHM', typography: { fontFamily: FONT.mono, fontSizePt: 5.8, leadingPt: 7, tracking: 35, align: 'center', fontWeight: '600', color: C.muted, hyphenate: false }, zIndex: 5 }),
  ]);
}

function typePageTwelve() {
  const story = `Desktop publishing is often described as placement: put the headline here, the photograph there, and the body copy into columns. That description misses the interesting part. A page is a system for directing attention over time. Scale announces. Leading regulates breath. Tracking changes temperature. A narrow measure creates urgency; a generous one lets an argument unfold.\n\nPaper therefore had to treat typography as structure, not decoration attached after layout. Paragraph styles hold rhythm across pages. Character styles let a word change voice without breaking the paragraph around it. Rich text needs the same serious controls as ordinary frames—font family, weight, color, kerning, tracking, leading, OpenType details—whether the user adjusts a whole object or one selected phrase.\n\nThe distinction between the canvas and export matters just as much. If type shifts when a PDF is made, the design is no longer the design. Exact font bytes, embeddability rights, output profiles, bleed, transparency, and raster artwork must survive the path to a printer. A soft proof is useful only when it shows the actual page under a simulated output condition; a production PDF is useful only when the photograph and the typography arrive together.\n\nThat is why this zine packages its fonts and its images as managed, content-addressed assets. The layout is editable, but its production dependencies are explicit. The page remembers what face it used, not merely a hopeful family name.\n\nFor someone who once loved yearbook layout and could not afford art school, this precision is not bureaucracy. It is a way of taking the work seriously.`;
  return page(12, [
    frame('p12-bg', 'shape', -BLEED, -BLEED, 216, 303, { fillColor: C.blueBlack, zIndex: 0 }),
    ...running(12, 'Typography / Type is structure', { inverse: true }),
    frame('p12-mark', 'text', 14, 29, 47, 50, { text: 'Aa', typography: { fontFamily: FONT.display, fontSizePt: 61, leadingPt: 61, fontWeight: '400', color: C.coral, hyphenate: false }, zIndex: 5 }),
    frame('p12-head', 'text', 70, 31, 91, 39, { text: 'TYPE IS\nNOT THE LABEL.', typography: { fontFamily: FONT.sans, fontSizePt: 27, leadingPt: 27, tracking: -18, fontWeight: '700', color: C.white, hyphenate: false }, zIndex: 5 }),
    frame('p12-jp-vertical', 'text', 177, 25, 19, 87, { text: '文字《もじ》は、\n情報《じょうほう》の\n呼吸《こきゅう》である。', typography: { fontFamily: FONT.jp, fontSizePt: 10.2, leadingPt: 16, fontWeight: '700', color: C.cyan, writingMode: 'vertical-rl', textOrientation: 'mixed', lineBreakStrict: true, hyphenate: false }, zIndex: 5 }),
    textPanel('p12-story', 14, 96, 147, 168, story, { columns: 2, columnGutterMm: 8, columnRule: true, columnBalance: true, fontFamily: FONT.serif, fontSizePt: 8.9, leadingPt: 11.8, color: C.white, paragraphStyleId: 'p-body-inverse' }),
    frame('p12-sidebar', 'shape', 169, 125, 27, 126, { fillColor: C.cobalt, cornerRadiusMm: 1, zIndex: 2 }),
    frame('p12-sidebar-text', 'text', 175, 132, 15, 112, { text: 'KERNING\n\nTRACKING\n\nLEADING\n\nWEIGHT\n\nCOLOR\n\nRUBY\n\nOUTPUT', typography: { fontFamily: FONT.mono, fontSizePt: 6.2, leadingPt: 11.5, tracking: 80, align: 'center', fontWeight: '700', color: C.white, hyphenate: false }, zIndex: 5 }),
    frame('p12-footer', 'text', 14, 273, 182, 12, { text: 'THE PAGE REMEMBERS THE FACE, THE FILE, THE RIGHTS, AND THE OUTPUT CONDITION.', typography: { fontFamily: FONT.mono, fontSizePt: 6.2, leadingPt: 8, tracking: 65, align: 'center', fontWeight: '700', color: C.orange, hyphenate: false }, zIndex: 5 }),
  ], { parentPageId: null });
}

function portsPageThirteen(a) {
  const graph = imageAsset(a.flowSloan, 'Flow workspace · Sloan Studio reference graph', 3841, 1892);
  return page(13, [
    ...running(13, 'System / Ports are promises'),
    frame('p13-title', 'text', 14, 28, 182, 36, { richText: [{ runs: [{ text: 'PORTS ARE ', fontFamily: FONT.sans, fontSizePt: 31, fontWeight: '700', tracking: -20, color: C.ink }, { text: 'PROMISES.', fontFamily: FONT.display, fontSizePt: 32, fontWeight: '400', color: C.coral }] }], typography: { fontFamily: FONT.sans, fontSizePt: 31, leadingPt: 32, fontWeight: '700', color: C.ink, hyphenate: false }, zIndex: 5 }),
    frame('p13-deck', 'text', 14, 69, 131, 24, { text: 'Typed data should reject what a node cannot use—and accept every form it genuinely understands. A reference input can be an image, a description, or both.', typography: { fontFamily: FONT.serif, fontSizePt: 11.2, leadingPt: 14.3, fontStyle: 'italic', fontWeight: '400', color: C.cobalt, hyphenate: false }, zIndex: 5 }),
    frame('p13-jp', 'text', 175, 29, 19, 66, { text: '接続《せつぞく》は\n約束《やくそく》。', typography: { fontFamily: FONT.jp, fontSizePt: 10, leadingPt: 15, fontWeight: '700', color: C.coral, writingMode: 'vertical-rl', textOrientation: 'mixed', lineBreakStrict: true, hyphenate: false }, zIndex: 5 }),
    frame('p13-graph', 'image', 14, 107, 182, 87, { asset: graph, fit: 'cover', zIndex: 2, strokeColor: C.cobalt, strokeWidthMm: 0.4 }),
    frame('p13-graph-caption', 'text', 19, 178, 172, 11, { text: 'SLOAN STUDIO CAMPAIGN / LOGO + GARMENT + MODEL + ENVIRONMENT + TEXT DESCRIPTIONS → FINAL EDIT NODE', typography: { fontFamily: FONT.mono, fontSizePt: 5.2, leadingPt: 6.8, tracking: 32, fontWeight: '600', color: C.cyan, hyphenate: false }, zIndex: 5 }),
    frame('p13-body-a', 'text', 14, 208, 84, 57, { text: 'A reference image carries pixels. A reference description carries role, priority, exclusions, material notes, and intent. When both connect to the same reference slot, the edit model receives the thing and the instructions for how to understand the thing. That is richer than pretending the port accepts only one data type.', typography: { fontFamily: FONT.serif, fontSizePt: 8.8, leadingPt: 11.6, fontWeight: '400', color: C.ink, hyphenate: true }, zIndex: 5 }),
    frame('p13-body-b', 'text', 108, 208, 88, 57, { text: 'The rule scales beyond this example. Typed ports are not about narrowing the graph until it is brittle. They are about representing the full contract accurately: accept every valid carrier, reject invalid ones visibly, preserve mixed envelopes, and keep enough context for the next node to do honest work.', typography: { fontFamily: FONT.serif, fontSizePt: 8.8, leadingPt: 11.6, fontWeight: '400', color: C.ink, hyphenate: true }, zIndex: 5 }),
    frame('p13-contract', 'text', 14, 273, 182, 12, { text: 'IMAGE  +  TEXT  +  JSON  +  PACKAGE  +  ENVELOPE  =  THE REAL REFERENCE CONTRACT', typography: { fontFamily: FONT.mono, fontSizePt: 6.4, leadingPt: 8, tracking: 60, align: 'center', fontWeight: '700', color: C.cobalt, hyphenate: false }, zIndex: 5 }),
  ]);
}

function afterimageAdPage(a) {
  const ad = imageAsset(a.afterimageAd, 'Flow · AFTERIMAGE fictional advertisement composite · print-resampled', 3792, 2544);
  return page(14, [
    frame('p14-image', 'image', -BLEED, -BLEED, 216, 303, { asset: ad, fit: 'cover', imageScale: 1.22, imageOffsetXPercent: 14, zIndex: 1 }),
    frame('p14-mask', 'shape', -BLEED, -BLEED, 103, 303, { fillColor: C.midnight, fillOpacity: 0.99, zIndex: 3 }),
    frame('p14-color-bar-a', 'shape', 0, 0, 70, 3, { fillColor: C.cyan, zIndex: 5 }),
    frame('p14-color-bar-b', 'shape', 70, 0, 70, 3, { fillColor: C.orange, zIndex: 5 }),
    frame('p14-color-bar-c', 'shape', 140, 0, 70, 3, { fillColor: C.coral, zIndex: 5 }),
    frame('p14-ad-label', 'text', 14, 18, 77, 8, { text: 'ADVERTISEMENT / FICTIONAL DEMO', typography: { fontFamily: FONT.mono, fontSizePt: 5.8, leadingPt: 7, tracking: 85, fontWeight: '700', color: C.cyan, hyphenate: false }, zIndex: 6 }),
    frame('p14-title', 'text', 14, 57, 78, 64, { text: 'AFTER\nIMAGE', typography: { fontFamily: FONT.sans, fontSizePt: 39, leadingPt: 36, tracking: -28, fontWeight: '700', color: C.white, hyphenate: false }, zIndex: 6 }),
    frame('p14-sub', 'text', 14, 129, 71, 26, { text: 'A DESK LIGHT FOR\nTHE SECOND THOUGHT.', typography: { fontFamily: FONT.mono, fontSizePt: 8.2, leadingPt: 11, tracking: 65, fontWeight: '700', color: C.orange, hyphenate: false }, zIndex: 6 }),
    frame('p14-copy', 'text', 14, 175, 73, 59, { text: 'A matte-black cantilever and a cyan-to-coral dichroic blade turn a working surface into a controlled afterglow. One orange dimmer. No spectacle without purpose.', typography: { fontFamily: FONT.serif, fontSizePt: 10, leadingPt: 13.4, fontWeight: '400', color: C.white, hyphenate: false }, zIndex: 6 }),
    frame('p14-tag', 'text', 14, 247, 74, 16, { text: 'LEAVE A TRACE.\nKEEP THE DESK QUIET.', typography: { fontFamily: FONT.sans, fontSizePt: 11.5, leadingPt: 12.5, fontWeight: '700', color: C.cyan, hyphenate: false }, zIndex: 6 }),
    frame('p14-legal', 'text', 14, 276, 166, 11, { text: 'CONCEPT DEMO · NOT A REAL PRODUCT · NOT FOR SALE · COMPOSITED IN FLOW FROM PRODUCT + ENVIRONMENT REFERENCES', typography: { fontFamily: FONT.mono, fontSizePt: 5.2, leadingPt: 6.6, tracking: 28, fontWeight: '600', color: C.white, hyphenate: false }, zIndex: 6 }),
    frame('p14-folio', 'text', 181, 280, 15, 7, { text: '14', typography: { fontFamily: FONT.mono, fontSizePt: 6.4, leadingPt: 7, align: 'right', fontWeight: '700', color: C.white, hyphenate: false }, zIndex: 6 }),
  ], { parentPageId: null });
}

function sloanAdPage(a) {
  const ad = imageAsset(a.sloanAd, 'Flow · Sloan Studio T-shirt advertisement composite · print-resampled', 3792, 2544);
  return page(15, [
    frame('p15-image', 'image', -BLEED, -BLEED, 216, 303, { asset: ad, fit: 'cover', imageScale: 1.24, imageOffsetXPercent: 11, zIndex: 1 }),
    frame('p15-gradient', 'shape', -BLEED, -BLEED, 128, 303, { fillColor: C.blueBlack, fillOpacity: 0.94, fillGradient: { type: 'linear', fromColor: '#071426fa', toColor: '#07142600', angleDeg: 90 }, zIndex: 3 }),
    frame('p15-rule', 'shape', 0, 0, 210, 3, { fillColor: C.coral, zIndex: 5 }),
    frame('p15-label', 'text', 14, 18, 77, 8, { text: 'ADVERTISEMENT / FICTIONAL DEMO', typography: { fontFamily: FONT.mono, fontSizePt: 5.8, leadingPt: 7, tracking: 85, fontWeight: '700', color: C.cyan, hyphenate: false }, zIndex: 6 }),
    frame('p15-head', 'text', 14, 55, 112, 80, { text: 'WEAR THE\nCONNECTION.', typography: { fontFamily: FONT.sans, fontSizePt: 36, leadingPt: 34, tracking: -22, fontWeight: '700', color: C.white, hyphenate: false }, zIndex: 6 }),
    frame('p15-jp', 'text', 117, 51, 14, 72, { text: 'つながりを、\n着《き》る。', typography: { fontFamily: FONT.jp, fontSizePt: 10, leadingPt: 15, tracking: 25, fontWeight: '700', color: C.coral, writingMode: 'vertical-rl', textOrientation: 'mixed', lineBreakStrict: true, hyphenate: false }, zIndex: 6 }),
    frame('p15-product', 'text', 14, 193, 83, 36, { richText: [{ runs: [{ text: 'SLOAN STUDIO\n', fontFamily: FONT.mono, fontSizePt: 7.2, fontWeight: '700', tracking: 90, color: C.coral }, { text: 'SIGNAL LOOP T-SHIRT', fontFamily: FONT.sans, fontSizePt: 15, fontWeight: '700', color: C.white }] }], typography: { fontFamily: FONT.sans, fontSizePt: 14, leadingPt: 18, fontWeight: '700', color: C.white, hyphenate: false }, zIndex: 6 }),
    frame('p15-copy', 'text', 14, 237, 74, 27, { text: 'Four interwoven loops. One black cotton field. A uniform for moving material between rooms.', typography: { fontFamily: FONT.serif, fontSizePt: 9.4, leadingPt: 12.3, fontWeight: '400', color: C.white, hyphenate: false }, zIndex: 6 }),
    frame('p15-legal', 'text', 14, 276, 154, 11, { text: 'CONCEPT DEMO · NOT A REAL PRODUCT · NOT FOR SALE · MODEL, SHIRT, LOGO + ENVIRONMENT COMPOSITED IN FLOW', typography: { fontFamily: FONT.mono, fontSizePt: 5.2, leadingPt: 6.6, tracking: 28, fontWeight: '600', color: C.white, hyphenate: false }, zIndex: 6 }),
    frame('p15-folio', 'text', 181, 280, 15, 7, { text: '15', typography: { fontFamily: FONT.mono, fontSizePt: 6.4, leadingPt: 7, align: 'right', fontWeight: '700', color: C.white, hyphenate: false }, zIndex: 6 }),
  ], { parentPageId: null });
}

function backCoverPage(a) {
  const logo = imageAsset(a.logo, 'Sloom Studio official logo', 512, 512);
  return page(16, [
    frame('p16-bg', 'shape', -BLEED, -BLEED, 216, 303, { fillColor: C.coral, zIndex: 0 }),
    frame('p16-loom-lines-a', 'shape', -3, 49, 216, 1, { fillColor: C.cobalt, zIndex: 1 }),
    frame('p16-loom-lines-b', 'shape', -3, 54, 216, 1, { fillColor: C.cyan, zIndex: 1 }),
    frame('p16-loom-lines-c', 'shape', -3, 59, 216, 1, { fillColor: C.orange, zIndex: 1 }),
    frame('p16-close', 'text', 14, 78, 182, 82, { richText: [{ runs: [
      { text: 'THE GRAPH WAS\nNEVER THE ', fontFamily: FONT.sans, fontSizePt: 38, fontWeight: '700', tracking: -26, color: C.ink },
      { text: 'DESTINATION.', fontFamily: FONT.display, fontSizePt: 38, fontWeight: '400', color: C.white },
      { text: '\nIT WAS THE LOOM.', fontFamily: FONT.sans, fontSizePt: 38, fontWeight: '700', tracking: -26, color: C.ink },
    ] }], typography: { fontFamily: FONT.sans, fontSizePt: 38, leadingPt: 37, fontWeight: '700', color: C.ink, hyphenate: false, lineBreak: 'balance' }, zIndex: 4 }),
    frame('p16-logo', 'image', 14, 196, 38, 38, { asset: logo, fit: 'contain', zIndex: 4 }),
    frame('p16-wordmark', 'text', 62, 199, 134, 33, { text: 'SLOOM\nSTUDIO', typography: { fontFamily: FONT.sans, fontSizePt: 20, leadingPt: 19, tracking: 95, fontWeight: '700', color: C.ink, hyphenate: false }, zIndex: 4 }),
    frame('p16-jp', 'text', 14, 253, 121, 17, { text: '信号《しんごう》を、かたちへ。素材《そざい》を、頁《ページ》へ。', typography: { fontFamily: FONT.jp, fontSizePt: 9.2, leadingPt: 12, fontWeight: '700', color: C.ink, lineBreakStrict: true, hyphenate: false }, zIndex: 4 }),
    frame('p16-demo', 'text', 14, 279, 182, 8, { text: 'ORIGIN ISSUE 01  /  DEMONSTRATION PUBLICATION  /  ALL ADVERTISED PRODUCTS ARE FICTIONAL', typography: { fontFamily: FONT.mono, fontSizePt: 5.7, leadingPt: 7, tracking: 45, fontWeight: '700', color: C.ink, hyphenate: false }, zIndex: 4 }),
  ], { parentPageId: null });
}

function styles() {
  return {
    paragraph: [
      { id: 'p-cover', name: 'Cover Feature', typography: { fontFamily: FONT.sans, fontSizePt: 31, leadingPt: 30, tracking: -22, fontWeight: '700', hyphenate: false, lineBreak: 'balance' } },
      { id: 'p-display', name: 'Feature Display', typography: { fontFamily: FONT.display, fontSizePt: 33, leadingPt: 34, fontWeight: '400', hyphenate: false, lineBreak: 'balance' } },
      { id: 'p-body', name: 'Feature Body', typography: { fontFamily: FONT.serif, fontSizePt: 9, leadingPt: 12, fontWeight: '400', hyphenate: true, lineBreak: 'pretty' } },
      { id: 'p-body-inverse', name: 'Feature Body Inverse', basedOnId: 'p-body', typography: { color: C.white } },
      { id: 'p-running', name: 'Running Head', typography: { fontFamily: FONT.mono, fontSizePt: 6.2, leadingPt: 7, tracking: 105, fontWeight: '600', hyphenate: false } },
      { id: 'p-caption', name: 'Caption', typography: { fontFamily: FONT.mono, fontSizePt: 5.7, leadingPt: 7.4, tracking: 30, fontWeight: '600', hyphenate: false } },
    ],
    character: [
      { id: 'c-cobalt', name: 'Signal Cobalt', typography: { color: C.cobalt, fontWeight: '700' } },
      { id: 'c-coral', name: 'Signal Coral', typography: { color: C.coral, fontWeight: '700' } },
      { id: 'c-display', name: 'Display Interruption', typography: { fontFamily: FONT.display, fontWeight: '400' } },
      { id: 'c-mono', name: 'System Mono', typography: { fontFamily: FONT.mono, tracking: 80, fontWeight: '600' } },
    ],
    object: [
      { id: 'o-full-bleed', name: 'Full Bleed Image', frame: { fillColor: C.blueBlack, strokeColor: 'transparent', strokeWidthMm: 0, cornerRadiusMm: 0, opacity: 1 } },
      { id: 'o-rule', name: 'Editorial Rule', frame: { fillColor: C.cobalt, strokeColor: 'transparent', strokeWidthMm: 0, cornerRadiusMm: 0, opacity: 1 } },
      { id: 'o-paper-card', name: 'Warm Paper Card', frame: { fillColor: C.paper, fillOpacity: 0.95, strokeColor: 'transparent', strokeWidthMm: 0, cornerRadiusMm: 1, opacity: 1 } },
      { id: 'o-dark-card', name: 'Midnight Card', frame: { fillColor: C.blueBlack, fillOpacity: 0.94, strokeColor: C.cyan, strokeWidthMm: 0.3, cornerRadiusMm: 1, opacity: 1 } },
    ],
  };
}

function swatches() {
  return [
    { id: 'sw-paper', name: 'Zine Warm Paper', type: 'process', model: 'cmyk', rgb: { r: 244, g: 240, b: 230 }, cmyk: { c: 2, m: 2, y: 7, k: 0 } },
    { id: 'sw-ink', name: 'Zine Ink', type: 'process', model: 'cmyk', rgb: { r: 16, g: 18, b: 24 }, cmyk: { c: 33, m: 25, y: 0, k: 91 } },
    { id: 'sw-cobalt', name: 'Signal Cobalt', type: 'process', model: 'cmyk', rgb: { r: 20, g: 61, b: 187 }, cmyk: { c: 89, m: 67, y: 0, k: 0 } },
    { id: 'sw-cyan', name: 'Electric Cyan', type: 'process', model: 'cmyk', rgb: { r: 22, g: 214, b: 220 }, cmyk: { c: 75, m: 0, y: 19, k: 0 } },
    { id: 'sw-coral', name: 'Signal Coral', type: 'spot', model: 'cmyk', rgb: { r: 255, g: 92, b: 85 }, cmyk: { c: 0, m: 72, y: 62, k: 0 }, spotName: 'Sloom Signal Coral' },
    { id: 'sw-orange', name: 'Signal Orange', type: 'process', model: 'cmyk', rgb: { r: 255, g: 154, b: 67 }, cmyk: { c: 0, m: 46, y: 78, k: 0 } },
    { id: 'sw-blue-black', name: 'Blue Black', type: 'process', model: 'cmyk', rgb: { r: 7, g: 20, b: 38 }, cmyk: { c: 82, m: 47, y: 0, k: 85 } },
  ];
}

function binaryRecord(bytes, fileName, mimeType) {
  const copy = new Uint8Array(bytes);
  const sha256 = createHash('sha256').update(copy).digest('hex');
  return {
    ref: { id: `sha256:${sha256}`, sha256, mimeType, byteLength: copy.byteLength, fileName },
    bytes: copy,
  };
}

function recordFromPath(path) {
  const extension = extname(path).toLowerCase();
  const mimeType = extension === '.ttf' ? 'font/ttf'
    : extension === '.otf' ? 'font/otf'
      : extension === '.icc' || extension === '.icm' ? 'application/vnd.iccprofile'
        : extension === '.txt' || extension === '.md' ? 'text/plain'
          : extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg'
            : 'image/png';
  return binaryRecord(readFileSync(path), basename(path), mimeType);
}

function face({ id, familyName, postscriptName, weight, style = 'normal', record, license, variableAxes = {} }) {
  return {
    id,
    familyId: familyName.toLocaleLowerCase('en-US'),
    familyName,
    postscriptName,
    weight,
    style,
    stretchPercent: 100,
    collectionIndex: 0,
    variableAxes,
    unicodeRanges: [{ start: 0x20, end: 0x10ffff }],
    format: 'truetype',
    fontAsset: record.ref,
    embeddability: 'installable',
    canSubset: true,
    source: { kind: 'bundled', version: 'Sloom Studio cleared font collection 2026-07' },
    license: { id: 'OFL-1.1', textAsset: license.ref, attribution: `${familyName} is packaged under the SIL Open Font License 1.1.` },
  };
}

function loadFonts(fontRoot) {
  const p = (...segments) => join(fontRoot, 'collection', 'base', ...segments);
  const families = {
    sans: {
      license: recordFromPath(p('ibmplexsanscondensed', 'OFL.txt')),
      faces: [
        [400, 'IBMPlexSansCondensed-Regular.ttf', 'IBMPlexSansCondensed-Regular'],
        [500, 'IBMPlexSansCondensed-Medium.ttf', 'IBMPlexSansCondensed-Medium'],
        [600, 'IBMPlexSansCondensed-SemiBold.ttf', 'IBMPlexSansCondensed-SemiBold'],
        [700, 'IBMPlexSansCondensed-Bold.ttf', 'IBMPlexSansCondensed-Bold'],
      ],
    },
    serif: {
      license: recordFromPath(p('newsreader', 'OFL.txt')),
      regular: recordFromPath(p('newsreader', 'Newsreader[opsz,wght].ttf')),
      italic: recordFromPath(p('newsreader', 'Newsreader-Italic[opsz,wght].ttf')),
    },
    display: { license: recordFromPath(p('abrilfatface', 'OFL.txt')), regular: recordFromPath(p('abrilfatface', 'AbrilFatface-Regular.ttf')) },
    mono: {
      license: recordFromPath(p('ibmplexmono', 'OFL.txt')),
      faces: [
        [400, 'IBMPlexMono-Regular.ttf', 'IBMPlexMono-Regular'],
        [600, 'IBMPlexMono-SemiBold.ttf', 'IBMPlexMono-SemiBold'],
        [700, 'IBMPlexMono-Bold.ttf', 'IBMPlexMono-Bold'],
      ],
    },
    jp: { license: recordFromPath(p('notosansjp', 'OFL.txt')), regular: recordFromPath(p('notosansjp', 'NotoSansJP[wght].ttf')) },
  };
  const records = [];
  const faces = [];
  for (const [weight, fileName, postscriptName] of families.sans.faces) {
    const record = recordFromPath(p('ibmplexsanscondensed', fileName));
    records.push(record);
    faces.push(face({ id: `sloom-plex-sans-condensed-${weight}`, familyName: 'IBM Plex Sans Condensed', postscriptName, weight, record, license: families.sans.license }));
  }
  for (const weight of [400, 600]) {
    faces.push(face({ id: `sloom-newsreader-${weight}`, familyName: 'Newsreader', postscriptName: `Newsreader-${weight}`, weight, record: families.serif.regular, license: families.serif.license, variableAxes: { opsz: { min: 6, default: 16, max: 72 }, wght: { min: 200, default: 400, max: 800 } } }));
  }
  faces.push(face({ id: 'sloom-newsreader-italic-400', familyName: 'Newsreader', postscriptName: 'Newsreader-Italic', weight: 400, style: 'italic', record: families.serif.italic, license: families.serif.license, variableAxes: { opsz: { min: 6, default: 16, max: 72 }, wght: { min: 200, default: 400, max: 800 } } }));
  faces.push(face({ id: 'sloom-abril-400', familyName: 'Abril Fatface', postscriptName: 'AbrilFatface-Regular', weight: 400, record: families.display.regular, license: families.display.license }));
  for (const [weight, fileName, postscriptName] of families.mono.faces) {
    const record = recordFromPath(p('ibmplexmono', fileName));
    records.push(record);
    faces.push(face({ id: `sloom-plex-mono-${weight}`, familyName: 'IBM Plex Mono', postscriptName, weight, record, license: families.mono.license }));
  }
  for (const weight of [400, 600, 700]) {
    faces.push(face({ id: `sloom-noto-sans-jp-${weight}`, familyName: 'Noto Sans JP', postscriptName: `NotoSansJP-${weight}`, weight, record: families.jp.regular, license: families.jp.license, variableAxes: { wght: { min: 100, default: 400, max: 900 } } }));
  }
  records.push(
    families.sans.license,
    families.serif.license, families.serif.regular, families.serif.italic,
    families.display.license, families.display.regular,
    families.mono.license,
    families.jp.license, families.jp.regular,
  );
  return { faces, records: [...new Map(records.map((record) => [record.ref.id, record])).values()] };
}

export function buildSloomOriginZine(a, { importedFonts, iccProfile, now = NOW } = {}) {
  if (!iccProfile?.ref) throw new Error('FOGRA39 profile is required.');
  const document = {
    id: 'paper-sloom-studio-origin-zine',
    title: 'Sloom Studio — The Studio That Grew Sideways',
    page: { preset: 'a4', widthMm: PAGE_W, heightMm: PAGE_H, bleedMm: BLEED, dpi: 300 },
    layout: {
      marginsMm: { top: 14, right: 14, bottom: 14, left: 14 },
      columns: { count: 4, gutterMm: 4 },
      grid: { enabled: true, sizeMm: 4, subdivisions: 4 },
      baselineGrid: { startMm: 14, incrementMm: 4.15 },
    },
    background: { type: 'solid', color: C.paper, fromColor: C.paper, toColor: C.paper, angleDeg: 90, radialShape: 'ellipse' },
    printProduction: {
      pdfStandard: 'browser-pdf',
      outputIntentProfileId: 'custom',
      outputIntentProfileAssetId: iccProfile.ref.id,
      customOutputIntentName: 'FOGRA39',
      totalInkLimitPercent: 300,
      blackPolicy: 'warn-rich-black',
      spotColorPolicy: 'preserve-named',
      overprintPreview: true,
    },
    managedIccProfiles: [{
      id: iccProfile.ref.id,
      asset: { ...iccProfile.ref },
      description: 'FOGRA39L Coated', deviceClass: 'prtr', colorSpace: 'CMYK', pcs: 'Lab ', outputConditionId: 'FOGRA39',
      source: { kind: 'bundled', url: '/icc/FOGRA39L_coated.icc', licenseId: 'LicenseRef-NoKnownCopyrightRestrictions' },
    }],
    importedFonts,
    view: { showRulers: false, showGrid: false, showBaselineGrid: false, showGuides: false, showFrameEdges: false, showBleed: false, showSpreads: true, startOnRight: true, rtlBinding: false, snapToGuides: true, snapToGrid: true },
    parentPages: [{
      id: 'parent-editorial', name: 'A — Editorial / 4-column', guides: baseGuides(),
      frames: [frame('parent-a-grid-signature', 'shape', 14, 288, 182, 0.35, { label: 'Parent baseline signature', fillColor: C.cobalt, zIndex: 0 })],
    }],
    styles: styles(),
    swatches: swatches(),
    pages: [
      coverPage(a), insideCoverPage(a), contentsPage(a), featurePageFour(a), featurePageFive(a), featurePageSix(), featurePageSeven(),
      systemPageEight(a), systemPageNine(), kernAdPage(a), typePageEleven(), typePageTwelve(), portsPageThirteen(a), afterimageAdPage(a), sloanAdPage(a), backCoverPage(a),
    ],
    createdAt: now,
    updatedAt: now,
  };
  return document;
}

function parseArgs(argv) {
  const options = { fonts: FONT_ROOT_DEFAULT };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--assets') options.assets = argv[++i];
    else if (arg === '--output') options.output = argv[++i];
    else if (arg === '--fonts') options.fonts = argv[++i];
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

export function generateSloomOriginZine({ assets, output, fonts = FONT_ROOT_DEFAULT }) {
  const assetDir = resolve(assets);
  const recordsByName = Object.fromEntries([
    'cover-print.png', 'hero-print.png', 'kern-product.png', 'kern-ad-print.png', 'afterimage-product.png', 'afterimage-ad-print.png', 'sloan-ad-print.png', 'logo.png',
    'flow-cover-graph.png', 'flow-sloan-graph.png',
  ].map((name) => [name, recordFromPath(join(assetDir, name))]));
  const a = {
    cover: recordsByName['cover-print.png'], hero: recordsByName['hero-print.png'], kernProduct: recordsByName['kern-product.png'], kernAd: recordsByName['kern-ad-print.png'],
    afterimageProduct: recordsByName['afterimage-product.png'], afterimageAd: recordsByName['afterimage-ad-print.png'], sloanAd: recordsByName['sloan-ad-print.png'], logo: recordsByName['logo.png'],
    flowCover: recordsByName['flow-cover-graph.png'], flowSloan: recordsByName['flow-sloan-graph.png'],
  };
  const fontBundle = loadFonts(resolve(fonts));
  const iccProfile = recordFromPath(ICC_PATH);
  const document = buildSloomOriginZine(a, { importedFonts: fontBundle.faces, iccProfile });
  const outputPath = resolve(output);
  mkdirSync(resolve(outputPath, '..'), { recursive: true });
  const records = [...Object.values(recordsByName), ...fontBundle.records, iccProfile];
  writeFileSync(outputPath, packMagazineContainer(document, [...new Map(records.map((record) => [record.ref.id, record])).values()]));
  return { outputPath, document, records };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.assets || !options.output) {
    process.stdout.write('Usage: node scripts/create-sloom-origin-zine.mjs --assets <asset-dir> --output <file.slppr> [--fonts <font-collection>]\n');
    process.exitCode = options.help ? 0 : 1;
    return;
  }
  const result = generateSloomOriginZine(options);
  process.stdout.write(`${result.outputPath}\n`);
  process.stdout.write(`pages=${result.document.pages.length} frames=${result.document.pages.reduce((sum, p) => sum + p.frames.length, 0)} managed-font-faces=${result.document.importedFonts.length}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
