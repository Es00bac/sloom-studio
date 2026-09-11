import { describe, expect, it } from 'vitest';

interface AutomationPathsModule {
  getAutomationImportMediaPaths: (env: Record<string, string | undefined>, delimiter?: string) => string[] | undefined;
  getAutomationPaperImageDirectory: (env: Record<string, string | undefined>) => string | undefined;
  getAutomationPaperPdfPath: (env: Record<string, string | undefined>) => string | undefined;
  getAutomationProjectOpenPath: (env: Record<string, string | undefined>) => string | undefined;
  getAutomationProjectSavePath: (env: Record<string, string | undefined>) => string | undefined;
  isAutomationPathsEnabled: (env: Record<string, string | undefined>) => boolean;
}

async function loadAutomationPathsModule(): Promise<AutomationPathsModule> {
  // @ts-expect-error CommonJS Electron helper lives outside the renderer tsconfig module graph.
  return await import('../../electron/automation-paths.cjs') as AutomationPathsModule;
}

describe('Electron automation path helpers', () => {
  it('ignores automation paths unless the explicit smoke-test flag is enabled', async () => {
    const {
      getAutomationProjectOpenPath,
      getAutomationProjectSavePath,
      isAutomationPathsEnabled,
    } = await loadAutomationPathsModule();
    const env = {
      SIGNAL_LOOM_AUTOMATION_PROJECT_OPEN_PATH: '/tmp/open.sloom',
      SIGNAL_LOOM_AUTOMATION_PROJECT_SAVE_PATH: '/tmp/save.sloom',
    };

    expect(isAutomationPathsEnabled(env)).toBe(false);
    expect(getAutomationProjectOpenPath(env)).toBeUndefined();
    expect(getAutomationProjectSavePath(env)).toBeUndefined();
  });

  it('returns trimmed project and Paper export paths when automation is enabled', async () => {
    const {
      getAutomationPaperImageDirectory,
      getAutomationPaperPdfPath,
      getAutomationProjectOpenPath,
      getAutomationProjectSavePath,
    } = await loadAutomationPathsModule();
    const env = {
      SIGNAL_LOOM_ENABLE_AUTOMATION_PATHS: '1',
      SIGNAL_LOOM_AUTOMATION_PROJECT_OPEN_PATH: ' /tmp/open.sloom ',
      SIGNAL_LOOM_AUTOMATION_PROJECT_SAVE_PATH: ' /tmp/save ',
      SIGNAL_LOOM_AUTOMATION_PAPER_PDF_PATH: ' /tmp/paper-output ',
      SIGNAL_LOOM_AUTOMATION_PAPER_IMAGE_DIRECTORY: ' /tmp/paper-pages ',
    };

    expect(getAutomationProjectOpenPath(env)).toBe('/tmp/open.sloom');
    expect(getAutomationProjectSavePath(env)).toBe('/tmp/save');
    expect(getAutomationPaperPdfPath(env)).toBe('/tmp/paper-output');
    expect(getAutomationPaperImageDirectory(env)).toBe('/tmp/paper-pages');
  });

  it('splits import media paths with the platform delimiter and drops empty entries', async () => {
    const { getAutomationImportMediaPaths } = await loadAutomationPathsModule();

    expect(getAutomationImportMediaPaths({
      SIGNAL_LOOM_ENABLE_AUTOMATION_PATHS: '1',
      SIGNAL_LOOM_AUTOMATION_IMPORT_MEDIA_PATHS: ' /tmp/a.png :: /tmp/b.mp4 : ',
    }, ':')).toEqual(['/tmp/a.png', '/tmp/b.mp4']);
  });
});
