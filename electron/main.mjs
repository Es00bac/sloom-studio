import { app, BrowserWindow, Menu, clipboard, crashReporter, dialog, ipcMain, net, protocol, safeStorage, shell } from 'electron';
import { execFile, spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { copyFile, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { unzipSync } from 'fflate';
import menuModule from './menu.cjs';
import paperPdfExportModule from './paper-pdf-export.cjs';
import paperImageExportModule from './paper-image-export.cjs';
import projectFileModule from './project-files.cjs';
import projectAuthorityModule from './project-authority.cjs';
import mediaFormatRegistryModule from './media-format-registry.cjs';
import startupProjectModule from './startup-project.cjs';
import vertexAuthModule from './vertex-auth.cjs';
import windowOptionsModule from './window-options.cjs';
import automationPathModule from './automation-paths.cjs';
import externalOpenModule from './external-open.cjs';
import linuxWindowingModule from './linux-windowing.cjs';
import globalMenuControllerModule from './globalMenu/globalMenuController.cjs';
import x11WindowIdModule from './globalMenu/x11WindowId.cjs';
import panelMenuServiceModule from './globalMenu/panelMenuService.cjs';
import bundledFontLibraryModule from './bundled-font-library.cjs';
import interfaceLocaleAuthorityModule from './interface-locale-authority.cjs';
import versionDisplayModule from './version-display.cjs';
import nativeCliAgentModule from './native-cli-agent.cjs';
import remotePhoneHostModule from './remote-phone-host.cjs';
import haneQrPairingModule from './hane-qr-pairing.cjs';
import crashReportsModule from './crashReports.cjs';
import videoMediaManagementModule from './video-media-management.cjs';

const { createApplicationMenuTemplate, SIGNAL_LOOM_MENU_COMMANDS } = menuModule;
const { formatInternalBuildVersion } = versionDisplayModule;
const {
  REMOTE_PHONE_PROXY_ORIGIN,
  buildRemotePhoneHostTarget,
  filterRemotePhoneRequestHeaders,
  normalizeRemotePhoneHostBaseUrl,
  normalizeRemotePhoneMethod,
} = remotePhoneHostModule;
const { startHaneQrPairingServer } = haneQrPairingModule;
const {
  createCrashReportController,
  createCrashReportFileStore,
} = crashReportsModule;
const {
  MAX_CONSOLIDATION_ENTRIES,
  buildConsolidationPostCommitError,
  createMediaConsolidationTransaction,
  inspectRelinkCandidate,
} = videoMediaManagementModule;
const {
  buildPaperPdfDefaultPath,
  buildPaperPdfPrintOptions,
  buildPaperPdfRenderReadyScript,
  ensurePdfExtension,
  sanitizePdfFileName,
} = paperPdfExportModule;
const {
  buildPaperImageDefaultDirectoryPath,
  ensurePaperImageExportDirectory,
  imageBufferFromDataUrl,
  sanitizePaperImagePathPart,
} = paperImageExportModule;
const {
  CURRENT_PROJECT_SCHEMA_VERSION,
  SIGNAL_LOOM_PROJECT_EXTENSION,
  attachNativeScratchAssetsToProjectDocument,
  buildDataUrlAssetSignatureCandidates,
  buildNativeAssetUrl,
  buildNativeScratchFileName,
  buildProjectOverwriteBackupPath,
  buildProjectScratchDirectoryCandidates,
  collectNativeAssetCapabilitiesFromSourceBin,
  collectSourceBinItems,
  createNativeAssetCapabilityRegistry,
  ensureSignalLoomProjectExtension,
  extractRecoverableMediaSignatureFromSourceKey,
  getLinkedNativeSourcePath,
  getProjectSaveDialogDefaultPath,
  isSignalLoomProjectBackupPath,
  mapSourceBinItemsAsync,
  parseNativeAssetUrl,
  parseProjectDocumentJson,
  removeTransientRecoveredScratchAssetsFromSourceBin,
  resolveScratchAssetNativePath,
  sanitizeFileName,
  shouldWriteProjectSaveDirectly,
} = projectFileModule;
const { createProjectAuthority, normalizeProjectSavePayload } = projectAuthorityModule;
const { getElectronDialogFilterGroups, inferMimeTypeFromFile, inferSourceKindFromFile } = mediaFormatRegistryModule;
const {
  buildStartupProjectRecovery,
  buildStartupProjectStatePath,
  discoverStartupProjectBackups,
  parseStartupProjectReopenPreference,
  parseStartupProjectState,
  prepareRememberedStartupProject,
  resolveStartupProjectPath,
  serializeStartupProjectState,
} = startupProjectModule;
const {
  buildVertexAccessTokenCommand,
  buildVertexLoginCommand,
  buildVertexAuthEnvironment,
  parseVertexEnvironmentVariables,
  getVertexAccessTokenFromAdc,
} = vertexAuthModule;
const {
  buildWorkspaceWindowOpenResult,
  focusFloatingPanelChildWindow,
  isAllowedWorkspaceNavigation,
  isSignalLoomFloatingPanelWindow,
} = windowOptionsModule;
const {
  getAutomationImportMediaPaths,
  getAutomationPaperImageDirectory,
  getAutomationPaperPdfPath,
  getAutomationProjectOpenPath,
  getAutomationProjectSavePath,
} = automationPathModule;
const {
  EXTERNAL_OPEN_DEEP_LINK_SCHEME,
  buildSecondInstanceOpenPayload,
  canonicalizeExternalOpenFilePath,
  createExternalOpenDeliveryId,
  createExternalOpenQueue,
  parseSecondInstanceOpenPayload,
} = externalOpenModule;
const {
  applyElectronMainLinuxWindowingCompatibility,
  applyLinuxGpuCommandLine,
  resolveLinuxGpuPolicy,
} = linuxWindowingModule;
const { createGlobalMenuController } = globalMenuControllerModule;
const { resolveX11WindowId } = x11WindowIdModule;
const { createPanelMenuService } = panelMenuServiceModule;
const { resolveBundledFontLibraryRoot, resolveBundledFontResourcePath } = bundledFontLibraryModule;
const { createInterfaceLocaleAuthority } = interfaceLocaleAuthorityModule;
const {
  NativeCliAgentError,
  executeNativeCliAgent,
  publicNativeCliAgentCapabilities,
  validateNativeCliAgentRequest,
} = nativeCliAgentModule;

const __dirname = dirname(fileURLToPath(import.meta.url));
const APP_ROOT = resolve(__dirname, '..');
const PRODUCTION_RENDERER_URL = pathToFileURL(resolve(__dirname, '../dist/index.html')).toString();
const SIGNAL_LOOM_SPLASH_IMAGE_PATH = resolve(__dirname, 'assets', 'signal-loom-splash.png');
const flowImportWorkerUrl = new URL('./flow-import-worker.mjs', import.meta.url);
const rendererUrl = process.env.ELECTRON_RENDERER_URL;
const isDev = Boolean(rendererUrl);
const DEV_RENDERER_READY_RETRY_COUNT = 12;
const DEV_RENDERER_READY_RETRY_DELAY_MS = 250;
const DEV_RENDERER_READY_TIMEOUT_ERROR = 'Renderer URL is unavailable.';
const BUNDLED_FONT_LIBRARY_STATUS_CHANNEL = 'signal-loom:font-library-status';
const appName = 'Sloom Studio';
const execFileAsync = promisify(execFile);
let mainWindow = null;
let splashWindow = null;
const workspaceWindows = new Map();
const remoteMediaDownloadControllers = new Map();
const providerPackRequestControllers = new Map();
const vertexGenerationControllers = new Map();
const nativeCliAgentControllers = new Map();
const MAX_CONCURRENT_NATIVE_CLI_AGENTS = 2;
// Session-scoped consent for the live layout agent: one explicit approval covers sequential turn
// requests from the same window+agent for 30 minutes. Other purposes always prompt per run.
const liveLayoutAgentSessionConsents = new Map();
const LIVE_LAYOUT_AGENT_SESSION_CONSENT_TTL_MS = 30 * 60 * 1000;
let applicationMenu = null;
let currentProjectPath = undefined;
let currentScratchDirectoryPath = undefined;
let currentAssetCapabilityRootPaths = [];
let remotePhoneHostBaseUrl;
// Native phone bearer credentials never cross the context-isolation boundary. They are deliberately
// memory-only: disconnect/relaunch requires the phone's pairing code again.
let remotePhoneHostToken;
// Every configuration owns a monotonic generation. Renderer requests carry this value through the
// private custom protocol (it is stripped before forwarding), so a delayed response from phone A can
// neither clear phone B's token nor tear down a newer connection.
let remotePhoneHostGeneration = 0;
let remotePhoneHostVerifiedGeneration;
// Configuration provides a restricted transport for both complete Sloom phone workspaces and
// additive Hane providers. Only an explicit authority activation may suspend local project I/O.
let remotePhoneHostAuthorityActive = false;
// Remains true after disconnect until a local New/Open commits. It distinguishes a merely activated,
// never-seeded link (safe to release) from renderer stores that actually contain phone-owned state.
let remotePhoneHostStateSeeded = false;
// Once phone state has replaced the renderer stores, a disconnect must not let File > Save write
// those stores over the previously-open local project. A committed New/Open clears this suspension.
let remotePhoneHostLocalSaveSuspended = false;
// Camera-first Hane pairing is a short-lived LAN invitation, independent of renderer lifetime.
// Its callback receives the bearer in main so Electron never exposes that credential to web code.
let haneQrPairingSession;
let startupProject = undefined;
let startupProjectRecovery = undefined;
// Reopening is opt-in. Keep the last path separately so a blank startup can still offer the
// preference without binding this window to that project's authority or source state.
let rememberedProjectPath = undefined;
let reopenLastProjectOnStartup = false;
// Set once by installProtocolHandlers() from the same resolveBundledFontLibraryRoot() call that
// decides whether signal-loom-font:// can actually serve a face (FBL-025). undefined means no
// audited font-library root was found, so every signal-loom-font request will 404.
let resolvedBundledFontLibraryRoot;
const rendererAuthorityEpochs = new Map();
let activeWorkspace = 'flow';
let keyboardShortcuts = {};
// Lazily-created KDE Plasma global-menu controller (opt-in; null when unsupported/disabled). It
// exports each workspace window's menu over DBus, fully decoupled from the GPU/render process.
let globalMenuController = null;
// Lazily-created native-Wayland KDE panel-menu service (opt-in via SIGNAL_LOOM_ELECTRON_PANEL_MENU=1;
// null when unsupported). Unlike the global-menu controller it needs no X11 window id, so it does NOT
// force XWayland — the app keeps its native-Wayland GPU surface while the menu shows in the panel.
let panelMenuService = null;
// Electron owns the one application-wide interface preference. Renderers seed/update it through a
// revision-checked protocol and all adopt its broadcast; window focus/close never transfers it.
const interfaceLocaleAuthority = createInterfaceLocaleAuthority({
  onChange: publishInterfaceLocaleChange,
});
let sourceLibraryVersion = 0;
let sourceLibrarySnapshot = createEmptySourceLibrarySnapshot();
const nativeAssetCapabilityRegistry = createNativeAssetCapabilityRegistry();
const nativeAssetCapabilityAssetIds = new Map();
const nativeAssetCapabilityRealPaths = new Map();
let activeRendererEntryUrl = rendererUrl ?? PRODUCTION_RENDERER_URL;

const WORKSPACE_VIEWS = ['flow', 'editor', 'image', 'paper'];
const WORKSPACE_LABELS = {
  flow: 'Flow',
  editor: 'Video',
  image: 'Image',
  paper: 'Paper',
};

const VIEW_COMMAND_WORKSPACES = {
  [SIGNAL_LOOM_MENU_COMMANDS.viewFlow]: 'flow',
  [SIGNAL_LOOM_MENU_COMMANDS.viewEditor]: 'editor',
  [SIGNAL_LOOM_MENU_COMMANDS.viewImage]: 'image',
  [SIGNAL_LOOM_MENU_COMMANDS.viewPaper]: 'paper',
};

applyElectronMainLinuxWindowingCompatibility(app, process.env, process.platform);

app.setName(appName);
const isolatedUserDataDir = process.env.SIGNAL_LOOM_ELECTRON_USER_DATA_DIR?.trim();
if (isolatedUserDataDir) {
  app.setPath('userData', resolve(isolatedUserDataDir));
}

// The single-instance lock keys on the resolved userData directory, so it is acquired
// immediately after the userData override and before ANY shared side effect (the GPU
// fallback sentinel, privileged protocol schemes, fixed-port services, windows). A losing
// instance quits untouched; its file arguments reach the winner through Electron's native argv
// relay. Only a small bounded identity token crosses additionalData (never argv/file bytes), so
// repeated delivery of one native callback retains the loser's identity without exercising the
// oversized Electron 41 payload path that previously stranded a loser.
const externalOpenLaunchDeliveryId = createExternalOpenDeliveryId();
const externalOpenLaunchPayload = buildSecondInstanceOpenPayload([], '', externalOpenLaunchDeliveryId);
const hasSingleInstanceLock = app.requestSingleInstanceLock(externalOpenLaunchPayload);

function getRendererEntryUrl() {
  return activeRendererEntryUrl;
}

function isWorkspaceView(value) {
  return typeof value === 'string' && WORKSPACE_VIEWS.includes(value);
}

function buildWorkspaceRendererUrl(workspace) {
  const url = new URL(getRendererEntryUrl());
  url.searchParams.set('workspace', workspace);
  return url.toString();
}

function getWorkspaceWindowTitle(workspace) {
  return `${appName} - ${WORKSPACE_LABELS[workspace] ?? 'Workspace'}`;
}

function canFallbackToProductionRenderer() {
  if (!isDev || !hasDevRendererUrl(activeRendererEntryUrl) || !isProductionRendererReady()) {
    return false;
  }

  return activeRendererEntryUrl !== PRODUCTION_RENDERER_URL;
}

function getWorkspaceForWindow(window) {
  for (const [workspace, workspaceWindow] of workspaceWindows.entries()) {
    if (workspaceWindow === window) {
      return workspace;
    }
  }
  return undefined;
}

function sleepMs(durationMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, durationMs);
  });
}

function hasDevRendererUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  } catch {
    return false;
  }
}

function isProductionRendererReady() {
  try {
    return existsSync(resolve(__dirname, '../dist/index.html'));
  } catch {
    return false;
  }
}

function buildStartupSplashHtml() {
  // Embed the artwork as a data URI. The splash page itself is a data: URL document, and in
  // the packaged app the PNG lives inside app.asar — a file:// <img> from a data: origin is
  // blocked there (blank 560x560 box), while main-process readFileSync reads through asar.
  let imageUrl;
  try {
    imageUrl = `data:image/png;base64,${readFileSync(SIGNAL_LOOM_SPLASH_IMAGE_PATH).toString('base64')}`;
  } catch {
    imageUrl = pathToFileURL(SIGNAL_LOOM_SPLASH_IMAGE_PATH).href;
  }

  // The free-software splash artwork carries its own wordmark and licence line, so the page is
  // just the image on the paper background. Kept in sync with public/signal-loom-splash.png.

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src file: data:; style-src 'unsafe-inline';" />
    <title>Sloom Studio is starting</title>
    <style>
      html,
      body {
        width: 100%;
        height: 100%;
        margin: 0;
        overflow: hidden;
        background: #f3eee4;
      }

      body {
        position: relative;
        display: grid;
        place-items: center;
        font-family: system-ui, -apple-system, 'Noto Sans JP', 'Noto Sans CJK JP', 'Hiragino Kaku Gothic ProN', 'Yu Gothic', sans-serif;
      }

      img {
        display: block;
        width: 100%;
        height: 100%;
        object-fit: contain;
        user-select: none;
        -webkit-user-drag: none;
      }

    </style>
  </head>
  <body>
    <img src="${imageUrl}" alt="Sloom Studio is starting" />
  </body>
</html>`;
}

function createStartupSplashWindow() {
  if (splashWindow && !splashWindow.isDestroyed()) {
    return splashWindow;
  }

  if (!existsSync(SIGNAL_LOOM_SPLASH_IMAGE_PATH)) {
    return undefined;
  }

  splashWindow = new BrowserWindow({
    width: 560,
    height: 560,
    minWidth: 560,
    minHeight: 560,
    maxWidth: 560,
    maxHeight: 560,
    useContentSize: true,
    title: 'Sloom Studio is starting',
    backgroundColor: '#f3eee4',
    frame: false,
    resizable: false,
    movable: true,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  splashWindow.setMenuBarVisibility(false);
  splashWindow.on('closed', () => {
    splashWindow = null;
  });

  // Serve the splash page from a real temp file: the embedded ~1.8MB data-URI artwork would
  // put a data:text/html loadURL within a hair of Chromium's 2MB URL cap.
  try {
    const splashHtmlPath = join(app.getPath('temp'), 'signal-loom-splash.html');
    writeFileSync(splashHtmlPath, buildStartupSplashHtml());
    void splashWindow.loadFile(splashHtmlPath);
  } catch {
    void splashWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(buildStartupSplashHtml())}`);
  }

  return splashWindow;
}

function closeStartupSplashWindow() {
  if (!splashWindow || splashWindow.isDestroyed()) {
    splashWindow = null;
    return;
  }

  const window = splashWindow;
  splashWindow = null;
  window.destroy();
}

async function canLoadRendererUrl(url) {
  return new Promise((resolve) => {
    const request = net.request({
      method: 'GET',
      url,
      redirect: 'follow',
    });

    let handled = false;
    const finish = (value) => {
      if (handled) return;
      handled = true;
      resolve(value);
    };

    const timer = setTimeout(() => {
      request.abort();
      finish(false);
    }, 800);

    request.on('response', (response) => {
      clearTimeout(timer);
      response.resume();
      response.on('end', () => {
        finish(response.statusCode === 200);
      });
      response.on('error', () => {
        finish(false);
      });
    });
    request.on('error', () => {
      clearTimeout(timer);
      finish(false);
    });
    request.end();
  });
}

async function resolveRendererEntryUrl() {
  if (!isDev) {
    return;
  }

  const attempts = Array.from({ length: DEV_RENDERER_READY_RETRY_COUNT }, (_, index) => index + 1);

  for (const attempt of attempts) {
    const isReachable = await canLoadRendererUrl(rendererUrl);
    if (isReachable) {
      activeRendererEntryUrl = rendererUrl;
      return;
    }

    if (isProductionRendererReady()) {
      console.warn(
        `Dev renderer is unavailable (attempt ${attempt}/${attempts.length}); falling back to packaged dist renderer for startup.`,
      );
      activeRendererEntryUrl = PRODUCTION_RENDERER_URL;
      return;
    }

    await sleepMs(DEV_RENDERER_READY_RETRY_DELAY_MS);
  }

  throw new Error(`${DEV_RENDERER_READY_TIMEOUT_ERROR} ${rendererUrl} (no local dist fallback available).`);
}

function getIpcWindow(event) {
  return BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? mainWindow ?? undefined;
}

function broadcastProjectPathChanged() {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      try { window.webContents.send('signal-loom:project-path-changed', currentProjectPath); } catch {}
    }
  }
}

function broadcastProjectAuthorityChanged(event) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      try { window.webContents.send('signal-loom:project-authority-changed', event); } catch {}
    }
  }
  // Legacy display listeners keep receiving the bare path alongside the versioned event.
  broadcastProjectPathChanged();
}

function broadcastInterfaceLocaleChanged(state) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      try { window.webContents.send('signal-loom:interface-locale-changed', state); } catch {}
    }
  }
}

function publishInterfaceLocaleChange(state, change) {
  // This is the only locale-driven menu rebuild path. Choosing the already-visible language still
  // broadcasts `localeChosen` so every first-run gate converges, but it does not rebuild identical
  // menu trees. Idempotent/stale requests never reach this callback at all.
  if (change?.localeChanged) {
    installApplicationMenu();
    globalMenuController?.refresh();
    panelMenuService?.refresh();
  }
  broadcastInterfaceLocaleChanged(state);
}

function getRendererAuthorityEpoch(webContentsId) {
  return rendererAuthorityEpochs.get(webContentsId) ?? 0;
}

function invalidateRendererAuthority(webContentsId) {
  rendererAuthorityEpochs.set(webContentsId, getRendererAuthorityEpoch(webContentsId) + 1);
  projectAuthority.invalidateRenderer(webContentsId);
}

function isLiveAuthoritySender(sender, rendererEpoch) {
  return Boolean(sender && !sender.isDestroyed() && getRendererAuthorityEpoch(sender.id) === rendererEpoch);
}

// Authoritative project identity/version arbitration (AUD-001): every open/save/clear commits
// through this gateway, and saves from renderers that never adopted the current identity and
// version are rejected before any disk IO.
const projectAuthority = createProjectAuthority({
  broadcast: broadcastProjectAuthorityChanged,
});

function commitStartupProjectAuthority() {
  return projectAuthority.commitStartup({
    filePath: currentProjectPath,
    scratchDirectoryPath: currentScratchDirectoryPath,
    document: startupProject?.document,
  });
}

// Every external open (initial argv, second-instance relaunch, macOS open-file/open-url)
// funnels through this validated transactional queue. Main retains document intents until the
// designated renderer epoch accepts/rejects and commits them.
const externalOpenQueue = createExternalOpenQueue({
  canonicalizeFile: canonicalizeExternalOpenFilePath,
  workspaceViews: WORKSPACE_VIEWS,
});
const preparedExternalOpenIntents = new Map();
const acceptedExternalProjectTransactions = new Map();
const completedExternalProjectCommits = new Map();
let externalOpenRendererAuthorization = undefined;
let externalOpenLifecycle = Promise.resolve();

function serializeExternalOpenLifecycle(operation) {
  const result = externalOpenLifecycle.then(operation, operation);
  externalOpenLifecycle = result.catch(() => undefined);
  return result;
}

function externalOpenRendererId(webContents) {
  return String(webContents?.id ?? '');
}

function isDesignatedExternalOpenRenderer(webContents) {
  return Boolean(
    mainWindow
    && !mainWindow.isDestroyed()
    && mainWindow.webContents === webContents
    && !webContents.isDestroyed(),
  );
}

function isAuthorizedExternalOpenRequest(webContents, request) {
  return Boolean(
    isDesignatedExternalOpenRenderer(webContents)
    && externalOpenRendererAuthorization
    && externalOpenRendererAuthorization.rendererId === externalOpenRendererId(webContents)
    && request?.epoch === externalOpenRendererAuthorization.epoch,
  );
}

function revokeExternalOpenRenderer(webContents) {
  const rendererId = externalOpenRendererId(webContents);
  const authorization = externalOpenRendererAuthorization;
  if (!authorization || authorization.rendererId !== rendererId) return;
  void serializeExternalOpenLifecycle(async () => {
    if (externalOpenRendererAuthorization?.epoch !== authorization.epoch) return;
    const outcome = externalOpenQueue.revokeRenderer(authorization);
    for (const intentId of outcome.releasedIntentIds ?? []) {
      await releaseExternalOpenIntent(intentId);
    }
    externalOpenRendererAuthorization = undefined;
  });
}

function enqueueExternalOpenArgv(argv, workingDirectory, deliveryId) {
  const outcome = externalOpenQueue.enqueueArgv(argv, {
    cwd: workingDirectory,
    platform: process.platform,
    appPath: APP_ROOT,
    execPath: process.execPath,
    deliveryId,
  });
  for (const rejection of outcome.rejected) {
    console.warn(`Ignoring unsupported external open target (${rejection.reason}): ${rejection.value}`);
  }
  return outcome;
}

function enqueueExternalOpenValue(rawValue, deliveryId) {
  const outcome = externalOpenQueue.enqueueValue(rawValue, {
    cwd: process.cwd(),
    platform: process.platform,
    deliveryId,
  });
  if (outcome.status === 'rejected') {
    console.warn(`Ignoring unsupported external open target (${outcome.reason}): ${String(rawValue)}`);
  }
  return outcome;
}

function focusExternalOpenTargetWindow() {
  const target = (mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined)
    ?? BrowserWindow.getAllWindows().find((window) => !window.isDestroyed());
  if (!target) {
    return undefined;
  }
  if (target.isMinimized()) {
    target.restore();
  }
  target.show();
  target.focus();
  return target;
}

function dispatchPendingExternalOpenRequests() {
  // Pre-readiness requests stay queued: the boot sequence drains workspace targets after the
  // first window exists, and the renderer pulls document targets once it finishes mounting.
  if (!app.isReady()) {
    return;
  }

  for (const request of externalOpenQueue.takeWorkspaceRequests()) {
    createWorkspaceWindow(request.workspace);
  }

  if (externalOpenQueue.hasPending('project') || externalOpenQueue.hasPending('paper')) {
    const target = mainWindow && !mainWindow.isDestroyed() ? mainWindow : createWorkspaceWindow('flow');
    if (target?.isMinimized()) target.restore();
    target?.show();
    target?.focus();
    target?.webContents.send('signal-loom:external-open-pending');
  }
}

function createEmptySourceLibrarySnapshot() {
  return {
    bins: [{
      id: 'default',
      name: 'Source Library',
      collapsed: false,
      createdAt: Date.now(),
      items: [],
    }],
    dismissedSourceKeys: [],
  };
}

