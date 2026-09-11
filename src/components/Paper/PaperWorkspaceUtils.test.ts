import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { addFrameToPaperPage, createDefaultPaperDocument, updatePaperDocumentSetup } from '../../lib/paperDocument';
import type { BinaryAssetRef } from '../../shared/assets/contentAddressedAsset';
import type { PaperFrame, PaperManagedFontFace, PaperManagedIccProfile } from '../../types/paper';
import { createBinaryAssetRecord } from '../../shared/assets/contentAddressedAsset';
import { paperAssetRepository } from '../../features/paper/assets/PaperAssetRuntime';
import {
  bubbleHandlePatch,
  buildPaperEyedropperFrameColorPatch,
  buildPaperPdfRasterExportSettings,
  createPaperDocumentRasterizationGuardWithCurrentSources,
  exportPaperEpubAndSave,
  deletePaperFrameVertexPatch,
  resolvePaperEyedropperPixelColor,
  exportPaperPdfDocument,
  exportPaperPdfxAndSave,
  exportPaperTaggedPdfAndSave,
  exportPaperKdpPdfAndSave,
  exportPaperWebcomicImages,
  insertPaperFrameVertexPatch,
  materializePaperRasterOutputDocument,
  movePaperFrameVertexPatch,
  openPrintPreview,
  resolvePaperEyedropperFrameColor,
  shouldShowPaperVertexHandles,
  samplePixelColorFromCanvas,
  verticesForEditableFrame,
} from './PaperWorkspaceUtils';
import { materializePaperDocumentAssetUrls } from '../../features/paper/assets/PaperAssetRuntime';

const sourceStoreMocks = vi.hoisted(() => ({
  items: [] as Array<{ id: string; label: string; kind: string; mimeType?: string; assetUrl?: string; createdAt: number }>,
}));

const androidFileMocks = vi.hoisted(() => ({
  writeFile: vi.fn(),
  appendFile: vi.fn(),
  getUri: vi.fn(),
}));

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Documents: 'DOCUMENTS', External: 'EXTERNAL', Data: 'DATA' },
  Filesystem: androidFileMocks,
}));

vi.mock('../../shared/ui/userNotice', () => ({ showUserNotice: vi.fn() }));

vi.mock('../../store/sourceBinStore', () => ({
  useSourceBinStore: { getState: () => ({ getAllItems: () => sourceStoreMocks.items }) },
}));

type DrawImageArgs = Parameters<CanvasRenderingContext2D['drawImage']>;

let pixelDrawArgs: DrawImageArgs | undefined;

const pixelContext = {
  drawImage: vi.fn((...args: DrawImageArgs) => {
    pixelDrawArgs = args;
  }),
  getImageData: vi.fn(() => {
    if (pixelDrawArgs?.[1] === 1 && pixelDrawArgs?.[2] === 2) {
      return { data: new Uint8ClampedArray([18, 52, 86, 255]) };
    }
    return { data: new Uint8ClampedArray([18, 52, 86, 0]) };
  }),
};

class FakeSampleCanvas {
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  getContext() {
    return pixelContext;
  }
}

function bubbleFrame(overrides: Partial<PaperFrame> = {}): PaperFrame {
  return {
    id: 'bubble-1',
    kind: 'speechBubble',
    label: 'Speech Bubble',
    xMm: 20,
    yMm: 30,
    widthMm: 40,
    heightMm: 20,
    rotationDeg: 0,
    locked: false,
    fit: 'cover',
    imageScale: 1,
    imageOffsetXPercent: 0,
    imageOffsetYPercent: 0,
    imageRotationDeg: 0,
    columns: 1,
    typography: {
      fontFamily: 'Inter',
      fontSizePt: 10,
      leadingPt: 13,
      tracking: 0,
      align: 'center',
      hyphenate: false,
      color: '#111827',
      fontWeight: '400',
      fontStyle: 'normal',
    },
    fillColor: '#ffffff',
    fillOpacity: 1,
    strokeColor: '#111827',
    strokeOpacity: 1,
    strokeWidthMm: 0.35,
    strokeStyle: 'solid',
    cornerRadiusMm: 0,
    opacity: 1,
    textBoxXPercent: 12,
    textBoxYPercent: 18,
    textBoxWidthPercent: 76,
    textBoxHeightPercent: 48,
    textRotationDeg: 0,
    textVerticalAlign: 'middle',
    zIndex: 0,
    ...overrides,
  };
}

function strictPdfDocument(title: string): {
  document: ReturnType<typeof createDefaultPaperDocument>;
  profile: PaperManagedIccProfile;
} {
  const sha256 = 'b'.repeat(64);
  const profileAsset: BinaryAssetRef = {
    id: `sha256:${sha256}`,
    sha256,
    mimeType: 'application/vnd.iccprofile',
    byteLength: 122152,
  };
  const profile: PaperManagedIccProfile = {
    id: profileAsset.id,
    asset: profileAsset,
    description: 'FOGRA39L Coated',
    deviceClass: 'prtr',
    colorSpace: 'CMYK',
    pcs: 'Lab ',
    outputConditionId: 'FOGRA39',
    source: { kind: 'bundled', url: '/icc/FOGRA39L_coated.icc' },
  };
  const document = updatePaperDocumentSetup(createDefaultPaperDocument({ title }), {
    printProduction: {
      pdfStandard: 'browser-pdf',
      outputIntentProfileId: 'custom',
      customOutputIntentName: 'FOGRA39',
      outputIntentProfileAssetId: profile.id,
    },
    managedIccProfiles: [profile],
  });
  return { document, profile };
}

async function paperDocumentWithManagedFont(title: string) {
  const record = await createBinaryAssetRecord(Uint8Array.from([1, 2, 3]), { mimeType: 'font/ttf' });
  const fontAsset = await paperAssetRepository.put(record);
  let document = createDefaultPaperDocument({ title });
  const face: PaperManagedFontFace = {
    id: 'browser-readiness-proof',
    familyId: 'browser readiness proof',
    familyName: 'Browser Readiness Proof',
    postscriptName: 'BrowserReadinessProof-Regular',
    weight: 400,
    style: 'normal',
    stretchPercent: 100,
    collectionIndex: 0,
    variableAxes: {},
    unicodeRanges: [],
    format: 'truetype',
    fontAsset,
    embeddability: 'installable',
    canSubset: true,
    source: { kind: 'user-import' },
    license: {},
  };
  document = addFrameToPaperPage(document, document.pages[0].id, {
    kind: 'text',
    text: 'Exact readiness',
    xMm: 10,
    yMm: 10,
    widthMm: 40,
    heightMm: 20,
    typography: {
      ...document.pages[0].frames[0]?.typography,
      fontFamily: face.familyName,
      fontWeight: '400',
      fontStyle: 'normal',
    },
  } as never).document;
  return { ...document, importedFonts: [face] };
}

function passingPdfxDependencies() {
  return {
    exportPdfx: vi.fn(async () => ({
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]),
      standard: 'pdf-x-1a' as const,
      pageCount: 1,
      profileName: 'FOGRA39L Coated',
      approximateColor: false,
      nativeEvidence: {
        processObjectIds: [],
        spotPlates: [],
        embeddedFontIds: [],
        outlinedObjectIds: [],
        flattenedObjectIds: [],
        overprintObjectIds: [],
      },
    })),
    validatePdfx: vi.fn(async () => ({
      standard: 'pdf-x-1a' as const,
      headerVersion: '1.4',
      pass: true,
      checks: [{ id: 'header', label: 'PDF header', pass: true }],
    })),
    assetExists: async () => true,
  };
}

