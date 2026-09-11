import type { PaperPageSpec, PaperPrintJobInfo, PaperPrintMarksSpec, PaperPrintProductionSpec } from '../types/paper';

export const PAPER_POINTS_PER_MM = 72 / 25.4;

export interface PaperPrintSheetRect {
  xPt: number;
  yTopPt: number;
  widthPt: number;
  heightPt: number;
}

export interface PaperCropMarkLine {
  id: string;
  x1Pt: number;
  y1TopPt: number;
  x2Pt: number;
  y2TopPt: number;
  strokeWidthPt: number;
}

export interface PaperRegistrationMark {
  id: string;
  centerXPt: number;
  centerYTopPt: number;
  radiusPt: number;
  crossArmPt: number;
  strokeWidthPt: number;
}

export interface PaperColorBarPatch {
  id: string;
  rect: PaperPrintSheetRect;
  cmyk: { c: number; m: number; y: number; k: number };
}

/**
 * Canonical physical output sheet. Coordinates use the render plan's top-left/y-down convention;
 * PDF adapters perform the one y-axis conversion at their boundary.
 */
export interface PaperPrintSheetPlan {
  mediaBox: PaperPrintSheetRect;
  bleedBox: PaperPrintSheetRect;
  trimBox: PaperPrintSheetRect;
  /** Translation from the historical bleed-media origin into this expanded production sheet. */
  contentOffsetPt: { x: number; y: number };
  cropMarks: PaperCropMarkLine[];
  registrationMarks: PaperRegistrationMark[];
  colorBars: PaperColorBarPatch[];
  /** Reserved, intentionally blank production area outside the bleed box. */
  slugBox?: PaperPrintSheetRect;
  /** Sanitized human-authored job text rendered inside `slugBox`. */
  slugText?: string;
}

export function buildPaperPrintSheetPlan(
  page: Pick<PaperPageSpec, 'widthMm' | 'heightMm' | 'bleedMm'>,
  production: Pick<PaperPrintProductionSpec, 'marks'> & Partial<Pick<PaperPrintProductionSpec, 'jobInfo'>>,
): PaperPrintSheetPlan {
  const marks = production.marks;
  const trimWidthPt = mmToPt(page.widthMm);
  const trimHeightPt = mmToPt(page.heightMm);
  const bleedPt = mmToPt(page.bleedMm);
  const markLengthPt = marks.cropMarks ? mmToPt(marks.cropMarkLengthMm) : 0;
  const markOffsetPt = marks.cropMarks ? mmToPt(marks.cropMarkOffsetMm) : 0;
  const registrationRadiusPt = mmToPt(2.5);
  const registrationCrossArmPt = mmToPt(3.5);
  const registrationClearancePt = marks.registrationMarks
    ? round(mmToPt(marks.cropMarkOffsetMm) + registrationRadiusPt + registrationCrossArmPt)
    : 0;
  const markClearancePt = Math.max(round(markLengthPt + markOffsetPt), registrationClearancePt);
  const colorBarBandHeightPt = marks.colorBars ? mmToPt(8) : 0;
  const slugHeightPt = mmToPt(marks.slugAreaMm);
  const bleedWidthPt = round(trimWidthPt + bleedPt * 2);
  const bleedHeightPt = round(trimHeightPt + bleedPt * 2);
  const mediaWidthPt = round(bleedWidthPt + markClearancePt * 2);
  const mediaHeightPt = round(bleedHeightPt + markClearancePt * 2 + colorBarBandHeightPt + slugHeightPt);
  const bleedBox: PaperPrintSheetRect = {
    xPt: markClearancePt,
    yTopPt: markClearancePt,
    widthPt: bleedWidthPt,
    heightPt: bleedHeightPt,
  };
  const trimBox: PaperPrintSheetRect = {
    xPt: round(bleedBox.xPt + bleedPt),
    yTopPt: round(bleedBox.yTopPt + bleedPt),
    widthPt: trimWidthPt,
    heightPt: trimHeightPt,
  };
  const cropMarks = marks.cropMarks
    ? buildCropMarks({
        trimBox,
        bleedBox,
        lengthPt: markLengthPt,
        offsetPt: markOffsetPt,
        strokeWidthPt: marks.cropMarkStrokePt,
      })
    : [];
  const registrationMarks = marks.registrationMarks
    ? buildRegistrationMarks({
        trimBox,
        bleedBox,
        offsetPt: mmToPt(marks.cropMarkOffsetMm),
        radiusPt: registrationRadiusPt,
        crossArmPt: registrationCrossArmPt,
        strokeWidthPt: marks.cropMarkStrokePt,
      })
    : [];
  const colorBars = marks.colorBars
    ? buildColorBars(bleedBox, round(bleedBox.yTopPt + bleedBox.heightPt + markClearancePt))
    : [];
  const slugBox = slugHeightPt > 0
    ? {
        xPt: bleedBox.xPt,
        yTopPt: round(bleedBox.yTopPt + bleedBox.heightPt + markClearancePt + colorBarBandHeightPt),
        widthPt: bleedBox.widthPt,
        heightPt: slugHeightPt,
      }
    : undefined;
  const slugText = slugBox && production.jobInfo ? formatPaperPrintJobInfo(production.jobInfo) : '';

  return {
    mediaBox: { xPt: 0, yTopPt: 0, widthPt: mediaWidthPt, heightPt: mediaHeightPt },
    bleedBox,
    trimBox,
    contentOffsetPt: { x: bleedBox.xPt, y: bleedBox.yTopPt },
    cropMarks,
    registrationMarks,
    colorBars,
    ...(slugBox ? { slugBox } : {}),
    ...(slugText ? { slugText } : {}),
  };
}

