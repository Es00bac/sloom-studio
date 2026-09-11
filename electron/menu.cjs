const WORKSPACE_MENUS = require('../shared/workspaceMenus.json');

const SIGNAL_LOOM_MENU_COMMANDS = Object.freeze({
  fileNew: 'file:new',
  fileOpen: 'file:open',
  fileSave: 'file:save',
  fileSaveAs: 'file:save-as',
  fileImportMedia: 'file:import-media',
  fileSetScratchFolder: 'file:set-scratch-folder',
  fileExportProject: 'file:export-project',
  fileExportAssets: 'file:export-assets',
  imageFileOpen: 'image:file-open',
  imageFileSaveAs: 'image:file-save-as',
  settingsKeyboardShortcuts: 'settings:keyboard-shortcuts',
  settingsGamepadBindings: 'settings:gamepad-bindings',
  editUndo: 'edit:undo',
  editRedo: 'edit:redo',
  editCut: 'edit:cut',
  editCopy: 'edit:copy',
  editPaste: 'edit:paste',
  editDelete: 'edit:delete',
  editSelectAll: 'edit:select-all',
  editDeselect: 'edit:deselect',
  editInvertSelection: 'edit:invert-selection',
  viewFlow: 'view:flow',
  viewEditor: 'view:editor',
  viewImage: 'view:image',
  viewPaper: 'view:paper',
  viewToggleSourceBin: 'view:toggle-source-bin',
  viewToggleInspector: 'view:toggle-inspector',
  viewToggleInterface: 'view:toggle-interface',
  viewCommandPalette: 'view:command-palette',
  viewActivityTrail: 'view:activity-trail',
  viewLayoutReset: 'view:layout-reset',
  viewLayoutBalanced: 'view:layout-balanced',
  viewLayoutFocus: 'view:layout-focus',
  viewLayoutAllPanels: 'view:layout-all-panels',
  flowAddSourceBin: 'flow:add-source-bin',
  imageToolHand: 'image:tool-hand',
  imageToolText: 'image:tool-text',
  imageToolMove: 'image:tool-move',
  imageToolMarquee: 'image:tool-marquee',
  imageToolLasso: 'image:tool-lasso',
  imageToolMagicWand: 'image:tool-magic-wand',
  imageToolBrush: 'image:tool-brush',
  imageToolPen: 'image:tool-pen',
  imageToolEraser: 'image:tool-eraser',
  imageToolMagicEraser: 'image:tool-magic-eraser',
  imageToolCloneStamp: 'image:tool-clone-stamp',
  imageToolSpotHeal: 'image:tool-spot-heal',
  imageToolBlurBrush: 'image:tool-blur-brush',
  imageToolSharpenBrush: 'image:tool-sharpen-brush',
  imageToolSmudgeBrush: 'image:tool-smudge-brush',
  imageToolDodgeBrush: 'image:tool-dodge-brush',
  imageToolBurnBrush: 'image:tool-burn-brush',
  imageToolSpongeSaturate: 'image:tool-sponge-saturate',
  imageToolSpongeDesaturate: 'image:tool-sponge-desaturate',
  imageToolPaintBucket: 'image:tool-paint-bucket',
  imageToolGradient: 'image:tool-gradient',
  imageToolRectangleShape: 'image:tool-rectangle-shape',
  imageToolEllipseShape: 'image:tool-ellipse-shape',
  imageToolCrop: 'image:tool-crop',
  imageToolEyedropper: 'image:tool-eyedropper',
  imageExportVisible: 'image:export-visible',
  imageExportPsd: 'image:export-psd',
  timelineSelect: 'timeline:select',
  timelineCut: 'timeline:cut',
  timelineSlip: 'timeline:slip',
  timelineHand: 'timeline:hand',
  timelineSnap: 'timeline:snap',
  timelineAddKeyframe: 'timeline:add-keyframe',
  timelinePreviousKeyframe: 'timeline:previous-keyframe',
  timelineNextKeyframe: 'timeline:next-keyframe',
  paperToolSelect: 'paper:tool-select',
  paperToolHand: 'paper:tool-hand',
  paperToolText: 'paper:tool-text',
  paperToolImage: 'paper:tool-image',
  paperToolEyedropper: 'paper:tool-eyedropper',
  paperNewDocument: 'paper:new-document',
  paperAddPage: 'paper:add-page',
  paperFileOpen: 'paper:file-open',
  paperFileSave: 'paper:file-save',
  paperFileSaveAs: 'paper:file-save-as',
  paperExportPdf: 'paper:export-pdf',
  paperExportEpub: 'paper:export-epub',
  paperExportKdpAssets: 'paper:export-kdp-assets',
  paperExportReaderSpreadsPdf: 'paper:export-reader-spreads-pdf',
  paperExportBookletProofPdf: 'paper:export-booklet-proof-pdf',
  paperExportWebcomicImages: 'paper:export-webcomic-images',
  paperExportHtml: 'paper:export-html',
  paperExportReaderSpreadsHtml: 'paper:export-reader-spreads-html',
  paperExportBookletProofHtml: 'paper:export-booklet-proof-html',
  paperPackagePrint: 'paper:package-print',
  paperExportJson: 'paper:export-json',
  paperImportJson: 'paper:import-json',
  paperAddTextFrame: 'paper:add-text-frame',
  paperAddImageFrame: 'paper:add-image-frame',
  paperAddSpeechBubble: 'paper:add-speech-bubble',
  paperAddThoughtBubble: 'paper:add-thought-bubble',
  paperAddCaption: 'paper:add-caption',
  paperToggleRulers: 'paper:toggle-rulers',
  paperToggleGuides: 'paper:toggle-guides',
  paperToggleGrid: 'paper:toggle-grid',
  paperToggleSnapToGuides: 'paper:toggle-snap-to-guides',
  paperToggleSnapToGrid: 'paper:toggle-snap-to-grid',
  paperToggleSpreads: 'paper:toggle-spreads',
  paperToggleStartOnRight: 'paper:toggle-start-on-right',
  paperToggleToolsPanel: 'paper:toggle-tools-panel',
  paperToggleDocumentStripPanel: 'paper:toggle-document-strip-panel',
  paperToggleInspectorPanel: 'paper:toggle-inspector-panel',
  paperTogglePreflightPanel: 'paper:toggle-preflight-panel',
  paperToggleLinkedAssetsPanel: 'paper:toggle-linked-assets-panel',
  paperToggleDtpParityPanel: 'paper:toggle-dtp-parity-panel',
  paperResetPanels: 'paper:reset-panels',
  helpProjectDocumentation: 'help:project-documentation',
  helpTutorial: 'help:tutorial',
  helpFeatureHelp: 'help:feature-help',
  helpKeyboardShortcuts: 'help:keyboard-shortcuts',
  helpAbout: 'help:about',
});

