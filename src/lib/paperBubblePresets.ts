import type { PaperFramePatch } from '../types/paper';

// One-click speech/thought-bubble looks — applied as a frame patch (shape, stroke, fill, and a few
// typography defaults) so users get a polished balloon without hand-tuning every value.
export interface PaperBubblePreset {
  id: string;
  name: string;
  description: string;
  patch: PaperFramePatch;
}

// Japanese vertical font stacks (kept in sync with PAPER_FONT_OPTIONS in the workspace).
const MANGA_GOTHIC = "'Hiragino Kaku Gothic ProN', 'Yu Gothic', YuGothic, 'Noto Sans CJK JP', 'Noto Sans JP', Meiryo, 'MS Gothic', sans-serif";
const MANGA_MINCHO = "'Hiragino Mincho ProN', 'Yu Mincho', YuMincho, 'Noto Serif CJK JP', 'Noto Serif JP', 'MS Mincho', serif";

export const PAPER_BUBBLE_PRESETS: PaperBubblePreset[] = [
  {
    id: 'speech',
    name: 'Speech',
    description: 'Clean rounded dialogue balloon',
    patch: {
      bubbleShape: 'organic', strokeStyle: 'solid', strokeWidthMm: 0.35, strokeColor: '#111827',
      // Horizontal presets clear writing-mode so a bubble can be switched back from 縦書き (manga) with one click.
      fillColor: '#ffffff', cornerRadiusMm: 0, typography: { fontWeight: '400', fontStyle: 'normal', align: 'center', writingMode: undefined },
    },
  },
  {
    id: 'whisper',
    name: 'Whisper',
    description: 'Soft dashed quiet aside',
    patch: {
      bubbleShape: 'organic', strokeStyle: 'dashed', strokeWidthMm: 0.25, strokeColor: '#6b7280',
      fillColor: '#ffffff', typography: { fontWeight: '400', fontStyle: 'italic', align: 'center', writingMode: undefined },
    },
  },
  {
    id: 'shout',
    name: 'Shout',
    description: 'Heavy bold outline for emphasis',
    patch: {
      bubbleShape: 'organic', strokeStyle: 'solid', strokeWidthMm: 0.7, strokeColor: '#111827',
      fillColor: '#ffffff', typography: { fontWeight: '800', fontStyle: 'normal', align: 'center', writingMode: undefined },
    },
  },
  {
    id: 'electronic',
    name: 'Electronic',
    description: 'Squared techy readout',
    patch: {
      bubbleShape: 'squircle', strokeStyle: 'solid', strokeWidthMm: 0.3, strokeColor: '#0e7490',
      fillColor: '#ecfeff', typography: { fontFamily: 'monospace', fontWeight: '500', align: 'center', writingMode: undefined },
    },
  },
  {
    id: 'narration',
    name: 'Narration',
    description: 'Caption-style narration box',
    patch: {
      bubbleShape: 'squircle', strokeStyle: 'solid', strokeWidthMm: 0.3, strokeColor: '#92400e',
      fillColor: '#fef3c7', cornerRadiusMm: 1, typography: { fontWeight: '500', fontStyle: 'normal', align: 'left', writingMode: undefined },
    },
  },
  {
    id: 'thought',
    name: 'Thought',
    description: 'Cloud bubble with dotted tail',
    patch: {
      bubbleShape: 'cloud', strokeStyle: 'solid', strokeWidthMm: 0.3, strokeColor: '#111827',
      fillColor: '#ffffff', bubbleConnectorStyle: 'thought-dots', typography: { fontStyle: 'italic', align: 'center', writingMode: undefined },
    },
  },
  {
    id: 'manga-gothic',
    name: '縦書き ゴシック · Vertical Gothic',
    description: 'Manga dialogue — vertical, gothic, centered / マンガのセリフ：縦書き・ゴシック・中央寄せ',
    patch: {
      bubbleShape: 'organic', strokeStyle: 'solid', strokeWidthMm: 0.35, strokeColor: '#111827',
      fillColor: '#ffffff', cornerRadiusMm: 0,
      typography: { fontFamily: MANGA_GOTHIC, fontWeight: '500', fontStyle: 'normal', align: 'center', writingMode: 'vertical-rl', textOrientation: 'mixed' },
    },
  },
  {
    id: 'manga-mincho',
    name: '縦書き 明朝 · Vertical Mincho',
    description: 'Narration / literary — vertical, mincho, centered / ナレーション・文芸：縦書き・明朝・中央寄せ',
    patch: {
      bubbleShape: 'squircle', strokeStyle: 'solid', strokeWidthMm: 0.3, strokeColor: '#111827',
      fillColor: '#ffffff', cornerRadiusMm: 1,
      typography: { fontFamily: MANGA_MINCHO, fontWeight: '400', fontStyle: 'normal', align: 'center', writingMode: 'vertical-rl', textOrientation: 'mixed' },
    },
  },
];
