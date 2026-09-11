import { basename, join } from 'node:path';

// 2×2 RGBA PNG: matches the smoke Image document's declared canvas and exercises Chromium's
// production decoder. The older 1×1 grayscale+alpha fixture was accepted structurally but
// rejected by Electron 41's createImageBitmap path once project restore became pixel-complete.
export const SMOKE_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFUlEQVR4nGNUuvzuPwMDAwMTAxQAACuMAuZqiZsjAAAAAElFTkSuQmCC';
export const SMOKE_PNG_DATA_URL = `data:image/png;base64,${SMOKE_PNG_BASE64}`;
export const NATIVE_SMOKE_WORKSPACES = ['flow', 'editor', 'image', 'paper'];
export const NATIVE_VIDEO_RENDER_SMOKE_RENDER_PORT = 41836;
export const NATIVE_VIDEO_RENDER_SMOKE_DEBUG_PORT = 9231;
const DEFAULT_STRESS_CYCLES = 12;
const DEFAULT_STRESS_DELAY_MS = 100;
const DEFAULT_REAL_PROJECT_SOAK_CYCLES = 6;
const DEFAULT_REAL_PROJECT_SOAK_DELAY_MS = 250;
const DEFAULT_FLOW_WORKSPACE_SWITCH_BUDGET_MS = 1200;
const DEFAULT_RENDERER_HEAP_BUDGET_MB = 768;

function buildNativeSmokeElectronEnvironment(baseEnv = process.env, platform = process.platform) {
  const nextEnv = { ...baseEnv };

  if (platform !== 'linux') {
    return nextEnv;
  }

  nextEnv.ELECTRON_OZONE_PLATFORM_HINT = 'x11';
  nextEnv.GDK_BACKEND = 'x11';
  nextEnv.XDG_SESSION_TYPE = 'x11';
  delete nextEnv.WAYLAND_DISPLAY;
  return nextEnv;
}

export function buildNativeSmokeElectronLaunchArgs({
  remoteDebuggingPort,
  platform = process.platform,
} = {}) {
  const args = [`--remote-debugging-port=${remoteDebuggingPort}`];
  if (platform === 'linux') {
    args.push('--ozone-platform=x11');
  }
  args.push('.');
  return args;
}

export function buildNativeSmokeOptions({ argv = [], env = {} } = {}) {
  const hasStressFlag = argv.includes('--stress');
  const argCycles = getOptionValue(argv, '--stress-cycles');
  const envCycles = env.SIGNAL_LOOM_NATIVE_STRESS_CYCLES;
  const argDelayMs = getOptionValue(argv, '--stress-delay-ms');
  const envDelayMs = env.SIGNAL_LOOM_NATIVE_STRESS_DELAY_MS;

  const stressCycles = argCycles !== undefined
    ? parsePositiveInteger(argCycles, 'Native stress cycles')
    : envCycles !== undefined && envCycles !== ''
      ? parsePositiveInteger(envCycles, 'Native stress cycles')
      : hasStressFlag
        ? DEFAULT_STRESS_CYCLES
        : 0;
  const stressDelayMs = argDelayMs !== undefined
    ? parseNonNegativeInteger(argDelayMs, 'Native stress delay')
    : envDelayMs !== undefined && envDelayMs !== ''
      ? parseNonNegativeInteger(envDelayMs, 'Native stress delay')
      : DEFAULT_STRESS_DELAY_MS;

  return { stressCycles, stressDelayMs };
}

export function buildNativeRealProjectSoakOptions({ argv = [], env = {} } = {}) {
  const argCycles = getOptionValue(argv, '--soak-cycles');
  const envCycles = env.SIGNAL_LOOM_NATIVE_SOAK_CYCLES;
  const argDelayMs = getOptionValue(argv, '--soak-delay-ms');
  const envDelayMs = env.SIGNAL_LOOM_NATIVE_SOAK_DELAY_MS;
  const rendererHeapBudgetMb = parseOptionalPositiveNumber({
    argv,
    argName: '--renderer-heap-budget-mb',
    envValue: env.SIGNAL_LOOM_RENDERER_HEAP_BUDGET_MB || env.SIGNAL_LOOM_NATIVE_SOAK_MAX_HEAP_MB,
    label: 'Native real-project soak renderer heap budget MB',
  }) ?? DEFAULT_RENDERER_HEAP_BUDGET_MB;
  const flowWorkspaceSwitchDurationBudgetMs = parseOptionalPositiveInteger({
    argv,
    argName: '--flow-workspace-switch-budget-ms',
    envValue: env.SIGNAL_LOOM_FLOW_SWITCH_BUDGET_MS,
    label: 'Native real-project soak Flow workspace switch budget ms',
  }) ?? DEFAULT_FLOW_WORKSPACE_SWITCH_BUDGET_MS;
  const maxHeapMb = parseOptionalPositiveNumber({
    argv,
    argName: '--max-heap-mb',
    envValue: env.SIGNAL_LOOM_NATIVE_SOAK_MAX_HEAP_MB,
    label: 'Native real-project soak max heap MB',
  });
  const maxNodes = parseOptionalPositiveInteger({
    argv,
    argName: '--max-nodes',
    envValue: env.SIGNAL_LOOM_NATIVE_SOAK_MAX_NODES,
    label: 'Native real-project soak max nodes',
  });
  const maxEventListeners = parseOptionalPositiveInteger({
    argv,
    argName: '--max-listeners',
    envValue: env.SIGNAL_LOOM_NATIVE_SOAK_MAX_LISTENERS,
    label: 'Native real-project soak max event listeners',
  });
  const maxCycleMs = parseOptionalPositiveInteger({
    argv,
    argName: '--max-cycle-ms',
    envValue: env.SIGNAL_LOOM_NATIVE_SOAK_MAX_CYCLE_MS,
    label: 'Native real-project soak max cycle ms',
  });

  const soakCycles = argCycles !== undefined
    ? parsePositiveInteger(argCycles, 'Native real-project soak cycles')
    : envCycles !== undefined && envCycles !== ''
      ? parsePositiveInteger(envCycles, 'Native real-project soak cycles')
      : DEFAULT_REAL_PROJECT_SOAK_CYCLES;
  const soakDelayMs = argDelayMs !== undefined
    ? parseNonNegativeInteger(argDelayMs, 'Native real-project soak delay')
    : envDelayMs !== undefined && envDelayMs !== ''
      ? parseNonNegativeInteger(envDelayMs, 'Native real-project soak delay')
      : DEFAULT_REAL_PROJECT_SOAK_DELAY_MS;

  const budgets = {
    flowWorkspaceSwitchDurationBudgetMs,
    rendererHeapBudgetMb,
  };
  if (maxHeapMb !== undefined) budgets.maxHeapBytes = Math.round(maxHeapMb * 1024 * 1024);
  if (maxNodes !== undefined) budgets.maxNodes = maxNodes;
  if (maxEventListeners !== undefined) budgets.maxEventListeners = maxEventListeners;
  if (maxCycleMs !== undefined) budgets.maxCycleMs = maxCycleMs;

  return { soakCycles, soakDelayMs, budgets };
}

export function evaluateNativeRealProjectSoakBudgets(soak, budgets = {}) {
  const observations = [
    buildSoakMetricBudgetObservation({
      key: 'rendererHeapBudgetMb',
      label: 'Renderer heap',
      limit: budgets.rendererHeapBudgetMb,
      unit: 'mb',
      worst: findWorstWorkspaceMetric(soak, 'jsHeapUsedBytes', (value) => roundToTenths(value / (1024 * 1024))),
    }),
    buildSoakMetricBudgetObservation({
      key: 'flowWorkspaceSwitchDurationBudgetMs',
      label: 'Flow workspace switch',
      limit: budgets.flowWorkspaceSwitchDurationBudgetMs,
      unit: 'ms',
      worst: findWorstWorkspaceSwitchDuration(soak),
    }),
    buildSoakMetricBudgetObservation({
      key: 'maxHeapBytes',
      label: 'JS heap',
      limit: budgets.maxHeapBytes,
      unit: 'bytes',
      worst: findWorstWorkspaceMetric(soak, 'jsHeapUsedBytes'),
    }),
    buildSoakMetricBudgetObservation({
      key: 'maxNodes',
      label: 'DOM nodes',
      limit: budgets.maxNodes,
      unit: 'count',
      worst: findWorstWorkspaceMetric(soak, 'nodes'),
    }),
    buildSoakMetricBudgetObservation({
      key: 'maxEventListeners',
      label: 'JS event listeners',
      limit: budgets.maxEventListeners,
      unit: 'count',
      worst: findWorstWorkspaceMetric(soak, 'jsEventListeners'),
    }),
    buildSoakMetricBudgetObservation({
      key: 'maxCycleMs',
      label: 'Cycle duration',
      limit: budgets.maxCycleMs,
      unit: 'ms',
      worst: findWorstCycleDuration(soak),
    }),
  ].filter(Boolean);
  const failures = observations.filter((observation) => observation.status === 'failed');

  return {
    status: observations.length === 0 ? 'not-configured' : failures.length > 0 ? 'failed' : 'passed',
    observations,
    failures,
  };
}