const DESKTOP_WORKSPACE_MENU_DESCRIPTORS = Object.freeze([
  Object.freeze({
    workspace: 'flow',
    menuLabel: 'Flow',
    launchLabel: 'Open/Focus Flow Window',
    launchCommand: SIGNAL_LOOM_MENU_COMMANDS.viewFlow,
    accelerator: 'CommandOrControl+1',
    launchSurface: 'electron-native-menu',
  }),
  Object.freeze({
    workspace: 'editor',
    menuLabel: 'Video',
    launchLabel: 'Open/Focus Video Window',
    launchCommand: SIGNAL_LOOM_MENU_COMMANDS.viewEditor,
    accelerator: 'CommandOrControl+2',
    launchSurface: 'electron-native-menu',
  }),
  Object.freeze({
    workspace: 'image',
    menuLabel: 'Image',
    launchLabel: 'Open/Focus Image Window',
    launchCommand: SIGNAL_LOOM_MENU_COMMANDS.viewImage,
    accelerator: 'CommandOrControl+3',
    launchSurface: 'electron-native-menu',
  }),
  Object.freeze({
    workspace: 'paper',
    menuLabel: 'Paper',
    launchLabel: 'Open/Focus Paper Window',
    launchCommand: SIGNAL_LOOM_MENU_COMMANDS.viewPaper,
    accelerator: 'CommandOrControl+4',
    launchSurface: 'electron-native-menu',
  }),
]);

let activeKeyboardShortcuts = {};

function commandItem(label, command, sendCommand, extra = {}) {
  const accelerator = resolveCommandAccelerator(command, extra.accelerator);
  const itemExtra = {
    ...extra,
    ...(accelerator ? { accelerator } : {}),
  };

  if (!accelerator) {
    delete itemExtra.accelerator;
  } else if (!acceleratorHasCommandModifier(accelerator)) {
    // Bare-letter / Shift+letter / Alt+letter accelerators (B, V, Shift+B, Del, …) would fire from
    // the native menu GLOBALLY — even while the user is typing in a text field — switching tools
    // mid-word, because native menu accelerators bypass the renderer entirely. Keep them visible as
    // hints but do NOT register them with the OS; the keystroke then reaches the renderer, whose
    // shortcut resolver already ignores keys aimed at editable fields. Ctrl/Cmd accelerators can't be
    // typed characters, so they stay natively registered.
    itemExtra.registerAccelerator = false;
  }

  return {
    label,
    click: () => sendCommand(command),
    ...itemExtra,
  };
}