describe('PaperWorkspaceUtils bubble handles', () => {
  it('allows bubble tails to extend outside the frame in any direction', () => {
    expect(bubbleHandlePatch(bubbleFrame(), 'tail', { xMm: 84, yMm: 12 })).toEqual({
      tailXPercent: 160,
      tailYPercent: -90,
    });
  });

  it('keeps pinch handles constrained to the bubble body', () => {
    expect(bubbleHandlePatch(bubbleFrame(), 'pinch', { xMm: 84, yMm: 12 })).toEqual({
      bubblePinchXPercent: 100,
      bubblePinchYPercent: 0,
    });
  });

  it('updates the single bubble tail curve control from a dragged curve point', () => {
    expect(bubbleHandlePatch(bubbleFrame({
      bubblePinchXPercent: 58,
      bubblePinchYPercent: 75,
      tailXPercent: 72,
      tailYPercent: 92,
    }), 'curve', { xMm: 44, yMm: 48 })).toEqual({
      bubbleTailCurvePercent: 100,
    });
  });

  // The four side handles now each shape ONLY their own edge (independent bulge/pinch). Each drag must
  // write exactly one bubbleWarp{Side} field and leave the others (and the legacy bubbleWarp) untouched,
  // so bubbles authored before per-side warp existed keep rendering from the symmetric fallback.
  it('left handle shapes only the left edge (bubbleWarpLeft)', () => {
    // xMm 21.2 → 3% across a 40mm frame → (5 - 3) / 4 = 0.5 bulge on the left edge alone.
    expect(bubbleHandlePatch(bubbleFrame(), 'left', { xMm: 21.2, yMm: 30 })).toEqual({
      bubbleWarpLeft: 0.5,
    });
  });

  it('right handle shapes only the right edge (bubbleWarpRight)', () => {
    // xMm 58.8 → 97% across → (97 - 95) / 4 = 0.5 bulge on the right edge alone.
    expect(bubbleHandlePatch(bubbleFrame(), 'right', { xMm: 58.8, yMm: 30 })).toEqual({
      bubbleWarpRight: 0.5,
    });
  });

  it('top handle shapes only the top edge (bubbleWarpTop)', () => {
    // yMm 31.9 → 9.5% down a 20mm frame → (12 - 9.5) / 5 = 0.5 bulge on the top edge alone.
    expect(bubbleHandlePatch(bubbleFrame(), 'top', { xMm: 20, yMm: 31.9 })).toEqual({
      bubbleWarpTop: 0.5,
    });
  });

  it('bottom handle shapes only the bottom edge (bubbleWarpBottom)', () => {
    // yMm 48.1 → 90.5% down → (90.5 - 88) / 5 = 0.5 bulge on the bottom edge alone.
    expect(bubbleHandlePatch(bubbleFrame(), 'bottom', { xMm: 20, yMm: 48.1 })).toEqual({
      bubbleWarpBottom: 0.5,
    });
  });
});

describe('PaperWorkspaceUtils eyedropper', () => {
  beforeEach(() => {
    globalThis.OffscreenCanvas = FakeSampleCanvas as unknown as typeof OffscreenCanvas;
    pixelDrawArgs = undefined;
    pixelContext.drawImage.mockClear();
    pixelContext.getImageData.mockClear();
  });

  it('samples the most visible editable color from a Paper frame', () => {
    expect(resolvePaperEyedropperFrameColor(bubbleFrame({
      kind: 'text',
      typography: { ...bubbleFrame().typography, color: '#123456' },
    }))).toBe('#123456');

    expect(resolvePaperEyedropperFrameColor(bubbleFrame({
      fillColor: '#abcdef',
      strokeColor: '#654321',
    }))).toBe('#abcdef');

    expect(resolvePaperEyedropperFrameColor(bubbleFrame({
      kind: 'shape',
      shapeKind: 'line',
      fillColor: 'transparent',
      strokeColor: '#654321',
    }))).toBe('#654321');
  });

  it('applies sampled colors to the selected frame color slot that matches its kind', () => {
    expect(buildPaperEyedropperFrameColorPatch(bubbleFrame({ kind: 'text' }), '#abcdef')).toEqual({
      typography: { color: '#abcdef' },
    });

    expect(buildPaperEyedropperFrameColorPatch(bubbleFrame({ kind: 'shape', shapeKind: 'line' }), '#abcdef')).toEqual({
      strokeColor: '#abcdef',
    });

    expect(buildPaperEyedropperFrameColorPatch(bubbleFrame({ kind: 'panel' }), '#abcdef')).toEqual({
      fillColor: '#abcdef',
    });
  });

  it('samples pixels from an image/page canvas source', () => {
    const bitmap = { width: 16, height: 16 } as unknown as (CanvasImageSource & { width: number; height: number });

    const sample = samplePixelColorFromCanvas({
      bitmap,
      x: 1.7,
      y: 2.4,
    });

    expect(sample).toEqual({ color: '#123456' });
    expect(pixelContext.drawImage).toHaveBeenCalledWith(bitmap, 1, 2, 1, 1, 0, 0, 1, 1);
  });

  it('returns a clear unsupported reason when no Paper pixel source is available', () => {
    const sample = resolvePaperEyedropperPixelColor();
    expect(sample).toEqual({ reason: 'No image/page pixel source is available for Paper eyedropper sampling.' });
  });

  it('returns a resolved color for image- and page-sourced Paper sampling requests', () => {
    const bitmap = { width: 16, height: 16 } as unknown as (CanvasImageSource & { width: number; height: number });

    expect(resolvePaperEyedropperPixelColor({ kind: 'image', bitmap, x: 1.7, y: 2.2 })).toEqual({
      color: '#123456',
      sourceKind: 'image',
      sourceLabel: 'Paper image',
    });
    expect(resolvePaperEyedropperPixelColor({ kind: 'page', bitmap, x: 1.7, y: 2.2 })).toEqual({
      color: '#123456',
      sourceKind: 'page',
      sourceLabel: 'Paper page',
    });
  });
});