function clonePlain(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizeSourceLibrarySnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return createEmptySourceLibrarySnapshot();
  }

  const inputBins = Array.isArray(snapshot.bins) && snapshot.bins.length > 0
    ? snapshot.bins
    : Array.isArray(snapshot.items)
      ? [{ ...createEmptySourceLibrarySnapshot().bins[0], items: snapshot.items }]
      : [];
  const bins = inputBins.map((bin, index) => {
    const input = bin && typeof bin === 'object' ? bin : {};
    const items = Array.isArray(input.items)
      ? input.items
          .filter((item) => item && typeof item === 'object' && typeof item.id === 'string' && typeof item.kind === 'string')
          .map((item) => ({ ...clonePlain(item), createdAt: typeof item.createdAt === 'number' ? item.createdAt : Date.now() }))
      : [];

    return {
      id: typeof input.id === 'string' && input.id.trim() ? input.id : (index === 0 ? 'default' : `bin-${index}`),
      name: typeof input.name === 'string' && input.name.trim() ? input.name : (index === 0 ? 'Source Library' : 'Recovered Bin'),
      collapsed: Boolean(input.collapsed),
      createdAt: typeof input.createdAt === 'number' && Number.isFinite(input.createdAt) ? input.createdAt : Date.now(),
      items,
    };
  });

  return {
    bins: bins.length > 0 ? bins : createEmptySourceLibrarySnapshot().bins,
    dismissedSourceKeys: Array.isArray(snapshot.dismissedSourceKeys)
      ? snapshot.dismissedSourceKeys.filter((key) => typeof key === 'string')
      : [],
  };
}

function getSourceLibrarySnapshot() {
  return clonePlain(sourceLibrarySnapshot);
}

function findSourceLibraryItem(itemId, snapshot = sourceLibrarySnapshot) {
  if (typeof itemId !== 'string' || !itemId.trim()) return undefined;
  const normalized = normalizeSourceLibrarySnapshot(snapshot);
  for (const bin of normalized.bins) {
    const item = bin.items.find((candidate) => candidate.id === itemId.trim());
    if (item) return clonePlain(item);
  }
  return undefined;
}

function replaceSourceLibraryItems(items, snapshot = sourceLibrarySnapshot) {
  const updates = new Map(items.map((item) => [item.id, clonePlain(item)]));
  const normalized = normalizeSourceLibrarySnapshot(snapshot);
  const seen = new Set();
  const bins = normalized.bins.map((bin) => ({
    ...bin,
    items: bin.items.map((item) => {
      const update = updates.get(item.id);
      if (!update) return item;
      seen.add(item.id);
      return update;
    }),
  }));
  if (seen.size !== updates.size) throw new Error('One or more managed media items no longer exist in the Source Library.');
  return { ...normalized, bins };
}

function buildManagedMediaItem(item, { filePath, fingerprint, resetProxy }) {
  const {
    assetId: _assetId,
    scratchFileName: _scratchFileName,
    durability: _durability,
    durabilityMessage: _durabilityMessage,
    ...base
  } = item;
  const professional = item.professional && typeof item.professional === 'object' ? item.professional : {};
  return {
    ...base,
    assetUrl: buildNativeAssetUrl(filePath, item.id),
    nativeFilePath: filePath,
    professional: {
      ...professional,
      version: 1,
      origin: professional.origin === 'generated' ? 'generated' : 'imported',
      onlineState: 'online',
      sourceFingerprint: fingerprint,
      ...(resetProxy ? { proxy: { status: 'none' } } : {}),
    },
  };
}

function mediaKindMatchesRelink(itemKind, candidateKind) {
  if (itemKind === 'composition') return candidateKind === 'video';
  return itemKind === candidateKind;
}

function isProfessionalManagedMediaKind(kind) {
  return kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'composition';
}

async function resolveRegisteredNativeAssetPath(item) {
  const candidates = [
    nativeAssetCapabilityAssetIds.get(item?.id),
    typeof item?.assetId === 'string' ? nativeAssetCapabilityAssetIds.get(item.assetId) : undefined,
    item?.nativeFilePath,
  ].filter((filePath, index, paths) => (
    typeof filePath === 'string' && filePath.trim() && paths.indexOf(filePath) === index
  ));
  for (const filePath of candidates) {
    if (await isNativeAssetCapabilityRegistered(filePath)) return filePath;
  }
  return undefined;
}

async function isPathInsideDirectory(filePath, directoryPath) {
  if (typeof filePath !== 'string' || typeof directoryPath !== 'string' || !filePath || !directoryPath) {
    return false;
  }

  const [realFilePath, realDirectoryPath] = await Promise.all([
    realpath(filePath).catch(() => undefined),
    realpath(directoryPath).catch(() => undefined),
  ]);

  if (!realFilePath || !realDirectoryPath) {
    return false;
  }

  const relativePath = relative(realDirectoryPath, realFilePath);
  return relativePath === '' || Boolean(relativePath && !relativePath.startsWith('..') && !isAbsolute(relativePath));
}

async function registerNativeAssetCapability(filePath, { allowExternal = false, assetId } = {}) {
  const capabilityRootPaths = currentAssetCapabilityRootPaths.length > 0
    ? currentAssetCapabilityRootPaths
    : [currentScratchDirectoryPath];
  const isInsideCapabilityRoot = (
    await Promise.all(capabilityRootPaths.map((directoryPath) => isPathInsideDirectory(filePath, directoryPath)))
  ).some(Boolean);

  if (!allowExternal && !isInsideCapabilityRoot) {
    return undefined;
  }

  const realFilePath = await realpath(filePath).catch(() => undefined);
  if (!realFilePath) {
    return undefined;
  }

  const registeredPath = nativeAssetCapabilityRegistry.register(filePath);
  if (registeredPath) {
    nativeAssetCapabilityRealPaths.set(registeredPath, realFilePath);
    if (typeof assetId === 'string' && assetId.trim()) {
      nativeAssetCapabilityAssetIds.set(assetId.trim(), registeredPath);
    }
  }

  return registeredPath;
}

async function registerNativeAssetCapabilitiesFromSourceBin(sourceBin, { replace = false } = {}) {
  const prepared = await prepareNativeAssetCapabilitiesFromSourceBin(sourceBin);
  commitNativeAssetCapabilities(prepared, { replace });
}

async function prepareNativeAssetCapabilitiesFromSourceBin(sourceBin, options = {}) {
  const capabilityRootPaths = Array.isArray(options.capabilityRootPaths)
    ? [...options.capabilityRootPaths]
    : currentAssetCapabilityRootPaths.length > 0
      ? [...currentAssetCapabilityRootPaths]
      : [currentScratchDirectoryPath];
  const previouslyRegisteredPaths = new Set(nativeAssetCapabilityRegistry.list());
  const verifiedPendingPaths = new Set(
    Array.isArray(options.verifiedPendingPaths)
      ? options.verifiedPendingPaths
          .filter((filePath) => typeof filePath === 'string' && filePath.trim())
          .map((filePath) => resolve(filePath))
      : [],
  );
  const verifiedExternalPaths = new Set(
    Array.isArray(options.verifiedExternalPaths)
      ? options.verifiedExternalPaths
          .filter((filePath) => typeof filePath === 'string' && filePath.trim())
          .map((filePath) => resolve(filePath))
      : [],
  );
  const paths = [];
  const assetIds = [];
  const realPaths = [];

  for (const capability of collectNativeAssetCapabilitiesFromSourceBin(sourceBin)) {
    const normalizedPath = resolve(capability.filePath);
    const isInsideCapabilityRoot = (
      await Promise.all(capabilityRootPaths.map((directoryPath) => isPathInsideDirectory(capability.filePath, directoryPath)))
    ).some(Boolean);
    const isExactlyVerifiedExternal = verifiedExternalPaths.has(normalizedPath)
      || verifiedPendingPaths.has(normalizedPath);
    if (!options.allowExternal
        && !isInsideCapabilityRoot
        && !previouslyRegisteredPaths.has(normalizedPath)
        && !isExactlyVerifiedExternal) continue;
    const realFilePath = await realpath(capability.filePath).catch(() => (
      verifiedPendingPaths.has(normalizedPath) ? normalizedPath : undefined
    ));
    if (!realFilePath) continue;
    paths.push(normalizedPath);
    realPaths.push([normalizedPath, realFilePath]);
    if (typeof capability.assetId === 'string' && capability.assetId.trim()) {
      assetIds.push([capability.assetId.trim(), normalizedPath]);
    }
  }

  return { paths, assetIds, realPaths };
}

function commitNativeAssetCapabilities(prepared, { replace = true } = {}) {
  if (replace) {
    nativeAssetCapabilityRegistry.clear();
    nativeAssetCapabilityAssetIds.clear();
    nativeAssetCapabilityRealPaths.clear();
  }
  nativeAssetCapabilityRegistry.registerMany(prepared?.paths ?? []);
  for (const [assetId, filePath] of prepared?.assetIds ?? []) nativeAssetCapabilityAssetIds.set(assetId, filePath);
  for (const [filePath, realFilePath] of prepared?.realPaths ?? []) nativeAssetCapabilityRealPaths.set(filePath, realFilePath);
}

async function isNativeAssetCapabilityRegistered(filePath) {
  if (!nativeAssetCapabilityRegistry.has(filePath)) {
    return false;
  }

  const registeredPath = resolve(filePath);
  const registeredRealPath = nativeAssetCapabilityRealPaths.get(registeredPath);
  const currentRealPath = await realpath(filePath).catch(() => undefined);
  return Boolean(registeredRealPath && currentRealPath && registeredRealPath === currentRealPath);
}

function broadcastSourceLibraryChanged(change) {
  const event = {
    version: sourceLibraryVersion,
    change: clonePlain(change),
    authority: projectAuthority?.getCurrent?.(),
  };

  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      try { window.webContents.send('signal-loom:source-library-changed', event); } catch {}
    }
  }
}

function commitSourceLibrarySnapshot(snapshot, preparedCapabilities, { broadcast = false, change } = {}) {
  sourceLibrarySnapshot = normalizeSourceLibrarySnapshot(snapshot);
  commitNativeAssetCapabilities(preparedCapabilities, { replace: true });
  sourceLibraryVersion += 1;
  projectAuthority?.replaceCanonicalSourceSnapshot?.(getSourceLibrarySnapshot());

  if (broadcast) {
    broadcastSourceLibraryChanged(change ?? {
      type: 'source-library-snapshot',
      snapshot: getSourceLibrarySnapshot(),
    });
  }

  return sourceLibraryVersion;
}

async function setSourceLibrarySnapshot(snapshot, { broadcast = false } = {}) {
  const normalized = normalizeSourceLibrarySnapshot(snapshot);
  const preparedCapabilities = await prepareNativeAssetCapabilitiesFromSourceBin(normalized);
  return commitSourceLibrarySnapshot(normalized, preparedCapabilities, { broadcast });
}

async function resetSourceLibrarySnapshot({ broadcast = false } = {}) {
  return setSourceLibrarySnapshot(undefined, { broadcast });
}

async function syncSourceLibraryFromDocument(document, options) {
  return setSourceLibrarySnapshot(document?.sourceBin, options);
}

async function prepareSourceLibraryChange(change) {
  if (!change || typeof change !== 'object' || typeof change.type !== 'string') {
    throw new Error('Invalid Source Library change.');
  }

  if (change.type === 'source-library-snapshot') {
    const snapshot = normalizeSourceLibrarySnapshot(change.snapshot);
    return {
      changed: true,
      snapshot,
      change: { type: 'source-library-snapshot', snapshot },
      preparedCapabilities: await prepareNativeAssetCapabilitiesFromSourceBin(snapshot),
    };
  }

  if (change.type === 'source-bin-items-added') {
    const incomingItems = Array.isArray(change.items)
      ? change.items
          .filter((item) => item && typeof item === 'object' && typeof item.id === 'string' && typeof item.kind === 'string')
          .map((item) => clonePlain(item))
      : [];

    if (incomingItems.length === 0) {
      return { changed: false };
    }

    const normalizedSnapshot = normalizeSourceLibrarySnapshot(sourceLibrarySnapshot);
    const requestedTargetBinId = typeof change.targetBinId === 'string' && change.targetBinId.trim()
      ? change.targetBinId
      : normalizedSnapshot.bins[0]?.id ?? 'default';
    const targetBinExists = normalizedSnapshot.bins.some((bin) => bin.id === requestedTargetBinId);
    const targetBinId = targetBinExists ? requestedTargetBinId : normalizedSnapshot.bins[0]?.id ?? 'default';
    const incomingIds = new Set(incomingItems.map((item) => item.id));
    const nextBins = normalizedSnapshot.bins.map((bin, index) => {
      const withoutIncoming = bin.items.filter((item) => !incomingIds.has(item.id));
      if (bin.id === targetBinId || index === 0 && !normalizedSnapshot.bins.some((candidate) => candidate.id === targetBinId)) {
        return { ...bin, collapsed: false, items: [...incomingItems, ...withoutIncoming] };
      }

      return { ...bin, items: withoutIncoming };
    });

    if (!normalizedSnapshot.bins.some((candidate) => candidate.id === targetBinId) && nextBins.length === 0) {
      nextBins.push({
        id: targetBinId,
        name: 'Source Library',
        collapsed: false,
        createdAt: Date.now(),
        items: incomingItems,
      });
    }

    const snapshot = {
      ...normalizedSnapshot,
      bins: nextBins,
    };
    return {
      changed: true,
      snapshot,
      change: {
        type: 'source-bin-items-added',
        items: incomingItems,
        ...(targetBinId ? { targetBinId } : {}),
      },
      preparedCapabilities: await prepareNativeAssetCapabilitiesFromSourceBin(snapshot),
    };
  }

  if (change.type === 'source-bin-item-renamed') {
    const itemId = typeof change.itemId === 'string' ? change.itemId.trim() : '';
    const label = typeof change.label === 'string' ? change.label.trim() : '';

    if (!itemId || !label) {
      return { changed: false };
    }

    let didRename = false;
    const normalizedSnapshot = normalizeSourceLibrarySnapshot(sourceLibrarySnapshot);
    const snapshot = {
      ...normalizedSnapshot,
      bins: normalizedSnapshot.bins.map((bin) => ({
        ...bin,
        items: bin.items.map((item) => {
          if (item.id !== itemId || item.label === label) {
            return item;
          }

          didRename = true;
          return { ...item, label };
        }),
      })),
    };

    if (!didRename) {
      return { changed: false };
    }
    return {
      changed: true,
      snapshot,
      change: { type: 'source-bin-item-renamed', itemId, label },
      preparedCapabilities: await prepareNativeAssetCapabilitiesFromSourceBin(snapshot),
    };
  }

  if (change.type === 'source-bin-item-removed') {
    const itemId = typeof change.itemId === 'string' ? change.itemId.trim() : '';
    if (!itemId) {
      return { changed: false };
    }

    const normalizedSnapshot = normalizeSourceLibrarySnapshot(sourceLibrarySnapshot);
    let removedSourceKey = typeof change.sourceKey === 'string' ? change.sourceKey : undefined;
    let didRemove = false;
    const snapshot = {
      ...normalizedSnapshot,
      bins: normalizedSnapshot.bins.map((bin) => {
        const nextItems = bin.items.filter((item) => {
          if (item.id !== itemId) {
            return true;
          }

          didRemove = true;
          removedSourceKey ??= typeof item.sourceKey === 'string' ? item.sourceKey : undefined;
          return false;
        });
        return nextItems.length === bin.items.length ? bin : { ...bin, items: nextItems };
      }),
      dismissedSourceKeys: removedSourceKey && !normalizedSnapshot.dismissedSourceKeys.includes(removedSourceKey)
        ? [...normalizedSnapshot.dismissedSourceKeys, removedSourceKey]
        : normalizedSnapshot.dismissedSourceKeys,
    };

    if (!didRemove) {
      return { changed: false };
    }
    return {
      changed: true,
      snapshot,
      change: {
        type: 'source-bin-item-removed',
        itemId,
        ...(removedSourceKey ? { sourceKey: removedSourceKey } : {}),
      },
      preparedCapabilities: await prepareNativeAssetCapabilitiesFromSourceBin(snapshot),
    };
  }

  throw new Error('Unsupported Source Library change.');
}

function commitPreparedSourceLibraryChange(prepared) {
  if (!prepared?.changed) return { ok: true, version: sourceLibraryVersion };
  return {
    ok: true,
    version: commitSourceLibrarySnapshot(prepared.snapshot, prepared.preparedCapabilities, {
      broadcast: true,
      change: prepared.change,
    }),
  };
}

function getStartupProjectStatePath() {
  return buildStartupProjectStatePath(app.getPath('userData'));
}

async function rememberProjectPath(filePath) {
  if (isSignalLoomProjectBackupPath(filePath)) {
    await forgetRememberedProjectPath();
    return;
  }

  await mkdir(app.getPath('userData'), { recursive: true });
  rememberedProjectPath = filePath;
  await writeFile(
    getStartupProjectStatePath(),
    serializeStartupProjectState(filePath, reopenLastProjectOnStartup),
    'utf8',
  );
}

async function forgetRememberedProjectPath() {
  rememberedProjectPath = undefined;
  if (reopenLastProjectOnStartup) {
    await mkdir(app.getPath('userData'), { recursive: true });
    await writeFile(
      getStartupProjectStatePath(),
      serializeStartupProjectState(undefined, reopenLastProjectOnStartup),
      'utf8',
    );
    return;
  }
  await rm(getStartupProjectStatePath(), { force: true });
}

async function readRememberedProjectPath() {
  try {
    const contents = await readFile(getStartupProjectStatePath(), 'utf8');
    reopenLastProjectOnStartup = parseStartupProjectReopenPreference(contents);
    const rememberedPath = parseStartupProjectState(contents);
    const resolvedPath = resolveStartupProjectPath(rememberedPath, existsSync);
    rememberedProjectPath = resolvedPath;
    return resolvedPath;
  } catch {
    rememberedProjectPath = undefined;
    reopenLastProjectOnStartup = false;
    return undefined;
  }
}

async function setReopenLastProjectOnStartup(enabled) {
  reopenLastProjectOnStartup = enabled === true;
  const filePath = currentProjectPath ?? rememberedProjectPath;
  if (!filePath && !reopenLastProjectOnStartup) {
    await rm(getStartupProjectStatePath(), { force: true });
    return reopenLastProjectOnStartup;
  }
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(
    getStartupProjectStatePath(),
    serializeStartupProjectState(filePath, reopenLastProjectOnStartup),
    'utf8',
  );
  rememberedProjectPath = filePath;
  return reopenLastProjectOnStartup;
}

function setCurrentProjectAssetRoots(filePath, document, scratchDirectoryPath) {
  currentProjectPath = filePath;
  currentScratchDirectoryPath = scratchDirectoryPath;
  currentAssetCapabilityRootPaths = [
    ...(typeof filePath === 'string' ? buildProjectScratchDirectoryCandidates(filePath, document) : []),
    scratchDirectoryPath,
  ].filter((directoryPath) => typeof directoryPath === 'string' && directoryPath.length > 0);
  currentAssetCapabilityRootPaths = [...new Set(currentAssetCapabilityRootPaths)];
}

async function loadRememberedStartupProject() {
  // A queued external open is only an intent until the renderer's dirty guard accepts it. Restore
  // the remembered project first so rejecting/canceling a startup intent leaves the old canonical
  // project intact instead of silently replacing it with a blank baton.
  const filePath = await readRememberedProjectPath();
  if (!reopenLastProjectOnStartup || !filePath) {
    setCurrentProjectAssetRoots(undefined, undefined, undefined);
    startupProject = undefined;
    startupProjectRecovery = undefined;
    await resetSourceLibrarySnapshot();
    return;
  }

  const outcome = await prepareRememberedStartupProject({
    filePath,
    reopenLastProjectOnStartup,
    readProject: (rememberedPath) => readFile(rememberedPath, 'utf8'),
    parseProject: parseProjectDocumentJson,
    prepareProject: prepareProjectDocumentForNativeOpen,
    discoverBackups: discoverStartupProjectBackups,
  });
  if (outcome.status === 'project') {
    const prepared = outcome.prepared;
    setCurrentProjectAssetRoots(filePath, prepared.document, prepared.scratchDirectoryPath);
    startupProject = {
      canceled: false,
      filePath,
      scratchDirectoryPath: currentScratchDirectoryPath,
      document: prepared.document,
    };
    startupProjectRecovery = undefined;
    await syncSourceLibraryFromDocument(prepared.document);
    return;
  }

  // Keep the path and typed failure. The canonical project is blank until the Flow renderer
  // explicitly chooses Retry, Open Another, Recover Backup, or Continue Blank.
  setCurrentProjectAssetRoots(undefined, undefined, undefined);
  startupProject = undefined;
  startupProjectRecovery = outcome.recovery;
  await resetSourceLibrarySnapshot();
}

async function prepareStartupRecoveryProjectOpen(event, filePath, request) {
  const rendererEpoch = getRendererAuthorityEpoch(event.sender.id);
  const isSenderLive = () => isLiveAuthoritySender(event.sender, rendererEpoch);
  let preparationError;
  const result = await projectAuthority.prepareOpenProject({
    senderId: event.sender.id,
    rendererEpoch,
    isSenderLive,
    claim: request?.claim,
    load: async () => {
      try {
        return await openProjectDocumentFromPath(filePath, isSenderLive);
      } catch (error) {
        preparationError = error;
        throw error;
      }
    },
  });

  if (result.rejected?.code === 'prepare-failed' && preparationError && startupProjectRecovery) {
    startupProjectRecovery = await buildStartupProjectRecovery(
      startupProjectRecovery.filePath,
      preparationError,
      'prepare',
      { discoverBackups: discoverStartupProjectBackups },
    );
    return { ...result, startupProjectRecovery };
  }
  return result;
}

function sendRendererCommand(command) {
  const workspace = VIEW_COMMAND_WORKSPACES[command];
  if (workspace) {
    createWorkspaceWindow(workspace);
    return;
  }

  const target = BrowserWindow.getFocusedWindow() ?? workspaceWindows.get(activeWorkspace) ?? mainWindow;
  target?.webContents.send('signal-loom:menu-command', command);
}

