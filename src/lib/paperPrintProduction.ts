import type {
  PaperDocument,
  PaperOutputIntentProfileId,
  PaperPrintProductionSpec,
} from '../types/paper';
import type { BinaryAssetId } from '../shared/assets/contentAddressedAsset';

export type PaperPrintProductionPatch = Omit<Partial<PaperPrintProductionSpec>, 'marks' | 'jobInfo'> & {
  marks?: Partial<PaperPrintProductionSpec['marks']>;
  jobInfo?: Partial<PaperPrintProductionSpec['jobInfo']>;
};

export interface PaperOutputIntentProfile {
  id: PaperOutputIntentProfileId;
  label: string;
  colorSpace: 'rgb' | 'cmyk' | 'gray';
  printingCondition?: string;
  registryName?: string;
  recommendedTotalInkLimitPercent: number;
}

export interface PaperPrintProductionMetadata extends PaperPrintProductionSpec {
  outputIntentLabel: string;
  outputIntentColorSpace: PaperOutputIntentProfile['colorSpace'];
  outputCondition?: string;
  outputIntentRegistryName?: string;
  browserPdfIsPressCertified: boolean;
  limitations: string[];
}

export const PAPER_OUTPUT_INTENT_PROFILES: Record<PaperOutputIntentProfileId, PaperOutputIntentProfile> = {
  srgb: {
    id: 'srgb',
    label: 'sRGB IEC61966-2.1',
    colorSpace: 'rgb',
    recommendedTotalInkLimitPercent: 300,
  },
  'gracol-2013-coated': {
    id: 'gracol-2013-coated',
    label: 'GRACoL 2013 Coated / CRPC6',
    colorSpace: 'cmyk',
    printingCondition: 'CGATS21-2-CRPC6',
    registryName: 'https://www.color.org/chardata/rgb/CGATS21_CRPC6.xalter',
    recommendedTotalInkLimitPercent: 300,
  },
  'swop-coated-v2': {
    id: 'swop-coated-v2',
    label: 'U.S. Web Coated SWOP v2',
    colorSpace: 'cmyk',
    printingCondition: 'CGATS TR 001',
    registryName: 'https://www.color.org/chardata/rgb/SWOP.xalter',
    recommendedTotalInkLimitPercent: 300,
  },
  'pso-coated-v3-fogra51': {
    id: 'pso-coated-v3-fogra51',
    label: 'PSO Coated v3 / FOGRA51',
    colorSpace: 'cmyk',
    printingCondition: 'FOGRA51',
    registryName: 'https://www.color.org/chardata/rgb/FOGRA51.xalter',
    recommendedTotalInkLimitPercent: 300,
  },
  'pso-uncoated-v3-fogra52': {
    id: 'pso-uncoated-v3-fogra52',
    label: 'PSO Uncoated v3 / FOGRA52',
    colorSpace: 'cmyk',
    printingCondition: 'FOGRA52',
    registryName: 'https://www.color.org/chardata/rgb/FOGRA52.xalter',
    recommendedTotalInkLimitPercent: 300,
  },
  custom: {
    id: 'custom',
    label: 'Custom press profile',
    colorSpace: 'cmyk',
    recommendedTotalInkLimitPercent: 300,
  },
};

export const DEFAULT_PAPER_PRINT_PRODUCTION: PaperPrintProductionSpec = {
  pdfStandard: 'browser-pdf',
  outputIntentProfileId: 'srgb',
  customOutputIntentName: '',
  totalInkLimitPercent: 300,
  blackPolicy: 'warn-rich-black',
  spotColorPolicy: 'warn',
  overprintPreview: false,
  marks: {
    cropMarks: false,
    cropMarkLengthMm: 5,
    cropMarkOffsetMm: 2,
    cropMarkStrokePt: 0.25,
    registrationMarks: false,
    colorBars: false,
    slugAreaMm: 0,
  },
  jobInfo: {
    jobName: '',
    jobNumber: '',
    client: '',
    author: '',
    notes: '',
  },
};

export function normalizePaperPrintProductionSpec(
  value?: PaperPrintProductionPatch,
): PaperPrintProductionSpec {
  const merged = { ...DEFAULT_PAPER_PRINT_PRODUCTION, ...value };
  const outputIntentProfileId = isOutputIntentProfileId(merged.outputIntentProfileId)
    ? merged.outputIntentProfileId
    : DEFAULT_PAPER_PRINT_PRODUCTION.outputIntentProfileId;
  const profile = PAPER_OUTPUT_INTENT_PROFILES[outputIntentProfileId];
  const outputIntentProfileAssetId = isBinaryAssetId(merged.outputIntentProfileAssetId)
    ? merged.outputIntentProfileAssetId
    : undefined;

  return {
    pdfStandard: isPaperPdfStandard(merged.pdfStandard) ? merged.pdfStandard : DEFAULT_PAPER_PRINT_PRODUCTION.pdfStandard,
    outputIntentProfileId,
    ...(outputIntentProfileAssetId ? { outputIntentProfileAssetId } : {}),
    customOutputIntentName: typeof merged.customOutputIntentName === 'string' ? merged.customOutputIntentName.slice(0, 120) : '',
    totalInkLimitPercent: clampPercent(merged.totalInkLimitPercent, 100, 400, profile.recommendedTotalInkLimitPercent),
    blackPolicy: isBlackPolicy(merged.blackPolicy) ? merged.blackPolicy : DEFAULT_PAPER_PRINT_PRODUCTION.blackPolicy,
    spotColorPolicy: isSpotColorPolicy(merged.spotColorPolicy) ? merged.spotColorPolicy : DEFAULT_PAPER_PRINT_PRODUCTION.spotColorPolicy,
    overprintPreview: Boolean(merged.overprintPreview),
    marks: normalizePaperPrintMarksSpec(value?.marks),
    jobInfo: normalizePaperPrintJobInfo(value?.jobInfo),
  };
}

