import { describe, expect, it } from 'vitest';

interface ElectronPaperImageExportModule {
  buildPaperImageDefaultDirectoryPath: (
    request: { directoryName?: string; title?: string; format?: string } | undefined,
    currentProjectPath?: string,
  ) => string;
  ensurePaperImageExportDirectory: (selectedPath: string, directoryName: string) => string;
  imageBufferFromDataUrl: (dataUrl: string, expectedMimeType: string) => Buffer;
  sanitizePaperImagePathPart: (value: string | undefined, fallback?: string) => string;
}

async function loadPaperImageExportModule(): Promise<ElectronPaperImageExportModule> {
  // @ts-expect-error CommonJS Electron helper lives outside the renderer tsconfig module graph.
  return await import('../../electron/paper-image-export.cjs') as ElectronPaperImageExportModule;
}

describe('Electron Paper image export helpers', () => {
  it('builds project-relative default named directory paths', async () => {
    const { buildPaperImageDefaultDirectoryPath } = await loadPaperImageExportModule();

    expect(buildPaperImageDefaultDirectoryPath(
      { directoryName: 'Chronicle-webcomic-png' },
      '/home/me/Chronicle.sloom',
    )).toBe('/home/me/Chronicle-webcomic-png');

    expect(buildPaperImageDefaultDirectoryPath(
      { title: 'My Comic: Proof?', format: 'png' },
      undefined,
    )).toBe('My-Comic-Proof-webcomic-png');
  });

  it('keeps exports inside the required named directory', async () => {
    const { ensurePaperImageExportDirectory } = await loadPaperImageExportModule();

    expect(ensurePaperImageExportDirectory('/tmp/exports', 'Comic-webcomic-png')).toBe('/tmp/exports/Comic-webcomic-png');
    expect(ensurePaperImageExportDirectory('/tmp/exports/Comic-webcomic-png', 'Comic-webcomic-png')).toBe('/tmp/exports/Comic-webcomic-png');
  });

  it('decodes validated image data URLs', async () => {
    const { imageBufferFromDataUrl, sanitizePaperImagePathPart } = await loadPaperImageExportModule();

    expect(sanitizePaperImagePathPart(' Bad / Name ', 'fallback')).toBe('Bad-Name');
    expect(imageBufferFromDataUrl('data:image/png;base64,UE5H', 'image/png').toString('utf8')).toBe('PNG');
    expect(() => imageBufferFromDataUrl('data:text/plain;base64,VEVYVA==', 'image/png')).toThrow(/image\/png/);
  });
});