describe('PaperWorkspaceUtils export', () => {
  it('uses a Chromium-compatible popup handle, severs its opener, and returns printed only after print()', async () => {
    const popupDocument = {
      open: vi.fn(),
      write: vi.fn(),
      close: vi.fn(),
    };
    const popup = {
      document: popupDocument,
      focus: vi.fn(),
      print: vi.fn(),
      opener: { reachable: true },
    };
    const open = vi.fn((_url: string, _target: string, features?: string) => (
      features ? null : popup as unknown as Window
    ));
    vi.stubGlobal('window', { open });

    const pendingOutcome = openPrintPreview(createDefaultPaperDocument({ title: 'Popup success' }));

    // Acquisition and opener isolation happen synchronously, before managed-font assembly awaits.
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(popup.opener).toBeNull();
    const outcome = await pendingOutcome;

    expect(outcome).toEqual({
      state: 'printed',
      message: 'Opened browser print dialog after exact managed-face verification.',
    });
    expect(popupDocument.open).toHaveBeenCalledOnce();
    expect(popupDocument.write).toHaveBeenCalledOnce();
    expect(popupDocument.close).toHaveBeenCalledOnce();
    expect(popup.focus).toHaveBeenCalledOnce();
    expect(popup.print).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('downloads print HTML and returns html-fallback when the browser blocks the popup', async () => {
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    const open = vi.fn(() => null);
    vi.stubGlobal('window', { open, setTimeout });
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { append: vi.fn() } });
    const createObjectURL = vi.fn(() => 'blob:aud-037-print-html');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    const outcome = await openPrintPreview(createDefaultPaperDocument({ title: 'Blocked Popup' }));

    expect(outcome).toEqual({
      state: 'html-fallback',
      message: 'Browser popup was blocked; started the print HTML download.',
    });
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.download).toBe('Blocked-Popup-print.html');
    vi.unstubAllGlobals();
  });

  it('reports a truthful error outcome instead of claiming a print dialog after popup fallback', async () => {
    const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() };
    const open = vi.fn(() => null);
    vi.stubGlobal('window', { open, setTimeout });
    vi.stubGlobal('document', { createElement: vi.fn(() => anchor), body: { append: vi.fn() } });
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:aud-037-caller'), revokeObjectURL: vi.fn() });
    const statuses: string[] = [];

    const outcome = await exportPaperPdfDocument(
      createDefaultPaperDocument({ title: 'Caller fallback' }),
      (status) => statuses.push(status),
    );

    expect(outcome).toEqual({
      state: 'error',
      message: 'Browser popup was blocked; started the print HTML download.',
      targetKind: 'file',
    });
    expect(statuses).toEqual(['Browser popup was blocked; started the print HTML download.']);
    expect([...statuses, outcome.message].join(' ')).not.toMatch(/opened browser print dialog/i);
    expect(anchor.click).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('awaits Android fallback storage in Documents -> External -> Data order before reporting success', async () => {
    const nativePlatform = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    androidFileMocks.writeFile.mockImplementation(async ({ directory }: { directory: string }) => {
      if (directory !== 'DATA') throw new Error(`${directory} unavailable`);
      return { uri: 'content://aud-037' };
    });
    androidFileMocks.getUri.mockResolvedValue({ uri: 'content://aud-037/Android-Fallback-print.html' });
    const open = vi.fn(() => null);
    vi.stubGlobal('window', { open });
    vi.stubGlobal('FileReader', class {
      result = 'data:text/html;base64,PGh0bWw+';
      onloadend: (() => void) | null = null;

      readAsDataURL() {
        this.onloadend?.();
      }
    });

    const outcome = await openPrintPreview(createDefaultPaperDocument({ title: 'Android Fallback' }));

    expect(outcome).toEqual({
      state: 'html-fallback',
      message: 'Browser popup was blocked; saved print HTML to app private storage.',
    });
    expect(androidFileMocks.writeFile.mock.calls.map(([request]) => request.directory)).toEqual([
      'DOCUMENTS',
      'EXTERNAL',
      'DATA',
    ]);
    expect(androidFileMocks.writeFile.mock.calls[2][0]).toMatchObject({ path: 'Android-Fallback-print.html' });
    expect(androidFileMocks.getUri).toHaveBeenCalledOnce();
    nativePlatform.mockRestore();
    androidFileMocks.writeFile.mockReset();
    androidFileMocks.getUri.mockReset();
    vi.unstubAllGlobals();
  });

  it('returns failed only after every ordered Android fallback destination fails', async () => {
    const nativePlatform = vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    androidFileMocks.writeFile.mockImplementation(async ({ directory }: { directory: string }) => {
      throw new Error(`${directory} denied`);
    });
    const open = vi.fn(() => null);
    vi.stubGlobal('window', { open });
    vi.stubGlobal('FileReader', class {
      result = 'data:text/html;base64,PGh0bWw+';
      onloadend: (() => void) | null = null;

      readAsDataURL() {
        this.onloadend?.();
      }
    });

    const outcome = await openPrintPreview(createDefaultPaperDocument({ title: 'Android Failure' }));

    expect(outcome).toEqual({
      state: 'failed',
      message: 'Browser popup was blocked, and the print HTML fallback failed: DATA denied',
    });
    expect(androidFileMocks.writeFile.mock.calls.map(([request]) => request.directory)).toEqual([
      'DOCUMENTS',
      'EXTERNAL',
      'DATA',
    ]);
    expect(androidFileMocks.getUri).not.toHaveBeenCalled();
    nativePlatform.mockRestore();
    androidFileMocks.writeFile.mockReset();
    androidFileMocks.getUri.mockReset();
    vi.unstubAllGlobals();
  });

  it('returns failed when a blocked browser popup cannot start its HTML fallback', async () => {
    const open = vi.fn(() => null);
    vi.stubGlobal('window', { open, setTimeout });
    vi.stubGlobal('document', { createElement: vi.fn(), body: { append: vi.fn() } });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => { throw new Error('object URL unavailable'); }),
      revokeObjectURL: vi.fn(),
    });

    await expect(openPrintPreview(createDefaultPaperDocument({ title: 'Fallback Failure' })))
      .resolves.toEqual({
        state: 'failed',
        message: 'Browser popup was blocked, and the print HTML fallback failed: object URL unavailable',
      });
    vi.unstubAllGlobals();
  });

  it('settles managed-font readiness rejection as a failed caller outcome and status', async () => {
    const popupDocument = {
      open: vi.fn(),
      write: vi.fn(),
      close: vi.fn(),
      createElement: vi.fn(() => ({ textContent: '' })),
      body: { prepend: vi.fn() },
    };
    const popup = {
      document: popupDocument,
      focus: vi.fn(),
      print: vi.fn(),
      opener: {},
      close: vi.fn(),
    };
    vi.stubGlobal('window', { open: vi.fn(() => popup as unknown as Window) });
    const statuses: string[] = [];
    const document = await paperDocumentWithManagedFont('Readiness Failure');

    const outcome = await exportPaperPdfDocument(document, (status) => statuses.push(status));

    expect(outcome).toEqual({
      state: 'error',
      message: 'Print preview failed: Browser does not expose requested-face verification.',
      targetKind: 'file',
    });
    expect(statuses).toEqual(['Print preview failed: Browser does not expose requested-face verification.']);
    expect(popup.print).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it.each([
    ['write', 'popup write failed'],
    ['print', 'browser print failed'],
  ] as const)('settles popup %s exceptions as failed instead of rejecting', async (stage, detail) => {
    const write = vi.fn(() => {
      if (stage === 'write') throw new Error(detail);
    });
    const print = vi.fn(() => {
      if (stage === 'print') throw new Error(detail);
    });
    const popup = {
      document: {
        open: vi.fn(),
        write,
        close: vi.fn(),
        createElement: vi.fn(() => ({ textContent: '' })),
        body: { prepend: vi.fn() },
      },
      focus: vi.fn(),
      print,
      opener: {},
      close: vi.fn(),
    };
    vi.stubGlobal('window', { open: vi.fn(() => popup as unknown as Window) });

    await expect(openPrintPreview(createDefaultPaperDocument({ title: `${stage} failure` })))
      .resolves.toEqual({ state: 'failed', message: `Print preview failed: ${detail}` });
    vi.unstubAllGlobals();
  });

  it('maps PDF raster presets to predictable format, quality, and DPI limits', () => {
    const doc = createDefaultPaperDocument({ title: 'PDF Presets' });

    expect(buildPaperPdfRasterExportSettings(doc, { rasterPreset: 'print-png' })).toMatchObject({
      format: 'png',
      outputDpi: doc.page.dpi,
      quality: undefined,
    });
    expect(buildPaperPdfRasterExportSettings(doc, { rasterPreset: 'balanced-jpeg' })).toMatchObject({
      format: 'jpeg',
      outputDpi: Math.min(doc.page.dpi, 240),
      quality: 0.9,
    });
    expect(buildPaperPdfRasterExportSettings(doc, { rasterPreset: 'proof-jpeg' })).toMatchObject({
      format: 'jpeg',
      outputDpi: Math.min(doc.page.dpi, 150),
      quality: 0.82,
    });
  });

  it('asks for the native PDF destination before creating any raster canvas', async () => {
    const order: string[] = [];
    const choosePaperPdfExportPath = vi.fn().mockImplementation(async () => {
      order.push('choose');
      return { canceled: false, filePath: '/tmp/Chooser-First.pdf' };
    });
    const exportPaperPdf = vi.fn().mockImplementation(async () => {
      order.push('write');
      return { canceled: false, filePath: '/tmp/Chooser-First.pdf', bytes: 1024 };
    });
    vi.stubGlobal('window', { signalLoomNative: { choosePaperPdfExportPath, exportPaperPdf } });
    vi.stubGlobal('Image', class {
      decoding = 'sync';
      src = '';
      decode = vi.fn().mockResolvedValue(undefined);
    });
    vi.stubGlobal('document', {
      createElement: vi.fn(() => {
        order.push('raster');
        return {
          width: 0,
          height: 0,
          getContext: vi.fn(() => ({ drawImage: vi.fn() })),
          toDataURL: vi.fn(() => 'data:image/png;base64,chooser-first'),
        };
      }),
    });

    await exportPaperPdfDocument(createDefaultPaperDocument({ title: 'Chooser First' }), vi.fn());

    expect(order[0]).toBe('choose');
    expect(order.indexOf('choose')).toBeLessThan(order.indexOf('raster'));
    expect(order.at(-1)).toBe('write');
    expect(exportPaperPdf.mock.calls[0][0].filePath).toBe('/tmp/Chooser-First.pdf');
    vi.unstubAllGlobals();
  });

  it('stops PDF export before rasterization when the destination chooser is canceled', async () => {
    const exportPaperPdf = vi.fn();
    const createElement = vi.fn();
    vi.stubGlobal('window', {
      signalLoomNative: {
        choosePaperPdfExportPath: vi.fn().mockResolvedValue({ canceled: true }),
        exportPaperPdf,
      },
    });
    vi.stubGlobal('document', { createElement });
    const statuses: string[] = [];

    await exportPaperPdfDocument(createDefaultPaperDocument({ title: 'Canceled PDF' }), (status) => statuses.push(status));

    expect(createElement).not.toHaveBeenCalled();
    expect(exportPaperPdf).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe('PDF export canceled.');
    vi.unstubAllGlobals();
  });

  it('blocks a placed-PDF raster export before chooser, status success, or canvas work', async () => {
    const choosePaperPdfExportPath = vi.fn();
    const exportPaperPdf = vi.fn();
    const createElement = vi.fn();
    vi.stubGlobal('window', { signalLoomNative: { choosePaperPdfExportPath, exportPaperPdf } });
    vi.stubGlobal('document', { createElement });
    const base = createDefaultPaperDocument({ title: 'Native preflight first' });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'document', label: 'Placed.pdf', xMm: 10, yMm: 10, widthMm: 50, heightMm: 40,
      asset: { label: 'Placed.pdf', kind: 'document', mimeType: 'application/pdf', locator: { kind: 'external', url: 'data:application/pdf;base64,JVBERi0=' } },
    });
    const statuses: string[] = [];

    await expect(exportPaperPdfDocument(document, (status) => statuses.push(status))).rejects.toThrow('cannot rasterize');
    expect(choosePaperPdfExportPath).not.toHaveBeenCalled();
    expect(exportPaperPdf).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalled();
    expect(statuses).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('asks for the native page-image directory before creating any raster canvas', async () => {
    const order: string[] = [];
    const choosePaperImageExportDirectory = vi.fn().mockImplementation(async () => {
      order.push('choose');
      return { canceled: false, directoryPath: '/tmp/Chooser-First-images' };
    });
    const exportPaperImages = vi.fn().mockImplementation(async () => {
      order.push('write');
      return { canceled: false, directoryPath: '/tmp/Chooser-First-images', files: [], bytes: 512 };
    });
    vi.stubGlobal('window', { signalLoomNative: { choosePaperImageExportDirectory, exportPaperImages } });
    vi.stubGlobal('Image', class {
      decoding = 'sync';
      src = '';
      decode = vi.fn().mockResolvedValue(undefined);
    });
    vi.stubGlobal('document', {
      createElement: vi.fn(() => {
        order.push('raster');
        return {
          width: 0,
          height: 0,
          getContext: vi.fn(() => ({ drawImage: vi.fn() })),
          toDataURL: vi.fn(() => 'data:image/png;base64,chooser-first'),
        };
      }),
    });

    await exportPaperWebcomicImages(createDefaultPaperDocument({ title: 'Chooser First' }), vi.fn(), {
      format: 'png',
      outputWidthPx: 1200,
    });

    expect(order[0]).toBe('choose');
    expect(order.indexOf('choose')).toBeLessThan(order.indexOf('raster'));
    expect(order.at(-1)).toBe('write');
    expect(exportPaperImages.mock.calls[0][0].directoryPath).toBe('/tmp/Chooser-First-images');
    vi.unstubAllGlobals();
  });

  it('stops page-image export before rasterization when the directory chooser is canceled', async () => {
    const exportPaperImages = vi.fn();
    const createElement = vi.fn();
    vi.stubGlobal('window', {
      signalLoomNative: {
        choosePaperImageExportDirectory: vi.fn().mockResolvedValue({ canceled: true }),
        exportPaperImages,
      },
    });
    vi.stubGlobal('document', { createElement });
    const statuses: string[] = [];

    await exportPaperWebcomicImages(createDefaultPaperDocument({ title: 'Canceled Images' }), (status) => statuses.push(status), {
      format: 'png',
      outputWidthPx: 1200,
    });

    expect(createElement).not.toHaveBeenCalled();
    expect(exportPaperImages).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe('Page image export canceled.');
    vi.unstubAllGlobals();
  });

  it('sends flattened page snapshots to default native PDF export so PDF text matches the editor', async () => {
    let doc = createDefaultPaperDocument({ title: 'PDF Parity' });
    doc = addFrameToPaperPage(doc, doc.pages[0].id, {
      kind: 'speechBubble',
      text: 'PDF parity text',
      xMm: 20,
      yMm: 20,
      widthMm: 70,
      heightMm: 24,
    }).document;
    const exportPaperPdf = vi.fn().mockResolvedValue({
      canceled: false,
      filePath: '/tmp/PDF-Parity.pdf',
      bytes: 4096,
    });
    vi.stubGlobal('window', {
      signalLoomNative: {
        exportPaperPdf,
      },
    });
    vi.stubGlobal('Image', class {
      decoding = 'sync';
      src = '';
      decode = vi.fn().mockResolvedValue(undefined);
    });
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => ({
          drawImage: vi.fn(),
        })),
        toDataURL: vi.fn(() => 'data:image/png;base64,flattened-page'),
      })),
    });
    const statuses: string[] = [];

    await exportPaperPdfDocument(doc, (status) => statuses.push(status));

    const request = exportPaperPdf.mock.calls[0][0];
    expect(request.mode).toBe('pages-raster');
    expect(request.html).toContain('data-signal-loom-paper-raster-pdf="true"');
    expect(request.html).toContain('data:image/png;base64,flattened-page');
    // AUD-020: the flattened page image carries the author text; the "-raster" PDF HTML must not
    // re-emit it as a live vector frame on top of the raster.
    expect(request.html).not.toContain('PDF parity text');
    expect(request.html).not.toContain('class="frame');
    expect(statuses[0]).toContain('Rasterizing 1 Paper page');
    expect(statuses.at(-1)).toContain('/tmp/PDF-Parity.pdf');
    vi.unstubAllGlobals();
  });

  it('bakes a translucent shape and author text into the page image once and ships no live overlay', async () => {
    // AUD-020 double-paint proof through the real default PDF-export boundary: the flattened page
    // snapshot (the SVG we rasterize) must contain BOTH the translucent shape and the author text so
    // they are painted exactly once; the delivered "-raster" PDF HTML must then contain only that page
    // image, never a second live copy of the shape/text that would alter opacity and compositing.
    let doc = createDefaultPaperDocument({ title: 'Flatten Once' });
    doc = addFrameToPaperPage(doc, doc.pages[0].id, {
      kind: 'shape',
      shapeKind: 'ellipse',
      fillColor: '#3366ff',
      fillOpacity: 0.5,
      xMm: 12,
      yMm: 14,
      widthMm: 40,
      heightMm: 40,
    }).document;
    doc = addFrameToPaperPage(doc, doc.pages[0].id, {
      kind: 'speechBubble',
      text: 'Baked once into raster',
      xMm: 20,
      yMm: 60,
      widthMm: 70,
      heightMm: 24,
    }).document;

    const exportPaperPdf = vi.fn().mockResolvedValue({
      canceled: false,
      filePath: '/tmp/Flatten-Once.pdf',
      bytes: 4096,
    });
    vi.stubGlobal('window', { signalLoomNative: { exportPaperPdf } });
    const imageSrcs: string[] = [];
    vi.stubGlobal('Image', class {
      decoding = 'sync';
      #src = '';
      set src(value: string) {
        this.#src = value;
        imageSrcs.push(value);
      }
      get src(): string {
        return this.#src;
      }
      decode = vi.fn().mockResolvedValue(undefined);
    });
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => ({ drawImage: vi.fn() })),
        toDataURL: vi.fn(() => 'data:image/png;base64,flattened-page'),
      })),
    });

    await exportPaperPdfDocument(doc, vi.fn());

    // The rasterized input SVG carries both the translucent shape (once) and the author text (once).
    const svgSrc = imageSrcs.find((src) => src.startsWith('data:image/svg+xml'));
    expect(svgSrc).toBeDefined();
    const svg = decodeURIComponent(svgSrc!.replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
    expect(svg).toContain('frame-shape');
    // The shape's 50% opacity is carried in its own fill (painted once into the page image).
    expect(svg).toContain('rgba(51, 102, 255, 0.5)');
    expect(svg).toContain('Baked once into raster');

    // The delivered PDF HTML is only the flattened page image — no live shape/text overlay.
    const request = exportPaperPdf.mock.calls[0][0];
    expect(request.mode).toBe('pages-raster');
    expect(request.html).toContain('data:image/png;base64,flattened-page');
    expect(request.html).not.toContain('class="frame');
    expect(request.html).not.toContain('frame-shape');
    expect(request.html).not.toContain('paper-page');
    expect(request.html).not.toContain('Baked once into raster');
    vi.unstubAllGlobals();
  });

  it('rebuilds a native vector PDF request with the same standalone exact alias and byte payload as browser print', async () => {
    const record = await createBinaryAssetRecord(Uint8Array.from([1, 2, 3]), { mimeType: 'font/ttf' });
    const fontAsset = await paperAssetRepository.put(record);
    let doc = createDefaultPaperDocument({ title: 'Exact Native PDF' });
    const face: PaperManagedFontFace = {
      id: 'native-variable-opsz', familyId: 'native proof family', familyName: 'Native Proof Family', postscriptName: 'NativeProof-Oblique',
      weight: 400, style: 'oblique', obliqueAngleDeg: 11, stretchPercent: 87.5, collectionIndex: 0,
      variableAxes: { opsz: { min: 8, default: 12, max: 72 } }, variationSettings: { opsz: 18 }, unicodeRanges: [], format: 'truetype', fontAsset,
      embeddability: 'installable', canSubset: true, source: { kind: 'user-import' }, license: {},
    };
    doc = addFrameToPaperPage(doc, doc.pages[0].id, {
      kind: 'text', text: 'Exact', xMm: 10, yMm: 10, widthMm: 40, heightMm: 20,
      typography: { ...doc.pages[0].frames[0]?.typography, fontFamily: face.familyName, fontWeight: '400', fontStyle: 'oblique 11deg', fontStretch: '87.5%', fontVariationSettings: { opsz: 18 } },
    } as never).document;
    doc = { ...doc, importedFonts: [face] };
    const exportPaperPdf = vi.fn().mockResolvedValue({ canceled: false, filePath: '/tmp/exact-native.pdf' });
    vi.stubGlobal('window', { signalLoomNative: { exportPaperPdf } });

    await exportPaperPdfDocument(doc, vi.fn(), {
      title: doc.title, fileName: 'exact-native.pdf', html: '<html/>', page: doc.page, mode: 'pages', production: {} as never,
    });

    const request = exportPaperPdf.mock.calls[0][0];
    expect(request.html).toContain('signal-loom-managed-font-manifest:');
    expect(request.html).not.toContain('format("collection")');
    expect(request.html).toContain('sloom-managed-native-variable-opsz');
    vi.unstubAllGlobals();
  });

  it('uses the selected PDF raster preset for smaller proof exports', async () => {
    let doc = createDefaultPaperDocument({ title: 'Small Proof PDF' });
    doc = {
      ...doc,
      page: {
        ...doc.page,
        dpi: 300,
      },
    };
    const exportPaperPdf = vi.fn().mockResolvedValue({
      canceled: false,
      filePath: '/tmp/Small-Proof-PDF.pdf',
      bytes: 2048,
    });
    const toDataURL = vi.fn(() => 'data:image/jpeg;base64,proof-page');
    vi.stubGlobal('window', {
      signalLoomNative: {
        exportPaperPdf,
      },
    });
    vi.stubGlobal('Image', class {
      decoding = 'sync';
      src = '';
      naturalWidth = 1200;
      naturalHeight = 1800;
      decode = vi.fn().mockResolvedValue(undefined);
    });
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => ({
          fillRect: vi.fn(),
          drawImage: vi.fn(),
        })),
        toDataURL,
      })),
    });
    const statuses: string[] = [];

    await exportPaperPdfDocument(doc, (status) => statuses.push(status), undefined, { rasterPreset: 'proof-jpeg' });

    const request = exportPaperPdf.mock.calls[0][0];
    expect(request.page.dpi).toBe(150);
    expect(request.html).toContain('data:image/jpeg;base64,proof-page');
    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', 0.82);
    expect(statuses[0]).toContain('Proof JPEG');
    vi.unstubAllGlobals();
  });

  it('does not invoke the PDF/X download bridge after a failed structural validation', async () => {
    const sha256 = 'a'.repeat(64);
    const profileAsset: BinaryAssetRef = {
      id: `sha256:${sha256}`,
      sha256,
      mimeType: 'application/vnd.iccprofile',
      byteLength: 8,
    };
    const profile: PaperManagedIccProfile = {
      id: profileAsset.id,
      asset: profileAsset,
      description: 'Exact FOGRA51 profile',
      deviceClass: 'prtr',
      colorSpace: 'CMYK',
      pcs: 'Lab ',
      outputConditionId: 'FOGRA51',
      source: { kind: 'user-import' },
    };
    const document = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Blocked PDFX' }), {
      printProduction: {
        pdfStandard: 'pdf-x-4',
        outputIntentProfileId: 'pso-coated-v3-fogra51',
        outputIntentProfileAssetId: profile.id,
      },
      managedIccProfiles: [profile],
    });
    const downloadPdf = vi.fn();
    const statuses: string[] = [];

    await exportPaperPdfxAndSave(document, (status) => statuses.push(status), {
      exportPdfx: async () => ({
        bytes: new Uint8Array([1]),
        standard: 'pdf-x-4',
        pageCount: 1,
        profileName: 'Exact FOGRA51 profile',
        approximateColor: false,
        nativeEvidence: {
          processObjectIds: [], spotPlates: [], embeddedFontIds: [], outlinedObjectIds: [], flattenedObjectIds: [], overprintObjectIds: [],
        },
      }),
      validatePdfx: async () => ({
        standard: 'pdf-x-4', headerVersion: '1.6', pass: false,
        checks: [{ id: 'no-rgb', label: 'No RGB color', pass: false }],
      }),
      downloadPdf,
      assetExists: async () => true,
    });

    expect(downloadPdf).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toContain('blocked');
  });

  it('blocks accessible PDF delivery before rasterization when a visual frame lacks authored alternative text', async () => {
    const base = createDefaultPaperDocument({ title: 'Missing accessible description' });
    const { document } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image', xMm: 10, yMm: 10, widthMm: 50, heightMm: 40,
      label: 'A label is deliberately not alternative text',
    } as never);
    const statuses: string[] = [];
    const buildTaggedPdf = vi.fn();

    await exportPaperTaggedPdfAndSave(document, (status) => statuses.push(status), { buildTaggedPdf });

    expect(buildTaggedPdf).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toContain('blocked');
    expect(statuses.at(-1)).toContain('alternative text');
  });

  it('delivers a structurally passing tagged PDF through the native byte-save bridge', async () => {
    const document = createDefaultPaperDocument({ title: 'Accessible native PDF' });
    const savePaperPdfBytes = vi.fn().mockResolvedValue({
      canceled: false,
      filePath: '/tmp/Accessible-native-PDF-accessible.pdf',
      bytes: 3,
    });
    vi.stubGlobal('window', { signalLoomNative: { savePaperPdfBytes } });
    vi.stubGlobal('Image', class {
      decoding = 'sync';
      src = '';
      naturalWidth = 1200;
      naturalHeight = 1800;
      decode = vi.fn().mockResolvedValue(undefined);
    });
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => ({ fillRect: vi.fn(), drawImage: vi.fn() })),
        toDataURL: vi.fn(() => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLkWAAAAABJRU5ErkJggg=='),
      })),
    });
    const buildTaggedPdf = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
    const validateTaggedPdf = vi.fn().mockResolvedValue({
      pass: true,
      language: 'en',
      pageCount: 1,
      semanticItemCount: 0,
      checks: [],
    });
    const statuses: string[] = [];

    await exportPaperTaggedPdfAndSave(document, (status) => statuses.push(status), { buildTaggedPdf, validateTaggedPdf });

    expect(buildTaggedPdf).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      rasterPages: [expect.objectContaining({ pageId: document.pages[0].id, mimeType: 'image/png', bytes: expect.any(Uint8Array) })],
    }));
    expect(validateTaggedPdf).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(savePaperPdfBytes).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Accessible native PDF',
      fileName: 'Accessible-native-PDF-accessible.pdf',
      bytes: new Uint8Array([1, 2, 3]),
    }));
    expect(statuses.at(-1)).toContain('Saved accessible tagged PDF to /tmp/Accessible-native-PDF-accessible.pdf');
    vi.unstubAllGlobals();
  });

  it('saves validated KDP PDF/X bytes through the native destination bridge and reports the exact path', async () => {
    const { document } = strictPdfDocument('Native KDP');
    const savePaperPdfBytes = vi.fn().mockResolvedValue({
      canceled: false,
      filePath: '/tmp/Native-KDP-interior.pdf',
      bytes: 8,
    });
    vi.stubGlobal('window', { signalLoomNative: { savePaperPdfBytes } });
    const statuses: string[] = [];

    const dependencies = passingPdfxDependencies();
    await exportPaperKdpPdfAndSave(document, (status) => statuses.push(status), dependencies);

    expect(savePaperPdfBytes).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Native KDP',
      fileName: 'Native-KDP-KDP-interior.pdf',
      bytes: expect.any(Uint8Array),
    }));
    expect(statuses.at(-1)).toContain('/tmp/Native-KDP-interior.pdf');
    expect(dependencies.exportPdfx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ standard: 'pdf-x-1a', outputDpi: 300, flattenAllPages: true }),
    );
    vi.unstubAllGlobals();
  });

  it('reports a canceled native KDP destination without claiming that a PDF was saved', async () => {
    const { document } = strictPdfDocument('Canceled KDP');
    const savePaperPdfBytes = vi.fn().mockResolvedValue({ canceled: true });
    vi.stubGlobal('window', { signalLoomNative: { savePaperPdfBytes } });
    const statuses: string[] = [];

    await exportPaperKdpPdfAndSave(document, (status) => statuses.push(status), passingPdfxDependencies());

    expect(statuses.at(-1)).toBe('KDP PDF/X-1a export canceled.');
    expect(statuses.join(' ')).not.toContain('Saved KDP');
    vi.unstubAllGlobals();
  });

  it('delivers only an EPUB that passed the local structural gate', async () => {
    const document = createDefaultPaperDocument({ title: 'Validated reading edition' });
    const statuses: string[] = [];
    const downloadEpub = vi.fn();

    await exportPaperEpubAndSave(document, (status) => statuses.push(status), { downloadEpub });

    expect(downloadEpub).toHaveBeenCalledOnce();
    expect(downloadEpub).toHaveBeenCalledWith(expect.any(Uint8Array), 'Validated-reading-edition.epub');
    expect(statuses.at(-1)).toContain('EPUB structural checks passed');
    expect(statuses.at(-1)).toContain('Saved reflowable EPUB');
  });

  it('does not invoke EPUB delivery after a failed structural report', async () => {
    const document = createDefaultPaperDocument({ title: 'Blocked reading edition' });
    const statuses: string[] = [];
    const downloadEpub = vi.fn();
    const buildEpub = vi.fn(() => new Uint8Array([0x50, 0x4b, 0x03, 0x04]));
    const validateEpub = vi.fn(() => ({
      pass: false,
      chapterCount: 1,
      checks: [{ id: 'package', label: 'OPF package is incomplete', pass: false }],
    }));

    await exportPaperEpubAndSave(document, (status) => statuses.push(status), {
      buildEpub,
      validateEpub,
      downloadEpub,
    });

    expect(buildEpub).toHaveBeenCalledOnce();
    expect(validateEpub).toHaveBeenCalledOnce();
    expect(downloadEpub).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toContain('EPUB export blocked');
    expect(statuses.at(-1)).toContain('OPF package is incomplete');
  });

  it('saves validated EPUB bytes through the native chooser bridge and reports the saved path', async () => {
    const savePaperEpubBytes = vi.fn().mockResolvedValue({
      canceled: false,
      filePath: '/tmp/Native-reading-edition.epub',
      bytes: 1024,
    });
    vi.stubGlobal('window', { signalLoomNative: { savePaperEpubBytes } });
    const statuses: string[] = [];

    await exportPaperEpubAndSave(createDefaultPaperDocument({ title: 'Native reading edition' }), (status) => statuses.push(status));

    expect(savePaperEpubBytes).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Native reading edition',
      fileName: 'Native-reading-edition.epub',
      bytes: expect.any(Uint8Array),
    }));
    expect(statuses.at(-1)).toContain('/tmp/Native-reading-edition.epub');
    vi.unstubAllGlobals();
  });

  it('reports a canceled native EPUB destination without claiming a saved book', async () => {
    const savePaperEpubBytes = vi.fn().mockResolvedValue({ canceled: true });
    vi.stubGlobal('window', { signalLoomNative: { savePaperEpubBytes } });
    const statuses: string[] = [];

    await exportPaperEpubAndSave(createDefaultPaperDocument({ title: 'Canceled reading edition' }), (status) => statuses.push(status));

    expect(statuses.at(-1)).toBe('EPUB export canceled.');
    expect(statuses.join(' ')).not.toContain('Saved reflowable EPUB');
    vi.unstubAllGlobals();
  });
});