export function buildNativeRealProjectSoakReport({
  rootDir,
  projectPath,
  options,
  startup,
  baseline,
  soak,
  reportPath,
} = {}) {
  const budgetSummary = evaluateNativeRealProjectSoakBudgets(soak, options?.budgets ?? {});

  return {
    ok: budgetSummary.status !== 'failed',
    rootDir,
    projectPath,
    options,
    startup,
    baseline,
    soak,
    budgetSummary,
    reportPath,
  };
}

export function formatNativeRealProjectSoakBudgetFailure(budgetSummary) {
  const failures = Array.isArray(budgetSummary?.failures) ? budgetSummary.failures : [];
  if (failures.length === 0) {
    return 'Native real-project soak performance budgets failed.';
  }

  return failures.map(formatBudgetFailure).join('; ');
}

export function buildNativeSmokeProjectDocument({ now = Date.now() } = {}) {
  return {
    id: 'native-smoke-project',
    name: 'Native Smoke',
    savedAt: now,
    flow: {
      version: 3,
      nodes: [{
        id: 'smoke-text',
        type: 'textNode',
        position: { x: 0, y: 0 },
        data: {
          label: 'Native Smoke',
          prompt: 'Smoke test text node',
        },
      }],
      edges: [],
    },
    sourceBin: {
      bins: [{
        id: 'default',
        name: 'Source Library',
        collapsed: false,
        createdAt: now,
        items: [{
          id: 'smoke-image',
          label: 'Smoke panel',
          kind: 'image',
          mimeType: 'image/png',
          assetUrl: SMOKE_PNG_DATA_URL,
          sourceKey: 'native-smoke-panel',
          createdAt: now,
        }],
      }],
      dismissedSourceKeys: [],
    },
    // Image document with a serialized pixel payload: the reopened project must
    // still carry bitmapData or a saved Image canvas would blank on reopen
    // (the .sloom bitmap-wipe data-loss class — see docs/notes on 2678f8c/5b1372d).
    imageEditor: {
      documents: [{
        id: 'smoke-image-doc',
        name: 'Smoke Canvas',
        width: 2,
        height: 2,
        activeLayerId: 'smoke-image-layer',
        layers: [{
          id: 'smoke-image-layer',
          name: 'Layer 1',
          type: 'image',
          visible: true,
          locked: false,
          opacity: 1,
          blendMode: 'normal',
          x: 0,
          y: 0,
          bitmap: null,
          bitmapVersion: 1,
          mask: null,
          bitmapData: SMOKE_PNG_DATA_URL,
        }],
        snapshots: [],
      }],
      activeDocId: 'smoke-image-doc',
    },
  };
}

export function buildNativeVideoRenderSmokeProjectDocument({ now = Date.now() } = {}) {
  return {
    id: 'native-video-render-smoke-project',
    name: 'Native Video Render Smoke',
    savedAt: now,
    flow: {
      version: 3,
      nodes: [{
        id: 'native-video-render-composition',
        type: 'composition',
        position: { x: 0, y: 0 },
        data: {
          label: 'Native Video Render Smoke',
          customTitle: 'Native Video Render Smoke',
          aspectRatio: '16:9',
          videoResolution: '720p',
          videoFrameRate: 6,
          compositionAudioTrackCount: 1,
          compositionTimelineSeconds: 1,
          compositionUseVideoAudio: false,
          compositionVideoAudioVolume: 100,
          editorExportPresetPlan: { presetId: 'review-h264-1080p' },
          editorVisualClips: [{
            id: 'native-video-render-clip',
            sourceNodeId: 'native-video-render-source-image',
            sourceKind: 'image',
            trackIndex: 0,
            startMs: 0,
            sourceInMs: 0,
            durationSeconds: 0.5,
            fitMode: 'cover',
            scalePercent: 100,
            opacityPercent: 90,
            positionX: 0,
            positionY: 0,
            cropLeftPercent: 0,
            cropRightPercent: 0,
            cropTopPercent: 0,
            cropBottomPercent: 0,
            blendMode: 'normal',
            stroke: {
              enabled: true,
              color: '#22d3ee',
              widthPx: 8,
              opacityPercent: 100,
            },
          }],
          editorAudioClips: [],
        },
      }],
      edges: [],
    },
    editor: {
      workspaceView: 'editor',
      activeCompositionId: 'native-video-render-composition',
      selectedSourceItemId: 'native-video-render-source-image',
      selectedVisualClipId: 'native-video-render-clip',
      sourceBinTab: 'media',
      sourceMonitorVisible: true,
      programMonitorVisible: true,
      inspectorVisible: true,
      sourceBinVisible: true,
      sourceMonitorWidth: 320,
      inspectorWidth: 320,
      sourceBinWidth: 280,
      monitorSplitPercent: 50,
      monitorSectionHeight: 360,
      timelineVisualTrackHeight: 84,
      timelineAudioTrackHeight: 64,
    },
    sourceBin: {
      bins: [{
        id: 'default',
        name: 'Source Library',
        collapsed: false,
        createdAt: now,
        items: [{
          id: 'native-video-render-source-image',
          label: 'Native video render source',
          kind: 'image',
          mimeType: 'image/png',
          assetUrl: SMOKE_PNG_DATA_URL,
          sourceKey: 'native-video-render-source-image',
          createdAt: now,
        }],
      }],
      dismissedSourceKeys: [],
    },
  };
}

export function buildNativeSmokeSourceLibraryItem({ now = Date.now() } = {}) {
  return {
    id: 'native-smoke-cross-window-item',
    label: 'Native smoke cross-window panel',
    kind: 'image',
    mimeType: 'image/png',
    assetUrl: SMOKE_PNG_DATA_URL,
    sourceKey: 'native-smoke-cross-window-panel',
    createdAt: now,
  };
}

export function buildNativeSmokeStressSourceLibraryItem({ cycle, now = Date.now() } = {}) {
  const safeCycle = normalizeStressCycle(cycle);
  return {
    id: `native-smoke-stress-item-${safeCycle}`,
    label: `Native smoke stress item ${safeCycle}`,
    kind: 'image',
    mimeType: 'image/png',
    assetUrl: SMOKE_PNG_DATA_URL,
    sourceKey: `native-smoke-stress-item-${safeCycle}`,
    createdAt: now,
  };
}

export function buildNativeSmokeStressRenameLabel(cycle) {
  const safeCycle = normalizeStressCycle(cycle);
  return `Native smoke stress item ${safeCycle} renamed`;
}

export function buildNativeSmokePaperPdfRequest() {
  return {
    title: 'Native Smoke Paper',
    fileName: 'Native-Smoke-Paper.pdf',
    html: '<!doctype html><html><head><style>@page{size:20mm 20mm;margin:0}body{margin:0;font:8px sans-serif}</style></head><body><div>Native Smoke PDF</div></body></html>',
    page: { widthMm: 20, heightMm: 20 },
  };
}

export function buildNativeSmokePaperImagesRequest() {
  return {
    title: 'Native Smoke',
    directoryName: 'Native-Smoke-webcomic-png',
    format: 'png',
    pages: [{
      pageNumber: 1,
      fileName: 'Native-Smoke-Page-1.png',
      mimeType: 'image/png',
      dataUrl: SMOKE_PNG_DATA_URL,
    }],
  };
}