export function paperPrintMarksEnabled(marks: PaperPrintMarksSpec): boolean {
  return marks.cropMarks || marks.registrationMarks || marks.colorBars || marks.slugAreaMm > 0;
}

export function formatPaperPrintJobInfo(jobInfo: PaperPrintJobInfo): string {
  return [
    jobInfo.jobName ? `Job: ${jobInfo.jobName}` : '',
    jobInfo.jobNumber ? `No: ${jobInfo.jobNumber}` : '',
    jobInfo.client ? `Client: ${jobInfo.client}` : '',
    jobInfo.author ? `Author: ${jobInfo.author}` : '',
    jobInfo.notes ? `Notes: ${jobInfo.notes}` : '',
  ].filter(Boolean).join('  ·  ');
}

export function paperPointsToMm(value: number): number {
  return Number((value / PAPER_POINTS_PER_MM).toFixed(3));
}

function buildCropMarks(input: {
  trimBox: PaperPrintSheetRect;
  bleedBox: PaperPrintSheetRect;
  lengthPt: number;
  offsetPt: number;
  strokeWidthPt: number;
}): PaperCropMarkLine[] {
  const { trimBox, bleedBox, lengthPt, offsetPt, strokeWidthPt } = input;
  const trimLeft = trimBox.xPt;
  const trimRight = round(trimBox.xPt + trimBox.widthPt);
  const trimTop = trimBox.yTopPt;
  const trimBottom = round(trimBox.yTopPt + trimBox.heightPt);
  const bleedLeft = bleedBox.xPt;
  const bleedRight = round(bleedBox.xPt + bleedBox.widthPt);
  const bleedTop = bleedBox.yTopPt;
  const bleedBottom = round(bleedBox.yTopPt + bleedBox.heightPt);
  const leftNear = round(bleedLeft - offsetPt);
  const leftFar = round(leftNear - lengthPt);
  const rightNear = round(bleedRight + offsetPt);
  const rightFar = round(rightNear + lengthPt);
  const topNear = round(bleedTop - offsetPt);
  const topFar = round(topNear - lengthPt);
  const bottomNear = round(bleedBottom + offsetPt);
  const bottomFar = round(bottomNear + lengthPt);
  const line = (id: string, x1Pt: number, y1TopPt: number, x2Pt: number, y2TopPt: number): PaperCropMarkLine => ({
    id,
    x1Pt,
    y1TopPt,
    x2Pt,
    y2TopPt,
    strokeWidthPt,
  });

  return [
    line('crop:top-left:horizontal', leftFar, trimTop, leftNear, trimTop),
    line('crop:top-left:vertical', trimLeft, topFar, trimLeft, topNear),
    line('crop:top-right:horizontal', rightNear, trimTop, rightFar, trimTop),
    line('crop:top-right:vertical', trimRight, topFar, trimRight, topNear),
    line('crop:bottom-left:horizontal', leftFar, trimBottom, leftNear, trimBottom),
    line('crop:bottom-left:vertical', trimLeft, bottomNear, trimLeft, bottomFar),
    line('crop:bottom-right:horizontal', rightNear, trimBottom, rightFar, trimBottom),
    line('crop:bottom-right:vertical', trimRight, bottomNear, trimRight, bottomFar),
  ];
}