function normalizePaperPrintMarksSpec(value: Partial<PaperPrintProductionSpec['marks']> | undefined): PaperPrintProductionSpec['marks'] {
  const merged = { ...DEFAULT_PAPER_PRINT_PRODUCTION.marks, ...value };
  return {
    cropMarks: Boolean(merged.cropMarks),
    cropMarkLengthMm: clampNumber(merged.cropMarkLengthMm, 2, 20, DEFAULT_PAPER_PRINT_PRODUCTION.marks.cropMarkLengthMm),
    cropMarkOffsetMm: clampNumber(merged.cropMarkOffsetMm, 0, 20, DEFAULT_PAPER_PRINT_PRODUCTION.marks.cropMarkOffsetMm),
    cropMarkStrokePt: clampNumber(merged.cropMarkStrokePt, 0.1, 2, DEFAULT_PAPER_PRINT_PRODUCTION.marks.cropMarkStrokePt),
    registrationMarks: Boolean(merged.registrationMarks),
    colorBars: Boolean(merged.colorBars),
    slugAreaMm: clampNumber(merged.slugAreaMm, 0, 100, DEFAULT_PAPER_PRINT_PRODUCTION.marks.slugAreaMm),
  };
}

function normalizePaperPrintJobInfo(value: Partial<PaperPrintProductionSpec['jobInfo']> | undefined): PaperPrintProductionSpec['jobInfo'] {
  const merged = { ...DEFAULT_PAPER_PRINT_PRODUCTION.jobInfo, ...value };
  const clean = (field: unknown, maximum: number) => typeof field === 'string'
    ? field.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum)
    : '';
  return {
    jobName: clean(merged.jobName, 160),
    jobNumber: clean(merged.jobNumber, 80),
    client: clean(merged.client, 160),
    author: clean(merged.author, 160),
    notes: clean(merged.notes, 500),
  };
}

export function buildPaperPrintProductionMetadata(document: Pick<PaperDocument, 'printProduction'>): PaperPrintProductionMetadata {
  const production = normalizePaperPrintProductionSpec(document.printProduction);
  const profile = PAPER_OUTPUT_INTENT_PROFILES[production.outputIntentProfileId];
  const outputIntentLabel = production.outputIntentProfileId === 'custom' && production.customOutputIntentName.trim()
    ? production.customOutputIntentName.trim()
    : profile.label;
  const limitations = [
    'Browser PDF export records the production intent but does not embed ICC output profiles or validate PDF/X conformance.',
  ];

  if (profile.colorSpace === 'cmyk') {
    limitations.push('Sloom Studio stores editable frame colors as CSS/RGB values; CMYK conversion and separations must be verified by a press-aware PDF workflow.');
  }

  return {
    ...production,
    outputIntentLabel,
    outputIntentColorSpace: profile.colorSpace,
    outputCondition: profile.printingCondition,
    outputIntentRegistryName: profile.registryName,
    browserPdfIsPressCertified: false,
    limitations,
  };
}

export function isPdfXProductionTarget(production: Pick<PaperPrintProductionSpec, 'pdfStandard'>): boolean {
  return production.pdfStandard === 'pdf-x-4' || production.pdfStandard === 'pdf-x-1a';
}

function isPaperPdfStandard(value: unknown): value is PaperPrintProductionSpec['pdfStandard'] {
  return value === 'browser-pdf' || value === 'pdf-x-4' || value === 'pdf-x-1a';
}

function isOutputIntentProfileId(value: unknown): value is PaperOutputIntentProfileId {
  return typeof value === 'string' && value in PAPER_OUTPUT_INTENT_PROFILES;
}

function isBinaryAssetId(value: unknown): value is BinaryAssetId {
  return typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);
}

function isBlackPolicy(value: unknown): value is PaperPrintProductionSpec['blackPolicy'] {
  return value === 'warn-rich-black' || value === 'force-100k-text' || value === 'allow-rich-black';
}

function isSpotColorPolicy(value: unknown): value is PaperPrintProductionSpec['spotColorPolicy'] {
  return value === 'warn' || value === 'convert-process' || value === 'preserve-named';
}

function clampPercent(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampNumber(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value * 1000) / 1000));
}
