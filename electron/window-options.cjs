const FLOATING_PANEL_FRAME_NAME_PREFIX = 'signal-loom-';

function isSignalLoomFloatingPanelWindow(details = {}) {
  const frameName = typeof details.frameName === 'string' ? details.frameName : '';
  const features = typeof details.features === 'string' ? details.features : '';

  return (
    frameName.startsWith(FLOATING_PANEL_FRAME_NAME_PREFIX) ||
    (features.includes('popup=yes') && features.includes('frame=false'))
  );
}

function shouldDisableWindowResize(details = {}) {
  const features = typeof details.features === 'string' ? details.features : '';
  return features
    .split(',')
    .some((feature) => {
      const [rawName, rawValue = ''] = feature.split('=');
      return rawName.trim().toLowerCase() === 'resizable'
        && ['0', 'false', 'no'].includes(rawValue.trim().toLowerCase());
    });
}

function parseFloatingPanelWindowFeatures(details = {}) {
  const features = typeof details.features === 'string' ? details.features : '';
  const parsed = {};

  for (const feature of features.split(',')) {
    const [rawName, rawValue = ''] = feature.split('=');
    const name = rawName.trim().toLowerCase();
    const value = Number.parseInt(rawValue.trim(), 10);
    if (!Number.isFinite(value)) {
      continue;
    }

    if (name === 'width' || name === 'height') {
      parsed[name] = Math.max(1, value);
    } else if (name === 'left') {
      parsed.x = value;
    } else if (name === 'top') {
      parsed.y = value;
    }
  }

  return parsed;
}

function buildFloatingPanelWindowOpenResult(parentWindow, details = {}) {
  const parsedFeatures = parseFloatingPanelWindowFeatures(details);
  const fixedSize = shouldDisableWindowResize(details)
    && parsedFeatures.width !== undefined
    && parsedFeatures.height !== undefined;
  const overrideBrowserWindowOptions = {
    parent: parentWindow,
    modal: false,
    show: true,
    frame: false,
    backgroundColor: fixedSize ? '#00000000' : '#08111d',
    skipTaskbar: true,
  };

  if (parsedFeatures.x !== undefined && parsedFeatures.y !== undefined) {
    overrideBrowserWindowOptions.x = parsedFeatures.x;
    overrideBrowserWindowOptions.y = parsedFeatures.y;
  }

  if (shouldDisableWindowResize(details)) {
    overrideBrowserWindowOptions.resizable = false;
  }

  if (fixedSize) {
    Object.assign(overrideBrowserWindowOptions, {
      transparent: true,
      hasShadow: false,
      useContentSize: true,
      width: parsedFeatures.width,
      height: parsedFeatures.height,
      minWidth: parsedFeatures.width,
      minHeight: parsedFeatures.height,
      maxWidth: parsedFeatures.width,
      maxHeight: parsedFeatures.height,
    });
  }

  return {
    action: 'allow',
    overrideBrowserWindowOptions,
  };
}

function buildDeniedWindowOpenResult() {
  return { action: 'deny' };
}

function buildWorkspaceWindowOpenResult(details, parentWindow) {
  return isSignalLoomFloatingPanelWindow(details)
    ? buildFloatingPanelWindowOpenResult(parentWindow, details)
    : buildDeniedWindowOpenResult();
}

/**
 * A workspace BrowserWindow is application chrome, never a general browser.
 * Reloading its exact renderer URL is valid; navigating the main frame to a
 * bundled ICC/font/media file (or any external location) would replace the
 * entire editor with raw resource bytes.
 */
function isAllowedWorkspaceNavigation(targetUrl, rendererEntryUrl, workspace) {
  if (
    typeof targetUrl !== 'string'
    || typeof rendererEntryUrl !== 'string'
    || typeof workspace !== 'string'
  ) {
    return false;
  }
  try {
    const expected = new URL(rendererEntryUrl);
    expected.searchParams.set('workspace', workspace);
    return new URL(targetUrl).href === expected.href;
  } catch {
    return false;
  }
}

function focusFloatingPanelChildWindow(parentWindow, childWindow, details = {}) {
  if (!childWindow || childWindow.isDestroyed?.()) {
    return;
  }

  if (typeof childWindow.setParentWindow === 'function') {
    childWindow.setParentWindow(parentWindow);
  }

  const parsedFeatures = parseFloatingPanelWindowFeatures(details);
  if (
    shouldDisableWindowResize(details)
    && parsedFeatures.width !== undefined
    && parsedFeatures.height !== undefined
  ) {
    callWindowMethod(childWindow, 'setResizable', false);
    callWindowMethod(childWindow, 'setMinimumSize', parsedFeatures.width, parsedFeatures.height);
    callWindowMethod(childWindow, 'setMaximumSize', parsedFeatures.width, parsedFeatures.height);
    callWindowMethod(childWindow, 'setContentSize', parsedFeatures.width, parsedFeatures.height);
    callWindowMethod(childWindow, 'setSize', parsedFeatures.width, parsedFeatures.height);
    callWindowMethod(childWindow, 'setShape', [{ x: 0, y: 0, width: parsedFeatures.width, height: parsedFeatures.height }]);
  }

  if (childWindow.isMinimized?.()) {
    childWindow.restore?.();
  }

  childWindow.show?.();
  childWindow.moveTop?.();
  childWindow.focus?.();
}

function callWindowMethod(window, methodName, ...args) {
  try {
    window[methodName]?.(...args);
  } catch {
    // Some Linux/Wayland compositors reject programmatic child-window sizing.
    // Keep the renderer-side fixed palette content clipped instead of failing startup.
  }
}

module.exports = {
  buildFloatingPanelWindowOpenResult,
  buildWorkspaceWindowOpenResult,
  focusFloatingPanelChildWindow,
  isAllowedWorkspaceNavigation,
  isSignalLoomFloatingPanelWindow,
  parseFloatingPanelWindowFeatures,
};
