import { describe, expect, it } from 'vitest';
import { DEFAULT_BRUSH_SETTINGS } from '../../types/imageEditor';
import {
  buildBrushDabs,
  buildBrushStrokePreviewMetadata,
  buildBrushEngineReadiness,
  describeBrushRouteSummaries,
  describeUnsupportedBrushDynamicsReadiness,
  describeAdvancedBrushEngineSupport,
  describeBrushWorkflowSupport,
  buildSymmetryBrushDabs,
  getUnsupportedBrushCapabilityWarnings,
  normalizeBrushSettings,
  resolveBrushDynamics,
  resolveBrushDabColor,
  summarizeBrushPresetCapabilities,
  smoothBrushPoint,
  readBrushPressure,
  readBrushTilt,
  describeBrushDynamicsSupportMatrix,
} from './ImageBrushEngine';
import { IMAGE_BRUSH_PRESETS } from './ImageBrushPresets';

describe('ImageBrushEngine', () => {
  it('normalizes brush settings with desktop-style controls and safe bounds', () => {
    expect(normalizeBrushSettings({
      size: 2048,
      opacity: 3,
      hardness: -1,
      flow: 2,
      spacing: 0,
      roundness: 0,
      scatter: 5,
      angleDeg: 725,
      pressureSize: 3,
      pressureOpacity: -2,
      pressureFlow: 2,
      smoothing: 4,
      tipShape: 'square',
      symmetryMode: 'both',
    })).toMatchObject({
      size: 512,
      opacity: 1,
      hardness: 0,
      flow: 1,
      spacing: 0.02,
      roundness: 0.05,
      scatter: 2,
      angleDeg: 5,
      pressureSize: 1,
      pressureOpacity: 0,
      pressureFlow: 1,
      smoothing: 1,
      tipShape: 'square',
      symmetryMode: 'both',
    });
  });

  it('resolves pressure-sensitive size, opacity, flow, and spacing without mutating defaults', () => {
    const dynamics = resolveBrushDynamics({
      ...DEFAULT_BRUSH_SETTINGS,
      size: 40,
      opacity: 0.8,
      flow: 0.5,
      spacing: 0.25,
      pressureSize: 1,
      pressureOpacity: 0.5,
      pressureFlow: 1,
    }, 0.25);

    expect(dynamics.size).toBe(10);
    expect(dynamics.opacity).toBe(0.5);
    expect(dynamics.flow).toBe(0.125);
    expect(dynamics.spacingPx).toBe(2.5);
    expect(DEFAULT_BRUSH_SETTINGS.size).toBe(12);
  });

  it('reshapes pressure through the response curve (soft damps, hard lifts, linear unchanged)', () => {
    const base = {
      ...DEFAULT_BRUSH_SETTINGS,
      size: 100,
      pressureSize: 1,
      pressureOpacity: 0,
      pressureFlow: 0,
      smoothing: 0,
    } as const;

    const linear = resolveBrushDynamics({ ...base, pressureCurve: 'linear' }, 0.5);
    const soft = resolveBrushDynamics({ ...base, pressureCurve: 'soft' }, 0.5);
    const hard = resolveBrushDynamics({ ...base, pressureCurve: 'hard' }, 0.5);

    // pressureSize=1 so size == base.size * shapedPressure. Linear: 100 * 0.5 = 50.
    expect(linear.size).toBe(50);
    // soft (ease-in) damps mid-pressure below linear; hard (ease-out) lifts it above.
    expect(soft.size).toBeLessThan(linear.size);
    expect(hard.size).toBeGreaterThan(linear.size);
    // Omitting the curve entirely is identical to linear (back-compat).
    expect(resolveBrushDynamics({ ...base }, 0.5).size).toBe(linear.size);
  });

  it('reduces opacity and flow with stylus tilt when enabled', () => {
    const tilt = { hasTilt: true, altitudeDeg: 45, azimuthDeg: 0, hasTwist: false, twistDeg: 0, tiltAmount: 0.5 };
    const base = {
      ...DEFAULT_BRUSH_SETTINGS,
      opacity: 1,
      flow: 1,
      pressureOpacity: 0,
      pressureFlow: 0,
      tiltOpacity: 1,
      tiltFlow: 1,
    } as const;

    // Half-tilt with full tilt→opacity/flow halves both channels.
    const tilted = resolveBrushDynamics(base, 1, undefined, 0, tilt);
    expect(tilted.opacity).toBeCloseTo(0.5, 6);
    expect(tilted.flow).toBeCloseTo(0.5, 6);

    // No tilt state => no reduction.
    const flat = resolveBrushDynamics(base, 1, undefined, 0, null);
    expect(flat.opacity).toBe(1);
    expect(flat.flow).toBe(1);

    // The workflow descriptor reports opacity/flow as tilt-affected (not unsupported).
    const descriptor = describeBrushWorkflowSupport(base);
    expect(descriptor.support.tilt.affects).toEqual(expect.arrayContaining(['opacity', 'flow']));
    expect(descriptor.support.tilt.unsupportedAffects).not.toEqual(expect.arrayContaining(['opacity', 'flow']));
  });

  it('drives roundness and hardness from pen pressure when enabled', () => {
    const base = {
      ...DEFAULT_BRUSH_SETTINGS,
      roundness: 1,
      hardness: 1,
      pressureSize: 0,
      pressureRoundness: 1,
      pressureHardness: 1,
    } as const;

    const light = resolveBrushDynamics(base, 0.2);
    const heavy = resolveBrushDynamics(base, 1);

    // Light pressure flattens the tip and softens the edge; full pressure restores the base.
    expect(light.roundness).toBeLessThan(1);
    expect(light.hardness).toBeLessThan(1);
    expect(heavy.roundness).toBeCloseTo(1, 6);
    expect(heavy.hardness).toBeCloseTo(1, 6);

    // With the dynamics off, roundness/hardness are pinned to the base regardless of pressure.
    const off = { ...DEFAULT_BRUSH_SETTINGS, roundness: 1, hardness: 1, pressureRoundness: 0, pressureHardness: 0 };
    expect(resolveBrushDynamics(off, 0.2).roundness).toBe(1);
    expect(resolveBrushDynamics(off, 0.2).hardness).toBe(1);

    // The workflow descriptor now reports roundness/hardness as pressure-affected (not unsupported).
    const descriptor = describeBrushWorkflowSupport(base);
    expect(descriptor.support.pressure.affects).toEqual(expect.arrayContaining(['roundness', 'hardness']));
    expect(descriptor.support.pressure.unsupportedAffects).not.toEqual(expect.arrayContaining(['roundness', 'hardness']));
  });

  it('applies deterministic per-dab jitter to size, opacity, flow, and roundness', () => {
    const stroke = (settings: Partial<typeof DEFAULT_BRUSH_SETTINGS>) =>
      buildBrushDabs(
        { x: 0, y: 0 },
        { x: 200, y: 0 },
        { ...DEFAULT_BRUSH_SETTINGS, size: 40, opacity: 1, flow: 1, roundness: 1, spacing: 0.1, ...settings },
        1,
        { seed: 9 },
      );

    // No jitter => every dab keeps the base property values.
    const flat = stroke({});
    expect(flat.every((d) => d.size === flat[0].size)).toBe(true);
    expect(flat.every((d) => d.opacity === 1 && d.flow === 1 && d.roundness === 1)).toBe(true);
    const baseSize = flat[0].size;

    // Size jitter => sizes vary, never exceed the base, and at least one is reduced.
    const jittered = stroke({ sizeJitter: 0.6 });
    expect(jittered.every((d) => d.size <= baseSize + 1e-9)).toBe(true);
    expect(jittered.some((d) => d.size < baseSize)).toBe(true);
    expect(new Set(jittered.map((d) => d.size)).size).toBeGreaterThan(1);

    // Deterministic: same seed reproduces identical dabs.
    const again = stroke({ sizeJitter: 0.6 });
    expect(again.map((d) => d.size)).toEqual(jittered.map((d) => d.size));

    // Opacity / flow / roundness jitter each reduce their own channel below the base.
    expect(stroke({ opacityJitter: 0.5 }).some((d) => d.opacity < 1)).toBe(true);
    expect(stroke({ flowJitter: 0.5 }).some((d) => d.flow < 1)).toBe(true);
    expect(stroke({ roundnessJitter: 0.5 }).some((d) => d.roundness < 1)).toBe(true);
    // Angle jitter rotates the tip per dab (around the base 0°), producing varied angles.
    const angled = stroke({ angleJitter: 0.5 });
    expect(new Set(angled.map((d) => d.angleDeg)).size).toBeGreaterThan(1);
    expect(angled.some((d) => d.angleDeg !== flat[0].angleDeg)).toBe(true);
    // Channels are independent: size jitter alone leaves opacity/flow/roundness pinned.
    expect(jittered.every((d) => d.opacity === 1 && d.flow === 1 && d.roundness === 1)).toBe(true);
  });

  it('builds deterministic spaced dabs with scatter and tip rotation', () => {
    const dabs = buildBrushDabs(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      {
        ...DEFAULT_BRUSH_SETTINGS,
        size: 20,
        spacing: 0.25,
        scatter: 0.5,
        angleDeg: 30,
        roundness: 0.6,
      },
      1,
      { seed: 7 },
    );

    expect(dabs.length).toBe(21);
    expect(dabs[0]).toMatchObject({
      size: 20,
      opacity: 1,
      flow: 1,
      angleDeg: 30,
      roundness: 0.6,
    });
    expect(dabs[0].y).not.toBe(0);
    expect(buildBrushDabs(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { ...DEFAULT_BRUSH_SETTINGS, size: 20, spacing: 0.25, scatter: 0.5 },
      1,
      { seed: 7 },
    ).map((dab) => [dab.x, dab.y])).toEqual(dabs.map((dab) => [dab.x, dab.y]));
  });

  it('smooths pointer input according to the brush smoothing value', () => {
    expect(smoothBrushPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 0)).toEqual({ x: 100, y: 0 });
    expect(smoothBrushPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 1)).toEqual({ x: 15, y: 0 });
    expect(smoothBrushPoint({ x: 0, y: 0 }, { x: 100, y: 0 }, 0.5)).toEqual({ x: 57.5, y: 0 });
  });

  it('reads brush pressure with relaxed checks for Wacom pointer types', () => {
    // Normal pen should work as expected
    expect(readBrushPressure({ pointerType: 'pen', pressure: 0.7 })).toBe(0.7);

    // A pressure pen at the moment of contact/release reports ~0 pressure and must
    // stay light, not snap to full size (that produced full-size blobs at the ends
    // of strokes on Wacom/Cintiq displays).
    expect(readBrushPressure({ pointerType: 'pen', pressure: 0 })).toBe(0.05);
    expect(readBrushPressure({ pointerType: 'pen', pressure: -0.2 })).toBe(0.05);
    // A no-pressure-support pen reports 0.5 when down; the clamp keeps it usable.
    expect(readBrushPressure({ pointerType: 'pen', pressure: 0.5 })).toBe(0.5);

    // Mouse or touch reporting valid high-precision pressure should be allowed (Wacom relaxation)
    expect(readBrushPressure({ pointerType: 'mouse', pressure: 0.35 })).toBe(0.35);
    expect(readBrushPressure({ pointerType: 'touch', pressure: 0.88 })).toBe(0.88);

    // Mouse or touch reporting standard fallback pressure should fall back to 1 (full pressure)
    expect(readBrushPressure({ pointerType: 'mouse', pressure: 0.5 })).toBe(1);
    expect(readBrushPressure({ pointerType: 'mouse', pressure: 0 })).toBe(1);
    expect(readBrushPressure({ pointerType: 'touch', pressure: 0.5 })).toBe(1);
    expect(readBrushPressure({ pointerType: 'touch', pressure: 0 })).toBe(1);
  });

  it('reads brush tilt and translates standard tiltX and tiltY to normalized degrees', () => {
    // No tilt (perpendicular)
    expect(readBrushTilt({ tiltX: 0, tiltY: 0 })).toBeNull();

    // Horizontal right tilt (tiltX > 0, tiltY = 0) => 0 degrees
    expect(readBrushTilt({ tiltX: 30, tiltY: 0 })).toBe(0);

    // Vertical down tilt (tiltX = 0, tiltY > 0) => 90 degrees
    expect(readBrushTilt({ tiltX: 0, tiltY: 45 })).toBe(90);

    // Diagonal tilt (tiltX = -20, tiltY = -20) => 225 degrees
    expect(readBrushTilt({ tiltX: -20, tiltY: -20 })).toBe(225);
  });

  it('resolves and builds dabs with tilt-aware brush rotation', () => {
    const dynamicsWithTilt = resolveBrushDynamics({
      ...DEFAULT_BRUSH_SETTINGS,
      angleDeg: 45,
    }, 1, 135);

    // Since tilt is active, the static angleDeg (45) is overridden with tilt (135)
    expect(dynamicsWithTilt.angleDeg).toBe(135);

    const dynamicsWithoutTilt = resolveBrushDynamics({
      ...DEFAULT_BRUSH_SETTINGS,
      angleDeg: 45,
    }, 1, null);

    // Since tilt is null/no-tilt, fallback to static angleDeg (45)
    expect(dynamicsWithoutTilt.angleDeg).toBe(45);

    // Under buildBrushDabs with options.tiltAngle
    const dabs = buildBrushDabs(
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { ...DEFAULT_BRUSH_SETTINGS, angleDeg: 10 },
      1,
      { tiltAngle: 270 }
    );
    expect(dabs[0].angleDeg).toBe(270);
  });

  it('mirrors brush dabs around centered vertical, horizontal, and four-way symmetry axes', () => {
    const dabs = buildBrushDabs(
      { x: 20, y: 30 },
      { x: 20, y: 30 },
      { ...DEFAULT_BRUSH_SETTINGS, size: 12 },
      1,
    );

    const vertical = buildSymmetryBrushDabs(dabs, 'vertical', { x: 50, y: 40 });
    const horizontal = buildSymmetryBrushDabs(dabs, 'horizontal', { x: 50, y: 40 });
    const both = buildSymmetryBrushDabs(dabs, 'both', { x: 50, y: 40 });

    expect(vertical.map((dab) => [dab.x, dab.y])).toEqual([[20, 30], [80, 30]]);
    expect(horizontal.map((dab) => [dab.x, dab.y])).toEqual([[20, 30], [20, 50]]);
    expect(both.map((dab) => [dab.x, dab.y])).toEqual([[20, 30], [80, 30], [20, 50], [80, 50]]);
  });

  it('builds deterministic brush stroke preview metadata for spacing, smoothing, and dynamics', () => {
    const settings = {
      ...DEFAULT_BRUSH_SETTINGS,
      size: 40,
      spacing: 0.25,
      smoothing: 0.5,
      pressureSize: 1,
      pressureOpacity: 0.5,
      pressureFlow: 1,
      scatter: 0.2,
    };

    const preview = buildBrushStrokePreviewMetadata(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      settings,
      { pressure: 0.5, seed: 13, tiltAngle: 315 },
    );

    expect(preview.rawDistancePx).toBe(100);
    expect(preview.smoothedTo).toEqual({ x: 57.5, y: 0 });
    expect(preview.distancePx).toBe(57.5);
    expect(preview.dynamics).toMatchObject({
      size: 20,
      opacity: 0.75,
      flow: 0.5,
      spacingPx: 5,
      angleDeg: 315,
    });
    expect(preview.spacing).toEqual({
      ratio: 0.25,
      px: 5,
      dabCount: 12,
      coverage: 'continuous',
    });
    expect(preview.smoothing).toEqual({
      amount: 0.5,
      applied: true,
      followFactor: 0.575,
    });
    expect(preview.dabPreview.map((dab) => [dab.x, dab.y, dab.index])).toEqual(
      buildBrushStrokePreviewMetadata(
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        settings,
        { pressure: 0.5, seed: 13, tiltAngle: 315 },
      ).dabPreview.map((dab) => [dab.x, dab.y, dab.index]),
    );
    expect(preview.signature).toBe('40:0.25:0.5:0.5:13:0,0->57.5,0:12');
  });

  it('summarizes brush preset capability coverage for standard brush-library workflows', () => {
    const summary = summarizeBrushPresetCapabilities(IMAGE_BRUSH_PRESETS);

    expect(summary.totalPresets).toBeGreaterThanOrEqual(24);
    expect(summary.groups).toMatchObject({
      Sketch: 4,
      Ink: 4,
      Paint: 9,
      'Comic / Manga': 5,
      FX: 3,
      Utility: 4,
    });
    expect(summary.workflowCoverage).toMatchObject({
      sketch: true,
      ink: true,
      paint: true,
      comic: true,
      effects: true,
      utility: true,
      eraser: true,
      texture: true,
    });
    expect(summary.implementedDynamics).toEqual(expect.arrayContaining([
      'spacing',
      'smoothing',
      'pressureSize',
      'pressureOpacity',
      'pressureFlow',
      'tiltAngle',
      'scatter',
      'symmetryMode',
      'roundness',
      'tipShape',
      'velocitySize',
      'velocityOpacity',
      'velocityFlow',
      'velocitySpacing',
      'texture',
      'dualBrush',
      'wetMedia',
      'gpuBrushEngine',
      'androidBrushControls',
      'gamepadBrushControls',
      'abrSourceHash',
    ]));
    expect(summary.unsupportedDynamics).toEqual(expect.arrayContaining(['colorJitter']));
    expect(summary.unsupportedDynamics).not.toEqual(expect.arrayContaining(['texture', 'dualBrush', 'angleJitter', 'sizeJitter']));
    expect(summary.unsupportedWarnings).toEqual([]);
  });

  it('warns about unsupported pressure, tilt, and randomization fields without flagging implemented dynamics', () => {
    const importedSettings = {
      ...DEFAULT_BRUSH_SETTINGS,
      pressureSize: 0.6,
      pressureFlow: 0.4,
      scatter: 0.25,
      pressureAngle: 0.8,
      tiltScatter: 0.45,
      colorJitter: 0.3,
    };

    expect(getUnsupportedBrushCapabilityWarnings(importedSettings).map((warning) => ({
      field: warning.field,
      category: warning.category,
    }))).toEqual([
      { field: 'pressureAngle', category: 'pressure' },
      { field: 'tiltScatter', category: 'tilt' },
      { field: 'colorJitter', category: 'randomization' },
    ]);

    const summary = summarizeBrushPresetCapabilities([
      {
        id: 'imported-mixer',
        label: 'Imported Mixer',
        group: 'Paint',
        settings: importedSettings,
      },
    ]);

    expect(summary.unsupportedWarnings.map((warning) => `${warning.presetId}:${warning.field}`)).toEqual([
      'imported-mixer:pressureAngle',
      'imported-mixer:tiltScatter',
      'imported-mixer:colorJitter',
    ]);
  });

  it('blends the dab colour between foreground and background by pressure/tilt', () => {
    const base = { primaryColor: '#000000', secondaryColor: '#ffffff' };
    // Colour dynamics off => foreground unchanged.
    expect(resolveBrushDabColor({ ...base, pressure: 1, tiltAmount: 1, pressureColor: 0, tiltColor: 0 }))
      .toBe('#000000');
    // Full pressure with full pressure-colour => fully the background.
    expect(resolveBrushDabColor({ ...base, pressure: 1, tiltAmount: 0, pressureColor: 1, tiltColor: 0 }))
      .toBe('rgb(255, 255, 255)');
    // Half pressure => midpoint grey.
    expect(resolveBrushDabColor({ ...base, pressure: 0.5, tiltAmount: 0, pressureColor: 1, tiltColor: 0 }))
      .toBe('rgb(128, 128, 128)');
    // Tilt drives the blend independently.
    expect(resolveBrushDabColor({ ...base, pressure: 0, tiltAmount: 1, pressureColor: 0, tiltColor: 1 }))
      .toBe('rgb(255, 255, 255)');
  });

  it('describes deterministic brush workflow support for planning consumers', () => {
    const descriptor = describeBrushWorkflowSupport({
      ...DEFAULT_BRUSH_SETTINGS,
      size: 32,
      spacing: 0.32,
      smoothing: 0.45,
      pressureSize: 0.7,
      pressureOpacity: 0.2,
      pressureFlow: 0,
      scatter: 0.18,
      symmetryMode: 'both',
      pressureAngle: 0.5,
      tiltScatter: 0.3,
      colorJitter: 0.4,
    });

    expect(descriptor).toMatchObject({
      descriptorId: 'image-brush-workflow-support:v1',
      version: 1,
      deterministic: true,
      support: {
        spacing: { supported: true, value: 0.32, coverage: 'spaced' },
        smoothing: { supported: true, value: 0.45, followFactor: 0.617 },
        pressure: {
          supported: true,
          affects: ['size', 'opacity'],
          unsupportedAffects: ['angle'],
        },
        tilt: {
          supported: true,
          affects: ['angle', 'roundness', 'size'],
          unsupportedAffects: ['scatter'],
        },
        randomization: {
          supported: true,
          affects: ['scatter'],
          unsupportedAffects: ['color'],
        },
      },
      symmetry: {
        mode: 'both',
        axes: ['vertical', 'horizontal'],
        mirroredDabMultiplier: 4,
        deterministic: true,
      },
    });
    expect(descriptor.warnings.map((warning) => `${warning.field}:${warning.category}`)).toEqual([
      'pressureAngle:pressure',
      'tiltScatter:tilt',
      'colorJitter:randomization',
    ]);
    expect(descriptor.signature).toBe('brush-support:v1:32:0.32:0.45:0.7,0.2,0:angle,scatter:color:both');
    expect(describeBrushWorkflowSupport(descriptor.settings)).toEqual(descriptor);
  });

  it('summarizes brush and eraser engine readiness with preview signatures and honest limitations', () => {
    const readiness = buildBrushEngineReadiness({
      settings: {
        ...DEFAULT_BRUSH_SETTINGS,
        size: 48,
        opacity: 0.82,
        hardness: 0.35,
        flow: 0.64,
        spacing: 0.3,
        smoothing: 0.4,
        pressureSize: 0.8,
        pressureOpacity: 0.25,
        pressureFlow: 0.5,
        scatter: 0.22,
        symmetryMode: 'vertical',
        texture: 'canvas-grain',
        dualBrush: true,
        colorJitter: 0.2,
      },
      presets: IMAGE_BRUSH_PRESETS,
      presetPack: {
        version: 1,
        presetCount: IMAGE_BRUSH_PRESETS.length,
        importable: true,
        exportable: true,
      },
      stylus: {
        pointerTypes: ['mouse', 'pen'],
        pressureEventsObserved: true,
        tiltEventsObserved: false,
        wacomDriverFallback: true,
      },
      operation: {
        tool: 'eraser',
        documentOpen: true,
        hasEditableTarget: true,
        lockedPixels: false,
        hiddenLayer: false,
        canvasWidth: 1200,
        canvasHeight: 800,
      },
      preview: {
        from: { x: 0, y: 0 },
        to: { x: 120, y: 0 },
        pressure: 0.6,
        seed: 5,
        tiltAngle: 45,
        maxDabs: 4,
      },
    });

    expect(readiness).toMatchObject({
      descriptorId: 'image-brush-engine-readiness:v1',
      version: 1,
      deterministic: true,
      operation: {
        tool: 'eraser',
        ready: true,
        compositeOperation: 'destination-out',
      },
      support: {
        dabs: { deterministic: true, supported: true },
        spacing: { supported: true, value: 0.3, coverage: 'spaced' },
        hardness: { supported: true, value: 0.35 },
        opacity: { supported: true, value: 0.82 },
        flow: { supported: true, value: 0.64 },
        smoothing: { supported: true, value: 0.4 },
        pressure: { supported: true, affects: ['size', 'opacity', 'flow'] },
        tilt: { supported: true, affects: ['angle', 'roundness', 'size'] },
        symmetry: { supported: true, mode: 'vertical', mirroredDabMultiplier: 2 },
        presets: { supported: true, totalPresets: IMAGE_BRUSH_PRESETS.length, unsupportedWarnings: 0 },
      },
      limitations: {
        advancedDynamics: {
          supported: false,
          unsupportedFields: ['colorJitter'],
        },
        texture: { supported: true, requested: true },
        scatter: {
          supported: true,
          deterministicOnly: true,
          unsupportedJitter: true,
        },
      },
      presetPack: {
        ready: true,
        packVersion: 1,
        presetCount: IMAGE_BRUSH_PRESETS.length,
        importable: true,
        exportable: true,
      },
      stylusInput: {
        ready: true,
        pressureReady: true,
        tiltReady: false,
        pointerTypes: ['mouse', 'pen'],
        wacomDriverFallback: true,
      },
      blockers: [],
    });
    expect(readiness.brushPreview.signature).toBe(readiness.brushPreview.preview.signature);
    expect(readiness.brushPreview.preview.dabPreview).toHaveLength(4);
    expect(readiness.advancedEngine.texture).toMatchObject({
      supported: true,
      requested: true,
      requestedFields: ['texture', 'textureScale', 'dualBrush'],
    });
    expect(readiness.signature).toContain('image-brush-engine-readiness:v1');
    expect(readiness.signature).toContain('preview=48:0.3:0.6:0.4:5:0,0->79.2,0:9');
  });

  it('reports operation blockers and preset-pack gaps without claiming runtime readiness', () => {
    const readiness = buildBrushEngineReadiness({
      settings: {
        ...DEFAULT_BRUSH_SETTINGS,
        size: 16,
        pressureAngle: 0.5,
        tiltScatter: 0.4,
      },
      presets: [],
      presetPack: {
        version: 2,
        presetCount: 0,
        importable: false,
        exportable: false,
      },
      stylus: {
        pointerTypes: ['mouse'],
        pressureEventsObserved: false,
        tiltEventsObserved: false,
      },
      operation: {
        tool: 'brush',
        documentOpen: false,
        hasEditableTarget: false,
        lockedPixels: true,
        hiddenLayer: true,
        canvasWidth: 0,
        canvasHeight: 600,
      },
    });

    expect(readiness.operation.ready).toBe(false);
    expect(readiness.blockers.map((blocker) => blocker.code)).toEqual([
      'no-open-document',
      'no-editable-pixel-target',
      'target-pixels-locked',
      'target-layer-hidden',
      'invalid-canvas-bounds',
    ]);
    expect(readiness.presetPack).toMatchObject({
      ready: false,
      packVersion: 2,
      presetCount: 0,
      importable: false,
      exportable: false,
      warnings: [
        'Preset pack version 2 is not the current deterministic pack format.',
        'Preset pack has no presets to import or export.',
        'Preset pack import is not ready.',
        'Preset pack export is not ready.',
      ],
    });
    expect(readiness.stylusInput).toMatchObject({
      ready: false,
      pressureReady: false,
      tiltReady: false,
      pointerTypes: ['mouse'],
    });
    expect(readiness.support.presets).toMatchObject({
      supported: true,
      totalPresets: 0,
      coverageComplete: false,
    });
    expect(readiness.limitations.advancedDynamics.unsupportedFields).toEqual([
      'pressureAngle',
      'tiltScatter',
    ]);
    expect(readiness.signature).toContain('blockers=no-open-document,no-editable-pixel-target,target-pixels-locked,target-layer-hidden,invalid-canvas-bounds');
  });

  it('describes route summaries for pixel, mask, QuickMask, and channel brush targets', () => {
    const routeSummary = describeBrushRouteSummaries({
      settings: {
        ...DEFAULT_BRUSH_SETTINGS,
        size: 24,
        spacing: 0.2,
        smoothing: 0.25,
      },
      tool: 'eraser',
      activeTarget: 'quick-mask',
      layerMaskTarget: true,
      quickMaskEnabled: true,
      activeRgbChannels: ['blue', 'red'],
      activeAlphaChannelId: 'alpha-shadow',
      activeSpotChannelId: 'spot-varnish',
      operation: {
        documentOpen: true,
        hasEditableTarget: true,
        lockedPixels: false,
        hiddenLayer: false,
        canvasWidth: 640,
        canvasHeight: 480,
      },
      preview: {
        from: { x: 4, y: 8 },
        to: { x: 84, y: 8 },
        pressure: 0.75,
        seed: 23,
        maxDabs: 3,
        applySmoothing: false,
      },
    });

    expect(routeSummary).toMatchObject({
      descriptorId: 'image-brush-route-summaries:v1',
      version: 1,
      deterministic: true,
      tool: 'eraser',
      activeTarget: 'quick-mask',
      activeRoute: 'quick-mask-selection-alpha',
      routes: {
        pixels: {
          route: 'active-pixels-rgba',
          supported: true,
          ready: true,
          compositeOperation: 'destination-out',
        },
        layerMask: {
          route: 'layer-mask-alpha',
          supported: true,
          ready: true,
          targetValue: 0,
        },
        quickMask: {
          route: 'quick-mask-selection-alpha',
          supported: true,
          ready: true,
          targetValue: 0,
        },
        rgbChannels: {
          route: 'active-rgb-components',
          supported: true,
          ready: true,
          channelComponents: ['red', 'blue'],
        },
        alphaChannel: {
          route: 'alpha-channel-direct-paint-unsupported',
          supported: false,
          ready: false,
          channelId: 'alpha-shadow',
        },
        spotChannel: {
          route: 'spot-channel-direct-paint-unsupported',
          supported: false,
          ready: false,
          channelId: 'spot-varnish',
        },
      },
    });
    expect(routeSummary.warnings.map((warning) => warning.code)).toEqual([
      'alpha-channel-direct-paint-unsupported',
      'spot-channel-direct-paint-unsupported',
    ]);
    expect(routeSummary.blockers).toEqual([]);
    expect(routeSummary.previewSignature).toBe('24:0.2:0.75:0.25:23:4,8->84,8:20');
    expect(routeSummary.signature).toBe(
      'brush-routes:v1:eraser:quick-mask:quick-mask-selection-alpha:pixels=ready,mask=ready,quick=ready,rgb=ready:red,blue,alpha=unsupported:alpha-shadow,spot=unsupported:spot-varnish:preview=24:0.2:0.75:0.25:23:4,8->84,8:20:blockers=none:warnings=alpha-channel-direct-paint-unsupported,spot-channel-direct-paint-unsupported',
    );
  });

  it('publishes deterministic support paths and blocker signatures for eraser routes', () => {
    const routeSummary = describeBrushRouteSummaries({
      settings: {
        ...DEFAULT_BRUSH_SETTINGS,
        size: 18,
        spacing: 0.25,
        smoothing: 0,
      },
      tool: 'eraser',
      activeTarget: 'layer-mask',
      layerMaskTarget: false,
      quickMaskEnabled: false,
      activeRgbChannels: [],
      operation: {
        documentOpen: true,
        hasEditableTarget: true,
        lockedPixels: false,
        hiddenLayer: false,
        canvasWidth: 320,
        canvasHeight: 200,
      },
      preview: {
        from: { x: 0, y: 0 },
        to: { x: 54, y: 0 },
        pressure: 1,
        seed: 2,
        applySmoothing: false,
      },
    });

    expect(routeSummary.routes.pixels).toMatchObject({
      supportPath: 'active-pixels-alpha-clear',
      blockerSummary: 'none',
      signature: 'brush-route-target:v1:active-pixels-rgba:active-pixels-alpha-clear:ready:destination-out:value=none:components=none:channel=none:blockers=none:warnings=none',
    });
    expect(routeSummary.routes.layerMask).toMatchObject({
      supportPath: 'layer-mask-alpha-conceal',
      ready: false,
      blockers: ['no-layer-mask-target'],
      blockerSummary: 'no-layer-mask-target',
      signature: 'brush-route-target:v1:layer-mask-alpha:layer-mask-alpha-conceal:blocked:destination-out:value=0:components=none:channel=none:blockers=no-layer-mask-target:warnings=none',
    });
    expect(routeSummary.routes.quickMask).toMatchObject({
      supportPath: 'quick-mask-selection-reveal',
      ready: false,
      blockers: ['quick-mask-disabled'],
      blockerSummary: 'quick-mask-disabled',
    });
    expect(routeSummary.routes.rgbChannels).toMatchObject({
      supportPath: 'active-rgb-components-alpha-clear',
      ready: false,
      blockers: ['no-active-rgb-channel'],
      blockerSummary: 'no-active-rgb-channel',
    });
    expect(routeSummary.activeRoute).toBe('layer-mask-alpha');
  });

  it('describes texture, dual-brush, and scattering dynamics as deterministic supported states', () => {
    const dynamics = describeUnsupportedBrushDynamicsReadiness({
      ...DEFAULT_BRUSH_SETTINGS,
      scatter: 0.45,
      texture: 'canvas-grain',
      dualBrush: true,
      pressureScatter: 0.5,
      colorJitter: 0.3,
    });

    expect(dynamics).toMatchObject({
      descriptorId: 'image-brush-unsupported-dynamics-readiness:v1',
      version: 1,
      deterministic: true,
      texture: {
        supported: true,
        requested: true,
        requestedFields: ['texture', 'textureScale', 'dualBrush'],
        fallback: 'flat-brush-tip',
      },
      scattering: {
        supported: true,
        value: 0.45,
        deterministicOnly: true,
        state: 'deterministic-scatter-with-jitter-fallback',
        unsupportedJitterFields: ['pressureScatter', 'colorJitter'],
      },
    });
    expect(dynamics.warnings.map((warning) => `${warning.field}:${warning.category}`)).toEqual([
      'pressureScatter:pressure',
      'colorJitter:randomization',
    ]);
    expect(dynamics.signature).toBe(
      'brush-unsupported-dynamics:v1:texture=texture,textureScale,dualBrush:scatter=0.45:scatter-state=deterministic-scatter-with-jitter-fallback:jitter=pressureScatter,colorJitter:warnings=pressureScatter,colorJitter',
    );
  });

  it('publishes a typed brush dynamics support matrix with implemented advanced brush states', () => {
    const matrix = describeBrushDynamicsSupportMatrix({
      settings: {
        ...DEFAULT_BRUSH_SETTINGS,
        spacing: 0.2,
        smoothing: 0.35,
        pressureSize: 0.7,
        pressureFlow: 0.4,
        scatter: 0.3,
        symmetryMode: 'horizontal',
        dualBrush: true,
        wetEdges: true,
        abrSourceHash: 'abr-legacy',
        velocitySize: 0.5,
      },
      stylus: {
        pointerTypes: ['mouse'],
        pressureEventsObserved: false,
        tiltEventsObserved: false,
      },
    });

    expect(matrix).toMatchObject({
      descriptorId: 'image-brush-dynamics-support-matrix:v1',
      version: 1,
      deterministic: true,
      support: {
        spacing: { supported: true, value: 0.2, coverage: 'continuous' },
        smoothing: { supported: true, value: 0.35 },
        pressure: {
          supported: true,
          trueTabletPressure: {
            supported: false,
            state: 'browser-or-device-unavailable',
          },
          affects: ['size', 'flow'],
        },
        tilt: {
          supported: true,
          state: 'browser-or-device-unavailable',
          affects: ['angle', 'roundness', 'size'],
        },
        velocity: {
          supported: true,
          requested: true,
          requestedFields: ['velocitySize'],
          affects: ['size'],
        },
        symmetry: {
          supported: true,
          mode: 'horizontal',
          mirroredDabMultiplier: 2,
        },
      },
    });
    expect(matrix.unsupportedEngineStates.map((state) => state.code)).toEqual([
      'true-tablet-pressure-unavailable',
    ]);
    expect(matrix.dynamicSettingsSignature).toBe('brush-dynamics-settings:v1:12:0.2:0.35:0.7,0,0.4:0.3:horizontal:velocitySize');
    expect(matrix.signature).toBe(
      'brush-dynamics-matrix:v1:settings=brush-dynamics-settings:v1:12:0.2:0.35:0.7,0,0.4:0.3:horizontal:velocitySize:pressure=browser-or-device-unavailable:tilt=browser-or-device-unavailable:unsupported=true-tablet-pressure-unavailable',
    );
  });

  it('supports the advanced brush completion slice: velocity, texture, wet media, GPU/backend, Android/gamepad controls, and ABR fidelity', () => {
    const advanced = describeAdvancedBrushEngineSupport({
      settings: {
        ...DEFAULT_BRUSH_SETTINGS,
        velocitySize: 0.7,
        velocityOpacity: 0.45,
        velocityFlow: 0.3,
        velocitySpacing: 0.4,
        texture: 'canvas-grain',
        textureScale: 0.5,
        textureDepth: 0.6,
        dualBrush: true,
        wetEdges: true,
        wetMedia: true,
        wetMix: 0.35,
        wetLoad: 0.55,
        wetPull: 0.25,
        gpuBrushEngine: true,
        androidBrushControls: true,
        gamepadBrushControls: true,
        abrSourceHash: 'abr-native-sha256',
        abrPresetId: 'abr:dry-media-01',
        abrVersion: 12,
      },
      renderBackend: {
        webgpuAvailable: true,
        offscreenCanvasAvailable: true,
        desktopAmdAvailable: true,
        desktopNvidiaAvailable: true,
        androidQualcommAvailable: true,
      },
      deviceControls: {
        androidStylusAvailable: true,
        gamepadConnected: true,
      },
    });

    expect(advanced).toMatchObject({
      descriptorId: 'image-brush-advanced-engine-support:v1',
      version: 1,
      deterministic: true,
      velocity: {
        supported: true,
        requested: true,
        affects: ['size', 'opacity', 'flow', 'spacing'],
      },
      texture: {
        supported: true,
        requested: true,
        requestedFields: ['texture', 'textureScale', 'textureDepth', 'dualBrush'],
        dualBrushComposition: true,
      },
      wetMedia: {
        supported: true,
        requested: true,
        mode: 'wet-edge-alpha-build-up',
      },
      renderBackend: {
        supported: true,
        gpuReady: true,
        selected: 'webgpu-compute',
        targets: ['desktop-amd', 'desktop-nvidia', 'android-qualcomm-adreno'],
      },
      deviceControls: {
        supported: true,
        android: { supported: true, stylusAvailable: true },
        gamepad: { supported: true, connected: true },
      },
      abrImportFidelity: {
        supported: true,
        sourceHash: 'abr-native-sha256',
        presetId: 'abr:dry-media-01',
        version: 12,
        fidelity: 'native-metadata-normalized',
      },
    });
    expect(advanced.unsupportedEngineStates).toEqual([]);
    expect(advanced.signature).toContain('velocity=size,opacity,flow,spacing');

    const preview = buildBrushStrokePreviewMetadata(
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      advanced.settings,
      { pressure: 0.7, seed: 41, velocityPxPerMs: 1.8, maxDabs: 5 },
    );

    expect(preview.velocity).toMatchObject({
      pxPerMs: 1.8,
      affects: ['size', 'opacity', 'flow', 'spacing'],
    });
    expect(preview.texture).toMatchObject({
      active: true,
      depth: 0.6,
      scale: 0.5,
      dualBrushComposition: true,
    });
    expect(preview.wetMedia).toMatchObject({
      active: true,
      mix: 0.35,
      load: 0.55,
      pull: 0.25,
    });
    expect(preview.dabPreview.some((dab) => dab.textureAlpha < 1)).toBe(true);
    expect(preview.signature).toContain('velocity=1.8');
  });
});
