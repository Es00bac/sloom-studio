import { describe, expect, it } from 'vitest';
import { createEmptyImageDocument } from '../../store/imageEditorStore';
import {
  describeImageNavigationReadiness,
  getImageNavigationCommandDescriptors,
  getImageNavigationCommandViewport,
  resolveImageNavigationKeyboardShortcut,
  type ImageNavigationCommandReadiness,
  type ImageNavigationCommand,
} from './ImageNavigationCommands';
import { screenToDoc } from './viewport';

describe('ImageNavigationCommands', () => {
  it('exposes typed pan, fit, 100 percent, and zoom command descriptors for actions and shortcuts', () => {
    expect(getImageNavigationCommandDescriptors()).toEqual([
      {
        command: 'pan',
        label: 'Pan view',
        kind: 'pan',
        route: 'viewport-pan',
        viewportTarget: 'pointer-delta-pan',
        viewportOnly: true,
        mutatesDocument: false,
        toolbarSuitable: false,
        shortcutSuitable: true,
        actionRecordable: true,
        batchSuitable: true,
        shortcutKeys: ['Space+Drag', 'Middle Mouse Drag'],
        caveats: ['Temporary hand panning must not commit the Hand tool over the active paint or selection tool.'],
      },
      {
        command: 'fit',
        label: 'Fit on screen',
        kind: 'fit',
        route: 'viewport-fit',
        viewportTarget: 'document-fit-to-container',
        viewportOnly: true,
        mutatesDocument: false,
        toolbarSuitable: true,
        shortcutSuitable: true,
        actionRecordable: true,
        batchSuitable: true,
        shortcutKeys: ['Ctrl+0', 'Cmd+0'],
        caveats: ['Fit depends on the current editor container size and should be replayed after layout restore.'],
      },
      {
        command: 'actual-size',
        label: '100% zoom',
        kind: 'zoom',
        route: 'viewport-actual-size',
        viewportTarget: 'current-center-actual-size',
        viewportOnly: true,
        mutatesDocument: false,
        toolbarSuitable: true,
        shortcutSuitable: true,
        actionRecordable: true,
        batchSuitable: true,
        shortcutKeys: ['Ctrl+1', 'Cmd+1'],
        caveats: ['100% zoom preserves the current viewport center and does not resample document pixels.'],
      },
      {
        command: 'zoom-in',
        label: 'Zoom in',
        kind: 'zoom',
        route: 'viewport-zoom-step',
        viewportTarget: 'container-center-zoom-step',
        viewportOnly: true,
        mutatesDocument: false,
        toolbarSuitable: true,
        shortcutSuitable: true,
        actionRecordable: true,
        batchSuitable: true,
        shortcutKeys: ['Ctrl+=', 'Cmd+=', 'Ctrl++', 'Cmd++'],
        caveats: ['Zoom steps clamp to the shared viewport maximum and should not affect document history.'],
      },
      {
        command: 'zoom-out',
        label: 'Zoom out',
        kind: 'zoom',
        route: 'viewport-zoom-step',
        viewportTarget: 'container-center-zoom-step',
        viewportOnly: true,
        mutatesDocument: false,
        toolbarSuitable: true,
        shortcutSuitable: true,
        actionRecordable: true,
        batchSuitable: true,
        shortcutKeys: ['Ctrl+-', 'Cmd+-'],
        caveats: ['Zoom steps clamp to the shared viewport minimum and should not affect document history.'],
      },
      {
        command: 'rotate-cw',
        label: 'Rotate view clockwise',
        kind: 'rotation',
        route: 'viewport-rotate-step',
        viewportTarget: 'document-center-rotate-step',
        viewportOnly: true,
        mutatesDocument: false,
        toolbarSuitable: true,
        shortcutSuitable: true,
        actionRecordable: true,
        batchSuitable: true,
        shortcutKeys: ['Ctrl+Shift+.', 'Cmd+Shift+.'],
        caveats: ['View rotation turns the camera around the document center in 15-degree steps and never resamples pixels.'],
      },
      {
        command: 'rotate-ccw',
        label: 'Rotate view counterclockwise',
        kind: 'rotation',
        route: 'viewport-rotate-step',
        viewportTarget: 'document-center-rotate-step',
        viewportOnly: true,
        mutatesDocument: false,
        toolbarSuitable: true,
        shortcutSuitable: true,
        actionRecordable: true,
        batchSuitable: true,
        shortcutKeys: ['Ctrl+Shift+,', 'Cmd+Shift+,'],
        caveats: ['View rotation turns the camera around the document center in 15-degree steps and never resamples pixels.'],
      },
      {
        command: 'reset-rotation',
        label: 'Reset view rotation',
        kind: 'rotation',
        route: 'viewport-rotate-reset',
        viewportTarget: 'view-rotation-reset',
        viewportOnly: true,
        mutatesDocument: false,
        toolbarSuitable: true,
        shortcutSuitable: true,
        actionRecordable: true,
        batchSuitable: true,
        shortcutKeys: ['Ctrl+Shift+0', 'Cmd+Shift+0'],
        caveats: ['Resetting rotation keeps the current zoom and pan; it only returns the view angle to upright.'],
      },
    ]);
  });

  it('fits the image document inside the current viewport container', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-nav-fit',
      title: 'Fit View',
      width: 400,
      height: 200,
    });

    const next = getImageNavigationCommandViewport('fit', doc, { width: 800, height: 600 });

    expect(next).toEqual({
      zoom: 2,
      panX: 0,
      panY: 100,
    });
  });

  it('sets 100 percent zoom around the current viewport center', () => {
    const doc = {
      ...createEmptyImageDocument({
        id: 'doc-nav-actual-size',
        title: 'Actual Size',
        width: 400,
        height: 200,
      }),
      viewport: { zoom: 2, panX: 0, panY: 100 },
    };
    const center = { x: 400, y: 300 };
    const before = screenToDoc(center, doc.viewport);

    const next = getImageNavigationCommandViewport('actual-size', doc, { width: 800, height: 600 });
    const after = screenToDoc(center, next);

    expect(next.zoom).toBe(1);
    expect(after).toEqual(before);
  });

  it.each([
    ['zoom-in', 1.5],
    ['zoom-out', 0.6667],
  ] satisfies Array<[ImageNavigationCommand, number]>)('steps %s around the container center', (command, expectedZoom) => {
    const doc = createEmptyImageDocument({
      id: `doc-nav-${command}`,
      title: command,
      width: 400,
      height: 200,
    });
    const center = { x: 400, y: 300 };
    const before = screenToDoc(center, doc.viewport);

    const next = getImageNavigationCommandViewport(command, doc, { width: 800, height: 600 });
    const after = screenToDoc(center, next);

    expect(next.zoom).toBeCloseTo(expectedZoom);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('describes deterministic ready navigation commands, shortcuts, focus, bounds, and signatures', () => {
    const doc = {
      ...createEmptyImageDocument({
        id: 'doc-nav-readiness',
        title: 'Navigation Readiness',
        width: 400,
        height: 200,
      }),
      viewport: { zoom: 2, panX: 16, panY: 24 },
    };

    const readiness = describeImageNavigationReadiness({
      doc,
      container: { width: 800, height: 600 },
      activeTool: 'hand',
      canvasHasFocus: true,
      pointerInteraction: 'idle',
    });

    expect(readiness.ready).toBe(true);
    expect(readiness.commandDescriptors.map((descriptor) => [descriptor.command, descriptor.route, descriptor.actionRecordable, descriptor.batchSuitable])).toEqual([
      ['pan', 'viewport-pan', true, true],
      ['fit', 'viewport-fit', true, true],
      ['actual-size', 'viewport-actual-size', true, true],
      ['zoom-in', 'viewport-zoom-step', true, true],
      ['zoom-out', 'viewport-zoom-step', true, true],
      ['rotate-cw', 'viewport-rotate-step', true, true],
      ['rotate-ccw', 'viewport-rotate-step', true, true],
      ['reset-rotation', 'viewport-rotate-reset', true, true],
    ]);
    expect(readiness.commands).toEqual([
      { command: 'pan', label: 'Pan view', ready: true, mutatesDocument: false, viewportOnly: true },
      { command: 'fit', label: 'Fit on screen', ready: true, mutatesDocument: false, viewportOnly: true },
      { command: 'actual-size', label: '100% zoom', ready: true, mutatesDocument: false, viewportOnly: true },
      { command: 'zoom-in', label: 'Zoom in', ready: true, mutatesDocument: false, viewportOnly: true },
      { command: 'zoom-out', label: 'Zoom out', ready: true, mutatesDocument: false, viewportOnly: true },
      { command: 'rotate-cw', label: 'Rotate view clockwise', ready: true, mutatesDocument: false, viewportOnly: true },
      { command: 'rotate-ccw', label: 'Rotate view counterclockwise', ready: true, mutatesDocument: false, viewportOnly: true },
      { command: 'reset-rotation', label: 'Reset view rotation', ready: true, mutatesDocument: false, viewportOnly: true },
    ]);
    expect(readiness.keyboardShortcuts).toEqual([
      { command: 'fit', keys: ['Ctrl+0', 'Cmd+0'], ready: true },
      { command: 'actual-size', keys: ['Ctrl+1', 'Cmd+1'], ready: true },
      { command: 'zoom-in', keys: ['Ctrl+=', 'Cmd+=', 'Ctrl++', 'Cmd++'], ready: true },
      { command: 'zoom-out', keys: ['Ctrl+-', 'Cmd+-'], ready: true },
      { command: 'rotate-cw', keys: ['Ctrl+Shift+.', 'Cmd+Shift+.'], ready: true },
      { command: 'rotate-ccw', keys: ['Ctrl+Shift+,', 'Cmd+Shift+,'], ready: true },
      { command: 'reset-rotation', keys: ['Ctrl+Shift+0', 'Cmd+Shift+0'], ready: true },
      { command: 'pan', keys: ['Space+Drag', 'Middle Mouse Drag'], ready: true },
    ]);
    expect(readiness.shortcutRouting).toEqual([
      {
        command: 'fit',
        keys: ['Ctrl+0', 'Cmd+0'],
        scope: 'image-editor-canvas',
        route: 'viewport-fit',
        ready: true,
        requiresCanvasFocus: true,
        ignoresEditableTargets: true,
        editableTargetPolicy: 'ignore-editable-targets',
        preventDefault: true,
        blockers: [],
      },
      {
        command: 'actual-size',
        keys: ['Ctrl+1', 'Cmd+1'],
        scope: 'image-editor-canvas',
        route: 'viewport-actual-size',
        ready: true,
        requiresCanvasFocus: true,
        ignoresEditableTargets: true,
        editableTargetPolicy: 'ignore-editable-targets',
        preventDefault: true,
        blockers: [],
      },
      {
        command: 'zoom-in',
        keys: ['Ctrl+=', 'Cmd+=', 'Ctrl++', 'Cmd++'],
        scope: 'image-editor-canvas',
        route: 'viewport-zoom-step',
        ready: true,
        requiresCanvasFocus: true,
        ignoresEditableTargets: true,
        editableTargetPolicy: 'ignore-editable-targets',
        preventDefault: true,
        blockers: [],
      },
      {
        command: 'zoom-out',
        keys: ['Ctrl+-', 'Cmd+-'],
        scope: 'image-editor-canvas',
        route: 'viewport-zoom-step',
        ready: true,
        requiresCanvasFocus: true,
        ignoresEditableTargets: true,
        editableTargetPolicy: 'ignore-editable-targets',
        preventDefault: true,
        blockers: [],
      },
      {
        command: 'rotate-cw',
        keys: ['Ctrl+Shift+.', 'Cmd+Shift+.'],
        scope: 'image-editor-canvas',
        route: 'viewport-rotate-step',
        ready: true,
        requiresCanvasFocus: true,
        ignoresEditableTargets: true,
        editableTargetPolicy: 'ignore-editable-targets',
        preventDefault: true,
        blockers: [],
      },
      {
        command: 'rotate-ccw',
        keys: ['Ctrl+Shift+,', 'Cmd+Shift+,'],
        scope: 'image-editor-canvas',
        route: 'viewport-rotate-step',
        ready: true,
        requiresCanvasFocus: true,
        ignoresEditableTargets: true,
        editableTargetPolicy: 'ignore-editable-targets',
        preventDefault: true,
        blockers: [],
      },
      {
        command: 'reset-rotation',
        keys: ['Ctrl+Shift+0', 'Cmd+Shift+0'],
        scope: 'image-editor-canvas',
        route: 'viewport-rotate-reset',
        ready: true,
        requiresCanvasFocus: true,
        ignoresEditableTargets: true,
        editableTargetPolicy: 'ignore-editable-targets',
        preventDefault: true,
        blockers: [],
      },
      {
        command: 'pan',
        keys: ['Space+Drag', 'Middle Mouse Drag'],
        scope: 'image-editor-canvas',
        route: 'viewport-pan',
        ready: true,
        requiresCanvasFocus: true,
        ignoresEditableTargets: true,
        editableTargetPolicy: 'ignore-editable-targets',
        preventDefault: true,
        blockers: [],
      },
    ]);
    expect(readiness.viewportBounds).toEqual({
      minZoom: 0.05,
      maxZoom: 64,
      document: { width: 400, height: 200, valid: true },
      container: { width: 800, height: 600, valid: true },
      current: { zoom: 2, panX: 16, panY: 24 },
      fit: { zoom: 2, panX: 0, panY: 100 },
      actualSize: { zoom: 1, panX: 208, panY: 162 },
    });
    expect(readiness.focusBehavior).toEqual({
      canvasHasFocus: true,
      shortcutsRequireCanvasFocus: true,
      canReceiveFocus: true,
      focusBlockers: [],
    });
    expect(readiness.mixedToolCaveats).toEqual([]);
    expect(readiness.mixedToolInteraction).toEqual({
      stable: true,
      preservesActiveTool: true,
      temporaryHandPan: true,
      ignoresNavigationWhileToolDragActive: true,
      panRoutes: ['hand-tool', 'spacebar-drag', 'middle-mouse-drag'],
      pointerCapturePolicy: 'capture-pointer-during-pan-release-on-pointerup',
      cursorPolicy: 'grab-while-panning-restore-active-tool-cursor-after-pan',
    });
    expect(readiness.navigationAffordances).toEqual([
      {
        id: 'toolbar-fit',
        label: 'Fit on screen',
        surface: 'top-toolbar',
        command: 'fit',
        input: 'button',
        visible: true,
        discoverable: true,
      },
      {
        id: 'toolbar-actual-size',
        label: '100% zoom',
        surface: 'top-toolbar',
        command: 'actual-size',
        input: 'button',
        visible: true,
        discoverable: true,
      },
      {
        id: 'toolbar-zoom-step',
        label: 'Zoom in / zoom out',
        surface: 'top-toolbar',
        command: 'zoom-in',
        input: 'button-pair',
        visible: true,
        discoverable: true,
      },
      {
        id: 'toolbar-rotate-step',
        label: 'Rotate view clockwise / counterclockwise',
        surface: 'top-toolbar',
        command: 'rotate-cw',
        input: 'button-pair',
        visible: true,
        discoverable: true,
      },
      {
        id: 'twist-rotate',
        label: 'Two-finger twist view rotation',
        surface: 'canvas',
        command: 'rotate-cw',
        input: 'touch-gesture',
        visible: false,
        discoverable: true,
      },
      {
        id: 'hand-tool-pan',
        label: 'Hand tool pan',
        surface: 'floating-tool-palette',
        command: 'pan',
        input: 'tool',
        visible: true,
        discoverable: true,
      },
      {
        id: 'spacebar-temporary-pan',
        label: 'Temporary hand pan',
        surface: 'canvas',
        command: 'pan',
        input: 'keyboard-pointer-chord',
        visible: false,
        discoverable: true,
      },
      {
        id: 'wheel-zoom',
        label: 'Wheel zoom',
        surface: 'canvas',
        command: 'zoom-in',
        input: 'wheel',
        visible: false,
        discoverable: true,
      },
      {
        id: 'pinch-zoom-touch-pan',
        label: 'Pinch zoom / two-finger pan',
        surface: 'canvas',
        command: 'zoom-in',
        input: 'touch-gesture',
        visible: false,
        discoverable: true,
      },
    ]);
    expect(readiness.platformHandoffCaveats).toEqual([
      {
        target: 'desktop',
        severity: 'info',
        message: 'Desktop handoff should persist viewport state as editor chrome metadata only; document pixels and layer history are unchanged.',
      },
      {
        target: 'android-touch',
        severity: 'warning',
        message: 'Android touch handoff should expose pinch zoom and two-finger pan equivalents because hardware keyboard shortcuts may be unavailable.',
      },
      {
        target: 'android-dex',
        severity: 'warning',
        message: 'Android DeX handoff depends on focused canvas routing for Ctrl/Cmd shortcuts; pointer hover and middle-button pan availability vary by device.',
      },
    ]);
    expect(readiness.actionSuitability).toEqual({
      actionRecordable: true,
      batchSuitable: true,
      suitability: 'viewport-only-safe',
      reason: 'Navigation actions only update viewport metadata, so action playback and batch previews can replay them without mutating pixels, layers, masks, or sources.',
      caveats: [
        'Batch playback should apply navigation after each document opens and after layout/container sizing settles.',
        'Recorded pan positions are screen-layout dependent and should be treated as review convenience rather than export-affecting state.',
      ],
    });
    expect(readiness.blockers).toEqual([]);
    expect(readiness.stableSignatures).toEqual({
      viewport: 'image-navigation-viewport:v1:{"doc":"400x200","container":"800x600","zoom":2,"panX":16,"panY":24,"fit":"2:0:100","actualSize":"1:208:162"}',
      commands: 'image-navigation-commands:v1:actual-size,fit,pan,reset-rotation,rotate-ccw,rotate-cw,zoom-in,zoom-out',
      shortcuts: 'image-navigation-shortcuts:v1:actual-size:Ctrl+1/Cmd+1|fit:Ctrl+0/Cmd+0|pan:Space+Drag/Middle Mouse Drag|reset-rotation:Ctrl+Shift+0/Cmd+Shift+0|rotate-ccw:Ctrl+Shift+,/Cmd+Shift+,|rotate-cw:Ctrl+Shift+./Cmd+Shift+.|zoom-in:Ctrl+=/Cmd+=/Ctrl++/Cmd++|zoom-out:Ctrl+-/Cmd+-',
      readiness: 'image-navigation-readiness:v1:{"ready":true,"blockers":[],"tool":"hand","interaction":"idle","focus":true,"mixedStable":true,"affordances":9}',
    });
    expect(describeImageNavigationReadiness({
      doc,
      container: { width: 800, height: 600 },
      activeTool: 'hand',
      canvasHasFocus: true,
      pointerInteraction: 'idle',
    }).stableSignatures).toEqual(readiness.stableSignatures);
  });

  it('resolves keyboard shortcuts with editable-target and focus readiness blockers', () => {
    const doc = createEmptyImageDocument({
      id: 'doc-nav-shortcuts',
      title: 'Shortcut Routing',
      width: 400,
      height: 200,
    });
    const ready = describeImageNavigationReadiness({
      doc,
      container: { width: 800, height: 600 },
      activeTool: 'move',
      canvasHasFocus: true,
      pointerInteraction: 'idle',
    });
    const unfocused = describeImageNavigationReadiness({
      doc,
      container: { width: 800, height: 600 },
      activeTool: 'move',
      canvasHasFocus: false,
      pointerInteraction: 'idle',
    });

    expect(resolveImageNavigationKeyboardShortcut({
      key: '=',
      ctrlKey: true,
      target: { tagName: 'CANVAS' },
    }, ready)).toEqual({
      command: 'zoom-in',
      route: 'viewport-zoom-step',
      ready: true,
      shouldPreventDefault: true,
      ignoredReason: null,
      blockers: [],
    });
    expect(resolveImageNavigationKeyboardShortcut({
      key: '0',
      metaKey: true,
      target: { tagName: 'DIV' },
    }, ready)).toEqual({
      command: 'fit',
      route: 'viewport-fit',
      ready: true,
      shouldPreventDefault: true,
      ignoredReason: null,
      blockers: [],
    });
    expect(resolveImageNavigationKeyboardShortcut({
      key: '=',
      ctrlKey: true,
      target: { tagName: 'INPUT' },
    }, ready)).toEqual({
      command: null,
      route: null,
      ready: false,
      shouldPreventDefault: false,
      ignoredReason: 'editable-target',
      blockers: [],
    });
    expect(resolveImageNavigationKeyboardShortcut({
      key: '=',
      ctrlKey: true,
      target: { tagName: 'CANVAS' },
    }, unfocused)).toEqual({
      command: 'zoom-in',
      route: 'viewport-zoom-step',
      ready: false,
      shouldPreventDefault: false,
      ignoredReason: 'shortcut-not-ready',
      blockers: ['canvas-not-focused'],
    });
  });

  it('reports invalid viewport bounds, focus blockers, and mixed-tool caveats without document mutation', () => {
    const doc = {
      ...createEmptyImageDocument({
        id: 'doc-nav-blocked',
        title: 'Blocked Navigation',
        width: 0,
        height: 200,
      }),
      viewport: { zoom: Number.NaN, panX: Number.POSITIVE_INFINITY, panY: -12 },
    };

    const readiness = describeImageNavigationReadiness({
      doc,
      container: { width: 0, height: 600 },
      activeTool: 'brush',
      canvasHasFocus: false,
      pointerInteraction: 'tool-drag',
    });

    expect(readiness.ready).toBe(false);
    expect(readiness.commands.every((command: ImageNavigationCommandReadiness) => command.mutatesDocument === false)).toBe(true);
    expect(readiness.viewportBounds.current).toEqual({ zoom: 0.05, panX: 0, panY: -12 });
    expect(readiness.viewportBounds.fit).toEqual({ zoom: 1, panX: 0, panY: 0 });
    expect(readiness.focusBehavior.focusBlockers).toEqual(['canvas-not-focused']);
    expect(readiness.shortcutRouting.every((route) => route.ready === false)).toBe(true);
    expect(readiness.shortcutRouting.map((route) => route.blockers)).toEqual([
      ['invalid-document-bounds', 'invalid-container-bounds', 'canvas-not-focused'],
      ['invalid-document-bounds', 'invalid-container-bounds', 'canvas-not-focused'],
      ['invalid-document-bounds', 'invalid-container-bounds', 'canvas-not-focused'],
      ['invalid-document-bounds', 'invalid-container-bounds', 'canvas-not-focused'],
      ['invalid-document-bounds', 'invalid-container-bounds', 'canvas-not-focused'],
      ['invalid-document-bounds', 'invalid-container-bounds', 'canvas-not-focused'],
      ['invalid-document-bounds', 'invalid-container-bounds', 'canvas-not-focused'],
      ['invalid-document-bounds', 'invalid-container-bounds', 'canvas-not-focused'],
    ]);
    expect(readiness.mixedToolCaveats).toEqual([
      {
        code: 'spacebar-temporary-hand-tool',
        severity: 'info',
        message: 'Brush remains the active tool; Space+Drag should temporarily pan the viewport without changing paint settings.',
      },
      {
        code: 'active-tool-drag-in-progress',
        severity: 'warning',
        message: 'Defer keyboard navigation until the current tool drag completes so the pointer gesture is not reinterpreted as pan or zoom.',
      },
    ]);
    expect(readiness.blockers).toEqual([
      {
        code: 'invalid-document-bounds',
        severity: 'blocking',
        message: 'Navigation needs a positive document width and height before fit or zoom targets can be trusted.',
      },
      {
        code: 'invalid-container-bounds',
        severity: 'blocking',
        message: 'Navigation needs a positive canvas container width and height before viewport targets can be trusted.',
      },
      {
        code: 'canvas-not-focused',
        severity: 'warning',
        message: 'Keyboard navigation shortcuts are idle until the image canvas or editor chrome has focus.',
      },
    ]);
  });
});

