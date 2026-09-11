// One-shot diagnostic: does ANGLE-Vulkan GPU acceleration survive under XWayland (ozone x11)?
//
// The historical menu/GPU conflict was: forcing XWayland for the KDE global menu pinned the GPU to
// SwiftShader because the `gl-egl` ANGLE backend couldn't find an EGL config on this AMD/Mesa stack.
// The current default backend is ANGLE-Vulkan (RADV), which sidesteps EGL. This probe forces the
// exact "global-menu" windowing (ozone-platform=x11) + the production Vulkan GPU switches and prints
// the live GPU feature status, so we can confirm hardware acceleration is NOT SwiftShader on X11.
//
// Run:  node_modules/.bin/electron electron/diagnostics/gpu-xwayland-probe.cjs
// It prints a JSON blob and exits.

const { app, BrowserWindow } = require('electron');

// Force the same windowing the global-menu path would use (skip to compare against native Wayland).
if (process.env.PROBE_NATIVE_WAYLAND === '1') {
  app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
} else {
  app.commandLine.appendSwitch('ozone-platform', 'x11');
}

// Mirror getLinuxGpuSwitches() default (ANGLE Vulkan + canvas/raster un-blocklist).
const backend = process.env.SIGNAL_LOOM_ELECTRON_ANGLE_BACKEND || 'vulkan';
app.commandLine.appendSwitch('use-gl', 'angle');
app.commandLine.appendSwitch('use-angle', backend);
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('enable-features', 'CanvasOopRasterization');

function classify(status) {
  // getGPUFeatureStatus values: 'enabled', 'enabled_on', 'software', 'disabled', 'unavailable', ...
  const canvas = status.gpu_compositing || status['2d_canvas'] || '';
  return canvas;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 320, height: 240 });
  await win.loadURL('data:text/html,<canvas id=c width=64 height=64></canvas>');

  let info = {};
  try {
    info = await app.getGPUInfo('complete');
  } catch (err) {
    info = { error: String(err) };
  }
  const feat = app.getGPUFeatureStatus();

  const aux = info.auxAttributes || {};
  const out = {
    ozonePlatform: 'x11 (forced)',
    angleBackend: backend,
    sessionType: process.env.XDG_SESSION_TYPE,
    waylandDisplay: process.env.WAYLAND_DISPLAY,
    display: process.env.DISPLAY,
    glRenderer: aux.glRenderer || info.glRenderer,
    glVendor: aux.glVendor || info.glVendor,
    glVersion: aux.glVersion,
    vulkanRenderer: (info.vulkanInfo && info.vulkanInfo.deviceName) || undefined,
    softwareRendering: aux.softwareRendering,
    featureStatus: feat,
    canvasCompositing: classify(feat),
    nativeWindowHandleBytes: (() => {
      try { return win.getNativeWindowHandle().length; } catch { return null; }
    })(),
  };
  // The XID lives in the native window handle on X11 (first 4 bytes, LE).
  try {
    const h = win.getNativeWindowHandle();
    out.x11WindowId = h.length >= 4 ? '0x' + h.readUInt32LE(0).toString(16) : null;
  } catch {
    out.x11WindowId = null;
  }

  console.log('GPU_XWAYLAND_PROBE_RESULT ' + JSON.stringify(out, null, 2));
  app.quit();
});

app.on('window-all-closed', () => app.quit());
// Safety timeout so the probe never hangs CI/headless.
setTimeout(() => { console.log('GPU_XWAYLAND_PROBE_TIMEOUT'); app.exit(0); }, 20000);