function createWorkspaceWindow(workspace = 'flow') {
  if (!isWorkspaceView(workspace)) {
    return undefined;
  }

  const existing = workspaceWindows.get(workspace);
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) {
      existing.restore();
    }
    existing.show();
    existing.focus();
    return existing;
  }

  const workspaceWindow = new BrowserWindow({
    width: workspace === 'flow' ? 1440 : 1320,
    height: workspace === 'flow' ? 960 : 860,
    minWidth: workspace === 'flow' ? 1024 : 900,
    minHeight: workspace === 'flow' ? 720 : 640,
    title: getWorkspaceWindowTitle(workspace),
    backgroundColor: '#08111d',
    show: false,
    webPreferences: {
      preload: resolve(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Keep painting even when Chromium thinks the window is occluded/backgrounded. On Linux
      // (Wayland + multi-monitor especially) that occlusion check misfires, so the compositor stops
      // presenting new frames while the window is actually visible and focused: the DOM/canvas
      // updates (a panel scrolls, the canvas zooms) but the screen doesn't repaint until an input
      // event — moving the pointer out of the window and back — wakes it. Disabling throttling keeps
      // frames presenting on their own.
      backgroundThrottling: false,
    },
  });

  // BrowserWindow.webContents throws once the window has been destroyed. Keep the WebContents
  // reference captured while the window is live so teardown listeners can revoke renderer-owned
  // state without dereferencing the already-destroyed BrowserWindow.
  const workspaceWebContents = workspaceWindow.webContents;

  workspaceWebContents.setWindowOpenHandler((details) =>
    buildWorkspaceWindowOpenResult(details, workspaceWindow),
  );
  workspaceWebContents.on('will-navigate', (event, targetUrl) => {
    if (isAllowedWorkspaceNavigation(targetUrl, getRendererEntryUrl(), workspace)) {
      return;
    }
    event.preventDefault();
    console.warn(`Blocked unexpected ${workspace} workspace main-frame navigation.`);
  });

  const workspaceWebContentsId = workspaceWebContents.id;
  workspaceWebContents.once('destroyed', () => {
    invalidateRendererAuthority(workspaceWebContentsId);
  });
  workspaceWebContents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame) invalidateRendererAuthority(workspaceWebContentsId);
  });
  workspaceWebContents.on('render-process-gone', () => {
    invalidateRendererAuthority(workspaceWebContentsId);
  });
  crashReportController?.attachWebContentsCapture(workspaceWebContents, workspace);

  workspaceWebContents.on('did-create-window', (childWindow, details) => {
    if (!isSignalLoomFloatingPanelWindow(details)) {
      return;
    }

    const focusFloatingPanel = () => focusFloatingPanelChildWindow(workspaceWindow, childWindow, details);
    focusFloatingPanel();
    childWindow.once('ready-to-show', focusFloatingPanel);
  });

  workspaceWebContents.on('did-fail-load', (_event, _errorCode, _errorDescription, validatedURL, isMainFrame) => {
    if (!isMainFrame || !canFallbackToProductionRenderer()) {
      return;
    }

    console.warn(`Renderer load failed for "${validatedURL}". Falling back to packaged dist renderer.`);
    activeRendererEntryUrl = PRODUCTION_RENDERER_URL;
    void workspaceWindow.loadURL(buildWorkspaceRendererUrl(workspace));
  });

  workspaceWebContents.on('will-prevent-unload', (event) => {
    const choice = dialog.showMessageBoxSync(workspaceWindow, {
      type: 'warning',
      title: 'Unsaved Paper changes',
      message: 'This window has unsaved Paper documents.',
      detail: 'Unsaved Image or Paper changes are still open. Leave without saving, or cancel and use Image Save, Paper Save, or Project Save.',
      buttons: ['Leave', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    // Electron prevents unloading by default. preventDefault here means the owner explicitly chose Leave.
    if (choice === 0) event.preventDefault();
  });

  if (workspace === 'flow') {
    workspaceWebContents.on('did-start-loading', () => {
      revokeExternalOpenRenderer(workspaceWebContents);
    });
    workspaceWebContents.on('render-process-gone', (_event, details) => {
      revokeExternalOpenRenderer(workspaceWebContents);
      if (!workspaceWindow.isDestroyed() && ['abnormal-exit', 'crashed', 'oom', 'launch-failed'].includes(details.reason)) {
        // A fresh renderer will receive a new epoch; any uncommitted accepted intent is rolled
        // back and re-offered after the normal startup restore.
        setTimeout(() => {
          if (!workspaceWindow.isDestroyed()) workspaceWindow.webContents.reload();
        }, 0);
      }
    });
    workspaceWebContents.on('destroyed', () => {
      revokeExternalOpenRenderer(workspaceWebContents);
    });
  }

  workspaceWindow.setMenu(menuForWorkspace(workspace));
  workspaceWindow.setAutoHideMenuBar(false);
  workspaceWindow.setMenuBarVisibility(true);

  workspaceWindows.set(workspace, workspaceWindow);
  if (workspace === 'flow') {
    mainWindow = workspaceWindow;
  }

  workspaceWindow.once('ready-to-show', () => {
    if (workspace === 'flow') {
      workspaceWindow.maximize();
    }
    workspaceWindow.show();
    if (workspace === 'flow') {
      closeStartupSplashWindow();
    }
    // Export this window's menu to the KDE Plasma global-menu applet (opt-in; no-op otherwise).
    void registerWorkspaceWindowGlobalMenu(workspaceWindow, workspace);
  });

  workspaceWindow.on('focus', () => {
    activeWorkspace = workspace;
    // The focused workspace's menu drives the macOS bar + KDE global menu.
    applicationMenu = menuForWorkspace(workspace);
    Menu.setApplicationMenu(applicationMenu);
    // Show this workspace's menu in the native-Wayland panel applet (no-op when the flag is off).
    panelMenuService?.setActive(true);
    panelMenuService?.setActiveWorkspace(workspace);
  });

  workspaceWindow.on('blur', () => {
    // Hide the panel menu when focus leaves Sloom Studio (debounced in the service so opening the
    // applet's own popup — which briefly steals focus — doesn't make the menu flicker away).
    panelMenuService?.setActive(false);
  });

  workspaceWindow.on('closed', () => {
    workspaceWindows.delete(workspace);
    if (workspace === 'flow') {
      revokeExternalOpenRenderer(workspaceWebContents);
      mainWindow = null;
    }
  });

  void workspaceWindow.loadURL(buildWorkspaceRendererUrl(workspace));

  if (isDev && workspace === 'flow') {
    workspaceWindow.webContents.openDevTools({ mode: 'detach' });
  }

  return workspaceWindow;
}

/** Build a fresh native menu showing only the given workspace's bar. */
function menuForWorkspace(workspace) {
  return Menu.buildFromTemplate(createApplicationMenuTemplate({
    appName,
    isMac: process.platform === 'darwin',
    activeWorkspace: workspace,
    keyboardShortcuts,
    locale: interfaceLocaleAuthority.getCurrent().locale,
    sendCommand: sendRendererCommand,
  }));
}

// Each window shows its own workspace's menu bar; the focused window's menu is
// also set as the application menu so the macOS bar and the KDE Plasma global
// menu follow the focused workspace.
function installApplicationMenu() {
  for (const [workspace, window] of workspaceWindows.entries()) {
    if (!window.isDestroyed()) {
      window.setMenu(menuForWorkspace(workspace));
      window.setAutoHideMenuBar(false);
      window.setMenuBarVisibility(true);
    }
  }
  const focused = BrowserWindow.getFocusedWindow();
  const focusedWorkspace = (focused && getWorkspaceForWindow(focused)) || activeWorkspace;
  applicationMenu = menuForWorkspace(focusedWorkspace);
  Menu.setApplicationMenu(applicationMenu);
}

// ── KDE Plasma global menu (opt-in, GPU-decoupled) ───────────────────────────────────────────────
// The controller exports each workspace window's menu over the session DBus to KDE's AppMenu
// registrar. KDE shows the focused window's registered menu in the panel automatically — no focus
// juggling. Everything here is best-effort desktop chrome: failures degrade to the in-window menu bar.

/** The DBusMenu has no Electron "roles", so role items carry synthetic `role:*` commands we perform
 *  here natively (the in-window menu gets these for free from Electron's role mechanism). */
function performGlobalMenuRole(command) {
  const focused = BrowserWindow.getFocusedWindow() ?? mainWindow;
  switch (command) {
    case 'role:quit':
      app.quit();
      return;
    case 'role:reload':
      focused?.webContents?.reload();
      return;
    case 'role:togglefullscreen':
      if (focused) focused.setFullScreen(!focused.isFullScreen());
      return;
    default:
      // Unknown role — route it through the normal command bus rather than dropping it.
      sendRendererCommand(command);
  }
}

function getGlobalMenuController() {
  if (globalMenuController) return globalMenuController;
  globalMenuController = createGlobalMenuController({
    onCommand: (command) => {
      if (typeof command === 'string' && command.startsWith('role:')) {
        performGlobalMenuRole(command);
        return;
      }
      sendRendererCommand(command);
    },
    getKeyboardShortcuts: () => keyboardShortcuts,
    getLocale: () => interfaceLocaleAuthority.getCurrent().locale,
    isMac: process.platform === 'darwin',
    // The controller only runs when the global menu is explicitly opted in, so always surface its
    // lifecycle (bus connect, registrar round-trip, Plasma adoption) — not just in dev builds.
    logger: (...args) => console.log('[gmenu]', ...args),
  });
  return globalMenuController;
}

// ── KDE panel menu, native-Wayland variant (opt-in, no XWayland) ─────────────────────────────────
// Same menu content and command routing as the global-menu controller, but published over our own
// `org.signalloom.PanelMenu` D-Bus service for the Sloom Studio Plasma applet to render. No X11 window
// id is involved, so this never forces XWayland: the app keeps hardware acceleration on native Wayland.
function getPanelMenuService() {
  if (panelMenuService) return panelMenuService;
  panelMenuService = createPanelMenuService({
    onCommand: (command) => {
      if (typeof command === 'string' && command.startsWith('role:')) {
        performGlobalMenuRole(command);
        return;
      }
      sendRendererCommand(command);
    },
    getActiveWorkspace: () => activeWorkspace,
    getKeyboardShortcuts: () => keyboardShortcuts,
    getLocale: () => interfaceLocaleAuthority.getCurrent().locale,
    isMac: process.platform === 'darwin',
    // Best-effort identity hints for the applet (StartupWMClass varies between our two .desktop files).
    appIdHints: ['signal-loom', 'Sloom Studio', 'signalloom', 'studio.sloom.signalloom'],
    logger: (...args) => console.log('[panelmenu]', ...args),
  });
  return panelMenuService;
}

/** Best-effort: get the toplevel's real X11 id. getNativeWindowHandle is the real XID on a normal
 *  X11/XWayland desktop; when it comes back as the 0x1 placeholder we correlate via pid + window
 *  title (the resolver never returns a window that isn't confidently ours). */
function resolveWorkspaceWindowXid(workspaceWindow, workspace) {
  // Boundary 3 (main process → XWayland window): log which path produced the XID and its value, so
  // we can see whether the native handle works on the user's real session or we fall to correlation.
  try {
    const handle = workspaceWindow.getNativeWindowHandle?.();
    if (handle && handle.length >= 4) {
      const handleXid = handle.readUInt32LE(0);
      console.log(`[gmenu] ${workspace}: getNativeWindowHandle → 0x${handleXid.toString(16)}`);
      if (handleXid > 1) return handleXid;
    } else {
      console.log(`[gmenu] ${workspace}: getNativeWindowHandle returned no usable handle`);
    }
  } catch (err) {
    console.log(`[gmenu] ${workspace}: getNativeWindowHandle threw (${String(err)}) → X11 correlation`);
  }
  const title = getWorkspaceWindowTitle(workspace);
  const correlated = resolveX11WindowId({ pid: process.pid, titleIncludes: title });
  console.log(
    `[gmenu] ${workspace}: X11 correlation (title="${title}") → ${correlated ? `0x${correlated.toString(16)}` : 'null'}`,
  );
  return correlated;
}

/** Register a workspace window with the KDE global menu (no-op unless opted in + supported). */
async function registerWorkspaceWindowGlobalMenu(workspaceWindow, workspace) {
  const controller = getGlobalMenuController();
  if (!controller.isSupported()) return;
  try {
    // Boundary 2 (main process → session DBus): did the bus connect + registrar proxy come up?
    const started = await controller.start();
    if (!started) {
      console.log(`[gmenu] ${workspace}: controller.start() returned false (bus/registrar unavailable)`);
      return;
    }
    const xid = resolveWorkspaceWindowXid(workspaceWindow, workspace);
    if (!xid) {
      // No confident XID → leave the in-window menu as the working fallback.
      console.log(`[gmenu] ${workspace}: no confident XID → skipping registration (in-window menu only)`);
      return;
    }
    // Boundary 4 (main process → AppMenu registrar): did KDE accept our window+menu registration?
    const registered = await controller.registerWindow(workspace, xid);
    console.log(`[gmenu] ${workspace}: registerWindow(0x${xid.toString(16)}) → ${registered}`);
    if (registered) {
      workspaceWindow.once('closed', () => {
        console.log(`[gmenu] ${workspace}: window closed → unregister 0x${xid.toString(16)}`);
        void controller.unregisterWindow(xid);
      });
    }
  } catch (err) {
    // The global menu is optional chrome — never let it break window startup — but DO say why.
    console.log(`[gmenu] ${workspace}: registration error — ${String(err && err.stack ? err.stack : err)}`);
  }
}

function getInstalledApplicationMenuLabels() {
  const menu = Menu.getApplicationMenu();
  return menu?.items.map((item) => item.label).filter(Boolean) ?? [];
}

function sanitizeKeyboardShortcutsForMenu(shortcuts) {
  if (!shortcuts || typeof shortcuts !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(shortcuts)
      .filter(([command, shortcut]) => typeof command === 'string' && typeof shortcut === 'string' && shortcut.trim())
      .map(([command, shortcut]) => [command, shortcut.trim()]),
  );
}

function getProjectDialogFilters() {
  return [
    { name: 'Sloom Studio Project', extensions: [SIGNAL_LOOM_PROJECT_EXTENSION.replace(/^\./, '')] },
    { name: 'All Files', extensions: ['*'] },
  ];
}

async function chooseProjectSavePath(existingPath, parentWindow) {
  const automationPath = getAutomationProjectSavePath(process.env);
  if (automationPath) {
    return ensureSignalLoomProjectExtension(automationPath);
  }

  const defaultPath = getProjectSaveDialogDefaultPath(existingPath);

  const result = await dialog.showSaveDialog(parentWindow ?? mainWindow ?? undefined, {
    title: isSignalLoomProjectBackupPath(existingPath)
      ? 'Save Restored Sloom Studio Project'
      : 'Save Sloom Studio Project',
    defaultPath,
    filters: getProjectDialogFilters(),
  });

  if (result.canceled || !result.filePath) {
    return undefined;
  }

  return ensureSignalLoomProjectExtension(result.filePath);
}

async function stageProjectStartupRecord(filePath) {
  const statePath = getStartupProjectStatePath();
  const previous = await readFile(statePath).catch(() => undefined);
  const previousRememberedProjectPath = rememberedProjectPath;
  const nextProjectPath = !filePath || isSignalLoomProjectBackupPath(filePath)
    ? undefined
    : filePath;
  const next = nextProjectPath || reopenLastProjectOnStartup
    ? Buffer.from(serializeStartupProjectState(nextProjectPath, reopenLastProjectOnStartup), 'utf8')
    : undefined;
  return {
    commit() {
      if (next) {
        mkdirSync(dirname(statePath), { recursive: true });
        writeFileSync(statePath, next);
      } else {
        rmSync(statePath, { force: true });
      }
      rememberedProjectPath = nextProjectPath;
    },
    async rollback() {
      if (previous) {
        writeFileSync(statePath, previous);
      } else {
        rmSync(statePath, { force: true });
      }
      rememberedProjectPath = previousRememberedProjectPath;
    },
  };
}

async function stageBlankProjectReset() {
  const startupRecord = await stageProjectStartupRecord(undefined);
  const preparedPublication = {
    sourceLibrarySnapshot: normalizeSourceLibrarySnapshot(undefined),
    sourceCapabilities: await prepareNativeAssetCapabilitiesFromSourceBin(undefined, { capabilityRootPaths: [] }),
  };
  return {
    result: { canceled: false, document: undefined, preparedPublication },
    commit: () => {
      startupRecord.commit();
      return { canceled: false, document: undefined, preparedPublication };
    },
    rollback: () => startupRecord.rollback(),
  };
}

async function writeProjectDocument(filePath, document, isSenderLive = () => true) {
  const assertSenderLive = () => {
    if (!isSenderLive()) throw new Error('The requesting renderer is no longer live.');
  };
  assertSenderLive();
  await mkdir(dirname(filePath), { recursive: true });
  assertSenderLive();
  let prepared;
  let stagedTarget;
  try {
    prepared = await prepareProjectDocumentForNativeSave(filePath, document);
    assertSenderLive();
    const previousTarget = await readFile(filePath).catch(() => undefined);
    assertSenderLive();
    stagedTarget = `${filePath}.sloom-stage-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await writeFile(stagedTarget, `${JSON.stringify(prepared.document, null, 2)}\n`, 'utf8');
    assertSenderLive();
    const startupRecord = await stageProjectStartupRecord(filePath);
    assertSenderLive();
    const preparedPublication = await prepareProjectPublication(
      filePath,
      prepared.document,
      prepared.scratchDirectoryPath,
    );
    assertSenderLive();
    return stagePreparedProjectSave(filePath, prepared, previousTarget, stagedTarget, startupRecord, preparedPublication);
  } catch (error) {
    if (stagedTarget) await rm(stagedTarget, { force: true }).catch(() => undefined);
    await prepared?.rollbackPreparationEffects?.().catch(() => undefined);
    throw error;
  }
}

function stagePreparedProjectSave(filePath, prepared, previousTarget, stagedTarget, startupRecord, preparedPublication) {
  const backupPath = previousTarget && shouldWriteProjectSaveDirectly(filePath)
    ? buildProjectOverwriteBackupPath(filePath)
    : undefined;
  let committed = false;
  let createdBackupPath;

  return {
    result: {
      canceled: false,
      filePath,
      scratchDirectoryPath: prepared.scratchDirectoryPath,
      document: prepared.document,
      preparedPublication,
    },
    commit() {
      // This is the closed commit: no await, liveness callback, renderer callback, or observer
      // runs between replacing the target and advancing the authority gateway.
      if (backupPath) {
        let candidate = backupPath;
        for (let attempt = 2; existsSync(candidate); attempt += 1) candidate = `${backupPath}-${attempt}`;
        writeFileSync(candidate, previousTarget);
        createdBackupPath = candidate;
      }
      try {
        renameSync(stagedTarget, filePath);
        startupRecord.commit();
        committed = true;
      } catch (error) {
        if (previousTarget) writeFileSync(filePath, previousTarget);
        else rmSync(filePath, { force: true });
      if (createdBackupPath) rmSync(createdBackupPath, { force: true });
      startupRecord.rollback();
      throw error;
      }
      return {
        canceled: false,
        filePath,
        scratchDirectoryPath: prepared.scratchDirectoryPath,
        document: prepared.document,
        preparedPublication,
      };
    },
    async rollback() {
      if (committed) {
        if (previousTarget) writeFileSync(filePath, previousTarget);
        else rmSync(filePath, { force: true });
      }
      rmSync(stagedTarget, { force: true });
      if (createdBackupPath) rmSync(createdBackupPath, { force: true });
      startupRecord.rollback();
      await prepared.rollbackPreparationEffects?.();
    },
  };
}

async function openProjectDocumentFromBytes(filePath, bytes, isSenderLive = () => true) {
  const assertSenderLive = () => {
    if (!isSenderLive()) throw new Error('The requesting renderer is no longer live.');
  };
  assertSenderLive();
  const contents = Buffer.from(bytes).toString('utf8');
  let prepared;
  try {
    prepared = await prepareProjectDocumentForNativeOpen(filePath, parseProjectDocumentJson(contents));
    assertSenderLive();
    const startupRecord = await stageProjectStartupRecord(filePath);
    assertSenderLive();
    const preparedPublication = await prepareProjectPublication(
      filePath,
      prepared.document,
      prepared.scratchDirectoryPath,
    );
    assertSenderLive();
    return {
      result: {
        canceled: false,
        filePath,
        scratchDirectoryPath: prepared.scratchDirectoryPath,
        document: prepared.document,
        preparedPublication,
      },
      commit() {
        startupRecord.commit();
        return {
          canceled: false,
          filePath,
          scratchDirectoryPath: prepared.scratchDirectoryPath,
          document: prepared.document,
          preparedPublication,
        };
      },
      async rollback() {
        startupRecord.rollback();
        await prepared.rollbackPreparationEffects?.();
      },
    };
  } catch (error) {
    await prepared?.rollbackPreparationEffects?.().catch(() => undefined);
    throw error;
  }
}

async function openProjectDocumentFromPath(filePath, isSenderLive = () => true) {
  if (!isSenderLive()) throw new Error('The requesting renderer is no longer live.');
  const bytes = await readFile(filePath);
  if (!isSenderLive()) throw new Error('The requesting renderer is no longer live.');
  return openProjectDocumentFromBytes(filePath, bytes, isSenderLive);
}

async function prepareProjectPublication(filePath, document, scratchDirectoryPath) {
  const capabilityRootPaths = [
    ...(typeof filePath === 'string' ? buildProjectScratchDirectoryCandidates(filePath, document) : []),
    scratchDirectoryPath,
  ].filter((directoryPath) => typeof directoryPath === 'string' && directoryPath.length > 0);
  const sourceSnapshot = normalizeSourceLibrarySnapshot(document?.sourceBin);
  return {
    sourceLibrarySnapshot: sourceSnapshot,
    sourceCapabilities: await prepareNativeAssetCapabilitiesFromSourceBin(sourceSnapshot, { capabilityRootPaths }),
  };
}

/** Synchronous half of the authority commit: never call this during preparation/I/O. */
function publishCommittedProjectSnapshot(snapshot) {
  const previous = {
    currentProjectPath,
    currentScratchDirectoryPath,
    currentAssetCapabilityRootPaths: [...currentAssetCapabilityRootPaths],
    startupProject,
    startupProjectRecovery,
    sourceLibrarySnapshot,
    sourceLibraryVersion,
    capabilityPaths: nativeAssetCapabilityRegistry.list(),
    capabilityAssetIds: [...nativeAssetCapabilityAssetIds.entries()],
    capabilityRealPaths: [...nativeAssetCapabilityRealPaths.entries()],
  };
  try {
    setCurrentProjectAssetRoots(snapshot.filePath, snapshot.document, snapshot.scratchDirectoryPath);
    startupProject = snapshot.document
      ? {
        canceled: false,
        filePath: snapshot.filePath,
        scratchDirectoryPath: snapshot.scratchDirectoryPath,
        document: snapshot.document,
      }
      : undefined;
    startupProjectRecovery = undefined;
    const preparedPublication = snapshot.preparedPublication;
    sourceLibrarySnapshot = normalizeSourceLibrarySnapshot(
      preparedPublication?.sourceLibrarySnapshot ?? snapshot.document?.sourceBin,
    );
    commitNativeAssetCapabilities(preparedPublication?.sourceCapabilities, { replace: true });
    sourceLibraryVersion += 1;
    broadcastSourceLibraryChanged({ type: 'source-library-snapshot', snapshot: getSourceLibrarySnapshot() });
  } catch (error) {
    currentProjectPath = previous.currentProjectPath;
    currentScratchDirectoryPath = previous.currentScratchDirectoryPath;
    currentAssetCapabilityRootPaths = previous.currentAssetCapabilityRootPaths;
    startupProject = previous.startupProject;
    startupProjectRecovery = previous.startupProjectRecovery;
    sourceLibrarySnapshot = previous.sourceLibrarySnapshot;
    sourceLibraryVersion = previous.sourceLibraryVersion;
    commitNativeAssetCapabilities({
      paths: previous.capabilityPaths,
      assetIds: previous.capabilityAssetIds,
      realPaths: previous.capabilityRealPaths,
    }, { replace: true });
    throw error;
  }
}

// The gateway invokes this only if synchronous publication itself throws. It restores every
// main-process mirror from the previous *canonical* snapshot before the staged disk rollback,
// so a rejected request cannot leave globals/adoption/source state on different projects.
function restoreCommittedProjectSnapshot(snapshot) {
  // publishCommittedProjectSnapshot restores its own exact globals, Source version, and
  // capability maps before rethrowing. Replaying the old document here would incorrectly
  // increment Source and republish an already-restored version.
  void snapshot;
}

async function stageAcceptedExternalProject(intentId, prepared, sender) {
  const rendererEpoch = getRendererAuthorityEpoch(sender.id);
  const isSenderLive = () => isLiveAuthoritySender(sender, rendererEpoch);
  const outcome = await projectAuthority.prepareOpenProject({
    senderId: sender.id,
    rendererEpoch,
    isSenderLive,
    claim: projectAuthority.getCurrent(),
    load: () => prepared.staged,
  });
  if (!outcome.transactionId) {
    throw new Error(outcome.rejected?.message ?? 'The external project could not be prepared.');
  }
  acceptedExternalProjectTransactions.set(intentId, {
    transactionId: outcome.transactionId,
    senderId: sender.id,
    rendererEpoch,
    result: prepared.result,
  });
}

async function rollbackAcceptedExternalProject(intentId) {
  const transaction = acceptedExternalProjectTransactions.get(intentId);
  if (!transaction) return;
  acceptedExternalProjectTransactions.delete(intentId);
  await projectAuthority.cancelPreparedProject({
    transactionId: transaction.transactionId,
    senderId: transaction.senderId,
    rendererEpoch: transaction.rendererEpoch,
  });
}

async function releaseExternalOpenIntent(intentId) {
  const wasAcceptedProject = acceptedExternalProjectTransactions.has(intentId);
  await rollbackAcceptedExternalProject(intentId);
  const prepared = preparedExternalOpenIntents.get(intentId);
  if (!wasAcceptedProject && prepared?.staged) {
    await prepared.staged.rollback().catch(() => undefined);
  }
  preparedExternalOpenIntents.delete(intentId);
}

async function commitAcceptedExternalProject(intentId, authorization) {
  const transaction = acceptedExternalProjectTransactions.get(intentId);
  if (!transaction) return { status: 'invalid-state' };
  let authorityOutcome = transaction.authorityOutcome;
  if (!authorityOutcome) {
    authorityOutcome = await projectAuthority.commitPreparedProject({
      transactionId: transaction.transactionId,
      senderId: transaction.senderId,
      rendererEpoch: transaction.rendererEpoch,
      publish: publishCommittedProjectSnapshot,
      restorePublish: restoreCommittedProjectSnapshot,
    });
  }
  if (!authorityOutcome.ok) {
    acceptedExternalProjectTransactions.delete(intentId);
    preparedExternalOpenIntents.delete(intentId);
    externalOpenQueue.rejectDocumentIntent({ ...authorization, intentId });
    return { status: 'error', error: authorityOutcome.rejected?.message ?? 'The external project commit failed.' };
  }
  transaction.authorityOutcome = authorityOutcome;
  const outcome = externalOpenQueue.commitDocumentIntent({ ...authorization, intentId });
  if (outcome.status === 'committed') {
    acceptedExternalProjectTransactions.delete(intentId);
    completedExternalProjectCommits.set(intentId, {
      authority: authorityOutcome.authority,
      filePath: authorityOutcome.filePath,
      scratchDirectoryPath: authorityOutcome.scratchDirectoryPath,
    });
    if (process.env.SIGNAL_LOOM_EXTERNAL_OPEN_PROBE === '1') {
      console.log(`[external-open-probe] committed project ${intentId}: ${transaction.result.filePath}`);
    }
  }
  return {
    ...outcome,
    ...(outcome.status === 'committed' ? {
      authority: authorityOutcome.authority,
      filePath: authorityOutcome.filePath,
      scratchDirectoryPath: authorityOutcome.scratchDirectoryPath,
    } : {}),
  };
}

async function getNativeFilePathFromAssetUrl(assetUrl) {
  if (typeof assetUrl !== 'string' || !assetUrl.startsWith('signal-loom-asset://')) {
    return undefined;
  }

  let parsedAsset;
  try {
    parsedAsset = parseNativeAssetUrl(assetUrl);
  } catch {
    return undefined;
  }

  const filePath = parsedAsset.type === 'asset'
    ? nativeAssetCapabilityAssetIds.get(parsedAsset.assetId)
    : parsedAsset.filePath;

  if (!filePath) {
    return undefined;
  }

  return await isNativeAssetCapabilityRegistered(filePath) ? filePath : undefined;
}

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
    return undefined;
  }

  const match = /^data:([^;,]+)?((?:;[^,]*)*),(.*)$/s.exec(dataUrl);

  if (!match) {
    return undefined;
  }

  const [, mimeType, metadata, payload] = match;
  const buffer = metadata.includes(';base64')
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8');

  return {
    buffer,
    mimeType,
  };
}

async function hasUsableNativeAsset(filePath) {
  try {
    const fileStats = await stat(filePath);
    return fileStats.isFile() && fileStats.size > 0;
  } catch {
    return false;
  }
}

function hasUsableNativeAssetSync(filePath) {
  try {
    const fileStats = statSync(filePath);
    return fileStats.isFile() && fileStats.size > 0;
  } catch {
    return false;
  }
}

async function readdirScratchDirectory(scratchDirectoryPath) {
  try {
    return await readdir(scratchDirectoryPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function buildScratchAssetSignatureRecoveryIndex(sourceBin, scratchDirectoryPath) {
  const wantedSignatures = new Set(
    collectSourceBinItems(sourceBin)
      .map((item) => extractRecoverableMediaSignatureFromSourceKey(item?.sourceKey))
      .filter(Boolean),
  );

  if (wantedSignatures.size === 0) {
    return new Map();
  }

  const entries = (await readdirScratchDirectory(scratchDirectoryPath))
    .filter((entry) => entry.isFile())
    .sort((left, right) => left.name.localeCompare(right.name));
  const recoveryIndex = new Map();

  for (const entry of entries) {
    if (recoveryIndex.size >= wantedSignatures.size) {
      break;
    }

    const nativeFilePath = join(scratchDirectoryPath, entry.name);
    const fileStats = await stat(nativeFilePath).catch(() => undefined);

    if (!fileStats?.isFile() || fileStats.size <= 0) {
      continue;
    }

    const buffer = await readFile(nativeFilePath).catch(() => undefined);

    if (!buffer?.byteLength) {
      continue;
    }

    for (const signature of buildDataUrlAssetSignatureCandidates(buffer, entry.name)) {
      if (wantedSignatures.has(signature) && !recoveryIndex.has(signature)) {
        recoveryIndex.set(signature, nativeFilePath);
      }
    }
  }

  return recoveryIndex;
}

async function attachRecoveredScratchAssetsToSourceBin(sourceBin) {
  if (!sourceBin) {
    return sourceBin;
  }

  // Orphan scratch files are recovery evidence, not authoritative source-library entries.
  return removeTransientRecoveredScratchAssetsFromSourceBin(sourceBin);
}

// Preparation may need to materialize assets before an authority transaction reaches its
// closed commit.  Keep an exact byte journal for every scratch target it touches, including
// whether the scratch directory existed at all, so cancellation/sender loss/publication
// failure cannot leave a future project with this transaction's files.
function createScratchPreparationJournal(scratchDirectoryPath) {
  const directoryExisted = existsSync(scratchDirectoryPath);
  const previousBytesByPath = new Map();
  return {
    async beforeWrite(targetPath) {
      if (previousBytesByPath.has(targetPath)) return;
      previousBytesByPath.set(targetPath, await readFile(targetPath).catch(() => undefined));
    },
    async rollback() {
      for (const [targetPath, previousBytes] of [...previousBytesByPath.entries()].reverse()) {
        if (previousBytes) {
          await mkdir(dirname(targetPath), { recursive: true });
          await writeFile(targetPath, previousBytes);
        } else {
          await rm(targetPath, { force: true });
        }
      }
      // Deliberately non-recursive: only remove a directory this prepare created and only
      // when no unrelated writer placed something in it while the transaction was pending.
      if (!directoryExisted) await rm(scratchDirectoryPath, { force: true }).catch(() => undefined);
    },
  };
}

function removeBrokenNativeAssetReference(item, nativeFilePath) {
  if (typeof item?.assetUrl !== 'string' || !item.assetUrl.startsWith('signal-loom-asset://')) {
    return item;
  }

  return {
    ...item,
    nativeFilePath,
    assetUrl: undefined,
  };
}

async function materializeProjectSourceBinItem(
  item,
  scratchDirectoryPath,
  scratchDirectoryPaths = [scratchDirectoryPath],
  sourceKeyAssetRecoveryIndex = new Map(),
  scratchJournal,
) {
  if (!item || item.kind === 'text') {
    return item;
  }

  const linkedSourcePath = getLinkedNativeSourcePath(item);
  if (linkedSourcePath) {
    const resolvedLinkedSourcePath = resolve(linkedSourcePath);

    if (!(await hasUsableNativeAsset(resolvedLinkedSourcePath))) {
      return removeBrokenNativeAssetReference(item, resolvedLinkedSourcePath);
    }

    return {
      ...item,
      nativeFilePath: resolvedLinkedSourcePath,
      assetUrl: buildNativeAssetUrl(resolvedLinkedSourcePath, item.id),
    };
  }

  await mkdir(scratchDirectoryPath, { recursive: true });

  const scratchFileName = item.scratchFileName ?? buildNativeScratchFileName(item);
  const targetPath = join(scratchDirectoryPath, scratchFileName);
  const dataUrlAsset = parseDataUrl(item.assetUrl);
  const registeredAssetPath = dataUrlAsset ? undefined : await getNativeFilePathFromAssetUrl(item.assetUrl);
  const sourcePath = dataUrlAsset
    ? undefined
    : resolveScratchAssetNativePath(item, scratchDirectoryPaths, existsSync) ?? registeredAssetPath;

  if (!sourcePath && !dataUrlAsset && !item.scratchFileName) {
    return item;
  }

  try {
    const sourceKeySignature = extractRecoverableMediaSignatureFromSourceKey(item.sourceKey);
    const recoveredSourcePath = sourceKeySignature
      ? sourceKeyAssetRecoveryIndex.get(sourceKeySignature)
      : undefined;
    let materializationSourcePath = sourcePath;

    if (materializationSourcePath && !(await hasUsableNativeAsset(materializationSourcePath))) {
      materializationSourcePath = recoveredSourcePath;
    } else if (!materializationSourcePath && recoveredSourcePath) {
      materializationSourcePath = recoveredSourcePath;
    }

    if (materializationSourcePath && !(await hasUsableNativeAsset(materializationSourcePath))) {
      throw new Error('Referenced source asset is missing or empty.');
    }

    if (dataUrlAsset && dataUrlAsset.buffer.byteLength === 0) {
      throw new Error('Source asset payload is empty.');
    }

    if (materializationSourcePath && resolve(materializationSourcePath) !== resolve(targetPath)) {
      await scratchJournal?.beforeWrite(targetPath);
      await copyFile(materializationSourcePath, targetPath);
    } else if (dataUrlAsset) {
      await scratchJournal?.beforeWrite(targetPath);
      await writeFile(targetPath, dataUrlAsset.buffer);
    }

    if (!(await hasUsableNativeAsset(targetPath))) {
      throw new Error('Materialized scratch asset is missing or empty.');
    }
  } catch {
    // Keep the project document saveable even when a referenced source file was moved.
    return removeBrokenNativeAssetReference(item, targetPath);
  }

  return {
    ...item,
    mimeType: item.mimeType ?? dataUrlAsset?.mimeType,
    scratchFileName,
    nativeFilePath: targetPath,
    assetUrl: buildNativeAssetUrl(targetPath, item.id),
  };
}

async function prepareProjectDocumentForNativeSave(filePath, document) {
  const scratchDirectoryPaths = buildProjectScratchDirectoryCandidates(filePath, document);
  const scratchDirectoryPath = scratchDirectoryPaths[0];
  const scratchJournal = createScratchPreparationJournal(scratchDirectoryPath);
  const sourceKeyAssetRecoveryIndex = document?.sourceBin
    ? await buildScratchAssetSignatureRecoveryIndex(document.sourceBin, scratchDirectoryPath)
    : new Map();
  const sourceBin = document?.sourceBin
    ? await mapSourceBinItemsAsync(
        document.sourceBin,
        (item) => materializeProjectSourceBinItem(
          item,
          scratchDirectoryPath,
          scratchDirectoryPaths,
          sourceKeyAssetRecoveryIndex,
          scratchJournal,
        ),
      )
    : document?.sourceBin;
  const scratchAssetCount = collectSourceBinItems(sourceBin)
    .filter((item) => item.kind !== 'text' && item.scratchFileName)
    .length;

  return {
    scratchDirectoryPath,
    rollbackPreparationEffects: () => scratchJournal.rollback(),
    document: {
      ...document,
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
      savedAt: Date.now(),
      sourceBin,
      fileSystem: {
        ...document?.fileSystem,
        projectDirectoryName: basename(dirname(filePath)),
        scratchDirectoryName: basename(scratchDirectoryPath),
        lastSavedToFolderAt: Date.now(),
        scratchAssetCount,
      },
    },
  };
}

async function prepareProjectDocumentForNativeOpen(filePath, document) {
  const scratchDirectoryPaths = buildProjectScratchDirectoryCandidates(filePath, document);
  const scratchDirectoryPath = scratchDirectoryPaths[0];
  const scratchJournal = createScratchPreparationJournal(scratchDirectoryPath);
  const sourceKeyAssetRecoveryIndex = document?.sourceBin
    ? await buildScratchAssetSignatureRecoveryIndex(document.sourceBin, scratchDirectoryPath)
    : new Map();

  if (!document?.sourceBin) {
    const openedDocument = attachNativeScratchAssetsToProjectDocument(
      document,
      scratchDirectoryPath,
      hasUsableNativeAssetSync,
    );

    return {
      scratchDirectoryPath,
      rollbackPreparationEffects: () => scratchJournal.rollback(),
      document: {
        ...openedDocument,
        sourceBin: await attachRecoveredScratchAssetsToSourceBin(openedDocument?.sourceBin, scratchDirectoryPath),
      },
    };
  }

  const sourceBin = await mapSourceBinItemsAsync(document.sourceBin, async (item) => {
    if (!item || item.kind === 'text') {
      return item;
    }

    if (item.scratchFileName || (typeof item.assetUrl === 'string' && item.assetUrl.startsWith('data:'))) {
      return materializeProjectSourceBinItem(
        item,
        scratchDirectoryPath,
        scratchDirectoryPaths,
        sourceKeyAssetRecoveryIndex,
        scratchJournal,
      );
    }

    if (item.nativeFilePath) {
      const nativeFilePath = resolveScratchAssetNativePath(item, scratchDirectoryPaths, existsSync);
      const fallbackAssetUrl = typeof item.assetUrl === 'string' && item.assetUrl.startsWith('signal-loom-asset://')
        ? undefined
        : item.assetUrl;

      return {
        ...item,
        nativeFilePath,
        assetUrl: nativeFilePath && hasUsableNativeAssetSync(nativeFilePath)
          ? buildNativeAssetUrl(nativeFilePath, item.id)
          : fallbackAssetUrl,
      };
    }

    return item;
  });

  const openedDocument = attachNativeScratchAssetsToProjectDocument(
    {
      ...document,
      sourceBin: await attachRecoveredScratchAssetsToSourceBin(sourceBin, scratchDirectoryPath),
    },
    scratchDirectoryPath,
    hasUsableNativeAssetSync,
  );

  return {
    scratchDirectoryPath,
    rollbackPreparationEffects: () => scratchJournal.rollback(),
    document: openedDocument,
  };
}

async function materializeNativeImport(item, scratchDirectoryPath) {
  if (!isPlainObject(item) || typeof item.filePath !== 'string' || typeof item.kind !== 'string') {
    return undefined;
  }

  const filePath = item.filePath;
  const sourceName = typeof item.label === 'string' && item.label.trim() ? item.label.trim() : basename(filePath);
  const id = globalThis.crypto?.randomUUID?.() ?? `native-asset-${Date.now()}`;
  let storedPath = filePath;
  let scratchFileName;

  if (scratchDirectoryPath) {
    await mkdir(scratchDirectoryPath, { recursive: true });
    scratchFileName = `${sanitizeFileName(id)}-${sanitizeFileName(sourceName)}`;
    storedPath = join(scratchDirectoryPath, scratchFileName);
    await copyFile(filePath, storedPath);
  }

  return {
    item: {
      id,
      label: sourceName,
      kind: item.kind,
      mimeType: typeof item.mimeType === 'string' && item.mimeType.trim() ? item.mimeType.trim() : 'application/octet-stream',
      assetUrl: buildNativeAssetUrl(storedPath, id),
      nativeFilePath: storedPath,
      scratchFileName,
      createdAt: Date.now(),
      isGenerated: false,
      professional: {
        version: 1,
        origin: 'imported',
        onlineState: 'online',
        proxy: { status: 'none' },
        tags: [],
      },
    },
    createdPath: scratchFileName ? storedPath : undefined,
  };
}

function sanitizeFlowImportWorkerItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  return items.flatMap((item) => {
    if (!isPlainObject(item) || typeof item.filePath !== 'string' || !item.filePath.trim()) {
      return [];
    }

    return [{
      filePath: item.filePath.trim(),
      ...(typeof item.label === 'string' && item.label.trim() ? { label: item.label.trim() } : {}),
      ...(typeof item.kind === 'string' && item.kind.trim() ? { kind: item.kind.trim() } : {}),
      ...(typeof item.mimeType === 'string' && item.mimeType.trim() ? { mimeType: item.mimeType.trim() } : {}),
    }];
  });
}

async function runFlowImportWorker(items) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(flowImportWorkerUrl, { type: 'module' });
    let settled = false;

    const settle = (fn, value) => {
      if (settled) {
        return;
      }

      settled = true;
      void worker.terminate().catch(() => undefined);
      fn(value);
    };

    worker.once('message', (payload) => {
      if (typeof payload?.error === 'string' && payload.error.trim()) {
        settle(reject, new Error(payload.error));
        return;
      }

      settle(resolve, Array.isArray(payload?.items) ? payload.items : []);
    });
    worker.once('error', (error) => settle(reject, error));
    worker.once('exit', (code) => {
      if (!settled && code !== 0) {
        settle(reject, new Error(`Flow import worker exited with code ${code}.`));
      }
    });
    worker.postMessage({
      type: 'normalize-imported-media-batch',
      items,
    });
  });
}

async function normalizeImportedMediaBatchInMain(items) {
  const sanitizedItems = sanitizeFlowImportWorkerItems(items);

  if (sanitizedItems.length === 0) {
    return [];
  }

  return runFlowImportWorker(sanitizedItems);
}

function sanitizePaperEpubFileName(value) {
  const baseName = (value ?? '')
    .trim()
    .replace(/[/\\?%*:|"<>]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '') || 'paper-document';
  return /\.epub$/i.test(baseName) ? baseName : `${baseName}.epub`;
}

function ensureEpubExtension(filePath) {
  return /\.epub$/i.test(filePath) ? filePath : `${filePath}.epub`;
}

async function choosePaperEpubSavePath(request, parentWindow) {
  const fileName = sanitizePaperEpubFileName(request?.fileName || request?.title || 'paper-document');
  const result = await dialog.showSaveDialog(parentWindow ?? mainWindow ?? undefined, {
    title: 'Export Paper EPUB',
    defaultPath: currentProjectPath ? join(dirname(currentProjectPath), fileName) : fileName,
    filters: [
      { name: 'EPUB ebook', extensions: ['epub'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || !result.filePath) return undefined;
  return ensureEpubExtension(result.filePath);
}

async function choosePaperPdfSavePath(request, parentWindow) {
  const automationPath = getAutomationPaperPdfPath(process.env);
  if (automationPath) {
    return ensurePdfExtension(automationPath);
  }

  const result = await dialog.showSaveDialog(parentWindow ?? mainWindow ?? undefined, {
    title: 'Export Paper PDF',
    defaultPath: buildPaperPdfDefaultPath(request, currentProjectPath),
    filters: [
      { name: 'PDF Document', extensions: ['pdf'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || !result.filePath) {
    return undefined;
  }

  return ensurePdfExtension(result.filePath);
}

async function choosePaperImageExportDirectory(request, parentWindow) {
  const directoryName = sanitizePaperImagePathPart(request?.directoryName, 'paper-webcomic-images');
  const automationDirectory = getAutomationPaperImageDirectory(process.env);
  if (automationDirectory) {
    return ensurePaperImageExportDirectory(automationDirectory, directoryName);
  }

  const result = await dialog.showOpenDialog(parentWindow ?? mainWindow ?? undefined, {
    title: 'Export Paper Page Images',
    defaultPath: buildPaperImageDefaultDirectoryPath(request, currentProjectPath),
    properties: ['openDirectory', 'createDirectory'],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return undefined;
  }

  return ensurePaperImageExportDirectory(result.filePaths[0], directoryName);
}

const PAPER_PDF_RENDER_READY_TIMEOUT_MS = 12000;
const PAPER_PDF_PRINT_TIMEOUT_MS = 30000;

function withTimeout(promise, timeoutMs, label) {
  let timeout;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms.`)), timeoutMs);
    }),
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