export function buildNativeSmokePaperOsFileDropExpression({
  fileName = 'native-smoke-paper-os-drop.png',
  mimeType = 'image/png',
  base64 = SMOKE_PNG_BASE64,
  lastModified = 1710000000000,
  pageNumber = 1,
  ensurePageCount,
  verifySaveOpenRoundTrip = false,
} = {}) {
  const targetPageNumber = normalizePositiveInteger(pageNumber, 1);
  const requiredPageCount = Math.max(targetPageNumber, normalizePositiveInteger(ensurePageCount, targetPageNumber));
  const targetPageSelector = `[data-paper-page-view="true"][data-paper-page-number="${targetPageNumber}"]`;

  return `
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const fileName = ${JSON.stringify(fileName)};
      const mimeType = ${JSON.stringify(mimeType)};
      const base64 = ${JSON.stringify(base64)};
      const lastModified = ${JSON.stringify(lastModified)};
      const pageNumber = ${JSON.stringify(targetPageNumber)};
      const requiredPageCount = ${JSON.stringify(requiredPageCount)};
      const targetPageSelector = ${JSON.stringify(targetPageSelector)};
      const targetPageFrameSelector = '[data-paper-frame="true"][data-paper-frame-page-number="' + pageNumber + '"]';
      const verifySaveOpenRoundTrip = ${JSON.stringify(Boolean(verifySaveOpenRoundTrip))};
      const expectedEnvelope = ${JSON.stringify(`Page ${targetPageNumber} imports`)};
      const expectedStatus = ${JSON.stringify(`Imported 1 image into Page ${targetPageNumber} imports.`)};
      const workspace = new URL(location.href).searchParams.get('workspace') || 'flow';
      const bridge = window.signalLoomNative;
      let authorityClaim;
      const refreshAuthorityClaim = async () => {
        const adopted = await bridge?.adoptProject?.();
        if (!adopted?.authority || !(await bridge?.confirmProjectAdoption?.(adopted.authority))?.ok) return false;
        authorityClaim = adopted.authority;
        return true;
      };
      await refreshAuthorityClaim();

      const getSourceItems = (snapshot) => (snapshot?.snapshot?.bins ?? []).flatMap((bin) => bin.items ?? []);
      const findExpectedSourceItem = (items) => items.find((item) => (
        item.label === fileName
        && item.mimeType === mimeType
        && item.envelopeLabel === expectedEnvelope
        && typeof item.envelopeId === 'string'
        && item.envelopeId.startsWith('paper-page-imports:')
        && item.kind === 'image'
      ));

      const readState = async () => {
        const text = document.body?.textContent || '';
        const page = document.querySelector(targetPageSelector);
        const images = Array.from(document.querySelectorAll('img')).map((img) => img.alt);
        const pageImages = page ? Array.from(page.querySelectorAll('img')).map((img) => img.alt) : [];
        const pageFrameImages = Array.from(document.querySelectorAll(targetPageFrameSelector + ' img')).map((img) => img.alt);
        const hasLinkedFrame = pageImages.includes(fileName) || pageFrameImages.includes(fileName);
        const pageCount = Number(document.querySelector('[data-paper-page-count]')?.getAttribute('data-paper-page-count') ?? 0)
          || document.querySelectorAll('[data-paper-page-view="true"]').length;
        let itemCount = 0;
        let snapshotHasEnvelope = false;
        let snapshotHasItem = false;
        let snapshotEnvelopeId;
        let snapshotItemId;
        if (bridge?.getSourceLibrarySnapshot) {
          const snapshot = await bridge.getSourceLibrarySnapshot({ claim: authorityClaim });
          const items = getSourceItems(snapshot);
          const item = findExpectedSourceItem(items);
          itemCount = items.length;
          snapshotHasEnvelope = items.some((item) => item.envelopeLabel === expectedEnvelope);
          snapshotHasItem = Boolean(item);
          snapshotEnvelopeId = item?.envelopeId;
          snapshotItemId = item?.id;
        }
        return {
          workspace,
          pageNumber,
          requiredPageCount,
          pageCount,
          hasRecoveryBoundary: text.includes('Recovery Boundary'),
          hasPage: Boolean(page),
          hasEnvelope: text.includes(expectedEnvelope),
          hasItemName: text.includes(fileName) || hasLinkedFrame || snapshotHasItem,
          hasMime: text.includes(mimeType) || snapshotHasItem,
          hasLinkedFrame,
          hasOffPageLinkedFrame: !hasLinkedFrame && images.includes(fileName),
          status: text.includes(expectedStatus),
          snapshotHasEnvelope,
          snapshotHasItem,
          snapshotEnvelopeId,
          snapshotItemId,
          itemCount,
          roundTripExpected: verifySaveOpenRoundTrip,
          bodyExcerpt: text.slice(0, 2000),
        };
      };

      const clickAddPageButton = () => {
        const button = Array.from(document.querySelectorAll('button'))
          .find((candidate) => candidate.textContent?.trim() === 'Page');
        if (!button) return false;
        button.click();
        return true;
      };

      const startedAt = Date.now();
      while (Date.now() - startedAt < 15000) {
        const state = await readState();
        if (state.hasRecoveryBoundary) return state;
        if (state.pageCount >= requiredPageCount && state.hasPage) break;
        if (state.pageCount < requiredPageCount) {
          if (!clickAddPageButton()) {
            return {
              ...state,
              error: 'Paper page add button not found for OS file-drop smoke.',
            };
          }
        }
        await sleep(100);
      }

      const page = document.querySelector(targetPageSelector);
      if (!page) {
        return {
          ...(await readState()),
          error: 'Paper page ' + pageNumber + ' view not found for OS file-drop smoke.',
        };
      }

      page.scrollIntoView({ block: 'center', inline: 'center' });
      await sleep(100);
      const rect = page.getBoundingClientRect();
      const center = {
        x: Math.round(rect.left + rect.width * 0.45),
        y: Math.round(rect.top + rect.height * 0.35),
      };
      const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
      const file = new File([bytes], fileName, { type: mimeType, lastModified });
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      for (const type of ['dragenter', 'dragover', 'drop']) {
        page.dispatchEvent(new DragEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: center.x,
          clientY: center.y,
          dataTransfer,
        }));
      }

      let latest = await readState();
      while (Date.now() - startedAt < 15000) {
        latest = await readState();
        if (
          latest.workspace === 'paper'
          && !latest.hasRecoveryBoundary
          && latest.pageNumber === pageNumber
          && latest.hasPage
          && latest.hasEnvelope
          && latest.hasItemName
          && latest.hasMime
          && latest.hasLinkedFrame
          && latest.status
          && latest.snapshotHasEnvelope
          && latest.snapshotHasItem
        ) {
          if (!verifySaveOpenRoundTrip) {
            return latest;
          }
          return {
            ...latest,
            ...(await verifyRoundTrip(latest)),
          };
        }
        await sleep(100);
      }
      return latest;

      async function verifyRoundTrip(liveState) {
        if (!bridge?.openProjectFile) {
          return {
            roundTripExpected: true,
            roundTripError: 'native bridge openProjectFile is unavailable',
          };
        }

        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 's',
          code: 'KeyS',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }));

        let latestRoundTrip = {
          roundTripExpected: true,
          roundTripHasEnvelope: false,
          roundTripHasItem: false,
          roundTripHasPage: false,
          roundTripHasLinkedFrame: false,
        };
        const roundTripStartedAt = Date.now();
        await sleep(200);
        while (Date.now() - roundTripStartedAt < 15000) {
          await refreshAuthorityClaim();
          const preparedOpen = await bridge.openProjectFile({ claim: authorityClaim });
          if (!preparedOpen?.transactionId) {
            await sleep(250);
            continue;
          }
          const committedOpen = await bridge.commitProjectSwitch({ transactionId: preparedOpen.transactionId });
          if (!committedOpen?.authority || committedOpen?.rejected) {
            await sleep(250);
            continue;
          }
          await bridge.confirmProjectAdoption(committedOpen.authority);
          authorityClaim = committedOpen.authority;
          const opened = {
            ...preparedOpen,
            ...committedOpen,
            document: committedOpen.document ?? preparedOpen.document,
          };
          const document = opened?.document;
          const sourceItems = (document?.sourceBin?.bins ?? []).flatMap((bin) => bin.items ?? []);
          const item = findExpectedSourceItem(sourceItems);
          const pages = document?.paper?.document?.pages ?? [];
          const page = pages.find((candidate) => candidate.pageNumber === pageNumber);
          const linkedFrame = page?.frames?.find((frame) => (
            frame.kind === 'image'
            && frame.asset?.sourceBinItemId === item?.id
            && frame.asset?.label === fileName
            && frame.asset?.mimeType === mimeType
          ));
          latestRoundTrip = {
            roundTripExpected: true,
            roundTripSavePath: opened?.filePath,
            roundTripSourceItemId: item?.id,
            roundTripFrameId: linkedFrame?.id,
            roundTripHasEnvelope: sourceItems.some((candidate) => candidate.envelopeLabel === expectedEnvelope),
            roundTripHasItem: Boolean(item),
            roundTripHasPage: Boolean(page),
            roundTripHasLinkedFrame: Boolean(linkedFrame),
            roundTripOpenedName: document?.name,
          };
          if (
            latestRoundTrip.roundTripHasEnvelope
            && latestRoundTrip.roundTripHasItem
            && latestRoundTrip.roundTripHasPage
            && latestRoundTrip.roundTripHasLinkedFrame
          ) {
            return latestRoundTrip;
          }
          await sleep(250);
        }
        return {
          ...latestRoundTrip,
          liveStateBeforeRoundTrip: liveState,
        };
      }
    })()
  `;
}

