import { describe, expect, it } from 'vitest';
import type { BrushDab } from './ImageBrushEngine';
import { createMask } from './SelectionMask';
import {
  buildQuickMaskOverlayDescriptor,
  createQuickMaskOverlayMask,
  describeQuickMaskChannelHandoff,
  describeQuickMaskReadinessLane,
  getQuickMaskEditRouteDescriptors,
  paintQuickMaskDabs,
  resolveQuickMaskBrushTargetValue,
} from './ImageQuickMask';
import * as QuickMaskModule from './ImageQuickMask';

type QuickMaskReadinessHelper = (
  selection: ReturnType<typeof createMask> | null,
  width: number,
  height: number,
  options: {
    enabled: boolean;
    operation: 'enter-mode' | 'exit-mode' | 'paint-mask';
    viewMode: 'maskedAreas' | 'selectedAreas';
    tintColor?: string;
    opacity?: number;
    featherPx?: number;
    brush?: {
      tool: 'brush' | 'eraser' | 'backgroundEraser' | 'magicEraser';
      color?: string;
    };
    activeChannel?: 'rgb' | 'alpha' | 'spot' | 'selection';
    hasActiveDocument?: boolean;
  },
) => {
  kind: 'quick-mask-edit-readiness';
  mode: {
    enabled: boolean;
    enter: {
      readiness: string;
      action: string;
      output: string;
    };
    exit: {
      readiness: string;
      action: string;
      output: string;
      blocker?: string;
    };
  };
  semantics: {
    selectionToMask: {
      readiness: string;
      source: string;
      white: string;
      black: string;
      gray: string;
      preservesPartialAlpha: boolean;
    };
    maskToSelection: {
      readiness: string;
      output: string;
      preservesPartialAlpha: boolean;
      blocker?: string;
    };
  };
  overlay: {
    viewMode: string;
    overlaySource: string;
    tintColor: string;
    opacity: number;
    opacityLabel: string;
    featherPx: number;
    featherLabel: string;
  };
  brushRouting: {
    tool: string;
    supported: boolean;
    route: string;
    targetValue: number | null;
    effect: string;
    blocker?: string;
  };
  selection: {
    transparentPixels: number;
    partialPixels: number;
    fullPixels: number;
    averageAlpha: number;
  };
  blockers: Array<{ code: string; severity: string; message: string }>;
  warnings: Array<{ code: string; severity: string; message: string }>;
  signature: string;
};

function quickMaskReadiness(): QuickMaskReadinessHelper {
  const helper = (QuickMaskModule as unknown as {
    describeQuickMaskEditingReadiness?: QuickMaskReadinessHelper;
  }).describeQuickMaskEditingReadiness;

  expect(helper).toBeTypeOf('function');
  return helper as QuickMaskReadinessHelper;
}

function dab(patch: Partial<BrushDab> = {}): BrushDab {
  return {
    x: 2,
    y: 2,
    index: 0,
    size: 3,
    opacity: 1,
    flow: 1,
    spacingPx: 1,
    hardness: 1,
    roundness: 1,
    angleDeg: 0,
    tipShape: 'round',
    textureAlpha: 1,
    wetness: 0,
    ...patch,
  };
}