async function waitForPaperPdfRenderReady(exportWindow) {
  await withTimeout(
    exportWindow.webContents.executeJavaScript(buildPaperPdfRenderReadyScript(), true),
    PAPER_PDF_RENDER_READY_TIMEOUT_MS,
    'Paper PDF render readiness',
  ).catch(() => undefined);
}

async function exportPaperPdfToFile(request, filePath) {
  const tempDir = join(app.getPath('temp'), 'signal-loom-paper-pdf');
  const tempHtmlPath = join(
    tempDir,
    `${Date.now()}-${sanitizePdfFileName(request?.title || request?.fileName || 'paper-document')}.html`,
  );
  const exportWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(tempHtmlPath, request.html, 'utf8');
    await exportWindow.loadFile(tempHtmlPath);
    await waitForPaperPdfRenderReady(exportWindow);
    const pdf = await withTimeout(
      exportWindow.webContents.printToPDF(buildPaperPdfPrintOptions(request)),
      PAPER_PDF_PRINT_TIMEOUT_MS,
      'Paper PDF print',
    );
    const stampedPdf = await applyPdfProvenance(pdf, request.provenanceLabel);
    await writeFile(filePath, stampedPdf);

    return {
      canceled: false,
      filePath,
      bytes: stampedPdf.byteLength ?? stampedPdf.length ?? 0,
    };
  } finally {
    if (!exportWindow.isDestroyed()) {
      exportWindow.destroy();
    }
    void rm(tempHtmlPath, { force: true }).catch(() => undefined);
  }
}

/**
 * PDF Producer/Creator provenance (licensing spec Part 2 §6). Chromium's printToPDF hardcodes its
 * own Producer; pdf-lib rewrites the Info dictionary. The edition label comes from the renderer's
 * offline license verification (sanitized here). Any failure returns the ORIGINAL bytes —
 * provenance must never break an export.
 */
async function applyPdfProvenance(pdfBuffer, provenanceLabel) {
  const label = typeof provenanceLabel === 'string' && provenanceLabel.trim()
    ? provenanceLabel.trim().slice(0, 200)
    : 'Sloom Studio (GPL-3.0-or-later)';
  try {
    const { PDFDocument } = await import('pdf-lib');
    const document = await PDFDocument.load(pdfBuffer, { updateMetadata: false });
    document.setProducer(label);
    document.setCreator('Sloom Studio');
    return Buffer.from(await document.save());
  } catch (error) {
    console.warn('[paper-pdf] provenance stamp skipped:', error);
    return pdfBuffer;
  }
}

async function exportPaperImagesToDirectory(request, directoryPath) {
  const pages = Array.isArray(request?.pages) ? request.pages : [];
  if (!pages.length) {
    throw new Error('No Paper pages were provided for image export.');
  }

  await mkdir(directoryPath, { recursive: true });
  const files = [];
  let totalBytes = 0;

  for (const page of pages) {
    const mimeType = page?.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/png';
    const fallbackName = `page-${String(page?.pageNumber ?? files.length + 1).padStart(3, '0')}.${mimeType === 'image/jpeg' ? 'jpg' : 'png'}`;
    const fileName = sanitizePaperImagePathPart(page?.fileName, fallbackName);
    const buffer = imageBufferFromDataUrl(page?.dataUrl, mimeType);
    const filePath = join(directoryPath, fileName);
    await writeFile(filePath, buffer);
    const bytes = buffer.byteLength ?? buffer.length ?? 0;
    totalBytes += bytes;
    files.push({
      fileName,
      filePath,
      pageNumber: Number(page?.pageNumber) || files.length + 1,
      bytes,
    });
  }

  return {
    canceled: false,
    directoryPath,
    files,
    bytes: totalBytes,
  };
}

