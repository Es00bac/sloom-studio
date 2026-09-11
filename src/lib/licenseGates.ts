/**
 * Sloom Studio (GPL) — there are no paid feature gates. Every export path and workspace is
 * available to everyone. These functions remain so call sites compile unchanged; each one
 * simply reports "unlocked". The physical-media brush gate reports "unavailable" because that
 * engine is not part of this repository.
 */
export function isCommercialExportUnlocked(): boolean {
  return true;
}

export function isTiltmarkBrushUnlocked(): boolean {
  return false;
}

export async function requestCommercialExportUnlock(_featureLabel: string): Promise<boolean> {
  return true;
}

export async function requestTiltmarkBrushUnlock(): Promise<boolean> {
  return false;
}

/** Kept for callers that classify print-production targets; classification no longer gates anything. */
export function isCommercialPrintProductionTarget(production: {
  pdfStandard: string;
  outputIntentColorSpace?: string;
}): boolean {
  return production.pdfStandard === 'pdf-x-4'
    || production.pdfStandard === 'pdf-x-1a'
    || production.outputIntentColorSpace === 'cmyk';
}