describe('PaperWorkspaceUtils editable frame vertices', () => {
  it('gives comic panels draggable corner vertices by default', () => {
    expect(verticesForEditableFrame(bubbleFrame({ kind: 'panel' }))).toEqual([
      { xPercent: 0, yPercent: 0 },
      { xPercent: 100, yPercent: 0 },
      { xPercent: 100, yPercent: 100 },
      { xPercent: 0, yPercent: 100 },
    ]);
  });

  it('does not reuse stale triangle vertices on captions or speech bubbles', () => {
    const staleTriangle = [
      { xPercent: 50, yPercent: 0 },
      { xPercent: 100, yPercent: 100 },
      { xPercent: 0, yPercent: 100 },
    ];

    expect(verticesForEditableFrame(bubbleFrame({ kind: 'caption', vertices: staleTriangle }))).toEqual([
      { xPercent: 0, yPercent: 0 },
      { xPercent: 100, yPercent: 0 },
      { xPercent: 100, yPercent: 100 },
      { xPercent: 0, yPercent: 100 },
    ]);
    expect(verticesForEditableFrame(bubbleFrame({ kind: 'speechBubble', vertices: staleTriangle }))).toBeUndefined();
  });

  it('moves individual vertices and expands the frame box to fit the edited polygon', () => {
    expect(movePaperFrameVertexPatch(bubbleFrame({
      kind: 'panel',
      vertices: [
        { xPercent: 0, yPercent: 0 },
        { xPercent: 100, yPercent: 0 },
        { xPercent: 100, yPercent: 100 },
        { xPercent: 0, yPercent: 100 },
      ],
    }), 1, { xMm: 72, yMm: 24 })).toEqual({
      xMm: 20,
      yMm: 24,
      widthMm: 52,
      heightMm: 26,
      vertices: [
        { xPercent: 0, yPercent: 23.08 },
        { xPercent: 100, yPercent: 0 },
        { xPercent: 76.92, yPercent: 100 },
        { xPercent: 0, yPercent: 100 },
      ],
    });
  });

  it('snaps vertex edits to the frame border when border snapping is requested', () => {
    expect(movePaperFrameVertexPatch(bubbleFrame({
      kind: 'panel',
      vertices: [
        { xPercent: 0, yPercent: 0 },
        { xPercent: 100, yPercent: 0 },
        { xPercent: 100, yPercent: 100 },
        { xPercent: 0, yPercent: 100 },
      ],
    }), 1, { xMm: 58.8, yMm: 24 }, { snapToBorder: true })).toEqual({
      xMm: 20,
      yMm: 24,
      widthMm: 40,
      heightMm: 26,
      vertices: [
        { xPercent: 0, yPercent: 23.08 },
        { xPercent: 100, yPercent: 0 },
        { xPercent: 100, yPercent: 100 },
        { xPercent: 0, yPercent: 100 },
      ],
    });
  });

  it('inserts a vertex along an edge so a rectangle can become a five-sided polygon', () => {
    expect(insertPaperFrameVertexPatch(bubbleFrame({ kind: 'panel' }), 0)).toEqual({
      vertices: [
        { xPercent: 0, yPercent: 0 },
        { xPercent: 50, yPercent: 0 },
        { xPercent: 100, yPercent: 0 },
        { xPercent: 100, yPercent: 100 },
        { xPercent: 0, yPercent: 100 },
      ],
    });

    expect(insertPaperFrameVertexPatch(bubbleFrame({ kind: 'panel' }), 3, { xMm: 10, yMm: 52 })).toEqual({
      xMm: 10,
      yMm: 30,
      widthMm: 50,
      heightMm: 22,
      vertices: [
        { xPercent: 20, yPercent: 0 },
        { xPercent: 100, yPercent: 0 },
        { xPercent: 100, yPercent: 90.91 },
        { xPercent: 20, yPercent: 90.91 },
        { xPercent: 0, yPercent: 100 },
      ],
    });
  });

  it('deletes vertices while preserving a valid polygon', () => {
    expect(deletePaperFrameVertexPatch(bubbleFrame({ kind: 'panel' }), 1)).toEqual({
      vertices: [
        { xPercent: 0, yPercent: 0 },
        { xPercent: 100, yPercent: 100 },
        { xPercent: 0, yPercent: 100 },
      ],
    });

    expect(deletePaperFrameVertexPatch(bubbleFrame({
      kind: 'panel',
      vertices: [
        { xPercent: 0, yPercent: 0 },
        { xPercent: 100, yPercent: 100 },
        { xPercent: 0, yPercent: 100 },
      ],
    }), 1)).toEqual({});
  });

  it('allows a caption corner to be deleted into an intentional triangle', () => {
    const patch = deletePaperFrameVertexPatch(bubbleFrame({ kind: 'caption' }), 1);

    expect(patch).toEqual({
      vertices: [
        { xPercent: 0, yPercent: 0 },
        { xPercent: 100, yPercent: 100 },
        { xPercent: 0, yPercent: 100 },
      ],
    });
    expect(verticesForEditableFrame(bubbleFrame({ kind: 'caption', vertices: patch.vertices }))).toEqual(patch.vertices);
  });

  it('only reveals polygon vertices while the vertex edit modifier is active or a vertex drag is running', () => {
    expect(shouldShowPaperVertexHandles(bubbleFrame({ kind: 'panel' }), {
      isSelected: true,
      modifierActive: false,
      vertexInteractionActive: false,
    })).toBe(false);
    expect(shouldShowPaperVertexHandles(bubbleFrame({ kind: 'panel' }), {
      isSelected: true,
      modifierActive: true,
      vertexInteractionActive: false,
    })).toBe(true);
    expect(shouldShowPaperVertexHandles(bubbleFrame({ kind: 'panel' }), {
      isSelected: true,
      modifierActive: false,
      vertexInteractionActive: true,
    })).toBe(true);
    expect(shouldShowPaperVertexHandles(bubbleFrame({ kind: 'speechBubble' }), {
      isSelected: true,
      modifierActive: true,
      vertexInteractionActive: false,
    })).toBe(false);
  });
});