async function readBoundedResponseText(response, maxBytes = 64 * 1024) {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error('The phone pairing response was too large.');
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function installProtocolHandlers() {
  // This is the sole root-resolution call. Both the font protocol and its renderer-facing
  // capability status read this exact value; a generic preload bridge is never evidence that
  // this root exists.
  resolvedBundledFontLibraryRoot = resolveBundledFontLibraryRoot({
    appIsPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appRoot: APP_ROOT,
    env: process.env,
  });

  protocol.handle('signal-loom-asset', async (request) => {
    const filePath = await getNativeFilePathFromAssetUrl(request.url);
    if (!filePath) {
      return new Response('Sloom Studio asset capability is not registered for this project.', { status: 403 });
    }

    return net.fetch(pathToFileURL(filePath).toString(), {
      headers: request.headers,
      signal: request.signal,
    });
  });

  protocol.handle('signal-loom-font', async (request) => {
    const filePath = resolvedBundledFontLibraryRoot
      ? resolveBundledFontResourcePath(resolvedBundledFontLibraryRoot, request.url)
      : undefined;
    if (!filePath) {
      return new Response('The requested bundled font resource is unavailable.', { status: 404 });
    }
    return net.fetch(pathToFileURL(filePath).toString());
  });

  protocol.handle('signal-loom-phone', async (request) => {
    if (!remotePhoneHostBaseUrl) {
      return new Response('No phone host is configured for this desktop session.', { status: 503 });
    }
    const requestGeneration = Number(request.headers.get('x-signal-loom-phone-generation'));
    if (!Number.isSafeInteger(requestGeneration) || requestGeneration !== remotePhoneHostGeneration) {
      return Response.json({ ok: false, error: 'The phone configuration changed.' }, { status: 409 });
    }
    const configuredBaseUrl = remotePhoneHostBaseUrl;
    let method;
    let target;
    let headers;
    try {
      method = normalizeRemotePhoneMethod(request.method);
      target = buildRemotePhoneHostTarget(configuredBaseUrl, request.url);
      headers = filterRemotePhoneRequestHeaders(request.headers);
    } catch (error) {
      return Response.json({
        ok: false,
        error: error instanceof Error ? error.message : 'The phone proxy rejected this request.',
      }, { status: 400 });
    }

    try {
      const pathname = new URL(target).pathname;
      if (remotePhoneHostToken && pathname !== '/__loom/api/health' && pathname !== '/__loom/api/pair') {
        headers.Authorization = `Bearer ${remotePhoneHostToken}`;
      }
      const init = {
        method,
        headers,
        redirect: 'error',
        signal: request.signal,
      };
      if (method !== 'GET' && request.body) {
        init.body = request.body;
        init.duplex = 'half';
      }
      const upstream = await net.fetch(target, init);
      if (requestGeneration !== remotePhoneHostGeneration || configuredBaseUrl !== remotePhoneHostBaseUrl) {
        return Response.json({ ok: false, error: 'The phone configuration changed.' }, { status: 409 });
      }
      if (pathname === '/__loom/api/health') {
        const text = await readBoundedResponseText(upstream);
        if (upstream.ok) {
          try {
            const body = JSON.parse(text);
            if (body?.name === 'Sloom Studio') remotePhoneHostVerifiedGeneration = requestGeneration;
          } catch {
            // The renderer's identity probe will reject malformed/non-JSON health responses.
          }
        }
        return new Response(text, {
          status: upstream.status,
          headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
        });
      }
      if (pathname === '/__loom/api/pair') {
        const text = await readBoundedResponseText(upstream);
        if (!upstream.ok) {
          return new Response(text, {
            status: upstream.status,
            headers: { 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
          });
        }
        const body = JSON.parse(text);
        if (typeof body?.token !== 'string' || body.token.length < 8 || body.token.length > 1024) {
          throw new Error('The phone returned an invalid pairing credential.');
        }
        remotePhoneHostToken = body.token;
        return Response.json({ ok: true });
      }
      if (upstream.status === 401
        && requestGeneration === remotePhoneHostGeneration
        && configuredBaseUrl === remotePhoneHostBaseUrl) {
        remotePhoneHostToken = undefined;
      }
      return upstream;
    } catch (error) {
      return Response.json({
        ok: false,
        error: error instanceof Error ? error.message : 'The phone host request failed.',
      }, { status: 502 });
    }
  });
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeVertexPathSegment(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is required.`);
  }

  const trimmed = value.trim();

  if (!/^[a-zA-Z0-9._-]+$/.test(trimmed)) {
    throw new Error(`${label} contains unsupported characters.`);
  }

  return trimmed;
}

function buildVertexImageEndpoint(request) {
  const projectId = sanitizeVertexPathSegment(request.projectId, 'Vertex project ID');
  const location = sanitizeVertexPathSegment(request.location || 'global', 'Vertex location');
  const modelId = sanitizeVertexPathSegment(request.modelId, 'Vertex model ID');
  const method = request.route === 'imagen-predict'
    ? 'predict'
    : request.route === 'gemini-generate-content'
      ? 'generateContent'
      : undefined;

  if (!method) {
    throw new Error('Unsupported Vertex image route.');
  }

  return {
    url: `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:${method}`,
    projectId,
    modelId,
  };
}

function buildVertexTextEndpoint(request) {
  const projectId = sanitizeVertexPathSegment(request.projectId, 'Vertex project ID');
  const location = sanitizeVertexPathSegment(request.location || 'global', 'Vertex location');
  const modelId = sanitizeVertexPathSegment(request.modelId, 'Vertex model ID');

  return {
    url: `https://aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:generateContent`,
    projectId,
    modelId,
  };
}

function sanitizeVertexApiVersion(value) {
  if (value === 'v1' || value === 'v1beta1' || value === 'v1alpha') {
    return value;
  }

  return 'v1';
}

function buildVertexRegionalHost(location) {
  return location === 'global'
    ? 'aiplatform.googleapis.com'
    : `${location}-aiplatform.googleapis.com`;
}

function buildVertexVideoEndpoint(request) {
  const projectId = sanitizeVertexPathSegment(request.projectId, 'Vertex project ID');
  const location = sanitizeVertexPathSegment(request.location || 'us-central1', 'Vertex location');
  const modelId = sanitizeVertexPathSegment(request.modelId, 'Vertex model ID');
  const route = request.route === 'gemini-generate-content'
    ? 'gemini-generate-content'
    : request.route === 'veo-predict-long-running'
      ? 'veo-predict-long-running'
      : undefined;

  if (!route) {
    throw new Error('Unsupported Vertex video route.');
  }

  const apiVersion = route === 'gemini-generate-content'
    ? sanitizeVertexApiVersion(request.apiVersion || 'v1beta1')
    : 'v1';
  const modelPath = `projects/${projectId}/locations/${location}/publishers/google/models/${modelId}`;
  const baseUrl = `https://${buildVertexRegionalHost(location)}/${apiVersion}/${modelPath}`;
  const method = route === 'gemini-generate-content' ? 'generateContent' : 'predictLongRunning';

  return {
    url: `${baseUrl}:${method}`,
    fetchOperationUrl: `${baseUrl}:fetchPredictOperation`,
    projectId,
    modelId,
    route,
  };
}

function resolveVertexQuotaProjectId(request, endpointProjectId) {
  const quotaProjectId = request?.auth?.quotaProjectId;
  if (typeof quotaProjectId === 'string' && quotaProjectId.trim()) {
    return sanitizeVertexPathSegment(quotaProjectId, 'Vertex quota project ID');
  }

  const envQuotaProjectId = parseVertexEnvironmentVariables(request?.auth?.environmentVariables).GOOGLE_CLOUD_QUOTA_PROJECT;
  return typeof envQuotaProjectId === 'string' && envQuotaProjectId.trim()
    ? sanitizeVertexPathSegment(envQuotaProjectId, 'Vertex quota project ID')
    : endpointProjectId;
}

async function getVertexAccessToken(auth) {
  let adcError;
  try {
    const adc = await getVertexAccessTokenFromAdc(auth);
    if (adc?.token) return adc;
  } catch (error) {
    adcError = error instanceof Error ? error.message : String(error);
  }

  let commandLabel = 'gcloud auth print-access-token';
  try {
    const { command, args } = buildVertexAccessTokenCommand(auth);
    commandLabel = args.length ? `${command} ${args.join(' ')}` : command;
    const { stdout } = await execFileAsync(command, args, {
      env: buildVertexAuthEnvironment(auth, process.env),
      timeout: 30000,
      maxBuffer: 1024 * 1024,
    });
    const token = stdout.trim();

    if (!token) {
      throw new Error('gcloud returned an empty access token.');
    }

    return { token, source: 'gcloud' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error([
      'Sloom Studio could not obtain a Vertex access token.',
      adcError ? `Built-in ADC broker: ${adcError}` : 'No imported or system ADC file was usable.',
      `Google Cloud SDK fallback (${commandLabel}): ${message}`,
      'Use Settings > Providers > Vertex AI to import an ADC/service-account JSON file or start browser sign-in; no terminal command is required.',
    ].join(' '));
  }
}

async function getGcloudAccessToken(auth) {
  return (await getVertexAccessToken(auth)).token;
}

async function listVertexProjectsWithToken(token) {
  const projects = [];
  let pageToken = '';
  do {
    const url = new URL('https://cloudresourcemanager.googleapis.com/v1/projects');
    url.searchParams.set('filter', 'lifecycleState:ACTIVE');
    url.searchParams.set('pageSize', '100');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const response = await net.fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(buildVertexErrorMessage(response.status, payload, 'project listing'));
    }
    for (const project of Array.isArray(payload.projects) ? payload.projects : []) {
      if (typeof project?.projectId === 'string' && project.projectId.trim()) {
        projects.push({
          projectId: project.projectId.trim(),
          name: typeof project.name === 'string' ? project.name : '',
        });
      }
    }
    pageToken = typeof payload.nextPageToken === 'string' ? payload.nextPageToken : '';
  } while (pageToken);
  return projects.sort((left, right) => left.projectId.localeCompare(right.projectId));
}

function isPrivateProviderPackHost(hostname) {
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (/^(?:127|10)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)) return true;
  const match = /^172\.(\d+)\./.exec(host);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function materializeProviderPackBrokerBody(body) {
  if (!body) return undefined;
  if (body.kind === 'text' && typeof body.text === 'string') {
    if (Buffer.byteLength(body.text, 'utf8') > 50 * 1024 * 1024) {
      throw new Error('The native provider request body exceeded 50 MiB.');
    }
    return body.text;
  }
  if (body.kind === 'binary' && typeof body.base64 === 'string') {
    const bytes = Buffer.from(body.base64, 'base64');
    if (bytes.length > 50 * 1024 * 1024) throw new Error('The native provider request body exceeded 50 MiB.');
    return bytes;
  }
  if (body.kind === 'multipart' && Array.isArray(body.parts)) {
    const form = new FormData();
    let totalBytes = 0;
    for (const part of body.parts.slice(0, 1_024)) {
      if (!part || typeof part.name !== 'string') continue;
      if (typeof part.base64 === 'string') {
        const bytes = Buffer.from(part.base64, 'base64');
        totalBytes += bytes.length;
        form.append(
          part.name,
          new Blob([bytes], { type: typeof part.mimeType === 'string' ? part.mimeType : 'application/octet-stream' }),
          typeof part.fileName === 'string' ? part.fileName : 'upload.bin',
        );
      } else if (typeof part.value === 'string') {
        totalBytes += Buffer.byteLength(part.value, 'utf8');
        form.append(part.name, part.value);
      }
      if (totalBytes > 50 * 1024 * 1024) throw new Error('The native provider request body exceeded 50 MiB.');
    }
    return form;
  }
  throw new Error('The native provider broker received an unsupported request body.');
}

function extractVertexGeneratedImage(response) {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];

    for (const part of parts) {
      const inlineData = part?.inlineData ?? part?.inline_data;
      const data = inlineData?.data;

      if (typeof data === 'string' && data) {
        return {
          mimeType: typeof inlineData.mimeType === 'string' ? inlineData.mimeType : 'image/png',
          data,
        };
      }
    }
  }

  const predictions = Array.isArray(response?.predictions) ? response.predictions : [];

  for (const prediction of predictions) {
    const data = prediction?.bytesBase64Encoded
      ?? prediction?.bytes_base64_encoded
      ?? prediction?.image?.bytesBase64Encoded
      ?? prediction?.image?.bytes_base64_encoded;

    if (typeof data === 'string' && data) {
      return {
        mimeType: prediction?.mimeType ?? prediction?.image?.mimeType ?? 'image/png',
        data,
      };
    }
  }

  return undefined;
}

function extractVertexGeneratedText(response) {
  const candidates = Array.isArray(response?.candidates) ? response.candidates : [];
  const textParts = [];

  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];

    for (const part of parts) {
      if (typeof part?.text === 'string' && part.text.trim()) {
        textParts.push(part.text);
      }
    }
  }

  return textParts.join('\n').trim();
}

function extractVertexGeneratedVideo(response) {
  const responseBody = response?.response ?? response;
  const videos = Array.isArray(responseBody?.videos) ? responseBody.videos : [];

  for (const video of videos) {
    const extracted = getVertexVideoPayload(video);

    if (extracted) {
      return extracted;
    }
  }

  const generatedSamples = Array.isArray(responseBody?.generateVideoResponse?.generatedSamples)
    ? responseBody.generateVideoResponse.generatedSamples
    : [];

  for (const sample of generatedSamples) {
    const extracted = getVertexVideoPayload(sample?.video ?? sample);

    if (extracted) {
      return extracted;
    }
  }

  return undefined;
}

function getVertexVideoPayload(value) {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const data = stringOrUndefined(value.bytesBase64Encoded)
    ?? stringOrUndefined(value.bytes_base64_encoded)
    ?? stringOrUndefined(value.encodedVideo)
    ?? stringOrUndefined(value.videoBytes)
    ?? stringOrUndefined(value.video_bytes);
  const mimeType = stringOrUndefined(value.mimeType)
    ?? stringOrUndefined(value.mime_type)
    ?? stringOrUndefined(value.encoding)
    ?? 'video/mp4';
  const gcsUri = stringOrUndefined(value.gcsUri) ?? stringOrUndefined(value.gcs_uri);
  const uri = stringOrUndefined(value.uri);

  if (!data && !gcsUri && !uri) {
    return undefined;
  }

  return {
    mimeType,
    ...(data ? { data } : {}),
    ...(gcsUri ? { gcsUri } : {}),
    ...(uri ? { uri } : {}),
  };
}

function stringOrUndefined(value) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function sleep(ms, signal) {
  if (signal?.aborted) {
    return Promise.reject(new DOMException('Operation aborted', 'AbortError'));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Operation aborted', 'AbortError'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function buildVertexErrorMessage(status, payload, label = 'generation') {
  const apiMessage = payload?.error?.message;

  if (typeof apiMessage === 'string' && apiMessage.trim()) {
    return `Vertex AI ${label} failed (${status}): ${apiMessage}`;
  }

  return `Vertex AI ${label} failed (${status}).`;
}

async function generateVertexImage(request, signal) {
  if (!isPlainObject(request) || !isPlainObject(request.body)) {
    return { error: 'Invalid Vertex image request.' };
  }

  try {
    const endpoint = buildVertexImageEndpoint(request);
    const token = await getGcloudAccessToken(request.auth);
    signal?.throwIfAborted();
    const quotaProjectId = resolveVertexQuotaProjectId(request, endpoint.projectId);
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-goog-user-project': quotaProjectId,
      },
      body: JSON.stringify(request.body),
      signal,
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return { error: buildVertexErrorMessage(response.status, payload, 'image generation') };
    }

    const image = extractVertexGeneratedImage(payload);

    if (!image) {
      return { error: 'Vertex AI returned no image data.' };
    }

    return {
      result: `data:${image.mimeType};base64,${image.data}`,
      resultType: 'image',
      mimeType: image.mimeType,
      statusMessage: `Generated with ${endpoint.modelId}`,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Vertex AI image generation failed.',
    };
  }
}

async function generateVertexText(request, signal) {
  if (!isPlainObject(request) || !isPlainObject(request.body)) {
    return { error: 'Invalid Vertex text request.' };
  }

  try {
    const endpoint = buildVertexTextEndpoint(request);
    const token = await getGcloudAccessToken(request.auth);
    signal?.throwIfAborted();
    const quotaProjectId = resolveVertexQuotaProjectId(request, endpoint.projectId);
    const response = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-goog-user-project': quotaProjectId,
      },
      body: JSON.stringify(request.body),
      signal,
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      return { error: buildVertexErrorMessage(response.status, payload, 'text generation') };
    }

    const text = extractVertexGeneratedText(payload);

    if (!text) {
      return { error: 'Vertex AI returned no text content.' };
    }

    return {
      text,
      statusMessage: `Generated with ${endpoint.modelId}`,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Vertex AI text generation failed.',
    };
  }
}

async function generateVertexVideo(request, signal) {
  if (!isPlainObject(request) || !isPlainObject(request.body)) {
    return { error: 'Invalid Vertex video request.' };
  }

  try {
    const endpoint = buildVertexVideoEndpoint(request);
    const token = await getGcloudAccessToken(request.auth);
    signal?.throwIfAborted();
    const quotaProjectId = resolveVertexQuotaProjectId(request, endpoint.projectId);
    const initialResponse = await fetch(endpoint.url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-goog-user-project': quotaProjectId,
      },
      body: JSON.stringify(request.body),
      signal,
    });
    const initialPayload = await initialResponse.json().catch(() => ({}));

    if (!initialResponse.ok) {
      return { error: buildVertexErrorMessage(initialResponse.status, initialPayload, 'video generation') };
    }

    const finalPayload = endpoint.route === 'veo-predict-long-running'
      ? await pollVertexVideoOperation({
          endpoint,
          operation: initialPayload,
          token,
          quotaProjectId,
          signal,
        })
      : initialPayload;
    const video = extractVertexGeneratedVideo(finalPayload);

    if (!video) {
      return { error: 'Vertex AI returned no video data.' };
    }

    const materialized = await materializeVertexVideo(video, token, quotaProjectId, signal);

    return {
      result: materialized.result,
      resultType: 'video',
      mimeType: materialized.mimeType,
      statusMessage: `Generated with ${endpoint.modelId}`,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Vertex AI video generation failed.',
    };
  }
}

async function pollVertexVideoOperation({ endpoint, operation, token, quotaProjectId, signal }) {
  let currentOperation = operation;

  for (let attempt = 0; attempt < 45; attempt += 1) {
    if (currentOperation?.error) {
      throw new Error(currentOperation.error.message || 'Vertex AI video operation failed.');
    }

    if (currentOperation?.done) {
      return currentOperation;
    }

    if (!currentOperation?.name) {
      throw new Error('Vertex AI video generation started without an operation name.');
    }

    await sleep(10_000, signal);
    const response = await fetch(endpoint.fetchOperationUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-goog-user-project': quotaProjectId,
      },
      body: JSON.stringify({
        operationName: currentOperation.name,
      }),
      signal,
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(buildVertexErrorMessage(response.status, payload, 'video operation polling'));
    }

    currentOperation = payload;
  }

  throw new Error('Vertex AI video generation timed out after waiting 7.5 minutes.');
}

async function materializeVertexVideo(video, token, quotaProjectId, signal) {
  if (video.data) {
    return {
      result: `data:${video.mimeType};base64,${video.data}`,
      mimeType: video.mimeType,
    };
  }

  const url = video.gcsUri
    ? vertexGcsUriToDownloadUrl(video.gcsUri)
    : video.uri;

  if (!url) {
    throw new Error('Vertex AI returned a video reference that Sloom Studio could not download.');
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      'x-goog-user-project': quotaProjectId,
    },
    signal,
  });

  if (!response.ok) {
    const payload = await response.text().catch(() => '');
    throw new Error(payload.trim() || `Vertex AI video download failed (${response.status}).`);
  }

  const mimeType = response.headers.get('content-type') || video.mimeType || 'video/mp4';
  const buffer = Buffer.from(await response.arrayBuffer());

  return {
    result: `data:${mimeType};base64,${buffer.toString('base64')}`,
    mimeType,
  };
}

async function runCancelableVertexGeneration(request, generate) {
  const controller = new AbortController();
  const cancellationId = typeof request?.cancellationId === 'string' && request.cancellationId.trim()
    ? request.cancellationId
    : undefined;
  if (cancellationId) {
    vertexGenerationControllers.set(cancellationId, controller);
  }
  try {
    return await generate(request, controller.signal);
  } finally {
    if (cancellationId && vertexGenerationControllers.get(cancellationId) === controller) {
      vertexGenerationControllers.delete(cancellationId);
    }
  }
}

function nativeCliAgentFailure(error) {
  if (error instanceof NativeCliAgentError) {
    return {
      ok: false,
      cancelled: error.code === 'cancelled',
      code: error.code,
      error: error.message,
    };
  }
  return {
    ok: false,
    code: 'failed',
    error: 'The local coding-agent request failed.',
  };
}

function vertexGcsUriToDownloadUrl(gcsUri) {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(gcsUri);

  if (!match) {
    return undefined;
  }

  const [, bucket, objectName] = match;
  return `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectName)}?alt=media`;
}

async function materializeSourceAsset(request, scratchJournal) {
  if (!currentScratchDirectoryPath) {
    return { error: 'No active Sloom Studio scratch directory is available.' };
  }

  if (!isPlainObject(request)) {
    return { error: 'Invalid source asset materialization request.' };
  }

  const binaryData = request.binaryData instanceof Uint8Array
    ? request.binaryData
    : request.binaryData instanceof ArrayBuffer
      ? new Uint8Array(request.binaryData)
      : ArrayBuffer.isView(request.binaryData)
        ? new Uint8Array(request.binaryData.buffer, request.binaryData.byteOffset, request.binaryData.byteLength)
        : Array.isArray(request.binaryData)
          ? Uint8Array.from(request.binaryData.filter((value) => Number.isFinite(value)).map((value) => Number(value)))
          : undefined;
  const hasDataUrl = typeof request.dataUrl === 'string';
  const requestedNativeFilePath = typeof request.nativeFilePath === 'string' && request.nativeFilePath.trim()
    ? resolve(request.nativeFilePath)
    : undefined;
  if (!hasDataUrl && !binaryData && !requestedNativeFilePath) {
    return { error: 'Invalid source asset materialization request.' };
  }

  try {
    const now = Date.now();
    const item = {
      id: typeof request.id === 'string' && request.id.trim() ? request.id : `source-bin-${now}`,
      label: typeof request.label === 'string' && request.label.trim() ? request.label : 'Generated asset',
      kind: typeof request.kind === 'string' && request.kind.trim() ? request.kind : 'image',
      mimeType: typeof request.mimeType === 'string' && request.mimeType.trim() ? request.mimeType : 'application/octet-stream',
      assetUrl: requestedNativeFilePath
        ? buildNativeAssetUrl(requestedNativeFilePath, typeof request.id === 'string' ? request.id : undefined)
        : request.dataUrl,
      pixelWidth: Number.isFinite(request.pixelWidth) ? request.pixelWidth : undefined,
      pixelHeight: Number.isFinite(request.pixelHeight) ? request.pixelHeight : undefined,
      createdAt: Number.isFinite(request.createdAt) ? request.createdAt : now,
      sourceKey: typeof request.sourceKey === 'string' ? request.sourceKey : undefined,
      originNodeId: typeof request.originNodeId === 'string' ? request.originNodeId : undefined,
      isGenerated: typeof request.isGenerated === 'boolean' ? request.isGenerated : undefined,
      starred: typeof request.starred === 'boolean' ? request.starred : undefined,
      collapsed: typeof request.collapsed === 'boolean' ? request.collapsed : undefined,
      envelopeId: typeof request.envelopeId === 'string' ? request.envelopeId : undefined,
      envelopeLabel: typeof request.envelopeLabel === 'string' ? request.envelopeLabel : undefined,
      envelopeIndex: Number.isFinite(request.envelopeIndex) ? request.envelopeIndex : undefined,
      envelopeCollapsed: typeof request.envelopeCollapsed === 'boolean' ? request.envelopeCollapsed : undefined,
      professional: isPlainObject(request.professional) ? request.professional : undefined,
    };

    if (requestedNativeFilePath) {
      if (!(await hasUsableNativeAsset(requestedNativeFilePath))) {
        return { error: 'The native render output is missing or empty.' };
      }

      const sourceAlreadyInScratch = resolve(dirname(requestedNativeFilePath)) === resolve(currentScratchDirectoryPath);
      const materializedItem = await materializeProjectSourceBinItem(
        {
          ...item,
          nativeFilePath: requestedNativeFilePath,
          scratchFileName: sourceAlreadyInScratch
            ? basename(requestedNativeFilePath)
            : buildNativeScratchFileName(item),
        },
        currentScratchDirectoryPath,
        [currentScratchDirectoryPath],
        new Map(),
        scratchJournal,
      );

      if (
        typeof materializedItem?.nativeFilePath !== 'string'
        || !(await hasUsableNativeAsset(materializedItem.nativeFilePath))
      ) {
        return { error: 'Could not register the native render output in the active scratch folder.' };
      }

      return { item: materializedItem };
    }

    if (binaryData) {
      await mkdir(currentScratchDirectoryPath, { recursive: true });
      const scratchFileName = buildNativeScratchFileName(item);
      const targetPath = join(currentScratchDirectoryPath, scratchFileName);

      await scratchJournal?.beforeWrite(targetPath);
      await writeFile(targetPath, Buffer.from(binaryData));

      if (!(await hasUsableNativeAsset(targetPath))) {
        return { error: 'Could not write the source asset into the active scratch folder.' };
      }

      return {
        item: {
          ...item,
          scratchFileName,
          nativeFilePath: targetPath,
          assetUrl: buildNativeAssetUrl(targetPath, item.id),
        },
      };
    }

    const materializedItem = await materializeProjectSourceBinItem(
      item,
      currentScratchDirectoryPath,
      [currentScratchDirectoryPath],
      new Map(),
      scratchJournal,
    );

    if (
      typeof materializedItem?.nativeFilePath !== 'string'
      || !(await hasUsableNativeAsset(materializedItem.nativeFilePath))
      || typeof materializedItem.assetUrl !== 'string'
      || !materializedItem.assetUrl.startsWith('signal-loom-asset://')
    ) {
      return { error: 'Could not write the source asset into the active scratch folder.' };
    }

    return {
      item: materializedItem,
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Could not materialize the source asset into the scratch folder.',
    };
  }
}

function assertLocalStandaloneDocumentIoAllowed(action, includeSeededState = false) {
  if (!remotePhoneHostAuthorityActive && !(includeSeededState && remotePhoneHostLocalSaveSuspended)) return;
  const error = new Error(remotePhoneHostAuthorityActive
    ? `Disconnect from the phone before ${action} a local standalone document.`
    : `Phone-owned state is still open. Use File > New or File > Open before ${action} a local standalone document.`);
  error.code = 'phone-host-authority';
  throw error;
}

function configureRemotePhoneHostState(baseUrl, preissuedToken) {
  if (remotePhoneHostBaseUrl && remotePhoneHostLocalSaveSuspended) {
    throw new Error('Disconnect the active phone workspace before linking another phone.');
  }
  const nextBaseUrl = normalizeRemotePhoneHostBaseUrl(baseUrl);
  remotePhoneHostGeneration += 1;
  remotePhoneHostBaseUrl = nextBaseUrl;
  remotePhoneHostToken = preissuedToken;
  remotePhoneHostVerifiedGeneration = undefined;
  remotePhoneHostAuthorityActive = false;
  return {
    ok: true,
    hostBaseUrl: remotePhoneHostBaseUrl,
    proxyApiBase: `${REMOTE_PHONE_PROXY_ORIGIN}/__loom/api`,
    generation: remotePhoneHostGeneration,
  };
}

