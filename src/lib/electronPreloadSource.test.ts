import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Electron preload source guards', () => {
  it('exposes the automation enable flag without exposing automation file paths', () => {
    const source = readFileSync(join(process.cwd(), 'electron/preload.cjs'), 'utf8');

    expect(source).toContain("contextBridge.exposeInMainWorld(\n  'SIGNAL_LOOM_ENABLE_AUTOMATION_PATHS'");
    expect(source).toContain("process.env.SIGNAL_LOOM_ENABLE_AUTOMATION_PATHS === '1' ? '1' : '0'");
    expect(source).not.toContain('SIGNAL_LOOM_AUTOMATION_PROJECT_OPEN_PATH');
    expect(source).not.toContain('SIGNAL_LOOM_AUTOMATION_PROJECT_SAVE_PATH');
    expect(source).not.toContain('SIGNAL_LOOM_AUTOMATION_PAPER_PDF_PATH');
    expect(source).not.toContain('SIGNAL_LOOM_AUTOMATION_PAPER_IMAGE_DIRECTORY');
  });

  it('exposes chooser-first Paper PDF and page-image export bridges', () => {
    const source = readFileSync(join(process.cwd(), 'electron/preload.cjs'), 'utf8');

    expect(source).toContain("choosePaperPdfExportPath: (request) => ipcRenderer.invoke('signal-loom:paper-choose-pdf-export-path', request)");
    expect(source).toContain("choosePaperImageExportDirectory: (request) => ipcRenderer.invoke('signal-loom:paper-choose-image-export-directory', request)");
    expect(source).toContain("savePaperPdfBytes: (request) => ipcRenderer.invoke('signal-loom:paper-save-pdf-bytes', request)");
    expect(source).toContain("savePaperEpubBytes: (request) => ipcRenderer.invoke('signal-loom:paper-save-epub-bytes', request)");
    expect(source).toContain("writePaperDocumentFile: (path, bytes) => ipcRenderer.invoke('signal-loom:paper-write-path', path, bytes)");
  });

  it('exposes the dedicated bundled-font transport capability instead of relying on generic bridge shape', () => {
    const source = readFileSync(join(process.cwd(), 'electron/preload.cjs'), 'utf8');

    expect(source).toContain("bundledFontLibraryStatus: () => ipcRenderer.invoke('signal-loom:font-library-status')");
  });
});