export function buildNativeSmokePaperOsFileDropWorkspacePropagationExpression({
  envelopeLabel,
  fileName,
  itemId,
  mimeType = 'image/png',
} = {}) {
  return `
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const expectedEnvelope = ${JSON.stringify(envelopeLabel ?? '')};
      const fileName = ${JSON.stringify(fileName ?? '')};
      const itemId = ${JSON.stringify(itemId ?? '')};
      const mimeType = ${JSON.stringify(mimeType)};
      const bridge = window.signalLoomNative;
      const workspace = new URL(location.href).searchParams.get('workspace') || 'flow';
      let authorityClaim;
      const refreshAuthorityClaim = async () => {
        const adopted = await bridge?.adoptProject?.();
        if (!adopted?.authority || !(await bridge?.confirmProjectAdoption?.(adopted.authority))?.ok) return false;
        authorityClaim = adopted.authority;
        return true;
      };
      await refreshAuthorityClaim();
      const appLabels = {
        flow: 'Flow',
        editor: 'Video',
        image: 'Image',
        paper: 'Paper',
      };

      const getSnapshotItems = async () => {
        if (!bridge?.getSourceLibrarySnapshot) return [];
        const snapshot = await bridge.getSourceLibrarySnapshot({ claim: authorityClaim });
        return (snapshot.snapshot?.bins ?? []).flatMap((bin) => bin.items ?? []);
      };

      const getPersistedItems = () => {
        try {
          const parsed = JSON.parse(window.localStorage.getItem('flow-global-source-bin') || '{}');
          const state = parsed?.state ?? parsed;
          return (state?.bins ?? []).flatMap((bin) => bin.items ?? []);
        } catch {
          return [];
        }
      };

      const findExpectedSourceItem = (items) => items.find((item) => (
        (!itemId || item.id === itemId)
        && item.label === fileName
        && item.envelopeLabel === expectedEnvelope
        && (!mimeType || item.mimeType === mimeType)
        && typeof item.envelopeId === 'string'
        && item.envelopeId.startsWith('paper-page-imports:')
        && item.kind === 'image'
      ));

      let lastState = {};
      const startedAt = Date.now();
      while (Date.now() - startedAt < 10000) {
        const bodyText = document.body?.innerText || document.body?.textContent || '';
        const rendererItemIds = (document.querySelector('[data-source-library-renderer-item-ids]')?.getAttribute('data-source-library-renderer-item-ids') || '')
          .split(/\\s+/)
          .filter(Boolean);
        const rendererStateHasItem = itemId ? rendererItemIds.includes(encodeURIComponent(itemId)) : false;
        const persistedItems = getPersistedItems();
        const snapshotItems = await getSnapshotItems();
        const persistedItem = findExpectedSourceItem(persistedItems);
        const snapshotItem = findExpectedSourceItem(snapshotItems);

        lastState = {
          workspace,
          app: appLabels[workspace] || workspace,
          expectedEnvelope,
          fileName,
          itemId,
          hasRecoveryBoundary: bodyText.includes('Recovery Boundary'),
          hasEnvelopeVisible: bodyText.includes(expectedEnvelope),
          hasItemNameVisible: bodyText.includes(fileName) || rendererStateHasItem,
          rendererStateHasItem,
          rendererPersistedHasEnvelope: persistedItems.some((item) => item.envelopeLabel === expectedEnvelope),
          rendererPersistedHasItem: Boolean(persistedItem),
          nativeSnapshotHasEnvelope: snapshotItems.some((item) => item.envelopeLabel === expectedEnvelope),
          nativeSnapshotHasItem: Boolean(snapshotItem),
        };

        if (
          !lastState.hasRecoveryBoundary
          && lastState.hasEnvelopeVisible
          && lastState.hasItemNameVisible
          && lastState.rendererStateHasItem
          && lastState.rendererPersistedHasEnvelope
          && lastState.rendererPersistedHasItem
          && lastState.nativeSnapshotHasEnvelope
          && lastState.nativeSnapshotHasItem
        ) {
          return lastState;
        }

        await sleep(100);
      }

      return lastState;
    })()
  `;
}