function installIpcHandlers() {
  ipcMain.handle('signal-loom:remote-phone-host-configure', (_event, request) => {
    try {
      return configureRemotePhoneHostState(request?.baseUrl, undefined);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'The phone address is invalid.',
      };
    }
  });
  ipcMain.handle('signal-loom:remote-phone-host-activate', (_event, request) => {
    if (!remotePhoneHostBaseUrl
      || !Number.isSafeInteger(request?.generation)
      || request.generation !== remotePhoneHostGeneration
      || remotePhoneHostVerifiedGeneration !== remotePhoneHostGeneration) {
      return { ok: false, error: 'Configure and verify a phone host before activating its project authority.' };
    }
    // This is deliberately separate from configure: a typo or unreachable phone must not strand the
    // user's current local project behind the post-disconnect save guard. The renderer calls activate
    // only after the restricted proxy has returned a valid Sloom Studio health response and before it
    // hydrates any phone-owned state.
    remotePhoneHostLocalSaveSuspended = true;
    remotePhoneHostAuthorityActive = true;
    return { ok: true, generation: remotePhoneHostGeneration };
  });
  ipcMain.handle('signal-loom:remote-phone-host-mark-seeded', (_event, request) => {
    if (!remotePhoneHostBaseUrl
      || !Number.isSafeInteger(request?.generation)
      || request.generation !== remotePhoneHostGeneration) {
      return { ok: false, error: 'The phone configuration changed.' };
    }
    remotePhoneHostStateSeeded = true;
    remotePhoneHostLocalSaveSuspended = true;
    remotePhoneHostAuthorityActive = true;
    return { ok: true };
  });
  ipcMain.handle('signal-loom:remote-phone-host-disconnect', (_event, request) => {
    if (!Number.isSafeInteger(request?.generation) || request.generation !== remotePhoneHostGeneration) {
      return {
        ok: false,
        stale: true,
        error: 'The phone configuration changed before this disconnect completed.',
        localSaveSuspended: remotePhoneHostLocalSaveSuspended,
      };
    }
    remotePhoneHostGeneration += 1;
    remotePhoneHostBaseUrl = undefined;
    remotePhoneHostToken = undefined;
    remotePhoneHostVerifiedGeneration = undefined;
    remotePhoneHostAuthorityActive = false;
    // Retain suspension only if a seed actually entered the renderer. Disconnecting an unpaired,
    // never-seeded link must not strand the user's untouched local project behind a save guard.
    if (!remotePhoneHostStateSeeded) remotePhoneHostLocalSaveSuspended = false;
    return { ok: true, localSaveSuspended: remotePhoneHostLocalSaveSuspended };
  });
  ipcMain.handle('signal-loom:remote-phone-host-status', () => ({
    configured: Boolean(remotePhoneHostBaseUrl),
    hostBaseUrl: remotePhoneHostBaseUrl,
    paired: Boolean(remotePhoneHostToken),
    generation: remotePhoneHostGeneration,
    verified: remotePhoneHostVerifiedGeneration === remotePhoneHostGeneration,
    authorityActive: remotePhoneHostAuthorityActive,
    stateSeeded: remotePhoneHostStateSeeded,
    localSaveSuspended: remotePhoneHostLocalSaveSuspended,
    proxyApiBase: `${REMOTE_PHONE_PROXY_ORIGIN}/__loom/api`,
  }));
  ipcMain.handle('signal-loom:hane-qr-pairing-begin', async () => {
    try {
      if (remotePhoneHostBaseUrl && remotePhoneHostLocalSaveSuspended) {
        return { ok: false, error: 'Disconnect the active phone workspace before linking Hane.' };
      }
      haneQrPairingSession?.close();
      haneQrPairingSession = await startHaneQrPairingServer({
        deviceLabel: `Sloom Studio on ${process.platform}`,
      });
      return { ok: true, ...haneQrPairingSession.invitation };
    } catch (error) {
      haneQrPairingSession?.close();
      haneQrPairingSession = undefined;
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Could not create a Hane pairing invitation.',
      };
    }
  });
  ipcMain.handle('signal-loom:hane-qr-pairing-poll', (_event, request) => {
    if (!haneQrPairingSession) {
      return { status: 'invalid', error: 'That QR invitation is no longer active.' };
    }
    const outcome = haneQrPairingSession.poll(request?.invitationId);
    if (outcome.status !== 'completed') {
      if (outcome.status === 'expired' || outcome.status === 'invalid') {
        haneQrPairingSession.close();
        haneQrPairingSession = undefined;
      }
      return outcome;
    }
    try {
      const configured = configureRemotePhoneHostState(outcome.haneUrl, outcome.token);
      const result = {
        status: 'completed',
        hostBaseUrl: configured.hostBaseUrl,
        proxyApiBase: configured.proxyApiBase,
        generation: configured.generation,
        haneDeviceLabel: outcome.haneDeviceLabel,
        tokenCustodied: true,
      };
      haneQrPairingSession.close();
      haneQrPairingSession = undefined;
      return result;
    } catch (error) {
      haneQrPairingSession.close();
      haneQrPairingSession = undefined;
      return {
        status: 'invalid',
        error: error instanceof Error ? error.message : 'Hane could not be configured.',
      };
    }
  });
  ipcMain.handle('signal-loom:hane-qr-pairing-cancel', (_event, request) => {
    if (!haneQrPairingSession) return { ok: true };
    const outcome = haneQrPairingSession.poll(request?.invitationId);
    if (outcome.status === 'invalid') {
      return { ok: false, error: 'That QR invitation is no longer active.' };
    }
    haneQrPairingSession.close();
    haneQrPairingSession = undefined;
    return { ok: true };
  });

  // Dedicated font-transport capability (FBL-025): a complete signalLoomNative bridge is
  // installed even when signal-loom-font:// has no usable root (every request 404s), so the
  // renderer must query this rather than infer availability from generic bridge shape.
  // Keep startup/reload installation idempotent and release the handler on app teardown. This
  // matters in Electron test/reload lifecycles where a second registration would otherwise throw.
  ipcMain.removeHandler(BUNDLED_FONT_LIBRARY_STATUS_CHANNEL);
  ipcMain.handle(BUNDLED_FONT_LIBRARY_STATUS_CHANNEL, () => ({
    available: Boolean(resolvedBundledFontLibraryRoot),
  }));

  ipcMain.handle('signal-loom:get-native-state', (event) => {
    const window = getIpcWindow(event);
    return {
      currentProjectPath,
      currentScratchDirectoryPath,
      startupProject,
      startupProjectRecovery,
      reopenLastProjectOnStartup,
      interfaceLocale: interfaceLocaleAuthority.getCurrent(),
      workspace: window ? getWorkspaceForWindow(window) ?? activeWorkspace : activeWorkspace,
      platform: process.platform,
      isDev,
      projectAuthority: projectAuthority.getCurrent(),
      webContentsId: event.sender.id,
    };
  });

  ipcMain.handle('signal-loom:set-reopen-last-project-on-startup', async (_event, enabled) => ({
    reopenLastProjectOnStartup: await setReopenLastProjectOnStartup(enabled === true),
  }));

  ipcMain.handle('signal-loom:startup-project-retry', async (event, request) => {
    if (!startupProjectRecovery?.filePath) {
      return { canceled: false, rejected: { code: 'prepare-failed', message: 'There is no remembered project waiting for recovery.', current: projectAuthority.getCurrent() } };
    }
    return prepareStartupRecoveryProjectOpen(event, startupProjectRecovery.filePath, request);
  });

  ipcMain.handle('signal-loom:startup-project-recover-backup', async (event, request) => {
    const backupPath = request?.filePath;
    const allowedBackup = startupProjectRecovery?.backups?.some((backup) => backup.filePath === backupPath);
    if (!allowedBackup) {
      return { canceled: false, rejected: { code: 'prepare-failed', message: 'That project backup is no longer available from the recovery list.', current: projectAuthority.getCurrent() } };
    }
    return prepareStartupRecoveryProjectOpen(event, backupPath, request);
  });

  ipcMain.handle('signal-loom:startup-project-dismiss', () => {
    // Continue Blank is session-only. The remembered path and opt-in preference remain on disk so
    // a temporary drive problem can be retried on the next launch.
    startupProjectRecovery = undefined;
    return { ok: true };
  });

  ipcMain.handle('signal-loom:clear-project-path', async (event, request) => {
    if (remotePhoneHostAuthorityActive) {
      return {
        canceled: false,
        rejected: {
          code: 'phone-host-authority',
          message: 'Disconnect from the phone before creating a local project.',
          current: projectAuthority.getCurrent(),
        },
      };
    }
    const rendererEpoch = getRendererAuthorityEpoch(event.sender.id);
    return projectAuthority.prepareClearProject({
      senderId: event.sender.id,
      rendererEpoch,
      isSenderLive: () => isLiveAuthoritySender(event.sender, rendererEpoch) && !remotePhoneHostAuthorityActive,
      claim: request?.claim,
      // Do not clear Source/startup before the final authority commit. The staged reset can be
      // rolled back if the sender disappears or publication fails.
      reset: stageBlankProjectReset,
    });
  });

  // Main owns every document intent until a single designated Flow renderer completes the
  // authorize → offer → accept/reject → commit protocol. Preparing an offer reads and validates
  // bytes only. Canonical roots, source state, startup baton, remembered path, and broadcasts do
  // not move until the renderer explicitly accepts after its dirty-document guard succeeds.
  ipcMain.handle('signal-loom:external-open-authorize', (event) =>
    serializeExternalOpenLifecycle(async () => {
      if (!isDesignatedExternalOpenRenderer(event.sender)) {
        return { authorized: false, reason: 'not-designated-renderer' };
      }
      const rendererId = externalOpenRendererId(event.sender);
      const outcome = externalOpenQueue.authorizeRenderer(rendererId);
      for (const intentId of outcome.releasedIntentIds ?? []) {
        await releaseExternalOpenIntent(intentId);
      }
      externalOpenRendererAuthorization = { rendererId, epoch: outcome.epoch };
      return { authorized: true, epoch: outcome.epoch };
    }));

  ipcMain.handle('signal-loom:external-open-next', (event, epoch) =>
    serializeExternalOpenLifecycle(async () => {
      const authorization = { rendererId: externalOpenRendererId(event.sender), epoch };
      if (!isAuthorizedExternalOpenRequest(event.sender, authorization)) {
        return { status: 'unauthorized' };
      }
      if (remotePhoneHostAuthorityActive) {
        return { status: 'blocked', reason: 'phone-host-authority' };
      }
      const outcome = externalOpenQueue.offerNextDocumentIntent(authorization);
      if (outcome.status !== 'offered') return outcome;

      let prepared = preparedExternalOpenIntents.get(outcome.intent.id);
      if (!prepared) {
        try {
          if (outcome.intent.kind === 'project') {
            const rendererEpoch = getRendererAuthorityEpoch(event.sender.id);
            const staged = await openProjectDocumentFromBytes(
              outcome.intent.filePath,
              outcome.intent.bytes,
              () => isLiveAuthoritySender(event.sender, rendererEpoch),
            );
            const { preparedPublication: _preparedPublication, ...result } = staged.result;
            prepared = { result, staged };
          } else {
            prepared = { bytes: outcome.intent.bytes };
          }
        } catch (error) {
          prepared = {
            error: error instanceof Error
              ? error.message
              : outcome.intent.kind === 'project'
                ? 'The project file could not be opened.'
                : 'The layout file could not be opened.',
          };
        }
        preparedExternalOpenIntents.set(outcome.intent.id, prepared);
      }
      const publicPrepared = prepared.error
        ? { error: prepared.error }
        : prepared.result
          ? { result: prepared.result }
          : { bytes: prepared.bytes };
      const { bytes: _queuedBytes, ...publicIntent } = outcome.intent;
      return { status: 'offered', state: outcome.state, intent: { ...publicIntent, ...publicPrepared } };
    }));

  ipcMain.handle('signal-loom:external-open-accept', (event, request) =>
    serializeExternalOpenLifecycle(async () => {
      const authorization = { rendererId: externalOpenRendererId(event.sender), epoch: request?.epoch };
      if (!isAuthorizedExternalOpenRequest(event.sender, authorization)) return { status: 'unauthorized' };
      if (remotePhoneHostAuthorityActive) return { status: 'blocked', reason: 'phone-host-authority' };
      const prepared = preparedExternalOpenIntents.get(request?.intentId);
      if (!prepared || prepared.error) return { status: 'invalid-state' };
      const outcome = externalOpenQueue.acceptDocumentIntent({ ...authorization, intentId: request?.intentId });
      if (outcome.status !== 'accepted') return outcome;
      if (prepared.result) {
        try {
          await stageAcceptedExternalProject(request.intentId, prepared, event.sender);
        } catch (error) {
          externalOpenQueue.rejectDocumentIntent({ ...authorization, intentId: request.intentId });
          preparedExternalOpenIntents.delete(request.intentId);
          return { status: 'error', error: error instanceof Error ? error.message : String(error) };
        }
      }
      return outcome;
    }));

  ipcMain.handle('signal-loom:external-open-reject', (event, request) =>
    serializeExternalOpenLifecycle(async () => {
      const authorization = { rendererId: externalOpenRendererId(event.sender), epoch: request?.epoch };
      if (!isAuthorizedExternalOpenRequest(event.sender, authorization)) return { status: 'unauthorized' };
      await releaseExternalOpenIntent(request?.intentId);
      const outcome = externalOpenQueue.rejectDocumentIntent({ ...authorization, intentId: request?.intentId });
      return outcome;
    }));

  ipcMain.handle('signal-loom:external-open-commit', (event, request) =>
    serializeExternalOpenLifecycle(async () => {
      const authorization = { rendererId: externalOpenRendererId(event.sender), epoch: request?.epoch };
      if (!isAuthorizedExternalOpenRequest(event.sender, authorization)) return { status: 'unauthorized' };
      if (remotePhoneHostAuthorityActive) return { status: 'blocked', reason: 'phone-host-authority' };
      const completedProject = completedExternalProjectCommits.get(request?.intentId);
      const outcome = acceptedExternalProjectTransactions.has(request?.intentId)
        ? await commitAcceptedExternalProject(request.intentId, authorization)
        : {
            ...externalOpenQueue.commitDocumentIntent({ ...authorization, intentId: request?.intentId }),
            ...(completedProject ?? {}),
          };
      if (outcome.status === 'committed') preparedExternalOpenIntents.delete(request.intentId);
      return outcome;
    }));

  ipcMain.handle('signal-loom:external-open-release', (event, epoch) =>
    serializeExternalOpenLifecycle(async () => {
      const authorization = { rendererId: externalOpenRendererId(event.sender), epoch };
      if (!isAuthorizedExternalOpenRequest(event.sender, authorization)) return { status: 'unauthorized' };
      const outcome = externalOpenQueue.revokeRenderer(authorization);
      for (const intentId of outcome.releasedIntentIds ?? []) {
        await releaseExternalOpenIntent(intentId);
      }
      externalOpenRendererAuthorization = undefined;
      return outcome;
    }));

  ipcMain.handle('signal-loom:project-open', async (event, request) => {
    if (remotePhoneHostAuthorityActive) {
      return {
        canceled: false,
        rejected: {
          code: 'phone-host-authority',
          message: 'Disconnect from the phone before opening a local project.',
          current: projectAuthority.getCurrent(),
        },
      };
    }
    const rendererEpoch = getRendererAuthorityEpoch(event.sender.id);
    const isSenderLive = () => isLiveAuthoritySender(event.sender, rendererEpoch) && !remotePhoneHostAuthorityActive;
    const automationPath = getAutomationProjectOpenPath(process.env);
    if (automationPath) {
      return projectAuthority.prepareOpenProject({
        senderId: event.sender.id,
        rendererEpoch,
        isSenderLive,
        claim: request?.claim,
        load: () => openProjectDocumentFromPath(automationPath, isSenderLive),
      });
    }

    const result = await dialog.showOpenDialog(getIpcWindow(event), {
      title: 'Open Sloom Studio Project',
      properties: ['openFile'],
      filters: getProjectDialogFilters(),
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }
    if (!isSenderLive()) {
      return { canceled: false, rejected: { code: 'sender-gone', message: 'The requesting window is no longer live.', current: projectAuthority.getCurrent() } };
    }

    return projectAuthority.prepareOpenProject({
      senderId: event.sender.id,
      rendererEpoch,
      isSenderLive,
      claim: request?.claim,
      load: () => openProjectDocumentFromPath(result.filePaths[0], isSenderLive),
    });
  });

  ipcMain.handle('signal-loom:project-open-request', async (event) => {
    if (remotePhoneHostAuthorityActive) {
      return { canceled: false, error: 'Disconnect from the phone before opening a local project.' };
    }
    const result = await dialog.showOpenDialog(getIpcWindow(event), {
      title: 'Open Sloom Studio Project',
      properties: ['openFile'],
      filters: getProjectDialogFilters(),
    });
    if (result.canceled || result.filePaths.length === 0) return { canceled: true };
    if (remotePhoneHostAuthorityActive) {
      return { canceled: false, error: 'The phone was linked while the file chooser was open. Disconnect before opening a local project.' };
    }

    const filePath = result.filePaths[0];
    const outcome = enqueueExternalOpenValue(filePath, createExternalOpenDeliveryId());
    if (outcome.status !== 'enqueued' && outcome.status !== 'duplicate') {
      return {
        canceled: false,
        filePath,
        error: `The selected project could not enter the open queue (${outcome.reason ?? outcome.status}).`,
      };
    }
    dispatchPendingExternalOpenRequests();
    return { canceled: false, filePath, queued: true };
  });

  ipcMain.handle('signal-loom:project-switch-commit', async (event, request) => {
    if (remotePhoneHostAuthorityActive) {
      return {
        canceled: false,
        rejected: {
          code: 'phone-host-authority',
          message: 'A local project switch cannot commit while the phone owns the open workspaces.',
          current: projectAuthority.getCurrent(),
        },
      };
    }
    const rendererEpoch = getRendererAuthorityEpoch(event.sender.id);
    const result = await projectAuthority.commitPreparedProject({
      transactionId: request?.transactionId,
      senderId: event.sender.id,
      rendererEpoch,
      publish: publishCommittedProjectSnapshot,
      restorePublish: restoreCommittedProjectSnapshot,
    });
    if (!remotePhoneHostAuthorityActive && !result?.rejected && !result?.canceled && !result?.stale) {
      remotePhoneHostLocalSaveSuspended = false;
      remotePhoneHostStateSeeded = false;
    }
    return result;
  });

  ipcMain.handle('signal-loom:project-switch-cancel', async (event, request) => {
    const rendererEpoch = getRendererAuthorityEpoch(event.sender.id);
    return projectAuthority.cancelPreparedProject({
      transactionId: request?.transactionId,
      senderId: event.sender.id,
      rendererEpoch,
    });
  });

  ipcMain.handle('signal-loom:project-save', async (event, payload) => {
    if (remotePhoneHostAuthorityActive || remotePhoneHostLocalSaveSuspended) {
      return {
        rejected: {
          code: 'phone-host-authority',
          message: remotePhoneHostAuthorityActive
            ? 'This desktop is editing the phone-owned project. Save on the phone authority, or disconnect and open/new a local project first.'
            : 'Phone-owned state is still open. Use File > Open or File > New before saving to a local project path.',
          current: projectAuthority.getCurrent(),
        },
      };
    }
    const rendererEpoch = getRendererAuthorityEpoch(event.sender.id);
    const isSaveAuthorityLive = () => isLiveAuthoritySender(event.sender, rendererEpoch)
      && !remotePhoneHostAuthorityActive
      && !remotePhoneHostLocalSaveSuspended;
    const { document, claim } = normalizeProjectSavePayload(payload);

    const result = await projectAuthority.saveProject({
      senderId: event.sender.id,
      rendererEpoch,
      // Rechecked by projectAuthority inside its exclusive lease and repeatedly during staged I/O.
      // Connecting a phone while a Save As dialog is open therefore invalidates that save before commit.
      isSenderLive: isSaveAuthorityLive,
      claim,
      resolveFilePath: (currentFilePath) => {
        const automationPath = getAutomationProjectSavePath(process.env);
        if (automationPath) {
          return ensureSignalLoomProjectExtension(automationPath);
        }
        return shouldWriteProjectSaveDirectly(currentFilePath)
          ? currentFilePath
          : chooseProjectSavePath(currentFilePath, getIpcWindow(event));
      },
      write: (filePath, isLiveImmediatelyBeforeWrite) => writeProjectDocument(filePath, document, isLiveImmediatelyBeforeWrite),
      publish: publishCommittedProjectSnapshot,
      restorePublish: restoreCommittedProjectSnapshot,
    });
    return result.rejected || result.canceled
      ? result
      : { ...result, sourceLibraryVersion };
  });

  ipcMain.handle('signal-loom:project-save-as', async (event, payload) => {
    if (remotePhoneHostAuthorityActive || remotePhoneHostLocalSaveSuspended) {
      return {
        rejected: {
          code: 'phone-host-authority',
          message: remotePhoneHostAuthorityActive
            ? 'This desktop is editing the phone-owned project. Save on the phone authority, or disconnect and open/new a local project first.'
            : 'Phone-owned state is still open. Use File > Open or File > New before saving to a local project path.',
          current: projectAuthority.getCurrent(),
        },
      };
    }
    const rendererEpoch = getRendererAuthorityEpoch(event.sender.id);
    const isSaveAuthorityLive = () => isLiveAuthoritySender(event.sender, rendererEpoch)
      && !remotePhoneHostAuthorityActive
      && !remotePhoneHostLocalSaveSuspended;
    const { document, claim } = normalizeProjectSavePayload(payload);

    const result = await projectAuthority.saveProject({
      senderId: event.sender.id,
      rendererEpoch,
      isSenderLive: isSaveAuthorityLive,
      claim,
      resolveFilePath: (currentFilePath) => chooseProjectSavePath(currentFilePath, getIpcWindow(event)),
      write: (filePath, isLiveImmediatelyBeforeWrite) => writeProjectDocument(filePath, document, isLiveImmediatelyBeforeWrite),
      publish: publishCommittedProjectSnapshot,
      restorePublish: restoreCommittedProjectSnapshot,
    });
    return result.rejected || result.canceled
      ? result
      : { ...result, sourceLibraryVersion };
  });

  ipcMain.handle('signal-loom:project-adopt', async () => {
    return projectAuthority.buildAdoptResponse();
  });

  ipcMain.handle('signal-loom:project-confirm-adoption', async (event, claim) => {
    const rendererEpoch = getRendererAuthorityEpoch(event.sender.id);
    return projectAuthority.confirmAdoption(
      event.sender.id,
      claim,
      rendererEpoch,
      () => isLiveAuthoritySender(event.sender, rendererEpoch),
    );
  });

  ipcMain.handle('signal-loom:image-open', async (event) => {
    assertLocalStandaloneDocumentIoAllowed('opening');
    const result = await dialog.showOpenDialog(getIpcWindow(event), {
      title: 'Open Sloom Studio Image',
      properties: ['openFile'],
      filters: [
        { name: 'Sloom Studio Image', extensions: ['slimg'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    assertLocalStandaloneDocumentIoAllowed('opening');
    const path = result.filePaths[0];
    const bytes = await readFile(path);
    return { canceled: false, bytes, path };
  });

  ipcMain.handle('signal-loom:image-save-as', async (event, bytes) => {
    assertLocalStandaloneDocumentIoAllowed('saving', true);
    const result = await dialog.showSaveDialog(getIpcWindow(event), {
      title: 'Save Sloom Studio Image',
      filters: [
        { name: 'Sloom Studio Image', extensions: ['slimg'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    assertLocalStandaloneDocumentIoAllowed('saving', true);
    const path = result.filePath.toLowerCase().endsWith('.slimg')
      ? result.filePath
      : `${result.filePath}.slimg`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.from(bytes));
    return { canceled: false, path };
  });

  ipcMain.handle('signal-loom:local-upscaler-status', () => getLocalUpscalerStatus());
  ipcMain.handle('signal-loom:local-upscaler-install', () => installLocalUpscaler());
  ipcMain.handle('signal-loom:local-upscaler-start', () => startLocalUpscaler());
  ipcMain.handle('signal-loom:local-upscaler-stop', () => stopLocalUpscaler());

  ipcMain.handle('signal-loom:crash-report-state', () => crashReportController?.getState());
  ipcMain.handle('signal-loom:crash-report-set-enabled', (_event, enabled) =>
    crashReportController?.setEnabled(enabled === true));
  ipcMain.handle('signal-loom:crash-report-clear', () => crashReportController?.clearReports());
  ipcMain.handle('signal-loom:crash-report-record', (_event, report) =>
    crashReportController?.recordRendererReport(report));

  // Overwrite a .slimg the renderer already knows the path of (the linked-edit round-trip's
  // "close tab → save & return"), with no dialog. Like image-read-path, the path originates
  // from a prior open/save dialog the user authorized, and only .slimg targets are accepted.
  ipcMain.handle('signal-loom:image-write-path', async (_event, path, bytes) => {
    try {
      assertLocalStandaloneDocumentIoAllowed('saving', true);
      if (typeof path !== 'string' || !path.toLowerCase().endsWith('.slimg')) {
        return { error: 'Only .slimg paths from a prior dialog can be overwritten.' };
      }
      await writeFile(path, Buffer.from(bytes));
      return { ok: true };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  // Re-read a .slimg the renderer already knows the path of (e.g. the .slimg Flow node's "Read disk"),
  // with no dialog. The path originates from a prior open/save dialog the user authorized.
  ipcMain.handle('signal-loom:image-read-path', async (_event, path) => {
    try {
      if (typeof path !== 'string' || !path) {
        return { error: 'No file path provided.' };
      }
      const bytes = await readFile(path);
      return { bytes };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('signal-loom:paper-open', async (event) => {
    assertLocalStandaloneDocumentIoAllowed('opening');
    const result = await dialog.showOpenDialog(getIpcWindow(event), {
      title: 'Open Sloom Studio Paper',
      properties: ['openFile'],
      filters: [
        { name: 'Sloom Studio Paper', extensions: ['slppr'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    assertLocalStandaloneDocumentIoAllowed('opening');
    const path = result.filePaths[0];
    const bytes = await readFile(path);
    return { canceled: false, bytes, path };
  });

  ipcMain.handle('signal-loom:paper-save-as', async (event, bytes) => {
    assertLocalStandaloneDocumentIoAllowed('saving', true);
    const result = await dialog.showSaveDialog(getIpcWindow(event), {
      title: 'Save Sloom Studio Paper',
      filters: [
        { name: 'Sloom Studio Paper', extensions: ['slppr'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    assertLocalStandaloneDocumentIoAllowed('saving', true);
    const path = result.filePath.toLowerCase().endsWith('.slppr')
      ? result.filePath
      : `${result.filePath}.slppr`;
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.from(bytes));
    return { canceled: false, path };
  });

  ipcMain.handle('signal-loom:paper-write-path', async (_event, path, bytes) => {
    try {
      assertLocalStandaloneDocumentIoAllowed('saving', true);
      if (typeof path !== 'string' || !path.toLowerCase().endsWith('.slppr')) {
        return { error: 'Only .slppr paths from an acknowledged Open or Save dialog can be overwritten.' };
      }
      await writeFile(path, Buffer.from(bytes));
      return { ok: true, path };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('signal-loom:normalize-imported-media-batch', async (_event, items) => {
    return normalizeImportedMediaBatchInMain(items);
  });

  ipcMain.handle('signal-loom:import-media-files', async (event, options = {}) => {
    const rendererEpoch = getRendererAuthorityEpoch(event.sender.id);
    const isSenderLive = () => isLiveAuthoritySender(event.sender, rendererEpoch);
    const precheck = projectAuthority.authorizeSave(event.sender.id, options?.claim, rendererEpoch, isSenderLive);
    if (!precheck.ok) return { canceled: false, items: [], rejected: precheck.rejected, error: precheck.rejected.message };
    const automationPaths = getAutomationImportMediaPaths(process.env);
    let filePaths = automationPaths;

    if (!filePaths) {
      const result = await dialog.showOpenDialog(getIpcWindow(event), {
        title: 'Import Media',
        properties: ['openFile', 'multiSelections'],
        filters: getElectronDialogFilterGroups(options?.kinds),
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { canceled: true, items: [] };
      }

      filePaths = result.filePaths;
    }

    return projectAuthority.runAuthorizedMutation({
      senderId: event.sender.id,
      rendererEpoch,
      isSenderLive,
      claim: options?.claim,
      prepare: async () => {
        const normalizedItems = await normalizeImportedMediaBatchInMain(
          filePaths.map((filePath) => ({ filePath })),
        );
        const materialized = (await Promise.all(
          normalizedItems.map((item) => materializeNativeImport(
            item,
            options?.mediaHandling === 'link' ? undefined : options.scratchDirectoryPath,
          )),
        )).filter(Boolean);
        const items = materialized.map((entry) => entry.item);
        return {
          items,
          createdPaths: materialized.map((entry) => entry.createdPath).filter(Boolean),
          preparedCapabilities: await prepareNativeAssetCapabilitiesFromSourceBin({ items }, { allowExternal: true }),
        };
      },
      commit: ({ items, preparedCapabilities }) => {
        commitNativeAssetCapabilities(preparedCapabilities, { replace: false });
        return { canceled: false, items };
      },
      rollback: async ({ createdPaths }) => {
        await Promise.all(createdPaths.map((filePath) => rm(filePath, { force: true })));
      },
    });
  });

  ipcMain.handle('signal-loom:video-media-relink', async (event, request = {}) => {
    const rendererEpoch = getRendererAuthorityEpoch(event.sender.id);
    const isSenderLive = () => isLiveAuthoritySender(event.sender, rendererEpoch);
    const precheck = projectAuthority.authorizeSave(event.sender.id, request?.claim, rendererEpoch, isSenderLive);
    if (!precheck.ok) return { canceled: false, rejected: precheck.rejected, error: precheck.rejected.message };
    const currentItem = findSourceLibraryItem(request?.itemId);
    if (!currentItem || !isProfessionalManagedMediaKind(currentItem.kind)) {
      return { canceled: false, error: 'Select an existing file-backed Source Library item to relink.' };
    }
    const expectedKind = currentItem.kind === 'composition' ? 'video' : currentItem.kind;
    const result = await dialog.showOpenDialog(getIpcWindow(event), {
      title: `Relink ${currentItem.label}`,
      properties: ['openFile'],
      filters: getElectronDialogFilterGroups([expectedKind]),
    });
    if (result.canceled || result.filePaths.length !== 1) return { canceled: true };
    const candidatePath = result.filePaths[0];

    return projectAuthority.runAuthorizedMutation({
      senderId: event.sender.id,
      rendererEpoch,
      isSenderLive,
      claim: request?.claim,
      prepare: async () => {
        const item = findSourceLibraryItem(request?.itemId);
        if (!item || !isProfessionalManagedMediaKind(item.kind)) throw new Error('The media item no longer exists.');
        const candidateKind = inferSourceKindFromFile(candidatePath);
        if (!mediaKindMatchesRelink(item.kind, candidateKind)) {
          throw new Error(`Relink requires ${item.kind === 'composition' ? 'video' : item.kind} media, but the selected file is ${candidateKind ?? 'unsupported'}.`);
        }
        const inspected = await inspectRelinkCandidate({
          filePath: candidatePath,
          expectedFingerprint: item.professional?.sourceFingerprint,
        });
        const updatedItem = buildManagedMediaItem(item, {
          filePath: inspected.canonicalPath,
          fingerprint: inspected.fingerprint,
          resetProxy: true,
        });
        updatedItem.mimeType = inferMimeTypeFromFile(inspected.canonicalPath, candidateKind);
        const snapshot = replaceSourceLibraryItems([updatedItem]);
        const preparedCapabilities = await prepareNativeAssetCapabilitiesFromSourceBin(snapshot, {
          // Only the exact chooser-returned candidate gains a new external capability.
          // Other persisted paths in the snapshot must already be registered or project-owned.
          verifiedExternalPaths: [inspected.canonicalPath],
        });
        return { updatedItem, snapshot, preparedCapabilities };
      },
      commit: ({ updatedItem, snapshot, preparedCapabilities }) => {
        const version = commitSourceLibrarySnapshot(snapshot, preparedCapabilities, {
          broadcast: true,
          change: { type: 'source-library-snapshot', snapshot },
        });
        return { ok: true, canceled: false, item: updatedItem, version };
      },
    });
  });

  ipcMain.handle('signal-loom:video-media-availability', async (event, request = {}) => {
    const rendererEpoch = getRendererAuthorityEpoch(event.sender.id);
    const authorization = projectAuthority.authorizeSave(
      event.sender.id,
      request?.claim,
      rendererEpoch,
      () => isLiveAuthoritySender(event.sender, rendererEpoch),
    );
    if (!authorization.ok) {
      return { rejected: authorization.rejected, error: authorization.rejected.message };
    }
    const itemIds = Array.isArray(request?.itemIds)
      ? [...new Set(request.itemIds
          .filter((itemId) => typeof itemId === 'string' && itemId.trim())
          .map((itemId) => itemId.trim()))].slice(0, MAX_CONSOLIDATION_ENTRIES)
      : [];
    const items = await Promise.all(itemIds.map(async (itemId) => {
      const item = findSourceLibraryItem(itemId);
      return {
        itemId,
        available: Boolean(item && isProfessionalManagedMediaKind(item.kind) && await resolveRegisteredNativeAssetPath(item)),
      };
    }));
    return { ok: true, items, authority: projectAuthority.getCurrent() };
  });

  ipcMain.handle('signal-loom:video-media-consolidate', async (event, request = {}) => {
    const rendererEpoch = getRendererAuthorityEpoch(event.sender.id);
    const isSenderLive = () => isLiveAuthoritySender(event.sender, rendererEpoch);
    const precheck = projectAuthority.authorizeSave(event.sender.id, request?.claim, rendererEpoch, isSenderLive);
    if (!precheck.ok) return { canceled: false, rejected: precheck.rejected, error: precheck.rejected.message };
    const requestedIds = Array.isArray(request?.itemIds)
      ? [...new Set(request.itemIds.filter((itemId) => typeof itemId === 'string' && itemId.trim()).map((itemId) => itemId.trim()))]
      : [];
    if (requestedIds.length === 0 || requestedIds.length > MAX_CONSOLIDATION_ENTRIES) {
      return { canceled: false, error: `Select between 1 and ${MAX_CONSOLIDATION_ENTRIES} used media items to consolidate.` };
    }
    const result = await dialog.showOpenDialog(getIpcWindow(event), {
      title: 'Choose Consolidated Media Folder',
      defaultPath: currentProjectPath ? join(dirname(currentProjectPath), 'Media') : undefined,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length !== 1) return { canceled: true };
    const targetDirectory = result.filePaths[0];

    return projectAuthority.runAuthorizedMutation({
      senderId: event.sender.id,
      rendererEpoch,
      isSenderLive,
      claim: request?.claim,
      prepare: async () => {
        const items = requestedIds.map((itemId) => findSourceLibraryItem(itemId));
        if (items.some((item) => !item || !isProfessionalManagedMediaKind(item.kind))) throw new Error('One or more selected media items no longer exist.');
        const entries = [];
        for (const item of items) {
          const registeredPath = await resolveRegisteredNativeAssetPath(item);
          if (!registeredPath) {
            throw new Error(`Media '${item.label}' is offline or is not backed by an authorized native capability.`);
          }
          entries.push({
            itemId: item.id,
            sourcePath: registeredPath,
            fileName: basename(registeredPath),
            expectedFingerprint: item.professional?.sourceFingerprint,
          });
        }
        const transaction = await createMediaConsolidationTransaction({ entries, targetDirectory });
        const byItemId = new Map(items.map((item) => [item.id, item]));
        const updatedItems = transaction.entries.map((entry) => buildManagedMediaItem(byItemId.get(entry.itemId), {
          filePath: entry.targetPath,
          fingerprint: entry.fingerprint,
          resetProxy: false,
        }));
        const snapshot = replaceSourceLibraryItems(updatedItems);
        const preparedCapabilities = await prepareNativeAssetCapabilitiesFromSourceBin(snapshot, {
          // These exact direct-child targets do not exist until the closed synchronous commit.
          // The transaction already owns verified same-directory staging files for each path.
          verifiedPendingPaths: transaction.entries.map((entry) => entry.targetPath),
        });
        return { transaction, updatedItems, snapshot, preparedCapabilities };
      },
      commit: ({ transaction, updatedItems, snapshot, preparedCapabilities }) => {
        let transactionCommitted = false;
        try {
          transaction.commit();
          transactionCommitted = true;
          const version = commitSourceLibrarySnapshot(snapshot, preparedCapabilities, {
            broadcast: true,
            change: { type: 'source-library-snapshot', snapshot },
          });
          transaction.finalize();
          return {
            ok: true,
            canceled: false,
            items: updatedItems,
            targetDirectory: transaction.targetDirectory,
            version,
          };
        } catch (error) {
          transaction.rollback();
          if (transactionCommitted) {
            throw buildConsolidationPostCommitError(error, transaction);
          }
          throw error;
        }
      },
      rollback: ({ transaction }) => transaction.rollback(),
    });
  });

  ipcMain.handle('signal-loom:paper-choose-pdf-export-path', async (event, request) => {
    try {
      const filePath = await choosePaperPdfSavePath(request, getIpcWindow(event));
      return filePath ? { canceled: false, filePath } : { canceled: true };
    } catch (error) {
      return {
        canceled: false,
        error: error instanceof Error ? error.message : 'Failed to choose the Paper PDF destination.',
      };
    }
  });

  ipcMain.handle('signal-loom:paper-choose-image-export-directory', async (event, request) => {
    try {
      const directoryPath = await choosePaperImageExportDirectory(request, getIpcWindow(event));
      return directoryPath ? { canceled: false, directoryPath } : { canceled: true };
    } catch (error) {
      return {
        canceled: false,
        error: error instanceof Error ? error.message : 'Failed to choose the Paper page-image destination.',
      };
    }
  });

  ipcMain.handle('signal-loom:paper-export-pdf', async (event, request) => {
    if (!request || typeof request.html !== 'string' || !request.html.trim()) {
      return {
        canceled: false,
        error: 'No Paper document HTML was provided for PDF export.',
      };
    }

    const requestedFilePath = typeof request.filePath === 'string' && isAbsolute(request.filePath)
      ? ensurePdfExtension(request.filePath)
      : undefined;
    const filePath = requestedFilePath ?? await choosePaperPdfSavePath(request, getIpcWindow(event));

    if (!filePath) {
      return { canceled: true };
    }

    try {
      return await exportPaperPdfToFile(request, filePath);
    } catch (error) {
      return {
        canceled: false,
        error: error instanceof Error ? error.message : 'Failed to export the Paper PDF.',
      };
    }
  });

  ipcMain.handle('signal-loom:paper-save-pdf-bytes', async (event, request) => {
    try {
      const bytes = request?.bytes instanceof Uint8Array
        ? Buffer.from(request.bytes)
        : ArrayBuffer.isView(request?.bytes)
          ? Buffer.from(request.bytes.buffer, request.bytes.byteOffset, request.bytes.byteLength)
          : Array.isArray(request?.bytes)
            ? Buffer.from(request.bytes)
            : undefined;
      if (!bytes?.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
        return { canceled: false, error: 'Validated Paper PDF bytes are missing a valid PDF header.' };
      }

      const requestedFilePath = typeof request?.filePath === 'string' && isAbsolute(request.filePath)
        ? ensurePdfExtension(request.filePath)
        : undefined;
      const filePath = requestedFilePath ?? await choosePaperPdfSavePath(request, getIpcWindow(event));
      if (!filePath) return { canceled: true };

      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, bytes);
      return {
        canceled: false,
        filePath,
        bytes: bytes.byteLength,
      };
    } catch (error) {
      return {
        canceled: false,
        error: error instanceof Error ? error.message : 'Failed to save the validated Paper PDF.',
      };
    }
  });

  ipcMain.handle('signal-loom:paper-save-epub-bytes', async (event, request) => {
    try {
      const bytes = request?.bytes instanceof Uint8Array
        ? Buffer.from(request.bytes)
        : ArrayBuffer.isView(request?.bytes)
          ? Buffer.from(request.bytes.buffer, request.bytes.byteOffset, request.bytes.byteLength)
          : Array.isArray(request?.bytes)
            ? Buffer.from(request.bytes)
            : undefined;
      // The renderer's Paper EPUB builder validates the complete bounded ZIP before this chooser
      // route is reached. Main still rejects non-ZIP or oversized IPC payloads before any disk write.
      if (!bytes || bytes.byteLength > 32 * 1024 * 1024 || !bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
        return { canceled: false, error: 'Validated Paper EPUB bytes are missing a bounded EPUB ZIP header.' };
      }
      const requestedFilePath = typeof request?.filePath === 'string' && isAbsolute(request.filePath)
        ? ensureEpubExtension(request.filePath)
        : undefined;
      const filePath = requestedFilePath ?? await choosePaperEpubSavePath(request, getIpcWindow(event));
      if (!filePath) return { canceled: true };

      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, bytes);
      return { canceled: false, filePath, bytes: bytes.byteLength };
    } catch (error) {
      return {
        canceled: false,
        error: error instanceof Error ? error.message : 'Failed to save the validated Paper EPUB.',
      };
    }
  });

  ipcMain.handle('signal-loom:paper-export-images', async (event, request) => {
    if (!request || !Array.isArray(request.pages) || request.pages.length === 0) {
      return {
        canceled: false,
        error: 'No Paper page images were provided for export.',
      };
    }

    const requestedDirectoryPath = typeof request.directoryPath === 'string' && isAbsolute(request.directoryPath)
      ? request.directoryPath
      : undefined;
    const directoryPath = requestedDirectoryPath ?? await choosePaperImageExportDirectory(request, getIpcWindow(event));

    if (!directoryPath) {
      return { canceled: true };
    }

    try {
      return await exportPaperImagesToDirectory(request, directoryPath);
    } catch (error) {
      return {
        canceled: false,
        error: error instanceof Error ? error.message : 'Failed to export Paper page images.',
      };
    }
  });

  ipcMain.handle('signal-loom:capture-current-window-png', async (event) => {
    const window = getIpcWindow(event);
    if (!window || window.isDestroyed()) {
      return {
        canceled: false,
        error: 'No active Electron window was available to capture.',
      };
    }

    try {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
      const image = await withTimeout(
        window.webContents.capturePage(),
        10000,
        'Current window capture',
      );
      const size = image.getSize();
      return {
        canceled: false,
        mimeType: 'image/png',
        base64: image.toPNG().toString('base64'),
        width: size.width,
        height: size.height,
      };
    } catch (error) {
      return {
        canceled: false,
        error: error instanceof Error ? error.message : 'Failed to capture the current Electron window.',
      };
    }
  });

  // Download a remote media URL through the main process (net.fetch is not
  // bound by the renderer's CORS policy and ignores Content-Disposition), so
  // provider result CDNs that block fetch() and force-download can still be
  // inlined and displayed in the renderer. Returns base64 bytes + mime type.
  ipcMain.handle('signal-loom:download-remote-media', async (_event, url, cancellationId) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
      return { error: 'A valid http(s) URL is required.' };
    }

    const controller = new AbortController();
    const registeredCancellationId = typeof cancellationId === 'string' && cancellationId.trim()
      ? cancellationId
      : undefined;
    if (registeredCancellationId) {
      remoteMediaDownloadControllers.set(registeredCancellationId, controller);
    }
    try {
      const response = await net.fetch(url, { signal: controller.signal });
      if (!response.ok) {
        return { error: `Remote media download failed with status ${response.status}.` };
      }

      const mimeType = (response.headers.get('content-type') || '').split(';', 1)[0].trim()
        || 'application/octet-stream';
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) {
        return { error: 'Remote media download returned no bytes.' };
      }

      return { base64: buffer.toString('base64'), mimeType };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Remote media download failed.' };
    } finally {
      if (registeredCancellationId && remoteMediaDownloadControllers.get(registeredCancellationId) === controller) {
        remoteMediaDownloadControllers.delete(registeredCancellationId);
      }
    }
  });

  ipcMain.handle('signal-loom:cancel-remote-media-download', async (_event, cancellationId) => {
    if (typeof cancellationId !== 'string') return { cancelled: false };
    const controller = remoteMediaDownloadControllers.get(cancellationId);
    if (!controller) return { cancelled: false };
    remoteMediaDownloadControllers.delete(cancellationId);
    controller.abort();
    return { cancelled: true };
  });

  ipcMain.handle('signal-loom:provider-pack-request', async (_event, request) => {
    const cancellationId = typeof request?.cancellationId === 'string' ? request.cancellationId : '';
    const controller = new AbortController();
    try {
      const url = new URL(request?.url);
      const approvedOrigin = new URL(request?.approvedOrigin).origin;
      if (
        url.origin !== approvedOrigin
        || url.username
        || url.password
        || (
          url.protocol !== 'https:'
          && !(url.protocol === 'http:' && isPrivateProviderPackHost(url.hostname))
        )
      ) {
        return { error: 'The native provider broker rejected a request outside its exact approved origin.' };
      }
      const method = String(request?.method ?? 'GET').toUpperCase();
      if (!['GET', 'POST', 'PUT', 'PATCH'].includes(method)) {
        return { error: 'The native provider broker rejected an unsupported HTTP method.' };
      }
      const headers = {};
      for (const [name, value] of Object.entries(request?.headers ?? {})) {
        if (
          !/^[a-z0-9-]{1,128}$/i.test(name)
          || ['host', 'origin', 'referer', 'cookie', 'set-cookie', 'proxy-authorization'].includes(name.toLowerCase())
          || typeof value !== 'string'
          || /[\r\n]/.test(value)
        ) {
          return { error: `The native provider broker rejected header ${name}.` };
        }
        headers[name] = value;
      }
      const body = materializeProviderPackBrokerBody(request?.body);
      if (cancellationId) providerPackRequestControllers.set(cancellationId, controller);
      const response = await net.fetch(url.toString(), {
        method,
        headers,
        body: method === 'GET' ? undefined : body,
        redirect: 'error',
        signal: controller.signal,
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > 50 * 1024 * 1024) {
        return { error: 'The native provider response exceeded 50 MiB.' };
      }
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        base64: bytes.toString('base64'),
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'The native provider request failed.' };
    } finally {
      if (cancellationId && providerPackRequestControllers.get(cancellationId) === controller) {
        providerPackRequestControllers.delete(cancellationId);
      }
    }
  });

  ipcMain.handle('signal-loom:provider-pack-request-cancel', async (_event, cancellationId) => {
    const controller = providerPackRequestControllers.get(cancellationId);
    if (!controller) return { cancelled: false };
    providerPackRequestControllers.delete(cancellationId);
    controller.abort();
    return { cancelled: true };
  });

  ipcMain.handle('signal-loom:vertex-generate-image', async (_event, request) => {
    return runCancelableVertexGeneration(request, generateVertexImage);
  });

  ipcMain.handle('signal-loom:vertex-generate-text', async (_event, request) => {
    return runCancelableVertexGeneration(request, generateVertexText);
  });

  ipcMain.handle('signal-loom:vertex-generate-video', async (_event, request) => {
    return runCancelableVertexGeneration(request, generateVertexVideo);
  });

  ipcMain.handle('signal-loom:vertex-cancel', async (_event, cancellationId) => {
    if (typeof cancellationId !== 'string') return { cancelled: false };
    const controller = vertexGenerationControllers.get(cancellationId);
    if (!controller) return { cancelled: false };
    vertexGenerationControllers.delete(cancellationId);
    controller.abort();
    return { cancelled: true };
  });

  ipcMain.handle('signal-loom:native-cli-agent-capabilities', () => ({
    agents: publicNativeCliAgentCapabilities(),
    maxConcurrentRuns: MAX_CONCURRENT_NATIVE_CLI_AGENTS,
  }));

  ipcMain.handle('signal-loom:native-cli-agent-run', async (event, rawRequest) => {
    let request;
    try {
      request = validateNativeCliAgentRequest(rawRequest);
    } catch (error) {
      return nativeCliAgentFailure(error);
    }
    if (nativeCliAgentControllers.has(request.requestId)) {
      return { ok: false, code: 'duplicate-request', error: 'That local coding-agent request is already running.' };
    }
    if (nativeCliAgentControllers.size >= MAX_CONCURRENT_NATIVE_CLI_AGENTS) {
      return { ok: false, code: 'busy', error: 'Two local coding-agent requests are already running. Wait for one to finish or cancel it.' };
    }

    const controller = new AbortController();
    nativeCliAgentControllers.set(request.requestId, controller);
    try {
      const agent = publicNativeCliAgentCapabilities().find((candidate) => candidate.id === request.agent);
      if (!agent?.available) {
        return { ok: false, code: 'unavailable', error: `${agent?.label ?? 'The selected local coding agent'} is not installed or executable.` };
      }
      const win = BrowserWindow.fromWebContents(event.sender);
      const characterCount = request.systemPrompt.length + request.userPrompt.length;
      const isLiveLayoutAgent = request.purpose === 'live-layout-agent';
      // The live layout agent makes many sequential turn requests. Re-prompting for consent on
      // every turn would make the feature unusable, so one explicit approval covers this agent in
      // this window for a bounded session. Writing/one-shot layout requests keep per-run consent.
      const sessionConsentKey = `${event.sender.id}:${request.agent}`;
      const sessionConsentExpiry = liveLayoutAgentSessionConsents.get(sessionConsentKey) ?? 0;
      const hasSessionConsent = isLiveLayoutAgent && sessionConsentExpiry > Date.now();
      if (!hasSessionConsent) {
        const consentOptions = isLiveLayoutAgent
          ? {
            type: 'question',
            title: 'Let a Local Coding Agent Edit This Layout?',
            message: `Let ${agent.label} build and refine the open Paper layout live?`,
            detail: [
              `Sloom Studio will pass the design brief and a compact document snapshot (${characterCount.toLocaleString()} characters this turn) to the installed ${agent.label} process through standard input, once per turn.`,
              'Each response is validated against a strict inert protocol. The agent can only create and edit its own agent-… frames, and every applied step is a normal undoable edit you can watch live.',
              'The CLI uses its existing sign-in and provider terms. No API key, executable path, command, shell argument, or workspace path is exposed to the Paper renderer.',
              '"Allow This Session" approves turns for the next 30 minutes in this window. "Send Once" approves only this turn.',
            ].join('\n\n'),
            buttons: ['Allow This Session', 'Send Once', 'Cancel'],
            defaultId: 2,
            cancelId: 2,
            noLink: true,
          }
          : {
            type: 'question',
            title: 'Use Local Coding Agent?',
            message: `Send this ${request.purpose === 'assisted-layout' ? 'layout' : 'writing'} request to ${agent.label}?`,
            detail: [
              `Sloom Studio will pass ${characterCount.toLocaleString()} characters to the installed ${agent.label} process through standard input.`,
              'The CLI uses its existing sign-in and provider terms. No API key, executable path, command, shell argument, or workspace path is exposed to the Paper renderer.',
              'The response will be previewed and will not be applied automatically.',
            ].join('\n\n'),
            buttons: ['Send Once', 'Cancel'],
            defaultId: 1,
            cancelId: 1,
            noLink: true,
          };
        const consent = win
          ? await dialog.showMessageBox(win, consentOptions)
          : await dialog.showMessageBox(consentOptions);
        const approved = isLiveLayoutAgent ? consent.response !== 2 : consent.response === 0;
        if (!approved || controller.signal.aborted) {
          return { ok: false, cancelled: true, code: 'cancelled', error: 'The local coding-agent request was cancelled.' };
        }
        if (isLiveLayoutAgent && consent.response === 0) {
          liveLayoutAgentSessionConsents.set(
            sessionConsentKey,
            Date.now() + LIVE_LAYOUT_AGENT_SESSION_CONSENT_TTL_MS,
          );
        }
      }

      const result = await executeNativeCliAgent(request, { signal: controller.signal });
      return { ok: true, ...result };
    } catch (error) {
      return nativeCliAgentFailure(error);
    } finally {
      if (nativeCliAgentControllers.get(request.requestId) === controller) {
        nativeCliAgentControllers.delete(request.requestId);
      }
    }
  });

  ipcMain.handle('signal-loom:native-cli-agent-cancel', (_event, requestId) => {
    if (typeof requestId !== 'string') return { cancelled: false };
    const controller = nativeCliAgentControllers.get(requestId);
    controller?.abort();
    return { cancelled: Boolean(controller) };
  });

  ipcMain.handle('signal-loom:vertex-login', async (_event, request = {}) => {
    try {
      if (request?.auth?.credentialJson) {
        const detected = await getVertexAccessToken(request.auth);
        return { ok: true, account: detected.account, projectId: detected.projectId };
      }
      const { command, args } = buildVertexLoginCommand(request?.auth);
      await execFileAsync(command, args, {
        env: buildVertexAuthEnvironment(request?.auth, process.env),
        timeout: 180000,
        maxBuffer: 1024 * 1024,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('signal-loom:vertex-detect-adc', async (_event, request = {}) => {
    try {
      const detected = await getVertexAccessToken(request?.auth);
      return {
        ok: true,
        hasToken: Boolean(detected.token),
        account: detected.account,
        projectId: detected.projectId,
        quotaProjectId: detected.quotaProjectId,
        source: detected.source,
      };
    } catch (error) {
      return { ok: false, hasToken: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('signal-loom:vertex-list-projects', async (_event, request = {}) => {
    try {
      const detected = await getVertexAccessToken(request?.auth);
      return { ok: true, projects: await listVertexProjectsWithToken(detected.token) };
    } catch (error) {
      return { ok: false, projects: [], error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('signal-loom:source-asset-materialize', async (event, request) => {
    const rendererEpoch = getRendererAuthorityEpoch(event.sender.id);
    return projectAuthority.runAuthorizedMutation({
      senderId: event.sender.id,
      rendererEpoch,
      isSenderLive: () => isLiveAuthoritySender(event.sender, rendererEpoch),
      claim: request?.claim,
      prepare: async () => {
        const scratchJournal = currentScratchDirectoryPath
          ? createScratchPreparationJournal(currentScratchDirectoryPath)
          : undefined;
        const result = await materializeSourceAsset(request, scratchJournal);
        if (result?.error) {
          await scratchJournal?.rollback();
          return { result };
        }
        const preparedCapabilities = result?.item
          ? await prepareNativeAssetCapabilitiesFromSourceBin({ items: [result.item] })
          : undefined;
        return { result, preparedCapabilities, scratchJournal };
      },
      commit: ({ result, preparedCapabilities }) => {
        if (preparedCapabilities) commitNativeAssetCapabilities(preparedCapabilities, { replace: false });
        return result;
      },
      rollback: ({ scratchJournal }) => scratchJournal?.rollback(),
    });
  });

  ipcMain.handle('signal-loom:choose-scratch-directory', async (event, request) => {
    const rendererEpoch = getRendererAuthorityEpoch(event.sender.id);
    const isSenderLive = () => isLiveAuthoritySender(event.sender, rendererEpoch);
    const precheck = projectAuthority.authorizeSave(event.sender.id, request?.claim, rendererEpoch, isSenderLive);
    if (!precheck.ok) return { canceled: false, rejected: precheck.rejected, error: precheck.rejected.message };
    const result = await dialog.showOpenDialog(getIpcWindow(event), {
      title: 'Choose Sloom Studio Scratch Folder',
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true };
    }

    return projectAuthority.runAuthorizedMutation({
      senderId: event.sender.id,
      rendererEpoch,
      isSenderLive,
      claim: request?.claim,
      prepare: async () => result.filePaths[0],
      commit: (directoryPath) => {
        setCurrentProjectAssetRoots(currentProjectPath, startupProject?.document, directoryPath);
        return { canceled: false, directoryPath: currentScratchDirectoryPath };
      },
    });
  });

  ipcMain.handle('signal-loom:open-workspace-window', async (_event, workspace) => {
    if (!isWorkspaceView(workspace)) {
      return { error: 'Unknown workspace.' };
    }

    createWorkspaceWindow(workspace);

    return { ok: true, workspace };
  });

  ipcMain.handle('signal-loom:set-active-workspace', async (event, workspace) => {
    if (!['flow', 'editor', 'image', 'paper'].includes(workspace)) {
      return { error: 'Unknown workspace.' };
    }

    activeWorkspace = workspace;
    // The sending window is now showing this workspace (covers single-window
    // tab-switching in place); give it that workspace's menu, and update the
    // application menu so the macOS bar + KDE global menu follow.
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    const workspaceMenu = menuForWorkspace(workspace);
    if (senderWindow && !senderWindow.isDestroyed()) {
      senderWindow.setMenu(workspaceMenu);
      senderWindow.setAutoHideMenuBar(false);
      senderWindow.setMenuBarVisibility(true);
    }
    applicationMenu = workspaceMenu;
    Menu.setApplicationMenu(workspaceMenu);

    return { ok: true };
  });

  ipcMain.handle('signal-loom:set-keyboard-shortcuts', async (_event, shortcuts) => {
    keyboardShortcuts = sanitizeKeyboardShortcutsForMenu(shortcuts);
    installApplicationMenu();
    // Rebuild the KDE global menu too so its accelerators track the in-window menu (no-op if off).
    globalMenuController?.refreshShortcuts();
    panelMenuService?.refresh();

    return { ok: true };
  });

  ipcMain.handle('signal-loom:set-locale', async (_event, request) => {
    return interfaceLocaleAuthority.update(request);
  });

  ipcMain.handle('signal-loom:source-library-get-snapshot', async (event, request) => {
    const rendererEpoch = getRendererAuthorityEpoch(event.sender.id);
    const authorization = projectAuthority.authorizeSave(
      event.sender.id,
      request?.claim,
      rendererEpoch,
      () => isLiveAuthoritySender(event.sender, rendererEpoch),
    );
    if (!authorization.ok) {
      return { rejected: authorization.rejected, error: authorization.rejected.message };
    }
    return {
      version: sourceLibraryVersion,
      snapshot: getSourceLibrarySnapshot(),
      authority: projectAuthority.getCurrent(),
    };
  });

  ipcMain.handle('signal-loom:source-library-sync-snapshot', async (event, request) => {
    const rendererEpoch = getRendererAuthorityEpoch(event.sender.id);
    return projectAuthority.runAuthorizedMutation({
      senderId: event.sender.id,
      rendererEpoch,
      isSenderLive: () => isLiveAuthoritySender(event.sender, rendererEpoch),
      claim: request?.claim,
      prepare: () => prepareSourceLibraryChange({ type: 'source-library-snapshot', snapshot: request?.snapshot }),
      commit: commitPreparedSourceLibraryChange,
    });
  });

  ipcMain.handle('signal-loom:source-library-apply-change', async (event, request) => {
    const rendererEpoch = getRendererAuthorityEpoch(event.sender.id);
    return projectAuthority.runAuthorizedMutation({
      senderId: event.sender.id,
      rendererEpoch,
      isSenderLive: () => isLiveAuthoritySender(event.sender, rendererEpoch),
      claim: request?.claim,
      prepare: () => prepareSourceLibraryChange(request?.change),
      commit: commitPreparedSourceLibraryChange,
    });
  });

  ipcMain.handle('signal-loom:show-about', async (event, options) => {
    const win = getIpcWindow(event);
    const packageVersion = app.getVersion();
    const version = formatInternalBuildVersion(packageVersion);
    // Edition line comes from the renderer's offline license verification
    // ("Community edition" / "Licensed to <email>"); sanitized, never trusted for gating.
    const edition = typeof options?.edition === 'string' && options.edition.trim()
      ? options.edition.trim().slice(0, 120)
      : 'Free software, GPL-3.0-or-later';
    const result = await dialog.showMessageBox(win, {
      type: 'info',
      title: `About ${appName}`,
      message: `${appName} ${version} — ${edition}`,
      detail:
        'A local-first multimedia studio — node-based Flow, a layered Image editor, '
        + 'print/comic Paper layout, and a Video timeline. Bring your own API keys; Sloom Studio '
        + 'never sees your keys or your work.\n\n'
        + 'Early access (beta) — expect rough edges, and thank you for trying it.\n\n'
        + 'Staying up to date: the newest builds are always at https://sloom.studio/downloads. '
        + 'Click "Check for Updates" below, or just re-download the latest installer and run it over '
        + 'your current version — your projects are kept.\n\n'
        + 'Support: support@sloom.studio',
      buttons: ['Check for Updates', 'Get the Latest', 'Visit sloom.studio', 'Close'],
      defaultId: 3,
      cancelId: 3,
      noLink: true,
    });
    if (result.response === 0) {
      await signalLoomCheckForUpdates(win, packageVersion);
    } else if (result.response === 1) {
      await shell.openExternal('https://sloom.studio/downloads');
    } else if (result.response === 2) {
      await shell.openExternal('https://sloom.studio');
    }
  });

  ipcMain.handle('signal-loom:open-path', async (_event, filePath) => {
    if (typeof filePath !== 'string' || !filePath) {
      return { error: 'No path provided.' };
    }

    const error = await shell.openPath(filePath);
    return error ? { error } : { ok: true };
  });

  // At-rest encryption for the renderer's persisted settings (API keys). safeStorage binds the
  // ciphertext to the OS user account (DPAPI / Keychain / libsecret-kwallet). Returns null when the
  // platform keyring is unavailable so the renderer falls back to its WebCrypto path.
  ipcMain.handle('signal-loom:secret-available', () => {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  });
  ipcMain.handle('signal-loom:secret-encrypt', (_event, plaintext) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.encryptString(String(plaintext ?? '')).toString('base64');
    } catch {
      return null;
    }
  });
  ipcMain.handle('signal-loom:secret-decrypt', (_event, ciphertextBase64) => {
    try {
      if (!safeStorage.isEncryptionAvailable()) return null;
      return safeStorage.decryptString(Buffer.from(String(ciphertextBase64 ?? ''), 'base64'));
    } catch {
      return null;
    }
  });

  // The async web Clipboard API (navigator.clipboard.read) is permission-gated
  // and unreliable for images inside Electron, so read the OS clipboard image
  // natively and hand the renderer a PNG data URL (null when there is none).
  ipcMain.handle('signal-loom:read-clipboard-image', async () => {
    try {
      const image = clipboard.readImage();
      if (!image || image.isEmpty()) return null;
      return image.toDataURL();
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });
}

/**
 * Desktop "Check for Updates": fetch a tiny manifest from the site, compare versions, and either
 * point the user at the download (install-over-current keeps their projects) or confirm up-to-date.
 * Kept deliberately simple — no silent auto-install, since the indie builds are unsigned and a
 * surprise replace is worse than a one-click "Download".
 */
async function signalLoomCheckForUpdates(win, currentVersion) {
  let manifest = null;
  try {
    const response = await fetch('https://sloom.studio/downloads/latest.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    manifest = await response.json();
  } catch (error) {
    const r = await dialog.showMessageBox(win, {
      type: 'warning',
      title: 'Check for Updates',
      message: 'Could not check for updates',
      detail: 'Couldn\'t reach the update server. You can always download the latest at '
        + `https://sloom.studio/downloads.\n\n(${error instanceof Error ? error.message : String(error)})`,
      buttons: ['Open Downloads', 'Close'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (r.response === 0) await shell.openExternal('https://sloom.studio/downloads');
    return;
  }
  const latest = typeof manifest?.version === 'string' ? manifest.version : null;
  if (latest && signalLoomIsVersionNewer(latest, currentVersion)) {
    const notes = typeof manifest.notes === 'string' && manifest.notes.trim()
      ? `\n\nWhat's new:\n${manifest.notes.trim()}`
      : '';
    const r = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update Available',
      message: `${appName} ${latest} is available`,
      detail: `You're on ${currentVersion}.${notes}\n\nDownload it and install over your current `
        + 'version — your projects are kept.',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (r.response === 0) {
      await shell.openExternal(typeof manifest.url === 'string' && manifest.url ? manifest.url : 'https://sloom.studio/downloads');
    }
  } else {
    await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Check for Updates',
      message: 'You\'re up to date',
      detail: `${appName} ${currentVersion} is the latest version.`,
      buttons: ['Close'],
    });
  }
}

/** Numeric-segment version compare; true when `a` is newer than `b` (ignores any -beta suffix). */
function signalLoomIsVersionNewer(a, b) {
  const parse = (v) => String(v).split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x > y;
  }
  return false;
}


// ─── Local AI upscaler: one-click install + managed runtime ─────────────────
// Downloads the pinned Real-ESRGAN ncnn release into userData, then runs
// ops/local-upscaler/local-upscaler.mjs (bundled via extraResources) under
// ELECTRON_RUN_AS_NODE with a persistent token, so the renderer's
// localAiCpuEndpointUrl/localAiCpuAuthHeader keep working across restarts.
const LOCAL_UPSCALER_PORT = 41797;
const LOCAL_UPSCALER_RELEASES = {
  linux: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-ubuntu.zip',
  win32: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-windows.zip',
  darwin: 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesrgan-ncnn-vulkan-20220424-macos.zip',
};
let localUpscalerChild;

function getLocalUpscalerPaths() {
  const installDir = join(app.getPath('userData'), 'local-upscaler');
  const binaryName = process.platform === 'win32' ? 'realesrgan-ncnn-vulkan.exe' : 'realesrgan-ncnn-vulkan';
  return {
    installDir,
    binaryPath: join(installDir, binaryName),
    modelsDir: join(installDir, 'models'),
    metaPath: join(installDir, 'meta.json'),
    runtimeScript: app.isPackaged
      ? join(process.resourcesPath, 'ops', 'local-upscaler', 'local-upscaler.mjs')
      : resolve(__dirname, '../ops/local-upscaler/local-upscaler.mjs'),
  };
}

async function readLocalUpscalerMeta() {
  const { metaPath } = getLocalUpscalerPaths();
  try {
    return JSON.parse(await readFile(metaPath, 'utf8'));
  } catch {
    return {};
  }
}

async function writeLocalUpscalerMeta(patch) {
  const { installDir, metaPath } = getLocalUpscalerPaths();
  await mkdir(installDir, { recursive: true });
  const meta = { ...(await readLocalUpscalerMeta()), ...patch };
  await writeFile(metaPath, JSON.stringify(meta, null, 2));
  return meta;
}

function buildLocalUpscalerEndpoint(meta) {
  const port = meta.port ?? LOCAL_UPSCALER_PORT;
  return {
    endpointUrl: `http://127.0.0.1:${port}`,
    authHeader: meta.token ? `Bearer ${meta.token}` : undefined,
  };
}

async function getLocalUpscalerStatus() {
  const { binaryPath } = getLocalUpscalerPaths();
  const meta = await readLocalUpscalerMeta();
  const running = Boolean(localUpscalerChild && localUpscalerChild.exitCode === null);
  return {
    installed: existsSync(binaryPath),
    running,
    backend: 'realesrgan-ncnn-vulkan',
    accelerator: 'vulkan',
    requiresVulkan: true,
    cpuFallback: false,
    ...(running ? buildLocalUpscalerEndpoint(meta) : {}),
  };
}

async function installLocalUpscaler() {
  const releaseUrl = LOCAL_UPSCALER_RELEASES[process.platform];
  if (!releaseUrl) {
    return { installed: false, running: false, error: `No Real-ESRGAN build for platform "${process.platform}".` };
  }
  const { installDir, binaryPath, modelsDir } = getLocalUpscalerPaths();
  try {
    if (!existsSync(binaryPath)) {
      const response = await net.fetch(releaseUrl);
      if (!response.ok) {
        return { installed: false, running: false, error: `Runtime download failed (HTTP ${response.status}).` };
      }
      const zipBytes = new Uint8Array(await response.arrayBuffer());
      const entries = unzipSync(zipBytes);
      await mkdir(modelsDir, { recursive: true });
      const binaryName = basename(binaryPath);
      for (const [name, bytes] of Object.entries(entries)) {
        const flat = name.replace(/^[^/]*realesrgan[^/]*\//i, '');
        const keep = flat === binaryName
          || flat.startsWith('models/')
          || flat.toLowerCase().endsWith('.dll');
        if (!keep || flat.endsWith('/') || bytes.length === 0) continue;
        const target = join(installDir, flat);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, Buffer.from(bytes));
      }
      if (!existsSync(binaryPath)) {
        return { installed: false, running: false, error: 'Runtime archive did not contain the upscaler binary.' };
      }
      if (process.platform !== 'win32') chmodSync(binaryPath, 0o755);
    }
    await writeLocalUpscalerMeta({ installedAt: Date.now() });
    return getLocalUpscalerStatus();
  } catch (error) {
    return { installed: existsSync(binaryPath), running: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function startLocalUpscaler() {
  const { binaryPath, modelsDir, runtimeScript } = getLocalUpscalerPaths();
  if (!existsSync(binaryPath)) {
    return { installed: false, running: false, error: 'Install the local upscaler runtime first.' };
  }
  if (!existsSync(runtimeScript)) {
    return { installed: true, running: false, error: `Runtime script missing at ${runtimeScript}.` };
  }
  if (localUpscalerChild && localUpscalerChild.exitCode === null) {
    return getLocalUpscalerStatus();
  }

  // The token persists in meta so saved renderer settings survive restarts.
  let meta = await readLocalUpscalerMeta();
  if (!meta.token) {
    meta = await writeLocalUpscalerMeta({ token: globalThis.crypto?.randomUUID?.() ?? `sl-${Date.now()}` });
  }
  meta = await writeLocalUpscalerMeta({ port: meta.port ?? LOCAL_UPSCALER_PORT, autoStart: true });

  const child = spawn(process.execPath, [
    runtimeScript,
    '--bin', binaryPath,
    '--models', modelsDir,
    '--port', String(meta.port),
    '--token', meta.token,
  ], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'ignore',
    detached: false,
  });
  child.on('exit', () => {
    if (localUpscalerChild === child) localUpscalerChild = undefined;
  });
  localUpscalerChild = child;

  const { endpointUrl, authHeader } = buildLocalUpscalerEndpoint(meta);
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    try {
      const probe = await net.fetch(`${endpointUrl}/v1/capabilities`, {
        headers: authHeader ? { Authorization: authHeader } : {},
      });
      if (probe.ok) return getLocalUpscalerStatus();
    } catch {
      // still booting
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 400));
  }
  return { installed: true, running: Boolean(localUpscalerChild), endpointUrl, authHeader, error: 'The local upscaler did not answer its health check in time.' };
}

async function stopLocalUpscaler() {
  if (localUpscalerChild && localUpscalerChild.exitCode === null) {
    localUpscalerChild.kill();
  }
  localUpscalerChild = undefined;
  await writeLocalUpscalerMeta({ autoStart: false });
  return getLocalUpscalerStatus();
}

async function maybeAutoStartLocalUpscaler() {
  try {
    const meta = await readLocalUpscalerMeta();
    const { binaryPath } = getLocalUpscalerPaths();
    if (meta.autoStart && existsSync(binaryPath)) {
      await startLocalUpscaler();
    }
  } catch (error) {
    console.warn('local-upscaler auto-start failed:', error);
  }
}

let crashReportController;

// app.quit() alone is not reliable before 'ready' (a live loser instance was observed
// lingering on Linux until killed), so the loser force-exits right after requesting quit.
// Nothing has started yet, and Chromium's process singleton has already relayed the
// loser's argv/workingDirectory to the winner's second-instance event.
if (!hasSingleInstanceLock) {
  app.quit();
  app.exit(0);
} else {
  // Opt-in local crash reporting (MH-014): a bounded, structurally redacted queue persisted
  // under userData/crash-reports, native Crashpad minidumps with uploadToServer:false, and no
  // network of any kind. Created before app ready so a persisted opt-in also lets
  // crashReporter.start() run early enough for native crashes, and main-process JS failures
  // are captured from the first statement of the lock winner.
  const crashReportStore = createCrashReportFileStore({
    directoryPath: join(app.getPath('userData'), 'crash-reports'),
    fs: { mkdirSync, readFileSync, writeFileSync, renameSync, unlinkSync, readdirSync },
  });
  crashReportController = createCrashReportController({
    store: crashReportStore,
    fs: { readdirSync, unlinkSync },
    app,
    crashReporter,
    appVersion: app.getVersion(),
  });
  crashReportController.installProcessCapture();
  crashReportController.attachChildProcessCapture(app);

  // Linux GPU acceleration policy. Default ON via the stable ANGLE GL/EGL backend so
  // the Image workspace's canvas compositing runs on the GPU instead of SwiftShader.
  // If the GPU process ever crashes (some AMD/Mesa + ANGLE combos segfault on init),
  // we drop a sentinel and relaunch in software mode so the user always gets a working
  // window; the sentinel self-expires after a cooldown so a transient hiccup recovers.
  // The sentinel lives in the shared userData directory, so only the lock winner may
  // read or clear it.
  const gpuFallbackSentinelPath = join(app.getPath('userData'), 'gpu-fallback.flag');
  let gpuFallbackSentinelTimestamp = null;
  try {
    if (existsSync(gpuFallbackSentinelPath)) {
      gpuFallbackSentinelTimestamp = statSync(gpuFallbackSentinelPath).mtimeMs;
    }
  } catch {
    gpuFallbackSentinelTimestamp = null;
  }
  const linuxGpuPolicy = resolveLinuxGpuPolicy(
    process.env,
    { sentinelTimestamp: gpuFallbackSentinelTimestamp },
    process.platform,
  );
  if (linuxGpuPolicy.clearSentinel) {
    try {
      rmSync(gpuFallbackSentinelPath, { force: true });
    } catch {
      /* best effort */
    }
  }
  applyLinuxGpuCommandLine(app, { disabled: linuxGpuPolicy.disabled }, process.platform);
  if (process.platform === 'linux' && !linuxGpuPolicy.disabled) {
    let gpuFallbackTriggered = false;
    app.on('child-process-gone', (_event, details) => {
      if (gpuFallbackTriggered || details?.type !== 'GPU' || details.reason === 'clean-exit') {
        return;
      }
      gpuFallbackTriggered = true;
      // Boundary 1 (GPU process → main process): a GPU crash here relaunches the whole app into
      // software mode, which also tears down any registered global menu. Logged so we can tell a
      // "menu vanished" report apart from a silent GPU-crash relaunch.
      console.log(
        `[gmenu] GPU process gone (reason=${details.reason ?? 'unknown'}) → writing fallback sentinel + relaunching in software`,
      );
      try {
        writeFileSync(gpuFallbackSentinelPath, String(Date.now()));
      } catch {
        /* best effort */
      }
      app.relaunch();
      app.exit(0);
    });
  }

  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'signal-loom-asset',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
      },
    },
    {
      scheme: 'signal-loom-font',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        bypassCSP: true,
      },
    },
    {
      scheme: 'signal-loom-phone',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
        bypassCSP: true,
      },
    },
  ]);

  // Own the already-defined signal-loom:// deep-link scheme (see NATIVE_WORKSPACE_STANDALONE_
  // ENTRY_POINTS in src/lib/nativeApp.ts). Packaged builds only: registering from a dev run
  // would point the OS handler at the bare electron binary.
  if (app.isPackaged) {
    app.setAsDefaultProtocolClient(EXTERNAL_OPEN_DEEP_LINK_SCHEME);
  }

  // Initial launch argv (Linux/Windows file managers, terminals, the dev launcher). macOS
  // delivers documents through open-file/open-url below instead.
  enqueueExternalOpenArgv(process.argv, process.cwd(), externalOpenLaunchDeliveryId);

  app.on('second-instance', (_event, argv, workingDirectory, additionalData) => {
    // Native argv/workingDirectory remain the source of target values. The bounded additionalData
    // token was minted once by the loser, so a repeated callback cannot acquire a fresh identity.
    const payload = parseSecondInstanceOpenPayload(additionalData);
    enqueueExternalOpenArgv(
      argv,
      workingDirectory,
      payload?.deliveryId ?? createExternalOpenDeliveryId(),
    );
    focusExternalOpenTargetWindow();
    dispatchPendingExternalOpenRequests();
  });

  // macOS document/deep-link events. Both can fire before app ready, so they are registered
  // here (not inside whenReady) and rely on the queue to hold pre-readiness requests.
  app.on('open-file', (event, filePath) => {
    event.preventDefault();
    enqueueExternalOpenValue(
      filePath,
      createExternalOpenDeliveryId(),
    );
    dispatchPendingExternalOpenRequests();
  });

  app.on('open-url', (event, url) => {
    event.preventDefault();
    enqueueExternalOpenValue(
      url,
      createExternalOpenDeliveryId(),
    );
    dispatchPendingExternalOpenRequests();
  });

  app.whenReady().then(async () => {
    installProtocolHandlers();
    installIpcHandlers();
    void maybeAutoStartLocalUpscaler();
    installApplicationMenu();
    // Bring up the native-Wayland panel-menu D-Bus service (no-op unless SIGNAL_LOOM_ELECTRON_PANEL_MENU=1).
    void getPanelMenuService().start();
    if (process.env.SIGNAL_LOOM_ELECTRON_MENU_SMOKE === '1') {
      console.log(`Sloom Studio application menu: ${getInstalledApplicationMenuLabels().join(', ')}`);
      app.quit();
      return;
    }
    createStartupSplashWindow();
    try {
      await resolveRendererEntryUrl();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Electron renderer startup resolution failed.';
      console.error(message);

      if (!isProductionRendererReady()) {
        dialog.showErrorBox(
          'Sloom Studio startup failed',
          `${message} Build the Vite app (npm run build) and restart in production mode.`,
        );
        app.quit();
        return;
      }
    }
    await loadRememberedStartupProject();
    commitStartupProjectAuthority();
    createWorkspaceWindow('flow');
    // Queued deep links open their workspace windows now; queued documents focus the main
    // window and wait for the renderer to drain them once it mounts.
    dispatchPendingExternalOpenRequests();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWorkspaceWindow('flow');
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // Tear down the global-menu DBus export cleanly so KDE drops our registrations on exit.
  app.on('will-quit', () => {
    haneQrPairingSession?.close();
    haneQrPairingSession = undefined;
    ipcMain.removeHandler(BUNDLED_FONT_LIBRARY_STATUS_CHANNEL);
    for (const controller of nativeCliAgentControllers.values()) controller.abort();
    nativeCliAgentControllers.clear();
    void globalMenuController?.stop();
    void panelMenuService?.stop();
  });
}

export { SIGNAL_LOOM_MENU_COMMANDS };