describe('ImageQuickMask', () => {
  it('builds a masked-areas overlay by inverting the current selection', () => {
    const selection = createMask(2, 2);
    selection.data.set([255, 64, 0, 128]);

    const overlay = createQuickMaskOverlayMask(selection, 2, 2, 'maskedAreas');

    expect(Array.from(overlay.data)).toEqual([0, 191, 255, 127]);
  });

  it('builds a full masked overlay when QuickMask is enabled without a selection', () => {
    const overlay = createQuickMaskOverlayMask(null, 2, 2, 'maskedAreas');

    expect(Array.from(overlay.data)).toEqual([255, 255, 255, 255]);
  });

  it('paints selection alpha toward the target value using brush dabs', () => {
    const selection = createMask(5, 5);

    paintQuickMaskDabs(selection, [dab()], 255);

    expect(selection.data[2 * 5 + 2]).toBe(255);
    expect(selection.data[0]).toBe(0);
  });

  it('erodes an existing selection when painting toward black', () => {
    const selection = createMask(5, 5);
    selection.data.fill(255);

    paintQuickMaskDabs(selection, [dab()], 0);

    expect(selection.data[2 * 5 + 2]).toBe(0);
    expect(selection.data[0]).toBe(255);
  });

  it('maps QuickMask brush colors to selection coverage values', () => {
    expect(resolveQuickMaskBrushTargetValue('#ffffff', false)).toBe(255);
    expect(resolveQuickMaskBrushTargetValue('#000000', false)).toBe(0);
    expect(resolveQuickMaskBrushTargetValue('#808080', false)).toBe(128);
    expect(resolveQuickMaskBrushTargetValue('#000000', true)).toBe(255);
  });

  it('describes QuickMask overlays with deterministic display and refinement metadata', () => {
    const selection = createMask(3, 1);
    selection.data.set([255, 128, 0]);
    const descriptor = buildQuickMaskOverlayDescriptor(
      selection,
      3,
      1,
      {
        viewMode: 'maskedAreas',
        tintColor: '#00ff00',
        opacity: 0.375,
        featherPx: 2.345,
      },
    );

    expect(descriptor).toMatchObject({
      kind: 'quick-mask-overlay',
      viewMode: 'maskedAreas',
      overlaySource: 'inverse-selection',
      size: { width: 3, height: 1 },
      selection: {
        transparentPixels: 1,
        partialPixels: 1,
        fullPixels: 1,
        averageAlpha: 127.67,
      },
      overlay: {
        transparentPixels: 1,
        partialPixels: 1,
        fullPixels: 1,
        averageAlpha: 127.33,
      },
      display: {
        tintColor: '#00ff00',
        opacity: 0.375,
        opacityLabel: '38%',
        featherPx: 2.35,
        featherLabel: '2.35 px',
      },
      refinement: {
        supportsPartialAlpha: true,
        brushTargets: [
          {
            paint: 'white',
            targetValue: 255,
            effect: 'adds selected coverage',
          },
          {
            paint: 'black',
            targetValue: 0,
            effect: 'removes selected coverage',
          },
          {
            paint: 'gray',
            targetValue: 128,
            effect: 'writes partial selected coverage',
          },
          {
            paint: 'eraser',
            targetValue: 255,
            effect: 'restores selected coverage',
          },
        ],
      },
      warnings: [
        {
          code: 'quick-mask-edge-refinement-preview-unsupported',
        },
        {
          code: 'quick-mask-richer-visualization-unsupported',
        },
      ],
    });
    expect(descriptor?.signature).toBe(
      'quick-mask-overlay:v1:{"viewMode":"maskedAreas","overlaySource":"inverse-selection","width":3,"height":1,"selection":{"transparentPixels":1,"partialPixels":1,"fullPixels":1,"averageAlpha":127.67},"overlay":{"transparentPixels":1,"partialPixels":1,"fullPixels":1,"averageAlpha":127.33},"display":{"opacity":0.375,"featherPx":2.35},"warnings":["quick-mask-edge-refinement-preview-unsupported","quick-mask-richer-visualization-unsupported"]}',
    );
  });

  it('describes entering QuickMask with selection-to-mask semantics, overlay display, and brush routing', () => {
    const selection = createMask(2, 2);
    selection.data.set([255, 128, 0, 64]);

    const descriptor = quickMaskReadiness()(selection, 2, 2, {
      enabled: false,
      operation: 'enter-mode',
      viewMode: 'maskedAreas',
      tintColor: '#00ff00',
      opacity: 0.42,
      featherPx: 1.25,
      brush: {
        tool: 'brush',
        color: '#404040',
      },
    });

    expect(descriptor).toMatchObject({
      kind: 'quick-mask-edit-readiness',
      mode: {
        enabled: false,
        enter: {
          readiness: 'ready',
          action: 'enable-quick-mask',
          output: 'selection-alpha-as-editable-mask',
        },
        exit: {
          readiness: 'inactive',
          action: 'commit-mask-to-selection',
          output: 'current-selection',
          blocker: 'quick-mask-not-active',
        },
      },
      semantics: {
        selectionToMask: {
          readiness: 'ready',
          source: 'current-selection',
          white: 'selected',
          black: 'masked-unselected',
          gray: 'partially-selected',
          preservesPartialAlpha: true,
        },
        maskToSelection: {
          readiness: 'blocked',
          output: 'current-selection',
          preservesPartialAlpha: true,
          blocker: 'quick-mask-not-active',
        },
      },
      overlay: {
        viewMode: 'maskedAreas',
        overlaySource: 'inverse-selection',
        tintColor: '#00ff00',
        opacity: 0.42,
        opacityLabel: '42%',
        featherPx: 1.25,
        featherLabel: '1.25 px',
      },
      brushRouting: {
        tool: 'brush',
        supported: true,
        route: 'quick-mask-selection-alpha',
        targetValue: 64,
        effect: 'writes partial selected coverage',
      },
      selection: {
        transparentPixels: 1,
        partialPixels: 2,
        fullPixels: 1,
        averageAlpha: 111.75,
      },
      blockers: [],
    });
    expect(descriptor.warnings.map((warning) => warning.code)).toEqual([
      'quick-mask-edge-refinement-preview-unsupported',
      'quick-mask-richer-visualization-unsupported',
      'quick-mask-alpha-channel-interop-warning',
    ]);
    expect(descriptor.signature).toBe(
      'quick-mask-edit-readiness:v1:{"operation":"enter-mode","enabled":false,"viewMode":"maskedAreas","overlaySource":"inverse-selection","width":2,"height":2,"selection":{"transparentPixels":1,"partialPixels":2,"fullPixels":1,"averageAlpha":111.75},"overlay":{"tintColor":"#00ff00","opacity":0.42,"featherPx":1.25},"brush":{"tool":"brush","supported":true,"targetValue":64,"route":"quick-mask-selection-alpha"},"blockers":[],"warnings":["quick-mask-edge-refinement-preview-unsupported","quick-mask-richer-visualization-unsupported","quick-mask-alpha-channel-interop-warning"]}',
    );
  });

  it('describes active QuickMask exit as mask-to-selection while warning on alpha channel interop', () => {
    const selection = createMask(3, 1);
    selection.data.set([0, 127, 255]);

    const descriptor = quickMaskReadiness()(selection, 3, 1, {
      enabled: true,
      operation: 'exit-mode',
      viewMode: 'selectedAreas',
      activeChannel: 'alpha',
      brush: {
        tool: 'eraser',
        color: '#000000',
      },
    });

    expect(descriptor.mode).toMatchObject({
      enabled: true,
      enter: {
        readiness: 'already-active',
      },
      exit: {
        readiness: 'ready',
        action: 'commit-mask-to-selection',
        output: 'current-selection',
      },
    });
    expect(descriptor.semantics.maskToSelection).toMatchObject({
      readiness: 'ready',
      output: 'current-selection',
      preservesPartialAlpha: true,
    });
    expect(descriptor.overlay).toMatchObject({
      viewMode: 'selectedAreas',
      overlaySource: 'selection',
      tintColor: '#ff0000',
      opacity: 0.5,
    });
    expect(descriptor.brushRouting).toMatchObject({
      tool: 'eraser',
      supported: true,
      targetValue: 255,
      effect: 'restores selected coverage',
    });
    expect(descriptor.blockers).toEqual([]);
    expect(descriptor.warnings.map((warning) => warning.code)).toEqual([
      'quick-mask-richer-visualization-unsupported',
      'quick-mask-alpha-channel-interop-warning',
      'quick-mask-direct-channel-paint-unsupported',
    ]);
  });

  it('reports deterministic blockers for invalid paint readiness', () => {
    const descriptor = quickMaskReadiness()(null, 0, 4, {
      enabled: false,
      operation: 'paint-mask',
      viewMode: 'maskedAreas',
      hasActiveDocument: false,
      brush: {
        tool: 'magicEraser',
        color: '#ffffff',
      },
    });

    expect(descriptor.brushRouting).toMatchObject({
      tool: 'magicEraser',
      supported: false,
      route: 'unsupported-pixel-alpha-tool',
      targetValue: null,
      blocker: 'quick-mask-brush-tool-unsupported',
    });
    expect(descriptor.blockers.map((blocker) => blocker.code)).toEqual([
      'quick-mask-no-active-document',
      'quick-mask-invalid-document-size',
      'quick-mask-not-active',
      'quick-mask-brush-tool-unsupported',
    ]);
    expect(descriptor.signature).toContain(
      '"blockers":["quick-mask-no-active-document","quick-mask-invalid-document-size","quick-mask-not-active","quick-mask-brush-tool-unsupported"]',
    );
  });

  it('exposes typed QuickMask edit routes, channel handoff, and lane signatures', () => {
    const routes = getQuickMaskEditRouteDescriptors();
    expect(routes.map((route) => route.route)).toEqual([
      'enter-quick-mask',
      'exit-quick-mask',
      'brush-to-selection-alpha',
      'eraser-to-selection-alpha',
      'background-eraser-blocked',
      'magic-eraser-blocked',
      'channel-handoff',
    ]);
    expect(routes.find((route) => route.route === 'background-eraser-blocked')).toMatchObject({
      support: 'unsupported',
      source: 'pixel-alpha-tool',
      output: 'blocked',
      blocker: 'quick-mask-brush-tool-unsupported',
      signature: 'quick-mask-edit-route:v1:background-eraser-blocked:quick-mask-brush-tool-unsupported',
    });
    expect(routes.find((route) => route.route === 'channel-handoff')).toMatchObject({
      support: 'separate-workflow',
      source: 'active-channel',
      output: 'saved-alpha-channel-workflow',
    });

    const channelHandoff = describeQuickMaskChannelHandoff('spot');
    expect(channelHandoff).toEqual({
      kind: 'quick-mask-channel-handoff',
      activeChannel: 'spot',
      quickMaskSource: 'transient-selection-alpha',
      commitTarget: 'current-selection',
      savedAlphaPersistence: 'separate-channels-workflow',
      directChannelPainting: 'unsupported-while-quick-mask-active',
      warnings: [
        {
          code: 'quick-mask-alpha-channel-interop-warning',
          severity: 'warning',
          message: 'Quick Mask edits the transient selection alpha buffer; saved alpha channel persistence remains a separate Channels workflow.',
        },
        {
          code: 'quick-mask-direct-channel-paint-unsupported',
          severity: 'warning',
          message: 'Quick Mask brush routing overrides RGB, alpha, and spot-channel paint targets while the mode is active.',
        },
      ],
      signature: 'quick-mask-channel-handoff:v1:{"activeChannel":"spot","warnings":["quick-mask-alpha-channel-interop-warning","quick-mask-direct-channel-paint-unsupported"]}',
    });

    const selection = createMask(2, 1);
    selection.data.set([255, 0]);
    const lane = describeQuickMaskReadinessLane(selection, 2, 1, {
      enabled: true,
      operation: 'paint-mask',
      viewMode: 'maskedAreas',
      activeChannel: 'spot',
      brush: { tool: 'backgroundEraser' },
    });

    expect(lane.kind).toBe('quick-mask-readiness-lane');
    expect(lane.stableSignatures.editRoutes).toEqual(routes.map((route) => route.signature));
    expect(lane.stableSignatures.channelHandoff).toBe(channelHandoff.signature);
    expect(lane.readiness.brushRouting).toMatchObject({
      tool: 'backgroundEraser',
      supported: false,
      blocker: 'quick-mask-brush-tool-unsupported',
    });
    expect(lane.readiness.blockers.map((blocker) => blocker.code)).toEqual([
      'quick-mask-brush-tool-unsupported',
    ]);
    expect(lane.signature).toContain('quick-mask-readiness-lane:v1:');
  });
});