export function buildNativeSmokeProjectImportWorkspacePropagationExpression({
  envelopeId = 'project-imports',
  envelopeLabel = 'Project imports',
  fileName = 'native-smoke-source-library-import.png',
  itemId,
  mimeType = 'image/png',
  verifySaveOpenRoundTrip = false,
} = {}) {
  return `
    (async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const expectedEnvelopeId = ${JSON.stringify(envelopeId)};
      const expectedEnvelope = ${JSON.stringify(envelopeLabel)};
      const fileName = ${JSON.stringify(fileName)};
      const expectedItemId = ${JSON.stringify(itemId ?? '')};
      const mimeType = ${JSON.stringify(mimeType)};
      const verifySaveOpenRoundTrip = ${JSON.stringify(Boolean(verifySaveOpenRoundTrip))};
      const bridge = window.signalLoomNative;
      const workspace = new URL(location.href).searchParams.get('workspace') || 'flow';
      let authorityClaim;
      const refreshAuthorityClaim = async () => {
        const adopted = await bridge?.adoptProject?.();
        if (!adopted?.authority || !(await bridge?.confirmProjectAdoption?.(adopted.authority))?.ok) return false;
        authorityClaim = adopted.authority;
        return true;
      };
      await refreshAuthorityClaim();
      const appLabels = {
        flow: 'Flow',
        editor: 'Video',
        image: 'Image',
        paper: 'Paper',
      };

      const getSnapshotItems = async () => {
        if (!bridge?.getSourceLibrarySnapshot) return [];
        const snapshot = await bridge.getSourceLibrarySnapshot({ claim: authorityClaim });
        return (snapshot.snapshot?.bins ?? []).flatMap((bin) => bin.items ?? []);
      };

      const getPersistedItems = () => {
        try {
          const parsed = JSON.parse(window.localStorage.getItem('flow-global-source-bin') || '{}');
          const state = parsed?.state ?? parsed;
          return (state?.bins ?? []).flatMap((bin) => bin.items ?? []);
        } catch {
          return [];
        }
      };

      const findExpectedSourceItem = (items) => items.find((item) => (
        (!expectedItemId || item.id === expectedItemId)
        && item.label === fileName
        && item.envelopeId === expectedEnvelopeId
        && item.envelopeLabel === expectedEnvelope
        && (!mimeType || item.mimeType === mimeType)
        && item.kind === 'image'
      ));

      const readState = async () => {
        const bodyText = document.body?.innerText || document.body?.textContent || '';
        const rendererItemIds = (document.querySelector('[data-source-library-renderer-item-ids]')?.getAttribute('data-source-library-renderer-item-ids') || '')
          .split(/\\s+/)
          .filter(Boolean);
        const persistedItems = getPersistedItems();
        const snapshotItems = await getSnapshotItems();
        const persistedItem = findExpectedSourceItem(persistedItems);
        const snapshotItem = findExpectedSourceItem(snapshotItems);
        const resolvedItemId = snapshotItem?.id || persistedItem?.id || expectedItemId;
        const rendererStateHasItem = resolvedItemId ? rendererItemIds.includes(encodeURIComponent(resolvedItemId)) : false;

        return {
          workspace,
          app: appLabels[workspace] || workspace,
          expectedEnvelopeId,
          expectedEnvelope,
          fileName,
          itemId: resolvedItemId,
          hasRecoveryBoundary: bodyText.includes('Recovery Boundary'),
          hasEnvelopeVisible: bodyText.includes(expectedEnvelope),
          hasItemNameVisible: bodyText.includes(fileName) || rendererStateHasItem,
          rendererStateHasItem,
          rendererPersistedHasEnvelope: persistedItems.some((item) => item.envelopeId === expectedEnvelopeId && item.envelopeLabel === expectedEnvelope),
          rendererPersistedHasItem: Boolean(persistedItem),
          nativeSnapshotHasEnvelope: snapshotItems.some((item) => item.envelopeId === expectedEnvelopeId && item.envelopeLabel === expectedEnvelope),
          nativeSnapshotHasItem: Boolean(snapshotItem),
          nativeSnapshotHasAssetUrl: typeof snapshotItem?.assetUrl === 'string' && snapshotItem.assetUrl.length > 0,
          snapshotItemId: snapshotItem?.id,
        };
      };

      let latest = {};
      const startedAt = Date.now();
      while (Date.now() - startedAt < 15000) {
        latest = await readState();
        if (
          !latest.hasRecoveryBoundary
          && latest.hasEnvelopeVisible
          && latest.hasItemNameVisible
          && latest.rendererStateHasItem
          && latest.rendererPersistedHasEnvelope
          && latest.rendererPersistedHasItem
          && latest.nativeSnapshotHasEnvelope
          && latest.nativeSnapshotHasItem
          && latest.nativeSnapshotHasAssetUrl
        ) {
          if (!verifySaveOpenRoundTrip) {
            return latest;
          }
          return {
            ...latest,
            ...(await verifyRoundTrip(latest)),
          };
        }

        await sleep(100);
      }

      return latest;

      async function verifyRoundTrip(liveState) {
        if (!bridge?.openProjectFile) {
          return {
            roundTripExpected: true,
            roundTripError: 'native bridge openProjectFile is unavailable',
          };
        }

        window.dispatchEvent(new KeyboardEvent('keydown', {
          key: 's',
          code: 'KeyS',
          ctrlKey: true,
          bubbles: true,
          cancelable: true,
        }));

        let latestRoundTrip = {
          roundTripExpected: true,
          roundTripHasEnvelope: false,
          roundTripHasItem: false,
          roundTripHasAssetUrl: false,
        };
        const roundTripStartedAt = Date.now();
        await sleep(200);
        while (Date.now() - roundTripStartedAt < 15000) {
          await refreshAuthorityClaim();
          const preparedOpen = await bridge.openProjectFile({ claim: authorityClaim });
          if (!preparedOpen?.transactionId) {
            await sleep(250);
            continue;
          }
          const committedOpen = await bridge.commitProjectSwitch({ transactionId: preparedOpen.transactionId });
          if (!committedOpen?.authority || committedOpen?.rejected) {
            await sleep(250);
            continue;
          }
          await bridge.confirmProjectAdoption(committedOpen.authority);
          authorityClaim = committedOpen.authority;
          const opened = {
            ...preparedOpen,
            ...committedOpen,
            document: committedOpen.document ?? preparedOpen.document,
          };
          const document = opened?.document;
          const sourceItems = (document?.sourceBin?.bins ?? []).flatMap((bin) => bin.items ?? []);
          const item = findExpectedSourceItem(sourceItems);
          latestRoundTrip = {
            roundTripExpected: true,
            roundTripSavePath: opened?.filePath,
            roundTripSourceItemId: item?.id,
            roundTripHasEnvelope: sourceItems.some((candidate) => candidate.envelopeId === expectedEnvelopeId && candidate.envelopeLabel === expectedEnvelope),
            roundTripHasItem: Boolean(item),
            roundTripHasAssetUrl: typeof item?.assetUrl === 'string' && item.assetUrl.length > 0,
            roundTripOpenedName: document?.name,
          };
          if (
            latestRoundTrip.roundTripHasEnvelope
            && latestRoundTrip.roundTripHasItem
            && latestRoundTrip.roundTripHasAssetUrl
          ) {
            return latestRoundTrip;
          }
          await sleep(250);
        }
        return {
          ...latestRoundTrip,
          liveStateBeforeRoundTrip: liveState,
        };
      }
    })()
  `;
}

export function buildNativeSmokePaths(rootDir) {
  return {
    rootDir,
    userDataDir: join(rootDir, 'user-data'),
    panelPath: join(rootDir, 'panel.png'),
    sourceLibraryImportPath: join(rootDir, 'native-smoke-source-library-import.png'),
    projectPath: join(rootDir, 'native-smoke.sloom'),
    pdfPath: join(rootDir, 'paper-proof.pdf'),
    paperImageDirectory: join(rootDir, 'webcomic-pages'),
    expectedPaperImagePath: join(rootDir, 'webcomic-pages', 'Native-Smoke-webcomic-png', 'Native-Smoke-Page-1.png'),
  };
}

export function buildNativeVideoRenderSmokePaths(rootDir) {
  return {
    rootDir,
    userDataDir: join(rootDir, 'user-data'),
    projectPath: join(rootDir, 'native-video-render-smoke.sloom'),
    startupProjectStatePath: join(rootDir, 'user-data', 'startup-project.json'),
    outputVideoPath: join(rootDir, 'native-video-render-smoke.mp4'),
    reportPath: join(rootDir, 'native-video-render-report.json'),
  };
}

export function buildNativeRealProjectSmokePaths(rootDir, projectPath) {
  const projectBaseName = sanitizeSmokePathPart(
    basename(projectPath || 'project')
      .replace(/\.sloom(?:\.bak.*)?$/i, ''),
    'real-project',
  );

  return {
    rootDir,
    projectPath,
    userDataDir: join(rootDir, 'user-data'),
    startupProjectStatePath: join(rootDir, 'user-data', 'startup-project.json'),
    pdfPath: join(rootDir, `${projectBaseName}-real-project.pdf`),
    paperImageDirectory: join(rootDir, 'webcomic-pages'),
  };
}

export function buildNativeRealProjectStartupState(projectPath, { now = new Date().toISOString() } = {}) {
  return `${JSON.stringify({
    currentProjectPath: projectPath,
    // The real-project harness explicitly tests startup restoration. Production remains blank by
    // default; this isolated profile opts in so the harness exercises the intended branch.
    reopenLastProjectOnStartup: true,
    updatedAt: now,
  }, null, 2)}\n`;
}

export function buildNativeRealProjectSmokeEnvironment({ baseEnv = process.env, rootDir, projectPath }) {
  const paths = buildNativeRealProjectSmokePaths(rootDir, projectPath);
  return {
    ...buildNativeSmokeElectronEnvironment(baseEnv),
    SIGNAL_LOOM_ENABLE_AUTOMATION_PATHS: '1',
    SIGNAL_LOOM_AUTOMATION_PAPER_PDF_PATH: paths.pdfPath,
    SIGNAL_LOOM_AUTOMATION_PAPER_IMAGE_DIRECTORY: paths.paperImageDirectory,
    SIGNAL_LOOM_ELECTRON_USER_DATA_DIR: paths.userDataDir,
  };
}

export function buildNativeSmokeEnvironment({ baseEnv = process.env, rootDir }) {
  const paths = buildNativeSmokePaths(rootDir);
  return {
    ...buildNativeSmokeElectronEnvironment(baseEnv),
    SIGNAL_LOOM_ENABLE_AUTOMATION_PATHS: '1',
    SIGNAL_LOOM_AUTOMATION_PROJECT_SAVE_PATH: paths.projectPath,
    SIGNAL_LOOM_AUTOMATION_PROJECT_OPEN_PATH: paths.projectPath,
    SIGNAL_LOOM_AUTOMATION_IMPORT_MEDIA_PATHS: paths.panelPath,
    SIGNAL_LOOM_AUTOMATION_PAPER_PDF_PATH: paths.pdfPath,
    SIGNAL_LOOM_AUTOMATION_PAPER_IMAGE_DIRECTORY: paths.paperImageDirectory,
    SIGNAL_LOOM_ELECTRON_USER_DATA_DIR: paths.userDataDir,
  };
}