/** True when an Electron accelerator carries a Ctrl/Cmd/Meta modifier (so it is not a plain typed
 *  character and is safe to keep as a globally registered native-menu accelerator). */
function acceleratorHasCommandModifier(accelerator) {
  return /(^|\+)(CommandOrControl|CmdOrCtrl|Command|Control|Ctrl|Cmd|Meta|Super)(\+|$)/i.test(accelerator);
}

function resolveCommandAccelerator(command, fallback) {
  const shortcut = activeKeyboardShortcuts?.[command];
  if (typeof shortcut === 'string' && shortcut.trim()) {
    return toElectronAccelerator(shortcut);
  }
  return fallback;
}

function toElectronAccelerator(shortcut) {
  return shortcut
    .split('+')
    .map((part) => {
      const trimmed = part.trim();
      if (/^ctrl$/i.test(trimmed) || /^control$/i.test(trimmed)) return 'CommandOrControl';
      if (/^del$/i.test(trimmed)) return 'Delete';
      if (/^esc$/i.test(trimmed)) return 'Escape';
      return trimmed;
    })
    .filter(Boolean)
    .join('+');
}

/** Resolve a group's `items` — either an inline array or a `$shared` reference like "$project". */
function resolveMenuItems(items) {
  if (typeof items === 'string' && items.startsWith('$')) {
    return WORKSPACE_MENUS.$shared[items.slice(1)] ?? [];
  }
  return Array.isArray(items) ? items : [];
}

/** Pick a label for the active locale, falling back to English. `labelJa` lives beside `label` in the
 *  shared JSON so the native menu translates from the same source as the integrated + global menus. */
function pickLabel(item, locale) {
  if (locale === 'ja' && item && typeof item.labelJa === 'string' && item.labelJa) return item.labelJa;
  return item ? item.label : undefined;
}

/** Map shared-JSON item descriptors to Electron menu template items. */
function buildNativeMenuItems(items, sendCommand, isMac, locale) {
  const out = [];
  for (const item of items) {
    if (!item) continue;
    if (item.type === 'separator') {
      out.push({ type: 'separator' });
      continue;
    }
    if (item.role) {
      // Electron quit/close differ by platform: non-mac Project uses quit; mac uses close
      // (the mac app menu already carries quit). Other roles pass through.
      if (item.role === 'quit' && isMac) continue;
      if (item.role === 'close' && !isMac) continue;
      out.push({ role: item.role });
      continue;
    }
    if (Array.isArray(item.items)) {
      out.push({ label: pickLabel(item, locale), submenu: buildNativeMenuItems(item.items, sendCommand, isMac, locale) });
      continue;
    }
    if (item.command) {
      const fallback = item.accelerator ? toElectronAccelerator(item.accelerator) : undefined;
      out.push(commandItem(pickLabel(item, locale), item.command, sendCommand, fallback ? { accelerator: fallback } : {}));
    }
  }
  return out;
}

/** Build the top-level menu groups for one workspace from the shared JSON. */
function buildWorkspaceMenuGroups(activeWorkspace, sendCommand, isMac, locale) {
  const groups = WORKSPACE_MENUS[activeWorkspace] ?? WORKSPACE_MENUS.flow;
  return groups.map((group) => ({
    label: pickLabel(group, locale),
    submenu: buildNativeMenuItems(resolveMenuItems(group.items), sendCommand, isMac, locale),
  }));
}

function createApplicationMenuTemplate({
  appName,
  isMac = false,
  activeWorkspace = 'flow',
  keyboardShortcuts = {},
  locale = 'en',
  sendCommand,
}) {
  const previousKeyboardShortcuts = activeKeyboardShortcuts;
  activeKeyboardShortcuts = keyboardShortcuts && typeof keyboardShortcuts === 'object' ? keyboardShortcuts : {};

  const template = buildWorkspaceMenuGroups(activeWorkspace, sendCommand, isMac, locale);


  const result = isMac
    ? [
      {
        label: appName,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'services' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      ...template,
    ]
    : template;

  activeKeyboardShortcuts = previousKeyboardShortcuts;
  return result;
}

module.exports = {
  SIGNAL_LOOM_MENU_COMMANDS,
  DESKTOP_WORKSPACE_MENU_DESCRIPTORS,
  createApplicationMenuTemplate,
};
