import { describe, expect, it } from 'vitest';
import {
  SMOKE_PNG_DATA_URL,
  NATIVE_SMOKE_WORKSPACES,
  assertNativeAssetProtocolSmokeResult,
  assertNativeSmokeResult,
  buildNativeSmokeEnvironment,
  buildNativeSmokeElectronLaunchArgs,
  buildNativeSmokeOptions,
  buildNativeRealProjectSoakReport,
  buildNativeRealProjectSoakOptions,
  evaluateNativeRealProjectSoakBudgets,
  formatNativeRealProjectSoakBudgetFailure,
  buildNativeSmokePaperImagesRequest,
  buildNativeSmokePaperPdfRequest,
  buildNativeSmokePaperOsFileDropExpression,
  buildNativeSmokePaperOsFileDropWorkspacePropagationExpression,
  buildNativeSmokeProjectImportWorkspacePropagationExpression,
  buildNativeVideoRenderSmokeEnvironment,
  buildNativeVideoRenderSmokePaths,
  buildNativeVideoRenderSmokeProjectDocument,
  buildNativeVideoRenderSmokeRendererEnvironment,
  buildNativeVideoRenderSmokeSettingsStorage,
  buildNativeSmokeProjectDocument,
  buildNativeRealProjectSmokeEnvironment,
  buildNativeRealProjectSmokePaths,
  buildNativeRealProjectStartupState,
  buildNativeSmokeSourceLibraryItem,
  buildNativeSmokeStressRenameLabel,
  buildNativeSmokeStressSourceLibraryItem,
  assertNativePaperOsFileDropSmokeResult,
  assertNativePaperOsFileDropWorkspacePropagationResult,
  assertNativeProjectImportWorkspacePropagationResult,
  assertNativeVideoRenderSmokeResult,
} from './native-smoke-lib.mjs';