export function buildNativeVideoRenderSmokeEnvironment({ baseEnv = process.env, rootDir }) {
  const paths = buildNativeVideoRenderSmokePaths(rootDir);
  return {
    ...buildNativeSmokeElectronEnvironment(baseEnv),
    SIGNAL_LOOM_ELECTRON_USER_DATA_DIR: paths.userDataDir,
  };
}

export function buildNativeVideoRenderSmokeRendererEnvironment({
  baseEnv = process.env,
  renderPort = NATIVE_VIDEO_RENDER_SMOKE_RENDER_PORT,
  outputPath,
}) {
  return {
    ...baseEnv,
    SIGNAL_LOOM_NATIVE_RENDER_HOST: '127.0.0.1',
    SIGNAL_LOOM_NATIVE_RENDER_PORT: String(renderPort),
    SIGNAL_LOOM_NATIVE_RENDER_ALLOW_UNAUTHENTICATED: '1',
    SIGNAL_LOOM_NATIVE_RENDER_ALLOWED_ORIGINS: 'null,http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://localhost:4173',
    ...(outputPath ? { SIGNAL_LOOM_NATIVE_RENDER_LAST_OUTPUT_PATH: outputPath } : {}),
  };
}

export function buildNativeVideoRenderSmokeSettingsStorage({
  renderPort = NATIVE_VIDEO_RENDER_SMOKE_RENDER_PORT,
} = {}) {
  return `${JSON.stringify({
    state: {
      providerSettings: {
        renderBackendPreference: 'auto',
        localNativeRenderUrl: `http://127.0.0.1:${renderPort}`,
        localNativeRenderToken: '',
      },
    },
    version: 0,
  })}`;
}

export function buildNativeSmokeBridgeExpression() {
  return `
    (async () => {
      const bridge = window.signalLoomNative;
      if (!bridge) return { error: 'native bridge missing' };
      const stage = (value) => { window.__signalLoomNativeSmokeStage = value; };
      stage('adopt-initial');
      const adopted = await bridge.adoptProject();
      stage('confirm-initial');
      if (!adopted?.authority || !(await bridge.confirmProjectAdoption(adopted.authority))?.ok) {
        return { error: 'native smoke could not adopt the initial project authority' };
      }
      stage('prepare-clear');
      const preparedClear = await bridge.clearProjectPath({ claim: adopted.authority });
      if (!preparedClear?.transactionId) {
        return { error: preparedClear?.rejected?.message || 'native smoke could not prepare the blank project' };
      }
      stage('commit-clear');
      const clear = await bridge.commitProjectSwitch({ transactionId: preparedClear.transactionId });
      if (!clear?.authority || clear?.rejected || !(await bridge.confirmProjectAdoption(clear.authority))?.ok) {
        return { error: clear?.rejected?.message || 'native smoke could not adopt the blank project authority' };
      }
      stage('save');
      const save = await bridge.saveProjectFile({
        document: ${JSON.stringify(buildNativeSmokeProjectDocument())},
        claim: clear.authority,
      });
      if (!save?.authority || save?.rejected) {
        return { error: save?.rejected?.message || 'native smoke could not save the project' };
      }
      stage('prepare-open');
      const preparedOpen = await bridge.openProjectFile({ claim: save.authority });
      if (!preparedOpen?.transactionId) {
        return { error: preparedOpen?.rejected?.message || 'native smoke could not prepare the saved project' };
      }
      stage('commit-open');
      const committedOpen = await bridge.commitProjectSwitch({ transactionId: preparedOpen.transactionId });
      if (!committedOpen?.authority || committedOpen?.rejected
        || !(await bridge.confirmProjectAdoption(committedOpen.authority))?.ok) {
        return { error: committedOpen?.rejected?.message || 'native smoke could not adopt the reopened project authority' };
      }
      const open = {
        ...preparedOpen,
        ...committedOpen,
        document: committedOpen.document ?? preparedOpen.document,
      };
      stage('import');
      const imported = await bridge.importMediaFiles({
        scratchDirectoryPath: save.scratchDirectoryPath,
        claim: committedOpen.authority,
      });
      stage('paper-pdf');
      const pdf = await bridge.exportPaperPdf(${JSON.stringify(buildNativeSmokePaperPdfRequest())});
      stage('paper-images');
      const images = await bridge.exportPaperImages(${JSON.stringify(buildNativeSmokePaperImagesRequest())});
      stage('workspace-windows');
      const workspaceWindows = [];
      for (const workspace of ${JSON.stringify(NATIVE_SMOKE_WORKSPACES)}) {
        workspaceWindows.push(await bridge.openWorkspaceWindow(workspace));
      }
      stage('complete');

      return {
        save: {
          canceled: save.canceled,
          filePath: save.filePath,
          scratchDirectoryPath: save.scratchDirectoryPath,
          sourceItems: save.document?.sourceBin?.bins?.[0]?.items?.length ?? 0,
        },
        open: {
          canceled: open.canceled,
          filePath: open.filePath,
          scratchDirectoryPath: open.scratchDirectoryPath,
          name: open.document?.name,
          sourceItems: open.document?.sourceBin?.bins?.[0]?.items?.length ?? 0,
          imageLayerBitmapDataPrefix: (open.document?.imageEditor?.documents?.[0]?.layers?.[0]?.bitmapData ?? '').slice(0, 14),
        },
        imported: {
          canceled: imported.canceled,
          count: imported.items?.length ?? 0,
          error: imported.error,
          items: (imported.items ?? []).map((item) => ({
            id: item.id,
            label: item.label,
            assetUrl: item.assetUrl,
            nativeFilePath: item.nativeFilePath,
            scratchFileName: item.scratchFileName,
          })),
        },
        pdf,
        images,
        workspaceWindows,
        bodyHasRecovery: document.body.innerText.includes('Recovery Boundary'),
      };
    })()
  `;
}

export function assertNativeSmokeResult(result) {
  if (!result || typeof result !== 'object') {
    throw new Error('Native smoke did not return a result object.');
  }
  if (result.error) {
    throw new Error(String(result.error));
  }
  if (result.bodyHasRecovery) {
    throw new Error('Native renderer showed a recovery boundary.');
  }
  if (result.save?.canceled || !result.save?.filePath || result.save.sourceItems < 1) {
    throw new Error('Native .sloom save did not return a saved project with a source item.');
  }
  if (result.open?.canceled || !result.open?.filePath || result.open?.name !== 'Native Smoke' || result.open.sourceItems < 1) {
    throw new Error('Native .sloom open did not restore the saved smoke project.');
  }
  if (result.open?.imageLayerBitmapDataPrefix !== 'data:image/png') {
    throw new Error('Native .sloom round-trip dropped the Image layer pixel payload (bitmapData) — saved canvases would blank on reopen.');
  }
  if (result.imported?.error) {
    throw new Error(`Native media import failed: ${result.imported.error}`);
  }
  if (result.imported?.canceled || result.imported?.count < 1) {
    throw new Error('Native media import did not return an item.');
  }
  if (result.pdf?.canceled || !result.pdf?.filePath || result.pdf.bytes < 100) {
    throw new Error('Native Paper PDF export did not produce a usable PDF.');
  }
  if (result.pdf?.error) {
    throw new Error(`Native Paper PDF export failed: ${result.pdf.error}`);
  }
  if (result.images?.canceled || !Array.isArray(result.images.files) || result.images.files.length < 1 || result.images.files[0].bytes < 1) {
    throw new Error('Native Paper webcomic image export did not produce a page image.');
  }
  if (result.images?.error) {
    throw new Error(`Native Paper image export failed: ${result.images.error}`);
  }
  if (!Array.isArray(result.workspaceWindows) || result.workspaceWindows.length !== NATIVE_SMOKE_WORKSPACES.length) {
    throw new Error('Native workspace windows did not all report open results.');
  }
  const openedWorkspaces = new Set();
  for (const entry of result.workspaceWindows) {
    if (!entry?.ok || !NATIVE_SMOKE_WORKSPACES.includes(entry.workspace)) {
      throw new Error('Native workspace windows did not all open successfully.');
    }
    openedWorkspaces.add(entry.workspace);
  }
  for (const workspace of NATIVE_SMOKE_WORKSPACES) {
    if (!openedWorkspaces.has(workspace)) {
      throw new Error(`Native workspace windows did not include ${workspace}.`);
    }
  }
  return result;
}

export function assertNativeAssetProtocolSmokeResult(result) {
  if (!result || typeof result !== 'object') {
    throw new Error('Native asset protocol smoke did not return a result object.');
  }

  const registered = result.registered;
  if (result.registeredItem?.id !== 'smoke-image') {
    throw new Error(`Native asset protocol smoke did not use the reopened project source-library asset: ${JSON.stringify(result.registeredItem)}`);
  }
  if (!registered?.ok || registered.status !== 200 || !(registered.bytes > 0)) {
    throw new Error(`Registered native asset was not readable through the protocol: ${JSON.stringify(registered)}`);
  }

  assertForbiddenProtocolProbe(result.unregisteredScratch, 'Unregistered scratch native asset');
  if (!result.symlinkEscape?.skipped && (!result.symlinkItem?.apply?.ok || !result.symlinkItem?.hasItem)) {
    throw new Error(`Scratch symlink Source Library entry was not registered in the snapshot before probing: ${JSON.stringify(result.symlinkItem)}`);
  }
  assertForbiddenProtocolProbe(result.symlinkEscape, 'Scratch symlink escape native asset');

  return result;
}

export function assertNativePaperOsFileDropSmokeResult(result, {
  pageNumber = 1,
  requireRoundTrip = false,
} = {}) {
  if (!result || typeof result !== 'object') {
    throw new Error('Native Paper OS file-drop smoke did not return a result object.');
  }
  if (result.error) {
    throw new Error(String(result.error));
  }
  if (result.workspace !== 'paper') {
    throw new Error(`Native Paper OS file-drop smoke did not run in the Paper workspace: ${JSON.stringify(result)}`);
  }
  if (result.pageNumber !== pageNumber) {
    throw new Error(`Native Paper OS file-drop smoke did not target page ${pageNumber}: ${JSON.stringify(result)}`);
  }
  if (result.hasRecoveryBoundary) {
    throw new Error('Native Paper OS file-drop workspace showed a recovery boundary.');
  }
  if (!result.hasPage) {
    throw new Error(`Native Paper OS file-drop smoke did not render page ${pageNumber}: ${JSON.stringify(result)}`);
  }
  if (!result.hasEnvelope || !result.snapshotHasEnvelope) {
    throw new Error(`Native Paper OS file-drop smoke did not create a Page ${pageNumber} imports envelope: ${JSON.stringify(result)}`);
  }
  if (!result.hasItemName || !result.hasMime || !result.snapshotHasItem) {
    throw new Error(`Native Paper OS file-drop smoke did not import the PNG source-library item: ${JSON.stringify(result)}`);
  }
  if (!result.hasLinkedFrame) {
    throw new Error(`Native Paper OS file-drop smoke did not place a linked image frame on page ${pageNumber}: ${JSON.stringify(result)}`);
  }
  if (!result.status) {
    throw new Error(`Native Paper OS file-drop smoke did not show the import completion status: ${JSON.stringify(result)}`);
  }
  if (requireRoundTrip) {
    if (result.roundTripError) {
      throw new Error(`Native Paper OS file-drop reopened project check failed: ${result.roundTripError}`);
    }
    if (!result.roundTripHasEnvelope || !result.roundTripHasItem || !result.roundTripHasPage || !result.roundTripHasLinkedFrame) {
      throw new Error(`Native Paper OS file-drop reopened project did not preserve the page ${pageNumber} imported source item and linked frame: ${JSON.stringify(result)}`);
    }
  }
  return result;
}

export function assertNativePaperOsFileDropWorkspacePropagationResult(result) {
  if (!result || typeof result !== 'object') {
    throw new Error('Native Paper OS file-drop Source Library propagation did not return a result object.');
  }
  if (result.error) {
    throw new Error(String(result.error));
  }

  const workspaces = Array.isArray(result.workspaces) ? result.workspaces : [];
  const expectedWorkspaces = new Set(NATIVE_SMOKE_WORKSPACES);
  const seenWorkspaces = new Set();

  for (const entry of workspaces) {
    const workspace = entry?.workspace;
    const app = entry?.app || workspace || 'unknown workspace';
    if (!expectedWorkspaces.has(workspace)) {
      throw new Error(`Native Paper OS file-drop Source Library propagation returned an unexpected workspace: ${JSON.stringify(entry)}`);
    }
    seenWorkspaces.add(workspace);

    if (entry.hasRecoveryBoundary) {
      throw new Error(`Native ${app} workspace showed a recovery boundary while checking Page imports propagation.`);
    }
    if (!entry.hasEnvelopeVisible || !entry.hasItemNameVisible) {
      throw new Error(`Native ${app} Source Library did not visibly show ${result.expectedEnvelope} / ${result.fileName}: ${JSON.stringify(entry)}`);
    }
    if (!entry.rendererStateHasItem && !entry.rendererPersistedHasItem) {
      throw new Error(`Native ${app} renderer Source Library state did not include the Paper OS-dropped item: ${JSON.stringify(entry)}`);
    }
    if (!entry.rendererPersistedHasEnvelope || !entry.rendererPersistedHasItem) {
      throw new Error(`Native ${app} renderer persistence did not preserve ${result.expectedEnvelope}: ${JSON.stringify(entry)}`);
    }
    if (!entry.nativeSnapshotHasEnvelope || !entry.nativeSnapshotHasItem) {
      throw new Error(`Native ${app} authoritative Source Library snapshot did not preserve ${result.expectedEnvelope}: ${JSON.stringify(entry)}`);
    }
  }

  for (const workspace of expectedWorkspaces) {
    if (!seenWorkspaces.has(workspace)) {
      throw new Error(`Native Paper OS file-drop Source Library propagation did not inspect ${workspace}.`);
    }
  }

  return result;
}

export function assertNativeProjectImportWorkspacePropagationResult(result) {
  if (!result || typeof result !== 'object') {
    throw new Error('Native project Source Library import propagation did not return a result object.');
  }
  if (result.error) {
    throw new Error(String(result.error));
  }

  const flowImport = result.flowImport;
  if (!flowImport || typeof flowImport !== 'object') {
    throw new Error('Native project Source Library import did not return the initial Flow import state.');
  }
  if (flowImport.hasRecoveryBoundary) {
    throw new Error('Native Flow workspace showed a recovery boundary after importing into the Source Library.');
  }
  if (!flowImport.hasEnvelopeVisible || !flowImport.hasItemNameVisible) {
    throw new Error(`Native Flow Source Library did not visibly show ${result.expectedEnvelope} / ${result.fileName}: ${JSON.stringify(flowImport)}`);
  }
  if (!flowImport.rendererPersistedHasEnvelope || !flowImport.rendererPersistedHasItem) {
    throw new Error(`Native Flow renderer persistence did not preserve ${result.expectedEnvelope}: ${JSON.stringify(flowImport)}`);
  }
  if (!flowImport.nativeSnapshotHasEnvelope || !flowImport.nativeSnapshotHasItem || !flowImport.nativeSnapshotHasAssetUrl) {
    throw new Error(`Native authoritative Source Library snapshot did not preserve the imported project asset: ${JSON.stringify(flowImport)}`);
  }
  if (flowImport.roundTripExpected) {
    if (flowImport.roundTripError) {
      throw new Error(`Native project Source Library import reopened project check failed: ${flowImport.roundTripError}`);
    }
    if (!flowImport.roundTripHasEnvelope || !flowImport.roundTripHasItem || !flowImport.roundTripHasAssetUrl) {
      throw new Error(`Native project Source Library import did not persist through save/open: ${JSON.stringify(flowImport)}`);
    }
  }

  const workspaces = Array.isArray(result.workspaces) ? result.workspaces : [];
  const expectedWorkspaces = new Set(NATIVE_SMOKE_WORKSPACES);
  const seenWorkspaces = new Set();

  for (const entry of workspaces) {
    const workspace = entry?.workspace;
    const app = entry?.app || workspace || 'unknown workspace';
    if (!expectedWorkspaces.has(workspace)) {
      throw new Error(`Native project Source Library import propagation returned an unexpected workspace: ${JSON.stringify(entry)}`);
    }
    seenWorkspaces.add(workspace);

    if (entry.hasRecoveryBoundary) {
      throw new Error(`Native ${app} workspace showed a recovery boundary while checking Project imports propagation.`);
    }
    if (!entry.hasEnvelopeVisible || !entry.hasItemNameVisible) {
      throw new Error(`Native ${app} Source Library did not visibly show ${result.expectedEnvelope} / ${result.fileName}: ${JSON.stringify(entry)}`);
    }
    if (!entry.rendererStateHasItem && !entry.rendererPersistedHasItem) {
      throw new Error(`Native ${app} renderer Source Library state did not include the imported project asset: ${JSON.stringify(entry)}`);
    }
    if (!entry.rendererPersistedHasEnvelope || !entry.rendererPersistedHasItem) {
      throw new Error(`Native ${app} renderer persistence did not preserve ${result.expectedEnvelope}: ${JSON.stringify(entry)}`);
    }
    if (!entry.nativeSnapshotHasEnvelope || !entry.nativeSnapshotHasItem || !entry.nativeSnapshotHasAssetUrl) {
      throw new Error(`Native ${app} authoritative Source Library snapshot did not preserve the imported project asset: ${JSON.stringify(entry)}`);
    }
  }

  for (const workspace of expectedWorkspaces) {
    if (!seenWorkspaces.has(workspace)) {
      throw new Error(`Native project Source Library import propagation did not inspect ${workspace}.`);
    }
  }

  return result;
}

export function assertNativeVideoRenderSmokeResult(result) {
  if (!result || typeof result !== 'object') {
    throw new Error('Native video render smoke did not return a result object.');
  }
  if (result.error) {
    throw new Error(String(result.error));
  }
  if (result.workspace?.hasRecoveryBoundary) {
    throw new Error('Native video render workspace showed a recovery boundary.');
  }
  if (!result.workspace?.renderButtonFound || !result.workspace?.clickedRender) {
    throw new Error(`Native video render smoke did not operate the Render control: ${JSON.stringify(result.workspace)}`);
  }
  if (!result.render?.previewVideoPresent) {
    throw new Error('Native video render smoke did not show a rendered preview video.');
  }
  if (result.render?.mimeType && result.render.mimeType !== 'video/mp4') {
    throw new Error(`Native video render smoke returned the wrong MIME type: ${result.render.mimeType}`);
  }
  if (!(result.render?.bytes >= 1000) || !(result.files?.outputVideo?.bytes >= 1000)) {
    throw new Error('Native video render smoke did not produce a usable MP4 artifact.');
  }
  const signature = String(result.render?.fileSignature || result.files?.outputVideo?.fileSignature || '');
  if (!signature.includes('66747970')) {
    throw new Error(`Native video render smoke output did not contain an MP4 ftyp signature: ${signature}`);
  }

  return result;
}

function assertForbiddenProtocolProbe(probe, label) {
  if (probe?.skipped) {
    return;
  }
  if (!probe || probe.ok || probe.status !== 403) {
    throw new Error(`${label} was not rejected with 403: ${JSON.stringify(probe)}`);
  }
}

function buildSoakMetricBudgetObservation({ key, label, limit, unit, worst }) {
  if (!Number.isFinite(limit)) {
    return undefined;
  }
  const observed = Number.isFinite(worst?.observed) ? worst.observed : 0;
  return {
    key,
    label,
    status: observed <= limit ? 'passed' : 'failed',
    observed,
    limit,
    unit,
    cycle: worst?.cycle,
    workspace: worst?.workspace,
  };
}

function formatBudgetFailure(failure) {
  const label = failure?.label || failure?.key || 'Budget';
  const observed = formatBudgetFailureValue(failure?.observed, failure?.unit);
  const limit = formatBudgetFailureValue(failure?.limit, failure?.unit);
  const locationParts = [
    failure?.workspace,
    Number.isFinite(Number(failure?.cycle)) ? `cycle ${failure.cycle}` : '',
  ].filter(Boolean);
  const location = locationParts.length > 0 ? ` on ${locationParts.join(' ')}` : '';

  return `${label} ${observed} > ${limit}${location}`;
}

function formatBudgetFailureValue(value, unit) {
  const observed = Number(value);
  const formatted = Number.isFinite(observed)
    ? unit === 'mb'
      ? observed.toFixed(1)
      : String(observed)
    : 'n/a';
  if (unit === 'bytes') return `${formatted} bytes`;
  if (unit === 'mb') return `${formatted} MB`;
  if (unit === 'ms') return `${formatted} ms`;
  return formatted;
}

function findWorstWorkspaceMetric(soak, metricName, transform = (value) => value) {
  const samples = Array.isArray(soak?.samples) ? soak.samples : [];
  let worst = { observed: 0 };

  for (const sample of samples) {
    const metricsByWorkspace = sample?.metrics && typeof sample.metrics === 'object' ? sample.metrics : {};
    for (const [workspace, metrics] of Object.entries(metricsByWorkspace)) {
      const rawObserved = Number(metrics?.[metricName]);
      if (!Number.isFinite(rawObserved)) {
        continue;
      }

      const observed = Number(transform(rawObserved));
      if (!Number.isFinite(observed) || observed <= worst.observed) {
        continue;
      }
      worst = {
        observed,
        cycle: sample.cycle,
        workspace,
      };
    }
  }

  return worst;
}

function findWorstWorkspaceSwitchDuration(soak) {
  const samples = Array.isArray(soak?.samples) ? soak.samples : [];
  let worst = { observed: 0 };

  for (const sample of samples) {
    const focusEntries = Array.isArray(sample?.focus) ? sample.focus : [];
    for (const entry of focusEntries) {
      const observed = Number(entry?.switchDurationMs);
      if (!Number.isFinite(observed) || observed <= worst.observed) {
        continue;
      }
      worst = {
        observed,
        cycle: sample.cycle,
        workspace: entry?.workspace,
      };
    }
  }

  return worst;
}

function roundToTenths(value) {
  return Math.round(Number(value) * 10) / 10;
}

function findWorstCycleDuration(soak) {
  const samples = Array.isArray(soak?.samples) ? soak.samples : [];
  let worst = { observed: 0 };

  for (const sample of samples) {
    const observed = Number(sample?.elapsedMs);
    if (!Number.isFinite(observed) || observed <= worst.observed) {
      continue;
    }
    worst = {
      observed,
      cycle: sample.cycle,
    };
  }

  return worst;
}

function getOptionValue(argv, name) {
  const prefix = `${name}=`;
  const match = argv.find((entry) => typeof entry === 'string' && entry.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be zero or a positive integer.`);
  }
  return parsed;
}

function parseOptionalPositiveInteger({ argv, argName, envValue, label }) {
  const argValue = getOptionValue(argv, argName);
  if (argValue !== undefined) {
    return parsePositiveInteger(argValue, label);
  }
  if (envValue !== undefined && envValue !== '') {
    return parsePositiveInteger(envValue, label);
  }
  return undefined;
}

function parseOptionalPositiveNumber({ argv, argName, envValue, label }) {
  const argValue = getOptionValue(argv, argName);
  if (argValue !== undefined) {
    return parsePositiveNumber(argValue, label);
  }
  if (envValue !== undefined && envValue !== '') {
    return parsePositiveNumber(envValue, label);
  }
  return undefined;
}

function parsePositiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return parsed;
}

function normalizePositiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

function normalizeStressCycle(cycle) {
  if (!Number.isInteger(cycle) || cycle < 1) {
    throw new Error('Native stress cycle must be a positive integer.');
  }
  return cycle;
}

function sanitizeSmokePathPart(value, fallback) {
  return (value ?? '')
    .trim()
    .replace(/[/\\?%*:|"<>]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    || fallback;
}
