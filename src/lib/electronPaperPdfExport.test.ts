import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';

interface ElectronPaperPdfExportModule {
  buildPaperPdfDefaultPath: (
    request: { fileName?: string; title?: string } | undefined,
    currentProjectPath?: string,
  ) => string;
  buildPaperPdfRenderReadyScript: (options?: {
    fontTimeoutMs?: number;
    frameTimeoutMs?: number;
    imageTimeoutMs?: number;
  }) => string;
  buildPaperPdfPrintOptions: (request?: {
    page?: { widthMm?: number; heightMm?: number };
  }) => Record<string, unknown>;
  ensurePdfExtension: (filePath: string) => string;
  sanitizePdfFileName: (value: string | undefined) => string;
}

async function loadPaperPdfExportModule(): Promise<ElectronPaperPdfExportModule> {
  // @ts-expect-error CommonJS Electron helper lives outside the renderer tsconfig module graph.
  return await import('../../electron/paper-pdf-export.cjs') as ElectronPaperPdfExportModule;
}

describe('Electron Paper PDF export helpers', () => {
  it('builds project-relative default PDF save paths with sanitized names', async () => {
    const { buildPaperPdfDefaultPath } = await loadPaperPdfExportModule();

    expect(buildPaperPdfDefaultPath(
      { fileName: 'Issue-01-Final.pdf', title: 'Ignored' },
      '/mnt/xtra/books/signal-loom-story.sloom',
    )).toBe('/mnt/xtra/books/Issue-01-Final.pdf');

    expect(buildPaperPdfDefaultPath(
      { title: 'Comic/Final: Cover?' },
      undefined,
    )).toBe('Comic-Final-Cover.pdf');
  });

  it('normalizes PDF extensions and print options for print-quality output', async () => {
    const {
      buildPaperPdfPrintOptions,
      ensurePdfExtension,
      sanitizePdfFileName,
    } = await loadPaperPdfExportModule();

    expect(ensurePdfExtension('/tmp/layout')).toBe('/tmp/layout.pdf');
    expect(ensurePdfExtension('/tmp/layout.PDF')).toBe('/tmp/layout.PDF');
    expect(sanitizePdfFileName('  My/Layout: Final?  ')).toBe('My-Layout-Final.pdf');
    expect(buildPaperPdfPrintOptions({
      page: {
        widthMm: 100,
        heightMm: 150,
      },
    })).toEqual({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margins: { marginType: 'custom', top: 0, bottom: 0, left: 0, right: 0 },
      pageSize: {
        width: 3.937,
        height: 5.906,
      },
      scale: 1,
    });
  });

  it('builds a bounded render-ready script that resolves when hidden windows throttle animation frames', async () => {
    const { buildPaperPdfRenderReadyScript } = await loadPaperPdfExportModule();
    const script = buildPaperPdfRenderReadyScript({
      fontTimeoutMs: 1,
      frameTimeoutMs: 1,
      imageTimeoutMs: 1,
    });

    const result = await runInNewContext(script, {
      Array,
      document: {
        fonts: { ready: new Promise(() => undefined) },
        images: [],
      },
      Promise,
      requestAnimationFrame: () => undefined,
      setTimeout,
    });

    expect(result).toBe(true);
    expect(script).toContain('Promise.race');
    expect(script).toContain('requestAnimationFrame');
  });

  it('requires every managed alias in a native PDF payload instead of accepting font readiness alone', async () => {
    const { buildPaperPdfRenderReadyScript } = await loadPaperPdfExportModule();
    const encoded = Buffer.from(JSON.stringify({ version: 1, faces: [{ identity: 'face-a', familyAlias: 'exact-a', postscriptName: 'ExactA-Regular', weight: 400, style: 'normal', stretchPercent: 100, format: 'truetype', collectionIndex: 0 }] })).toString('base64url');
    const script = buildPaperPdfRenderReadyScript({ fontTimeoutMs: 5, frameTimeoutMs: 1, imageTimeoutMs: 1 });
    await expect(runInNewContext(script, {
      Array, atob, document: {
        documentElement: { innerHTML: `signal-loom-managed-font-manifest:${encoded}` },
        fonts: { ready: Promise.resolve(), load: async () => [{ family: 'human-family', status: 'loaded' }], check: () => true }, images: [],
      }, Promise, requestAnimationFrame: () => undefined, setTimeout,
    })).rejects.toThrow(/requested identity/i);
  });

  it('uses a Chromium-parseable keyword instead of percentage stretch in native PDF readiness', async () => {
    const { buildPaperPdfRenderReadyScript } = await loadPaperPdfExportModule();
    const encoded = Buffer.from(JSON.stringify({ version: 1, faces: [{ identity: 'face-a', familyAlias: 'exact-a', postscriptName: 'ExactA-Condensed', weight: 400, style: 'normal', stretchPercent: 75, format: 'truetype', collectionIndex: 0 }] })).toString('base64url');
    const load = vi.fn(async () => [{ family: 'exact-a', status: 'loaded' }]);
    const check = vi.fn(() => true);
    const script = buildPaperPdfRenderReadyScript({ fontTimeoutMs: 5, frameTimeoutMs: 1, imageTimeoutMs: 1 });
    await expect(runInNewContext(script, {
      Array, atob, document: {
        documentElement: { innerHTML: `signal-loom-managed-font-manifest:${encoded}` },
        fonts: { ready: Promise.resolve(), load, check }, images: [],
      }, Promise, requestAnimationFrame: () => undefined, setTimeout,
    })).resolves.toBe(true);
    expect(load).toHaveBeenCalledWith('normal 400 condensed 16px "exact-a"', 'WMWMWMiiiii012345');
    expect(check).toHaveBeenCalledWith('normal 400 condensed 16px "exact-a"', 'WMWMWMiiiii012345');
  });

  it('rejects the old collection-member-zero masquerade before native PDF paint', async () => {
    const { buildPaperPdfRenderReadyScript } = await loadPaperPdfExportModule();
    const encoded = Buffer.from(JSON.stringify({ version: 1, faces: [{
      identity: 'collection-zero', familyAlias: 'exact-collection', postscriptName: 'Collection-Member-Zero',
      weight: 400, style: 'normal', stretchPercent: 100, format: 'collection', collectionIndex: 0,
    }] })).toString('base64url');
    const load = vi.fn(async () => [{ family: 'exact-collection', status: 'loaded' }]);
    const script = buildPaperPdfRenderReadyScript({ fontTimeoutMs: 5, frameTimeoutMs: 1, imageTimeoutMs: 1 });
    await expect(runInNewContext(script, {
      Array, atob, document: {
        documentElement: { innerHTML: `signal-loom-managed-font-manifest:${encoded}` },
        fonts: { ready: Promise.resolve(), load, check: () => true }, images: [],
      }, Promise, requestAnimationFrame: () => undefined, setTimeout,
    })).rejects.toThrow(/collection member paint is blocked|standalone/i);
    expect(load).not.toHaveBeenCalled();
  });
});