function buildRegistrationMarks(input: {
  trimBox: PaperPrintSheetRect;
  bleedBox: PaperPrintSheetRect;
  offsetPt: number;
  radiusPt: number;
  crossArmPt: number;
  strokeWidthPt: number;
}): PaperRegistrationMark[] {
  const { trimBox, bleedBox, offsetPt, radiusPt, crossArmPt, strokeWidthPt } = input;
  const trimCenterX = round(trimBox.xPt + trimBox.widthPt / 2);
  const trimCenterY = round(trimBox.yTopPt + trimBox.heightPt / 2);
  const bleedRight = round(bleedBox.xPt + bleedBox.widthPt);
  const bleedBottom = round(bleedBox.yTopPt + bleedBox.heightPt);
  const mark = (id: string, centerXPt: number, centerYTopPt: number): PaperRegistrationMark => ({
    id,
    centerXPt,
    centerYTopPt,
    radiusPt,
    crossArmPt,
    strokeWidthPt,
  });
  return [
    mark('registration:top', trimCenterX, round(bleedBox.yTopPt - offsetPt - radiusPt)),
    mark('registration:right', round(bleedRight + offsetPt + radiusPt), trimCenterY),
    mark('registration:bottom', trimCenterX, round(bleedBottom + offsetPt + radiusPt)),
    mark('registration:left', round(bleedBox.xPt - offsetPt - radiusPt), trimCenterY),
  ];
}

function buildColorBars(bleedBox: PaperPrintSheetRect, bandTopPt: number): PaperColorBarPatch[] {
  const colors = [
    { id: 'cyan', c: 1, m: 0, y: 0, k: 0 },
    { id: 'magenta', c: 0, m: 1, y: 0, k: 0 },
    { id: 'yellow', c: 0, m: 0, y: 1, k: 0 },
    { id: 'black', c: 0, m: 0, y: 0, k: 1 },
    { id: 'red', c: 0, m: 1, y: 1, k: 0 },
    { id: 'green', c: 1, m: 0, y: 1, k: 0 },
    { id: 'blue', c: 1, m: 1, y: 0, k: 0 },
    { id: 'gray-50', c: 0, m: 0, y: 0, k: 0.5 },
    { id: 'registration', c: 1, m: 1, y: 1, k: 1 },
  ] as const;
  const patchWidthPt = Math.min(mmToPt(6), bleedBox.widthPt / colors.length);
  const patchHeightPt = mmToPt(5);
  const stripWidthPt = patchWidthPt * colors.length;
  const stripLeftPt = round(bleedBox.xPt + (bleedBox.widthPt - stripWidthPt) / 2);
  return colors.map((color, index) => ({
    id: `color-bar:${color.id}`,
    rect: {
      xPt: round(stripLeftPt + patchWidthPt * index),
      yTopPt: bandTopPt,
      widthPt: round(patchWidthPt),
      heightPt: patchHeightPt,
    },
    cmyk: { c: color.c, m: color.m, y: color.y, k: color.k },
  }));
}

function mmToPt(value: number): number {
  return round(value * PAPER_POINTS_PER_MM);
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