describe('ImageNavigationCommands view rotation', () => {
  const container = { width: 800, height: 600 };

  it('exposes rotate commands with keyboard shortcuts and rotation routes', () => {
    const descriptors = getImageNavigationCommandDescriptors();
    const cw = descriptors.find((descriptor) => descriptor.command === 'rotate-cw');
    const ccw = descriptors.find((descriptor) => descriptor.command === 'rotate-ccw');
    const reset = descriptors.find((descriptor) => descriptor.command === 'reset-rotation');

    expect(cw).toMatchObject({ kind: 'rotation', route: 'viewport-rotate-step', toolbarSuitable: true, mutatesDocument: false });
    expect(cw?.shortcutKeys).toContain('Ctrl+Shift+.');
    expect(ccw?.shortcutKeys).toContain('Ctrl+Shift+,');
    expect(reset).toMatchObject({ kind: 'rotation', route: 'viewport-rotate-reset' });
  });

  it('steps and resets view rotation without touching zoom or pan', () => {
    const doc = { width: 400, height: 300, viewport: { zoom: 2, panX: 11, panY: 22 } };

    const cw = getImageNavigationCommandViewport('rotate-cw', doc, container);
    expect(cw).toEqual({ zoom: 2, panX: 11, panY: 22, rotationDeg: 15 });

    const ccw = getImageNavigationCommandViewport('rotate-ccw', { ...doc, viewport: cw }, container);
    expect(ccw).toEqual({ zoom: 2, panX: 11, panY: 22 });

    const reset = getImageNavigationCommandViewport('reset-rotation', { ...doc, viewport: { ...cw, rotationDeg: -33 } }, container);
    expect(reset).toEqual({ zoom: 2, panX: 11, panY: 22 });
  });

  it('preserves rotation across fit and resolves shift rotate shortcuts', () => {
    const rotated = { width: 400, height: 300, viewport: { zoom: 2, panX: 5, panY: 6, rotationDeg: 30 } };
    const fitted = getImageNavigationCommandViewport('fit', rotated, container);
    expect(fitted.rotationDeg).toBe(30);

    const readiness = describeImageNavigationReadiness({
      doc: rotated,
      container,
      activeTool: 'brush',
      canvasHasFocus: true,
      pointerInteraction: 'idle',
    });
    const resolution = resolveImageNavigationKeyboardShortcut(
      { key: '.', ctrlKey: true, shiftKey: true },
      readiness,
    );
    expect(resolution).toMatchObject({ command: 'rotate-cw', ready: true, shouldPreventDefault: true });

    const unshifted = resolveImageNavigationKeyboardShortcut(
      { key: '.', ctrlKey: true, shiftKey: false },
      readiness,
    );
    expect(unshifted).toMatchObject({ command: null, ignoredReason: 'unmapped-shortcut' });
  });
});