describe('native smoke helpers', () => {
  it('builds a project document with a flow node and durable source-library image', () => {
    const project = buildNativeSmokeProjectDocument({ now: 1234 });

    expect(project).toMatchObject({
      id: 'native-smoke-project',
      name: 'Native Smoke',
      savedAt: 1234,
      flow: {
        version: 3,
        edges: [],
      },
    });
    expect(project.flow.nodes).toHaveLength(1);
    expect(project.sourceBin.bins[0].items[0]).toMatchObject({
      id: 'smoke-image',
      label: 'Smoke panel',
      kind: 'image',
      mimeType: 'image/png',
      assetUrl: SMOKE_PNG_DATA_URL,
    });
    const smokePng = Buffer.from(SMOKE_PNG_DATA_URL.split(',')[1], 'base64');
    expect(smokePng.readUInt32BE(16)).toBe(2);
    expect(smokePng.readUInt32BE(20)).toBe(2);
    expect(smokePng[25]).toBe(6); // RGBA color type accepted by the live Electron decoder.
  });

  it('tracks every workspace expected in the native release-gate window smoke', () => {
    expect(NATIVE_SMOKE_WORKSPACES).toEqual(['flow', 'editor', 'image', 'paper']);
  });

  it('builds deterministic Paper PDF and webcomic image export requests', () => {
    const pdf = buildNativeSmokePaperPdfRequest();
    const images = buildNativeSmokePaperImagesRequest();

    expect(pdf).toMatchObject({
      title: 'Native Smoke Paper',
      fileName: 'Native-Smoke-Paper.pdf',
      page: { widthMm: 20, heightMm: 20 },
    });
    expect(pdf.html).toContain('Native Smoke PDF');

    expect(images).toMatchObject({
      title: 'Native Smoke',
      directoryName: 'Native-Smoke-webcomic-png',
      format: 'png',
    });
    expect(images.pages[0]).toMatchObject({
      fileName: 'Native-Smoke-Page-1.png',
      mimeType: 'image/png',
      dataUrl: SMOKE_PNG_DATA_URL,
    });
  });

  it('builds a native Paper OS file-drop expression that verifies page import envelopes and linked frames', () => {
    const expression = buildNativeSmokePaperOsFileDropExpression({
      fileName: 'native-paper-os-drop.png',
      lastModified: 1710000000000,
      pageNumber: 2,
      verifySaveOpenRoundTrip: true,
    });

    expect(expression).toContain('new File');
    expect(expression).toContain('new DataTransfer');
    expect(expression).toContain("['dragenter', 'dragover', 'drop']");
    expect(expression).toContain('[data-paper-page-view="true"]');
    expect(expression).toContain('data-paper-page-number=\\"2\\"');
    expect(expression).toContain('[data-paper-frame="true"][data-paper-frame-page-number="');
    expect(expression).toContain('native-paper-os-drop.png');
    expect(expression).toContain('Page 2 imports');
    expect(expression).toContain('image/png');
    expect(expression).toContain("new KeyboardEvent('keydown'");
    expect(expression).toContain('openProjectFile');
  });

  it('builds a Paper OS file-drop propagation expression for every workspace Source Library', () => {
    const expression = buildNativeSmokePaperOsFileDropWorkspacePropagationExpression({
      envelopeLabel: 'Page 2 imports',
      fileName: 'native-paper-os-drop.png',
      itemId: 'paper-import-item-1',
    });

    expect(expression).toContain('Page 2 imports');
    expect(expression).toContain('native-paper-os-drop.png');
    expect(expression).toContain('paper-import-item-1');
    expect(expression).toContain('hasEnvelopeVisible');
    expect(expression).toContain('rendererPersistedHasItem');
    expect(expression).toContain('nativeSnapshotHasItem');
  });

  it('builds a Project imports propagation expression with save/open verification', () => {
    const expression = buildNativeSmokeProjectImportWorkspacePropagationExpression({
      fileName: 'native-smoke-source-library-import.png',
      itemId: 'project-import-item-1',
      verifySaveOpenRoundTrip: true,
    });

    expect(expression).toContain('Project imports');
    expect(expression).toContain('project-imports');
    expect(expression).toContain('native-smoke-source-library-import.png');
    expect(expression).toContain('project-import-item-1');
    expect(expression).toContain('rendererPersistedHasItem');
    expect(expression).toContain('nativeSnapshotHasAssetUrl');
    expect(expression).toContain("new KeyboardEvent('keydown'");
    expect(expression).toContain('openProjectFile');
  });

  it('builds guarded automation environment paths inside the requested smoke directory', () => {
    const env = buildNativeSmokeEnvironment({
      baseEnv: { PATH: '/usr/bin', WAYLAND_DISPLAY: 'wayland-0' },
      rootDir: '/tmp/signal-loom-test-smoke',
    });

    expect(env).toMatchObject({
      PATH: '/usr/bin',
      ELECTRON_OZONE_PLATFORM_HINT: 'x11',
      GDK_BACKEND: 'x11',
      XDG_SESSION_TYPE: 'x11',
      SIGNAL_LOOM_ENABLE_AUTOMATION_PATHS: '1',
      SIGNAL_LOOM_AUTOMATION_PROJECT_SAVE_PATH: '/tmp/signal-loom-test-smoke/native-smoke.sloom',
      SIGNAL_LOOM_AUTOMATION_PROJECT_OPEN_PATH: '/tmp/signal-loom-test-smoke/native-smoke.sloom',
      SIGNAL_LOOM_AUTOMATION_IMPORT_MEDIA_PATHS: '/tmp/signal-loom-test-smoke/panel.png',
      SIGNAL_LOOM_AUTOMATION_PAPER_PDF_PATH: '/tmp/signal-loom-test-smoke/paper-proof.pdf',
      SIGNAL_LOOM_AUTOMATION_PAPER_IMAGE_DIRECTORY: '/tmp/signal-loom-test-smoke/webcomic-pages',
      SIGNAL_LOOM_ELECTRON_USER_DATA_DIR: '/tmp/signal-loom-test-smoke/user-data',
    });
    expect(env.WAYLAND_DISPLAY).toBeUndefined();
  });

  it('builds isolated real-project smoke paths and startup state without mutating the user profile', () => {
    const paths = buildNativeRealProjectSmokePaths(
      '/tmp/signal-loom-real-smoke',
      '/projects/Chronicle-restored.sloom',
    );
    const env = buildNativeRealProjectSmokeEnvironment({
      baseEnv: { PATH: '/usr/bin', WAYLAND_DISPLAY: 'wayland-0' },
      rootDir: '/tmp/signal-loom-real-smoke',
      projectPath: '/projects/Chronicle-restored.sloom',
    });
    const state = JSON.parse(buildNativeRealProjectStartupState('/projects/Chronicle-restored.sloom', {
      now: '2026-05-24T00:00:00.000Z',
    }));

    expect(paths).toMatchObject({
      rootDir: '/tmp/signal-loom-real-smoke',
      projectPath: '/projects/Chronicle-restored.sloom',
      userDataDir: '/tmp/signal-loom-real-smoke/user-data',
      startupProjectStatePath: '/tmp/signal-loom-real-smoke/user-data/startup-project.json',
      pdfPath: '/tmp/signal-loom-real-smoke/Chronicle-restored-real-project.pdf',
    });
    expect(env).toMatchObject({
      PATH: '/usr/bin',
      ELECTRON_OZONE_PLATFORM_HINT: 'x11',
      GDK_BACKEND: 'x11',
      XDG_SESSION_TYPE: 'x11',
      SIGNAL_LOOM_ENABLE_AUTOMATION_PATHS: '1',
      SIGNAL_LOOM_AUTOMATION_PAPER_PDF_PATH: paths.pdfPath,
      SIGNAL_LOOM_AUTOMATION_PAPER_IMAGE_DIRECTORY: paths.paperImageDirectory,
      SIGNAL_LOOM_ELECTRON_USER_DATA_DIR: paths.userDataDir,
    });
    expect(env.SIGNAL_LOOM_AUTOMATION_PROJECT_OPEN_PATH).toBeUndefined();
    expect(env.WAYLAND_DISPLAY).toBeUndefined();
    expect(state).toEqual({
      currentProjectPath: '/projects/Chronicle-restored.sloom',
      reopenLastProjectOnStartup: true,
      updatedAt: '2026-05-24T00:00:00.000Z',
    });
  });

  it('builds a deterministic native video render smoke project', () => {
    const project = buildNativeVideoRenderSmokeProjectDocument({ now: 4567 });

    expect(project).toMatchObject({
      id: 'native-video-render-smoke-project',
      name: 'Native Video Render Smoke',
      savedAt: 4567,
      editor: {
        workspaceView: 'editor',
        activeCompositionId: 'native-video-render-composition',
      },
    });
    expect(project.flow.nodes).toHaveLength(1);
    expect(project.flow.nodes[0]).toMatchObject({
      id: 'native-video-render-composition',
      type: 'composition',
      data: {
        aspectRatio: '16:9',
        videoResolution: '720p',
        videoFrameRate: 6,
        editorExportPresetPlan: { presetId: 'review-h264-1080p' },
      },
    });
    expect(project.flow.nodes[0].data.editorVisualClips[0]).toMatchObject({
      id: 'native-video-render-clip',
      sourceNodeId: 'native-video-render-source-image',
      sourceKind: 'image',
      durationSeconds: 0.5,
      stroke: {
        enabled: true,
        color: '#22d3ee',
      },
    });
    expect(project.sourceBin.bins[0].items[0]).toMatchObject({
      id: 'native-video-render-source-image',
      label: 'Native video render source',
      kind: 'image',
      mimeType: 'image/png',
      assetUrl: SMOKE_PNG_DATA_URL,
    });
  });

  it('builds isolated native video render smoke paths and settings', () => {
    const paths = buildNativeVideoRenderSmokePaths('/tmp/signal-loom-video-smoke');
    const env = buildNativeVideoRenderSmokeEnvironment({
      baseEnv: { PATH: '/usr/bin', WAYLAND_DISPLAY: 'wayland-0' },
      rootDir: '/tmp/signal-loom-video-smoke',
    });
    const rendererEnv = buildNativeVideoRenderSmokeRendererEnvironment({
      baseEnv: { PATH: '/usr/bin' },
      renderPort: 41836,
      outputPath: '/tmp/signal-loom-video-smoke/native-video-render-smoke.mp4',
    });
    const settings = JSON.parse(buildNativeVideoRenderSmokeSettingsStorage({ renderPort: 41836 }));

    expect(paths).toMatchObject({
      rootDir: '/tmp/signal-loom-video-smoke',
      userDataDir: '/tmp/signal-loom-video-smoke/user-data',
      projectPath: '/tmp/signal-loom-video-smoke/native-video-render-smoke.sloom',
      startupProjectStatePath: '/tmp/signal-loom-video-smoke/user-data/startup-project.json',
      outputVideoPath: '/tmp/signal-loom-video-smoke/native-video-render-smoke.mp4',
      reportPath: '/tmp/signal-loom-video-smoke/native-video-render-report.json',
    });
    expect(env).toMatchObject({
      PATH: '/usr/bin',
      ELECTRON_OZONE_PLATFORM_HINT: 'x11',
      GDK_BACKEND: 'x11',
      XDG_SESSION_TYPE: 'x11',
      SIGNAL_LOOM_ELECTRON_USER_DATA_DIR: paths.userDataDir,
    });
    expect(env.WAYLAND_DISPLAY).toBeUndefined();
    expect(rendererEnv).toMatchObject({
      PATH: '/usr/bin',
      SIGNAL_LOOM_NATIVE_RENDER_HOST: '127.0.0.1',
      SIGNAL_LOOM_NATIVE_RENDER_PORT: '41836',
      SIGNAL_LOOM_NATIVE_RENDER_ALLOW_UNAUTHENTICATED: '1',
      SIGNAL_LOOM_NATIVE_RENDER_LAST_OUTPUT_PATH: '/tmp/signal-loom-video-smoke/native-video-render-smoke.mp4',
    });
    expect(settings.state.providerSettings).toMatchObject({
      renderBackendPreference: 'auto',
      localNativeRenderUrl: 'http://127.0.0.1:41836',
      localNativeRenderToken: '',
    });
  });

  it('forces native smoke Electron launches onto x11 on Linux', () => {
    expect(buildNativeSmokeElectronLaunchArgs({
      remoteDebuggingPort: 9234,
      platform: 'linux',
    })).toEqual(['--remote-debugging-port=9234', '--ozone-platform=x11', '.']);

    expect(buildNativeSmokeElectronLaunchArgs({
      remoteDebuggingPort: 9234,
      platform: 'darwin',
    })).toEqual(['--remote-debugging-port=9234', '.']);
  });

  it('rejects incomplete native video render smoke results', () => {
    expect(() => assertNativeVideoRenderSmokeResult({
      ok: true,
      workspace: {
        url: 'file:///app/index.html?workspace=editor',
        hasRecoveryBoundary: false,
        renderButtonFound: true,
        clickedRender: true,
      },
      render: {
        previewVideoPresent: true,
        bytes: 2048,
        mimeType: 'video/mp4',
        fileSignature: '0000002066747970',
        statusMessage: 'Rendered editor sequence with 1 visual clip with AMD VAAPI hardware encoding.',
      },
      files: {
        outputVideo: { filePath: '/tmp/native-video-render-smoke.mp4', bytes: 2048 },
      },
    })).not.toThrow();

    expect(() => assertNativeVideoRenderSmokeResult({
      ok: true,
      workspace: { hasRecoveryBoundary: true, renderButtonFound: true, clickedRender: true },
      render: { previewVideoPresent: true, bytes: 2048, mimeType: 'video/mp4', fileSignature: '0000002066747970' },
      files: { outputVideo: { bytes: 2048 } },
    })).toThrow(/recovery boundary/i);

    expect(() => assertNativeVideoRenderSmokeResult({
      ok: true,
      workspace: { hasRecoveryBoundary: false, renderButtonFound: true, clickedRender: true },
      render: { previewVideoPresent: false, bytes: 2048, mimeType: 'video/mp4', fileSignature: '0000002066747970' },
      files: { outputVideo: { bytes: 2048 } },
    })).toThrow(/rendered preview/i);

    expect(() => assertNativeVideoRenderSmokeResult({
      ok: true,
      workspace: { hasRecoveryBoundary: false, renderButtonFound: true, clickedRender: true },
      render: { previewVideoPresent: true, bytes: 20, mimeType: 'video/mp4', fileSignature: '0000002066747970' },
      files: { outputVideo: { bytes: 20 } },
    })).toThrow(/usable MP4/i);
  });

  it('builds a deterministic source-library item for cross-window native snapshot smoke', () => {
    expect(buildNativeSmokeSourceLibraryItem({ now: 55 })).toMatchObject({
      id: 'native-smoke-cross-window-item',
      label: 'Native smoke cross-window panel',
      kind: 'image',
      mimeType: 'image/png',
      assetUrl: SMOKE_PNG_DATA_URL,
      sourceKey: 'native-smoke-cross-window-panel',
      createdAt: 55,
    });
  });

  it('parses optional native stress-mode settings from arguments and environment', () => {
    expect(buildNativeSmokeOptions({
      argv: [],
      env: {},
    })).toEqual({
      stressCycles: 0,
      stressDelayMs: 100,
    });

    expect(buildNativeSmokeOptions({
      argv: ['--stress'],
      env: {},
    })).toEqual({
      stressCycles: 12,
      stressDelayMs: 100,
    });

    expect(buildNativeSmokeOptions({
      argv: ['--stress-cycles=4', '--stress-delay-ms=5'],
      env: {
        SIGNAL_LOOM_NATIVE_STRESS_CYCLES: '2',
        SIGNAL_LOOM_NATIVE_STRESS_DELAY_MS: '7',
      },
    })).toEqual({
      stressCycles: 4,
      stressDelayMs: 5,
    });

    expect(() => buildNativeSmokeOptions({
      argv: ['--stress-cycles=0'],
      env: {},
    })).toThrow(/stress cycles/i);
  });

  it('parses native real-project soak settings from arguments and environment', () => {
    expect(buildNativeRealProjectSoakOptions({
      argv: [],
      env: {},
    })).toEqual({
      soakCycles: 6,
      soakDelayMs: 250,
      budgets: {
        flowWorkspaceSwitchDurationBudgetMs: 1200,
        rendererHeapBudgetMb: 768,
      },
    });

    expect(buildNativeRealProjectSoakOptions({
      argv: ['--soak-cycles=3', '--soak-delay-ms=0'],
      env: {
        SIGNAL_LOOM_NATIVE_SOAK_CYCLES: '8',
        SIGNAL_LOOM_NATIVE_SOAK_DELAY_MS: '900',
      },
    })).toEqual({
      soakCycles: 3,
      soakDelayMs: 0,
      budgets: {
        flowWorkspaceSwitchDurationBudgetMs: 1200,
        rendererHeapBudgetMb: 768,
      },
    });

    expect(buildNativeRealProjectSoakOptions({
      argv: [],
      env: {
        SIGNAL_LOOM_NATIVE_SOAK_CYCLES: '2',
        SIGNAL_LOOM_NATIVE_SOAK_DELAY_MS: '10',
      },
    })).toEqual({
      soakCycles: 2,
      soakDelayMs: 10,
      budgets: {
        flowWorkspaceSwitchDurationBudgetMs: 1200,
        rendererHeapBudgetMb: 768,
      },
    });

    expect(() => buildNativeRealProjectSoakOptions({
      argv: ['--soak-cycles=0'],
      env: {},
    })).toThrow(/soak cycles/i);
  });

  it('parses native real-project soak performance budgets from arguments and environment', () => {
    expect(buildNativeRealProjectSoakOptions({
      argv: [
        '--max-heap-mb=64',
        '--max-nodes=15000',
        '--max-listeners=3000',
        '--max-cycle-ms=2500',
      ],
      env: {
        SIGNAL_LOOM_NATIVE_SOAK_MAX_HEAP_MB: '32',
        SIGNAL_LOOM_NATIVE_SOAK_MAX_NODES: '100',
        SIGNAL_LOOM_NATIVE_SOAK_MAX_LISTENERS: '200',
        SIGNAL_LOOM_NATIVE_SOAK_MAX_CYCLE_MS: '300',
      },
    })).toEqual({
      soakCycles: 6,
      soakDelayMs: 250,
      budgets: {
        flowWorkspaceSwitchDurationBudgetMs: 1200,
        rendererHeapBudgetMb: 32,
        maxHeapBytes: 64 * 1024 * 1024,
        maxNodes: 15000,
        maxEventListeners: 3000,
        maxCycleMs: 2500,
      },
    });

    expect(buildNativeRealProjectSoakOptions({
      argv: [],
      env: {
        SIGNAL_LOOM_NATIVE_SOAK_MAX_HEAP_MB: '48',
        SIGNAL_LOOM_NATIVE_SOAK_MAX_NODES: '12000',
        SIGNAL_LOOM_NATIVE_SOAK_MAX_LISTENERS: '2400',
        SIGNAL_LOOM_NATIVE_SOAK_MAX_CYCLE_MS: '2000',
      },
    })).toMatchObject({
      budgets: {
        maxHeapBytes: 48 * 1024 * 1024,
        maxNodes: 12000,
        maxEventListeners: 2400,
        maxCycleMs: 2000,
      },
    });

    expect(() => buildNativeRealProjectSoakOptions({
      argv: ['--max-heap-mb=0'],
      env: {},
    })).toThrow(/max heap/i);
    expect(() => buildNativeRealProjectSoakOptions({
      argv: ['--max-listeners=0'],
      env: {},
    })).toThrow(/max event listeners/i);
  });

  it('evaluates native real-project soak performance budgets with worst sample evidence', () => {
    const soak = {
      samples: [
        {
          cycle: 1,
          elapsedMs: 450,
          metrics: {
            flow: { jsHeapUsedBytes: 18_000_000, nodes: 7_000, jsEventListeners: 1_100 },
            paper: { jsHeapUsedBytes: 24_000_000, nodes: 8_600, jsEventListeners: 1_200 },
          },
        },
        {
          cycle: 2,
          elapsedMs: 1200,
          metrics: {
            flow: { jsHeapUsedBytes: 19_000_000, nodes: 7_100, jsEventListeners: 1_130 },
            paper: { jsHeapUsedBytes: 30_000_000, nodes: 16_001, jsEventListeners: 3_100 },
          },
        },
      ],
    };

    expect(evaluateNativeRealProjectSoakBudgets(soak, {})).toEqual({
      status: 'not-configured',
      observations: [],
      failures: [],
    });

    const summary = evaluateNativeRealProjectSoakBudgets(soak, {
      maxHeapBytes: 32 * 1024 * 1024,
      maxNodes: 15_000,
      maxEventListeners: 3_000,
      maxCycleMs: 1_000,
    });

    expect(summary.status).toBe('failed');
    expect(summary.failures.map((failure) => failure.key)).toEqual([
      'maxNodes',
      'maxEventListeners',
      'maxCycleMs',
    ]);
    expect(summary.observations).toContainEqual(expect.objectContaining({
      key: 'maxHeapBytes',
      status: 'passed',
      observed: 30_000_000,
      limit: 33_554_432,
      cycle: 2,
      workspace: 'paper',
    }));
    expect(summary.observations).toContainEqual(expect.objectContaining({
      key: 'maxNodes',
      status: 'failed',
      observed: 16_001,
      limit: 15_000,
      cycle: 2,
      workspace: 'paper',
    }));
    expect(summary.observations).toContainEqual(expect.objectContaining({
      key: 'maxCycleMs',
      status: 'failed',
      observed: 1_200,
      limit: 1_000,
      cycle: 2,
    }));
  });

  it('builds native real-project soak reports with budget pass/fail status', () => {
    const soak = {
      cycles: 2,
      elapsedMs: 1650,
      samples: [
        {
          cycle: 1,
          elapsedMs: 450,
          metrics: {
            flow: { jsHeapUsedBytes: 18_000_000, nodes: 7_000, jsEventListeners: 1_100 },
          },
        },
        {
          cycle: 2,
          elapsedMs: 1200,
          metrics: {
            paper: { jsHeapUsedBytes: 30_000_000, nodes: 16_001, jsEventListeners: 3_100 },
          },
        },
      ],
    };

    const passedReport = buildNativeRealProjectSoakReport({
      rootDir: '/tmp/soak',
      projectPath: '/projects/Chronicle.sloom',
      options: {
        soakCycles: 2,
        soakDelayMs: 0,
        budgets: {
          maxHeapBytes: 64 * 1024 * 1024,
          maxNodes: 20_000,
          maxEventListeners: 4_000,
          maxCycleMs: 2_000,
        },
      },
      startup: { sourceItems: 113, paperPages: 24 },
      baseline: { flow: { sourceItemCount: 113 } },
      soak,
      reportPath: '/tmp/soak/real-project-soak-report.json',
    });

    expect(passedReport).toMatchObject({
      ok: true,
      rootDir: '/tmp/soak',
      projectPath: '/projects/Chronicle.sloom',
      reportPath: '/tmp/soak/real-project-soak-report.json',
      budgetSummary: {
        status: 'passed',
        failures: [],
      },
    });

    const failedReport = buildNativeRealProjectSoakReport({
      rootDir: '/tmp/soak',
      projectPath: '/projects/Chronicle.sloom',
      options: {
        soakCycles: 2,
        soakDelayMs: 0,
        budgets: {
          maxNodes: 15_000,
          maxCycleMs: 1_000,
        },
      },
      startup: { sourceItems: 113, paperPages: 24 },
      baseline: { flow: { sourceItemCount: 113 } },
      soak,
      reportPath: '/tmp/soak/real-project-soak-report.json',
    });

    expect(failedReport.ok).toBe(false);
    expect(failedReport.budgetSummary.status).toBe('failed');
    expect(failedReport.budgetSummary.failures.map((failure) => failure.key)).toEqual(['maxNodes', 'maxCycleMs']);
    expect(formatNativeRealProjectSoakBudgetFailure(failedReport.budgetSummary)).toContain('DOM nodes 16001 > 15000');
    expect(formatNativeRealProjectSoakBudgetFailure(failedReport.budgetSummary)).toContain('Cycle duration 1200 ms > 1000 ms');
  });

  it('builds deterministic source-library churn items for native stress smoke cycles', () => {
    expect(buildNativeSmokeStressSourceLibraryItem({ cycle: 3, now: 99 })).toMatchObject({
      id: 'native-smoke-stress-item-3',
      label: 'Native smoke stress item 3',
      kind: 'image',
      mimeType: 'image/png',
      assetUrl: SMOKE_PNG_DATA_URL,
      sourceKey: 'native-smoke-stress-item-3',
      createdAt: 99,
    });
    expect(buildNativeSmokeStressRenameLabel(3)).toBe('Native smoke stress item 3 renamed');
  });

  it('rejects incomplete native smoke bridge results', () => {
    expect(() => assertNativeSmokeResult({
      save: { canceled: false, filePath: '/tmp/native-smoke.sloom', sourceItems: 1 },
      open: { canceled: false, filePath: '/tmp/native-smoke.sloom', name: 'Native Smoke', sourceItems: 1, imageLayerBitmapDataPrefix: 'data:image/png' },
      imported: { canceled: false, count: 1 },
      pdf: { canceled: false, filePath: '/tmp/paper-proof.pdf', bytes: 100 },
      images: { canceled: false, directoryPath: '/tmp/pages', files: [{ fileName: 'Native-Smoke-Page-1.png', bytes: 68 }] },
      workspaceWindows: NATIVE_SMOKE_WORKSPACES.map((workspace) => ({ ok: true, workspace })),
      bodyHasRecovery: false,
    })).not.toThrow();

    expect(() => assertNativeSmokeResult({
      save: { canceled: false, filePath: '/tmp/native-smoke.sloom', sourceItems: 1 },
      open: { canceled: false, filePath: '/tmp/native-smoke.sloom', name: 'Native Smoke', sourceItems: 1, imageLayerBitmapDataPrefix: 'data:image/png' },
      imported: { canceled: false, count: 0 },
      pdf: { canceled: false, filePath: '/tmp/paper-proof.pdf', bytes: 100 },
      images: { canceled: false, directoryPath: '/tmp/pages', files: [{ fileName: 'Native-Smoke-Page-1.png', bytes: 68 }] },
      workspaceWindows: NATIVE_SMOKE_WORKSPACES.map((workspace) => ({ ok: true, workspace })),
      bodyHasRecovery: false,
    })).toThrow(/Native media import did not return an item/);

    expect(() => assertNativeSmokeResult({
      save: { canceled: false, filePath: '/tmp/native-smoke.sloom', sourceItems: 1 },
      open: { canceled: false, filePath: '/tmp/native-smoke.sloom', name: 'Native Smoke', sourceItems: 1 },
      imported: { canceled: false, count: 1 },
      pdf: { canceled: false, filePath: '/tmp/paper-proof.pdf', bytes: 100 },
      images: { canceled: false, directoryPath: '/tmp/pages', files: [{ fileName: 'Native-Smoke-Page-1.png', bytes: 68 }] },
      workspaceWindows: NATIVE_SMOKE_WORKSPACES.map((workspace) => ({ ok: true, workspace })),
      bodyHasRecovery: false,
    })).toThrow(/dropped the Image layer pixel payload/);

    expect(() => assertNativeSmokeResult({
      save: { canceled: false, filePath: '/tmp/native-smoke.sloom', sourceItems: 1 },
      open: { canceled: false, filePath: '/tmp/native-smoke.sloom', name: 'Native Smoke', sourceItems: 1, imageLayerBitmapDataPrefix: 'data:image/png' },
      imported: { canceled: false, count: 1 },
      pdf: { canceled: false, filePath: '/tmp/paper-proof.pdf', bytes: 100 },
      images: { canceled: false, directoryPath: '/tmp/pages', files: [{ fileName: 'Native-Smoke-Page-1.png', bytes: 68 }] },
      workspaceWindows: NATIVE_SMOKE_WORKSPACES.map((workspace) => ({ ok: true, workspace })),
      bodyHasRecovery: true,
    })).toThrow(/recovery boundary/);

    expect(() => assertNativeSmokeResult({
      save: { canceled: false, filePath: '/tmp/native-smoke.sloom', sourceItems: 1 },
      open: { canceled: false, filePath: '/tmp/native-smoke.sloom', name: 'Native Smoke', sourceItems: 1, imageLayerBitmapDataPrefix: 'data:image/png' },
      imported: { canceled: false, count: 1 },
      pdf: { canceled: false, filePath: '/tmp/paper-proof.pdf', bytes: 100 },
      images: { canceled: false, directoryPath: '/tmp/pages', files: [{ fileName: 'Native-Smoke-Page-1.png', bytes: 68 }] },
      workspaceWindows: [{ ok: true, workspace: 'flow' }],
      bodyHasRecovery: false,
    })).toThrow(/workspace windows/);
  });

  it('rejects native asset protocol authorization regressions', () => {
    expect(() => assertNativeAssetProtocolSmokeResult({
      registeredItem: { id: 'smoke-image' },
      symlinkItem: { apply: { ok: true }, hasItem: true },
      registered: { ok: true, status: 200, bytes: 68 },
      unregisteredScratch: { ok: false, status: 403, bytes: 0 },
      symlinkEscape: { ok: false, status: 403, bytes: 0 },
    })).not.toThrow();

    expect(() => assertNativeAssetProtocolSmokeResult({
      registeredItem: { id: 'smoke-image' },
      symlinkItem: { apply: { ok: true }, hasItem: true },
      registered: { ok: false, status: 403, bytes: 0 },
      unregisteredScratch: { ok: false, status: 403, bytes: 0 },
      symlinkEscape: { ok: false, status: 403, bytes: 0 },
    })).toThrow(/registered native asset/i);

    expect(() => assertNativeAssetProtocolSmokeResult({
      registeredItem: { id: 'smoke-image' },
      symlinkItem: { apply: { ok: true }, hasItem: true },
      registered: { ok: true, status: 200, bytes: 68 },
      unregisteredScratch: { ok: true, status: 200, bytes: 68 },
      symlinkEscape: { ok: false, status: 403, bytes: 0 },
    })).toThrow(/unregistered scratch/i);

    expect(() => assertNativeAssetProtocolSmokeResult({
      registeredItem: { id: 'smoke-image' },
      symlinkItem: { apply: { ok: true }, hasItem: true },
      registered: { ok: true, status: 200, bytes: 68 },
      unregisteredScratch: { ok: false, status: 403, bytes: 0 },
      symlinkEscape: { ok: true, status: 200, bytes: 68 },
    })).toThrow(/symlink escape/i);

    expect(() => assertNativeAssetProtocolSmokeResult({
      registeredItem: { id: 'smoke-image' },
      registered: { ok: true, status: 200, bytes: 68 },
      unregisteredScratch: { ok: false, status: 403, bytes: 0 },
      symlinkEscape: { skipped: true, reason: 'symlink unavailable on this platform' },
    })).not.toThrow();

    expect(() => assertNativeAssetProtocolSmokeResult({
      registeredItem: { id: 'imported-panel' },
      symlinkItem: { apply: { ok: true }, hasItem: true },
      registered: { ok: true, status: 200, bytes: 68 },
      unregisteredScratch: { ok: false, status: 403, bytes: 0 },
      symlinkEscape: { ok: false, status: 403, bytes: 0 },
    })).toThrow(/reopened project/i);

    expect(() => assertNativeAssetProtocolSmokeResult({
      registeredItem: { id: 'smoke-image' },
      symlinkItem: { apply: { ok: false }, hasItem: false },
      registered: { ok: true, status: 200, bytes: 68 },
      unregisteredScratch: { ok: false, status: 403, bytes: 0 },
      symlinkEscape: { ok: false, status: 403, bytes: 0 },
    })).toThrow(/symlink source library/i);
  });

  it('rejects incomplete native Paper OS file-drop smoke results', () => {
    expect(() => assertNativePaperOsFileDropSmokeResult({
      workspace: 'paper',
      pageNumber: 2,
      hasRecoveryBoundary: false,
      hasPage: true,
      hasEnvelope: true,
      hasItemName: true,
      hasMime: true,
      hasLinkedFrame: true,
      status: true,
      snapshotHasEnvelope: true,
      snapshotHasItem: true,
      itemCount: 2,
      roundTripExpected: true,
      roundTripSavePath: '/tmp/native-smoke.sloom',
      roundTripHasEnvelope: true,
      roundTripHasItem: true,
      roundTripHasPage: true,
      roundTripHasLinkedFrame: true,
    }, { pageNumber: 2, requireRoundTrip: true })).not.toThrow();

    expect(() => assertNativePaperOsFileDropSmokeResult({
      workspace: 'paper',
      pageNumber: 1,
      hasRecoveryBoundary: false,
      hasPage: true,
      hasEnvelope: true,
      hasItemName: true,
      hasMime: true,
      hasLinkedFrame: false,
      status: true,
      snapshotHasEnvelope: true,
      snapshotHasItem: true,
      itemCount: 2,
    }, { pageNumber: 1 })).toThrow(/linked image frame/i);

    expect(() => assertNativePaperOsFileDropSmokeResult({
      workspace: 'flow',
      pageNumber: 2,
      hasRecoveryBoundary: false,
      hasPage: true,
      hasEnvelope: true,
      hasItemName: true,
      hasMime: true,
      hasLinkedFrame: true,
      status: true,
      snapshotHasEnvelope: true,
      snapshotHasItem: true,
      itemCount: 2,
    }, { pageNumber: 2 })).toThrow(/Paper workspace/i);

    expect(() => assertNativePaperOsFileDropSmokeResult({
      workspace: 'paper',
      pageNumber: 2,
      hasRecoveryBoundary: true,
      hasPage: true,
      hasEnvelope: true,
      hasItemName: true,
      hasMime: true,
      hasLinkedFrame: true,
      status: true,
      snapshotHasEnvelope: true,
      snapshotHasItem: true,
      itemCount: 2,
    }, { pageNumber: 2 })).toThrow(/recovery boundary/i);

    expect(() => assertNativePaperOsFileDropSmokeResult({
      workspace: 'paper',
      pageNumber: 1,
      hasRecoveryBoundary: false,
      hasPage: true,
      hasEnvelope: true,
      hasItemName: true,
      hasMime: true,
      hasLinkedFrame: true,
      status: true,
      snapshotHasEnvelope: true,
      snapshotHasItem: true,
      itemCount: 2,
      roundTripExpected: true,
      roundTripSavePath: '/tmp/native-smoke.sloom',
      roundTripHasEnvelope: true,
      roundTripHasItem: true,
      roundTripHasPage: true,
      roundTripHasLinkedFrame: true,
    }, { pageNumber: 2, requireRoundTrip: true })).toThrow(/page 2/i);

    expect(() => assertNativePaperOsFileDropSmokeResult({
      workspace: 'paper',
      pageNumber: 2,
      hasRecoveryBoundary: false,
      hasPage: true,
      hasEnvelope: true,
      hasItemName: true,
      hasMime: true,
      hasLinkedFrame: true,
      status: true,
      snapshotHasEnvelope: true,
      snapshotHasItem: true,
      itemCount: 2,
      roundTripExpected: true,
      roundTripSavePath: '/tmp/native-smoke.sloom',
      roundTripHasEnvelope: true,
      roundTripHasItem: true,
      roundTripHasPage: true,
      roundTripHasLinkedFrame: false,
    }, { pageNumber: 2, requireRoundTrip: true })).toThrow(/reopened project/i);
  });

  it('rejects Paper OS file-drop Source Library propagation gaps across workspace apps', () => {
    expect(() => assertNativePaperOsFileDropWorkspacePropagationResult({
      expectedEnvelope: 'Page 2 imports',
      fileName: 'native-paper-os-drop.png',
      workspaces: [
        {
          workspace: 'flow',
          app: 'Flow',
          hasRecoveryBoundary: false,
          hasEnvelopeVisible: true,
          hasItemNameVisible: true,
          rendererPersistedHasEnvelope: true,
          rendererPersistedHasItem: true,
          nativeSnapshotHasEnvelope: true,
          nativeSnapshotHasItem: true,
        },
        {
          workspace: 'editor',
          app: 'Video',
          hasRecoveryBoundary: false,
          hasEnvelopeVisible: true,
          hasItemNameVisible: true,
          rendererPersistedHasEnvelope: true,
          rendererPersistedHasItem: true,
          nativeSnapshotHasEnvelope: true,
          nativeSnapshotHasItem: true,
        },
        {
          workspace: 'image',
          app: 'Image',
          hasRecoveryBoundary: false,
          hasEnvelopeVisible: true,
          hasItemNameVisible: true,
          rendererPersistedHasEnvelope: true,
          rendererPersistedHasItem: true,
          nativeSnapshotHasEnvelope: true,
          nativeSnapshotHasItem: true,
        },
        {
          workspace: 'paper',
          app: 'Paper',
          hasRecoveryBoundary: false,
          hasEnvelopeVisible: true,
          hasItemNameVisible: true,
          rendererPersistedHasEnvelope: true,
          rendererPersistedHasItem: true,
          nativeSnapshotHasEnvelope: true,
          nativeSnapshotHasItem: true,
        },
      ],
    })).not.toThrow();

    expect(() => assertNativePaperOsFileDropWorkspacePropagationResult({
      expectedEnvelope: 'Page 2 imports',
      fileName: 'native-paper-os-drop.png',
      workspaces: [
        {
          workspace: 'flow',
          app: 'Flow',
          hasRecoveryBoundary: false,
          hasEnvelopeVisible: true,
          hasItemNameVisible: true,
          rendererPersistedHasEnvelope: true,
          rendererPersistedHasItem: true,
          nativeSnapshotHasEnvelope: true,
          nativeSnapshotHasItem: true,
        },
        {
          workspace: 'editor',
          app: 'Video',
          hasRecoveryBoundary: false,
          hasEnvelopeVisible: false,
          hasItemNameVisible: true,
          rendererPersistedHasEnvelope: true,
          rendererPersistedHasItem: true,
          nativeSnapshotHasEnvelope: true,
          nativeSnapshotHasItem: true,
        },
      ],
    })).toThrow(/Video.*Page 2 imports/i);
  });

  it('rejects Project imports propagation and persistence gaps across workspace apps', () => {
    const passingWorkspace = (workspace) => ({
      workspace,
      app: workspace,
      hasRecoveryBoundary: false,
      hasEnvelopeVisible: true,
      hasItemNameVisible: true,
      rendererStateHasItem: true,
      rendererPersistedHasEnvelope: true,
      rendererPersistedHasItem: true,
      nativeSnapshotHasEnvelope: true,
      nativeSnapshotHasItem: true,
      nativeSnapshotHasAssetUrl: true,
    });

    expect(() => assertNativeProjectImportWorkspacePropagationResult({
      expectedEnvelope: 'Project imports',
      fileName: 'native-smoke-source-library-import.png',
      flowImport: {
        ...passingWorkspace('flow'),
        roundTripExpected: true,
        roundTripHasEnvelope: true,
        roundTripHasItem: true,
        roundTripHasAssetUrl: true,
      },
      workspaces: NATIVE_SMOKE_WORKSPACES.map(passingWorkspace),
    })).not.toThrow();

    expect(() => assertNativeProjectImportWorkspacePropagationResult({
      expectedEnvelope: 'Project imports',
      fileName: 'native-smoke-source-library-import.png',
      flowImport: {
        ...passingWorkspace('flow'),
        roundTripExpected: true,
        roundTripHasEnvelope: true,
        roundTripHasItem: false,
        roundTripHasAssetUrl: true,
      },
      workspaces: NATIVE_SMOKE_WORKSPACES.map(passingWorkspace),
    })).toThrow(/save\/open/i);

    expect(() => assertNativeProjectImportWorkspacePropagationResult({
      expectedEnvelope: 'Project imports',
      fileName: 'native-smoke-source-library-import.png',
      flowImport: {
        ...passingWorkspace('flow'),
        roundTripExpected: true,
        roundTripHasEnvelope: true,
        roundTripHasItem: true,
        roundTripHasAssetUrl: true,
      },
      workspaces: NATIVE_SMOKE_WORKSPACES.map((workspace) => (
        workspace === 'image'
          ? { ...passingWorkspace(workspace), nativeSnapshotHasAssetUrl: false }
          : passingWorkspace(workspace)
      )),
    })).toThrow(/image.*imported project asset/i);
  });
});