describe('current-source placed document boundary for shipping export routes', () => {
  beforeEach(() => {
    sourceStoreMocks.items = [];
  });

  it('blocks the native raster PDF route on a current-PDF linked source before chooser, canvas, or status work', async () => {
    sourceStoreMocks.items = [{
      id: 'replaced', label: 'Panel art', kind: 'document', mimeType: 'application/pdf',
      assetUrl: 'blob:https://app.test/replaced-pdf', createdAt: 1,
    }];
    const choosePaperPdfExportPath = vi.fn();
    const exportPaperPdf = vi.fn();
    const createElement = vi.fn();
    vi.stubGlobal('window', { signalLoomNative: { choosePaperPdfExportPath, exportPaperPdf } });
    vi.stubGlobal('document', { createElement });
    const base = createDefaultPaperDocument({ title: 'Replaced link blocks' });
    const { document: paperDoc } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image', label: 'Panel art', xMm: 10, yMm: 10, widthMm: 50, heightMm: 40,
      asset: { sourceBinItemId: 'replaced', label: 'panel.png', kind: 'image', mimeType: 'image/png' },
    });
    const statuses: string[] = [];

    await expect(exportPaperPdfDocument(paperDoc, (status) => statuses.push(status))).rejects.toThrow('cannot rasterize');
    expect(choosePaperPdfExportPath).not.toHaveBeenCalled();
    expect(exportPaperPdf).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalled();
    expect(statuses).toEqual([]);
    vi.unstubAllGlobals();
  });

  it('stops the strict PDF/X, KDP PDF, and webcomic image routes on a current-PDF linked source before their work begins', async () => {
    sourceStoreMocks.items = [{
      id: 'replaced', label: 'Panel art', kind: 'document', mimeType: 'application/pdf',
      assetUrl: 'blob:https://app.test/replaced-pdf', createdAt: 1,
    }];
    const base = createDefaultPaperDocument({ title: 'Replaced link strict' });
    const { document: paperDoc } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image', label: 'Panel art', xMm: 10, yMm: 10, widthMm: 50, heightMm: 40,
      asset: { sourceBinItemId: 'replaced', label: 'panel.png', kind: 'image', mimeType: 'image/png' },
    });
    const exportPdfx = vi.fn(async () => {
      throw new Error('strict export must not run');
    });
    const downloadPdf = vi.fn();
    const chooseDirectory = vi.fn();
    vi.stubGlobal('window', {
      signalLoomNative: { choosePaperImageExportDirectory: chooseDirectory, exportPaperImages: vi.fn() },
    });
    const statuses: string[] = [];

    await exportPaperPdfxAndSave(paperDoc, (status) => statuses.push(status), { exportPdfx, downloadPdf });
    expect(statuses.at(-1)).toContain('cannot rasterize');
    await exportPaperKdpPdfAndSave(paperDoc, (status) => statuses.push(status), { exportPdfx, downloadPdf });
    expect(statuses.at(-1)).toContain('cannot rasterize');
    await expect(exportPaperWebcomicImages(paperDoc, (status) => statuses.push(status), { format: 'png' }))
      .rejects.toThrow('cannot rasterize');
    expect(exportPdfx).not.toHaveBeenCalled();
    expect(downloadPdf).not.toHaveBeenCalled();
    expect(chooseDirectory).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('does not falsely block a stale persisted PDF frame whose current linked item is an image (race guard)', async () => {
    // A data-URL-backed item keeps the whole route runnable in Node; blob-backed replacement is
    // covered by the PaperAssetRuntime MIME-stamp test and the PDF/X browser boundary test.
    sourceStoreMocks.items = [{
      id: 'replaced', label: 'Reference art', kind: 'image', mimeType: 'image/png',
      assetUrl: 'data:image/png;base64,iVBORw0KGgo=', createdAt: 1,
    }];
    const choosePaperPdfExportPath = vi.fn().mockResolvedValue({ canceled: false, filePath: '/tmp/Replaced-Link.pdf' });
    const exportPaperPdf = vi.fn().mockResolvedValue({ canceled: false, filePath: '/tmp/Replaced-Link.pdf', bytes: 2048 });
    vi.stubGlobal('window', { signalLoomNative: { choosePaperPdfExportPath, exportPaperPdf } });
    vi.stubGlobal('Image', class {
      decoding = 'sync';
      src = '';
      decode = vi.fn().mockResolvedValue(undefined);
    });
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => ({ drawImage: vi.fn() })),
        toDataURL: vi.fn(() => 'data:image/png;base64,replaced-link'),
      })),
    });
    const base = createDefaultPaperDocument({ title: 'Replaced link passes' });
    const { document: paperDoc } = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image', label: 'Reference art', xMm: 10, yMm: 10, widthMm: 50, heightMm: 40,
      asset: { sourceBinItemId: 'replaced', label: 'reference.pdf', kind: 'image', mimeType: 'application/pdf' },
    });
    const outputDocument = await materializePaperDocumentAssetUrls(paperDoc, sourceStoreMocks.items);
    const statuses: string[] = [];

    const outcome = await exportPaperPdfDocument(outputDocument, (status) => statuses.push(status));

    expect(outcome.state).toBe('success');
    expect(exportPaperPdf).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('stops native PDF output when the linked item becomes a PDF while its destination chooser is open', async () => {
    sourceStoreMocks.items = [{
      id: 'linked-art', label: 'Linked art', kind: 'image', mimeType: 'image/png',
      assetUrl: 'data:image/png;base64,iVBORw0KGgo=', createdAt: 1,
    }];
    const base = createDefaultPaperDocument({ title: 'Replacement race' });
    const paperDoc = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image', label: 'Linked art', xMm: 10, yMm: 10, widthMm: 50, heightMm: 40,
      asset: { sourceBinItemId: 'linked-art', label: 'linked-art.png', kind: 'image', mimeType: 'image/png' },
    }).document;
    const outputDocument = await materializePaperDocumentAssetUrls(paperDoc, sourceStoreMocks.items);
    const exportPaperPdf = vi.fn();
    const createElement = vi.fn();
    vi.stubGlobal('window', {
      signalLoomNative: {
        choosePaperPdfExportPath: vi.fn().mockImplementation(async () => {
          sourceStoreMocks.items = [{
            id: 'linked-art', label: 'Linked art', kind: 'document', mimeType: 'application/pdf',
            assetUrl: 'data:application/pdf;base64,JVBERi0=', createdAt: 2,
          }];
          return { canceled: false, filePath: '/tmp/Replacement-Race.pdf' };
        }),
        exportPaperPdf,
      },
    });
    vi.stubGlobal('document', { createElement });
    const statuses: string[] = [];

    const outcome = await exportPaperPdfDocument(outputDocument, (status) => statuses.push(status));

    expect(outcome).toMatchObject({ state: 'error', message: expect.stringContaining('cannot rasterize') });
    expect(exportPaperPdf).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it.each(['native PDF', 'page images'] as const)(
    'stops %s output on a same-id same-MIME URL replacement before stale page data ships',
    async (route) => {
      sourceStoreMocks.items = [{
        id: 'linked-art', label: 'Linked art', kind: 'image', mimeType: 'image/png',
        assetUrl: 'data:image/png;base64,OLD', createdAt: 1,
      }];
      const base = createDefaultPaperDocument({ title: 'Same MIME replacement race' });
      const paperDoc = addFrameToPaperPage(base, base.pages[0].id, {
        kind: 'image', label: 'Linked art', xMm: 10, yMm: 10, widthMm: 50, heightMm: 40,
        asset: { sourceBinItemId: 'linked-art', label: 'linked-art.png', kind: 'image', mimeType: 'image/png' },
      }).document;
      const outputDocument = await materializePaperDocumentAssetUrls(paperDoc, sourceStoreMocks.items);
      const exportPaperPdf = vi.fn();
      const exportPaperImages = vi.fn();
      const replaceLinkedItem = () => {
        sourceStoreMocks.items = [{
          id: 'linked-art', label: 'Linked art', kind: 'image', mimeType: 'image/png',
          assetUrl: 'data:image/png;base64,NEW', createdAt: 1,
        }];
      };
      vi.stubGlobal('window', {
        signalLoomNative: route === 'native PDF' ? {
          choosePaperPdfExportPath: vi.fn().mockImplementation(async () => {
            replaceLinkedItem();
            return { canceled: false, filePath: '/tmp/Same-MIME-Race.pdf' };
          }),
          exportPaperPdf,
        } : {
          choosePaperImageExportDirectory: vi.fn().mockImplementation(async () => {
            replaceLinkedItem();
            return { canceled: false, directoryPath: '/tmp/Same-MIME-Race-images' };
          }),
          exportPaperImages,
        },
      });

      const outcome = route === 'native PDF'
        ? await exportPaperPdfDocument(outputDocument, vi.fn())
        : await exportPaperWebcomicImages(outputDocument, vi.fn(), { format: 'png' });

      expect(outcome).toMatchObject({ state: 'error', message: expect.stringContaining('changed while this output was being prepared') });
      expect(exportPaperPdf).not.toHaveBeenCalled();
      expect(exportPaperImages).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    },
  );

  it('rejects deletion that lands during caller materialization before any downstream helper can reset the baseline', async () => {
    sourceStoreMocks.items = [{
      id: 'linked-art', label: 'Linked art', kind: 'image', mimeType: 'image/png',
      assetUrl: 'data:image/png;base64,OLD', createdAt: 1,
    }];
    const base = createDefaultPaperDocument({ title: 'Materialization deletion race' });
    const paperDoc = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image', label: 'Linked art', xMm: 10, yMm: 10, widthMm: 50, heightMm: 40,
      asset: { sourceBinItemId: 'linked-art', label: 'linked-art.png', kind: 'image', mimeType: 'image/png' },
    }).document;
    const guard = createPaperDocumentRasterizationGuardWithCurrentSources(paperDoc);

    const materialization = materializePaperRasterOutputDocument(paperDoc, guard);
    sourceStoreMocks.items = [];

    await expect(materialization).rejects.toThrow(/no longer available/i);
  });

  it.each(['native PDF', 'page images'] as const)(
    'keeps the pre-materialization deletion baseline through the %s shipping helper',
    async (route) => {
      sourceStoreMocks.items = [{
        id: 'linked-art', label: 'Linked art', kind: 'image', mimeType: 'image/png',
        assetUrl: 'data:image/png;base64,OLD', createdAt: 1,
      }];
      const base = createDefaultPaperDocument({ title: 'Shared deletion transaction' });
      const paperDoc = addFrameToPaperPage(base, base.pages[0].id, {
        kind: 'image', label: 'Linked art', xMm: 10, yMm: 10, widthMm: 50, heightMm: 40,
        asset: { sourceBinItemId: 'linked-art', label: 'linked-art.png', kind: 'image', mimeType: 'image/png' },
      }).document;
      const guard = createPaperDocumentRasterizationGuardWithCurrentSources(paperDoc);
      const outputDocument = await materializePaperDocumentAssetUrls(paperDoc, guard.sourceItems);
      sourceStoreMocks.items = [];
      const choosePaperPdfExportPath = vi.fn();
      const choosePaperImageExportDirectory = vi.fn();
      vi.stubGlobal('window', {
        signalLoomNative: route === 'native PDF' ? {
          choosePaperPdfExportPath,
          exportPaperPdf: vi.fn(),
        } : {
          choosePaperImageExportDirectory,
          exportPaperImages: vi.fn(),
        },
      });

      const outcome = route === 'native PDF'
        ? await exportPaperPdfDocument(outputDocument, vi.fn(), undefined, { rasterizationGuard: guard })
        : await exportPaperWebcomicImages(outputDocument, vi.fn(), { format: 'png', rasterizationGuard: guard });

      expect(outcome).toMatchObject({ state: 'error', message: expect.stringContaining('no longer available') });
      expect(choosePaperPdfExportPath).not.toHaveBeenCalled();
      expect(choosePaperImageExportDirectory).not.toHaveBeenCalled();
      vi.unstubAllGlobals();
    },
  );

  it('stops page-image output when its linked item is deleted while the directory chooser is open', async () => {
    sourceStoreMocks.items = [{
      id: 'linked-art', label: 'Linked art', kind: 'image', mimeType: 'image/png',
      assetUrl: 'data:image/png;base64,iVBORw0KGgo=', createdAt: 1,
    }];
    const base = createDefaultPaperDocument({ title: 'Deletion race' });
    const paperDoc = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image', label: 'Linked art', xMm: 10, yMm: 10, widthMm: 50, heightMm: 40,
      asset: { sourceBinItemId: 'linked-art', label: 'linked-art.png', kind: 'image', mimeType: 'image/png' },
    }).document;
    const outputDocument = await materializePaperDocumentAssetUrls(paperDoc, sourceStoreMocks.items);
    const exportPaperImages = vi.fn();
    const createElement = vi.fn();
    vi.stubGlobal('window', {
      signalLoomNative: {
        choosePaperImageExportDirectory: vi.fn().mockImplementation(async () => {
          sourceStoreMocks.items = [];
          return { canceled: false, directoryPath: '/tmp/Deletion-Race-images' };
        }),
        exportPaperImages,
      },
    });
    vi.stubGlobal('document', { createElement });

    const outcome = await exportPaperWebcomicImages(outputDocument, vi.fn(), { format: 'png' });

    expect(outcome).toMatchObject({ state: 'error', message: expect.stringContaining('no longer available') });
    expect(exportPaperImages).not.toHaveBeenCalled();
    expect(createElement).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it.each([
    ['PDF/X', exportPaperPdfxAndSave],
    ['KDP PDF', exportPaperKdpPdfAndSave],
  ] as const)('stops %s generation when the linked item disappears during production preparation', async (_label, runExport) => {
    sourceStoreMocks.items = [{
      id: 'linked-art', label: 'Linked art', kind: 'image', mimeType: 'image/png',
      assetUrl: 'data:image/png;base64,iVBORw0KGgo=', createdAt: 1,
    }];
    const { document: base } = strictPdfDocument('Preparation deletion race');
    const imageSha256 = 'c'.repeat(64);
    const paperDoc = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image', label: 'Linked art', xMm: 10, yMm: 10, widthMm: 50, heightMm: 40,
      asset: {
        sourceBinItemId: 'linked-art', label: 'linked-art.png', kind: 'image', mimeType: 'image/png',
        pixelWidth: 2400, pixelHeight: 1920,
        locator: { kind: 'managed', ref: {
          id: `sha256:${imageSha256}`, sha256: imageSha256, mimeType: 'image/png', byteLength: 1024,
        } },
      },
    }).document;
    const dependencies = passingPdfxDependencies();
    const downloadPdf = vi.fn();
    dependencies.assetExists = vi.fn(async () => {
      sourceStoreMocks.items = [];
      return true;
    });
    const statuses: string[] = [];

    await runExport(paperDoc, (status) => statuses.push(status), { ...dependencies, downloadPdf });

    expect(statuses.at(-1)).toContain('no longer available');
    expect(dependencies.exportPdfx).not.toHaveBeenCalled();
    expect(downloadPdf).not.toHaveBeenCalled();
  });

  it('does not cancel page-image output when only an unrelated Source item changes', async () => {
    sourceStoreMocks.items = [
      {
        id: 'linked-art', label: 'Linked art', kind: 'image', mimeType: 'image/png',
        assetUrl: 'data:image/png;base64,iVBORw0KGgo=', createdAt: 1,
      },
      {
        id: 'unrelated', label: 'Unrelated', kind: 'image', mimeType: 'image/png',
        assetUrl: 'data:image/png;base64,AAAA', createdAt: 1,
      },
    ];
    const base = createDefaultPaperDocument({ title: 'Unrelated race' });
    const paperDoc = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image', label: 'Linked art', xMm: 10, yMm: 10, widthMm: 50, heightMm: 40,
      asset: { sourceBinItemId: 'linked-art', label: 'linked-art.png', kind: 'image', mimeType: 'image/png' },
    }).document;
    const outputDocument = await materializePaperDocumentAssetUrls(paperDoc, sourceStoreMocks.items);
    const exportPaperImages = vi.fn().mockResolvedValue({
      canceled: false, directoryPath: '/tmp/Unrelated-Race-images', files: ['Page-001.png'], bytes: 512,
    });
    vi.stubGlobal('window', {
      signalLoomNative: {
        choosePaperImageExportDirectory: vi.fn().mockImplementation(async () => {
          sourceStoreMocks.items = [
            sourceStoreMocks.items[0],
            {
              id: 'unrelated', label: 'Unrelated', kind: 'document', mimeType: 'application/pdf',
              assetUrl: 'data:application/pdf;base64,JVBERi0=', createdAt: 2,
            },
          ];
          return { canceled: false, directoryPath: '/tmp/Unrelated-Race-images' };
        }),
        exportPaperImages,
      },
    });
    vi.stubGlobal('Image', class {
      decoding = 'sync';
      src = '';
      decode = vi.fn().mockResolvedValue(undefined);
    });
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({
        width: 0,
        height: 0,
        getContext: vi.fn(() => ({ drawImage: vi.fn() })),
        toDataURL: vi.fn(() => 'data:image/png;base64,unrelated-change'),
      })),
    });

    const outcome = await exportPaperWebcomicImages(outputDocument, vi.fn(), { format: 'png' });

    expect(outcome.state).toBe('success');
    expect(exportPaperImages).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('blocks uppercase incomplete PDF data text before the page-image destination chooser', async () => {
    const base = createDefaultPaperDocument({ title: 'Incomplete PDF data' });
    const paperDoc = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'image', label: 'Thumbnail', xMm: 10, yMm: 10, widthMm: 50, heightMm: 40,
      asset: {
        label: 'thumbnail.png', kind: 'image', mimeType: 'image/png',
        locator: { kind: 'external', url: 'DATA:APPLICATION/PDF;base64' },
      },
    }).document;
    const choosePaperImageExportDirectory = vi.fn();
    const exportPaperImages = vi.fn();
    vi.stubGlobal('window', { signalLoomNative: { choosePaperImageExportDirectory, exportPaperImages } });

    await expect(exportPaperWebcomicImages(paperDoc, vi.fn(), { format: 'png' }))
      .rejects.toThrow('cannot rasterize');
    expect(choosePaperImageExportDirectory).not.toHaveBeenCalled();
    expect(exportPaperImages).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
