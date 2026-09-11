// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageLayerEffect, ImageLayerFilter } from '../../types/imageEditor';
import { LayerEffectsControls, LayerFiltersControls } from './ImageEditorLayerStackEffectsControls';

function makeFilter(patch: Partial<ImageLayerFilter> & Pick<ImageLayerFilter, 'id' | 'kind'>): ImageLayerFilter {
  return {
    id: patch.id,
    kind: patch.kind,
    enabled: patch.enabled ?? true,
    amount: patch.amount ?? 100,
    opacity: patch.opacity ?? 1,
    blendMode: patch.blendMode ?? 'normal',
  } as ImageLayerFilter;
}

function makeEffect(patch: Partial<ImageLayerEffect> & Pick<ImageLayerEffect, 'id' | 'kind'>): ImageLayerEffect {
  return {
    id: patch.id,
    kind: patch.kind,
    enabled: patch.enabled ?? true,
    color: 'color' in patch ? patch.color : '#000000',
    opacity: 'opacity' in patch ? patch.opacity : 1,
    angle: 'angle' in patch ? patch.angle : 0,
    distance: 'distance' in patch ? patch.distance : 1,
    size: 'size' in patch ? patch.size : 1,
  } as ImageLayerEffect;
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function setSelectValue(select: HTMLSelectElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
  setter?.call(select, value);
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('LayerFiltersControls', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders per-filter blend and opacity controls and reorders filters with move buttons', () => {
    const onChange = vi.fn();
    const filters = [
      makeFilter({ id: 'blur', kind: 'blur', amount: 6 }),
      makeFilter({ id: 'invert', kind: 'invert', amount: 100 }),
    ];

    act(() => {
      root.render(<LayerFiltersControls filters={filters} onChange={onChange} />);
    });

    const blendMode = container.querySelector<HTMLSelectElement>('select[aria-label="Filter blend mode"]');
    const opacity = container.querySelector<HTMLInputElement>('input[aria-label="Filter opacity"]');
    const moveDown = container.querySelector<HTMLButtonElement>('button[aria-label="Move filter down"]');
    const label = Array.from(container.querySelectorAll('span')).find((node) => node.textContent === 'Blur');

    expect(blendMode).not.toBeNull();
    expect(opacity).not.toBeNull();
    expect(moveDown).not.toBeNull();
    expect(label?.getAttribute('title')).toBe(
      'Editable in Sloom Studio: amount, blend mode, opacity, enabled state, stack order, and per-filter alpha masks. Advanced parameters and native Photoshop Smart Filter roundtrip remain unsupported.',
    );

    act(() => {
      setSelectValue(blendMode!, 'screen');
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'blur', blendMode: 'screen' }),
      expect.objectContaining({ id: 'invert' }),
    ]);

    onChange.mockClear();

    act(() => {
      setInputValue(opacity!, '0.35');
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'blur', opacity: 0.35 }),
      expect.objectContaining({ id: 'invert' }),
    ]);

    onChange.mockClear();

    act(() => {
      moveDown?.click();
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'invert' }),
      expect.objectContaining({ id: 'blur' }),
    ]);
  });

  it('creates and edits an owned filter mask through the coverage control', () => {
    const onChange = vi.fn();
    act(() => {
      root.render(<LayerFiltersControls filters={[makeFilter({ id: 'blur', kind: 'blur', amount: 6 })]} layerSize={{ width: 4, height: 2 }} onChange={onChange} />);
    });
    const mask = container.querySelector<HTMLInputElement>('input[aria-label="Mask coverage for Blur"]');
    expect(mask).not.toBeNull();
    act(() => setInputValue(mask!, '25'));
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ mask: { width: 4, height: 2, alpha: [64, 64, 64, 64, 64, 64, 64, 64] } })]);
  });
});

describe('LayerEffectsControls', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('adds inner shadow and exposes distance size and angle controls', () => {
    const onChange = vi.fn();

    act(() => {
      root.render(
        <LayerEffectsControls
          effects={[makeEffect({ id: 'inner-shadow', kind: 'innerShadow', distance: 3, size: 4, angle: 5 })]}
          onChange={onChange}
        />,
      );
    });

    const addButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Inner Shadow');
    const distance = container.querySelector<HTMLInputElement>('input[aria-label="Inner shadow distance"]');
    const size = container.querySelector<HTMLInputElement>('input[aria-label="Inner shadow size"]');
    const angle = container.querySelector<HTMLInputElement>('input[aria-label="Inner shadow angle"]');

    expect(addButton).not.toBeNull();
    expect(distance).not.toBeNull();
    expect(size).not.toBeNull();
    expect(angle).not.toBeNull();

    act(() => {
      setInputValue(distance!, '7');
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'inner-shadow', distance: 7 }),
    ]);
  });

  it('adds satin and pattern overlay with compact controls', () => {
    const onChange = vi.fn();

    act(() => {
      root.render(
        <LayerEffectsControls
          effects={[
            makeEffect({ id: 'satin', kind: 'satin', distance: 10, size: 12, angle: 19, invert: false }),
            {
              id: 'pattern',
              kind: 'patternOverlay',
              enabled: true,
              color: '#ffffff',
              backgroundColor: '#000000',
              opacity: 0.35,
              pattern: 'checker',
              scale: 8,
            } as ImageLayerEffect,
          ]}
          onChange={onChange}
        />,
      );
    });

    const addSatin = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Satin');
    const addPattern = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Pattern Overlay');
    const satinDistance = container.querySelector<HTMLInputElement>('input[aria-label="Satin distance"]');
    const satinSize = container.querySelector<HTMLInputElement>('input[aria-label="Satin size"]');
    const satinAngle = container.querySelector<HTMLInputElement>('input[aria-label="Satin angle"]');
    const satinInvert = container.querySelector<HTMLInputElement>('input[aria-label="Invert satin"]');
    const patternSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Pattern overlay pattern"]');
    const patternScale = container.querySelector<HTMLInputElement>('input[aria-label="Pattern overlay scale"]');

    expect(addSatin).not.toBeNull();
    expect(addPattern).not.toBeNull();
    expect(satinDistance).not.toBeNull();
    expect(satinSize).not.toBeNull();
    expect(satinAngle).not.toBeNull();
    expect(satinInvert).not.toBeNull();
    expect(patternSelect).not.toBeNull();
    expect(patternScale).not.toBeNull();

    act(() => {
      setInputValue(satinDistance!, '14');
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'satin', distance: 14 }),
      expect.objectContaining({ id: 'pattern' }),
    ]);

    onChange.mockClear();

    act(() => {
      setSelectValue(patternSelect!, 'diagonal');
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'satin' }),
      expect.objectContaining({ id: 'pattern', pattern: 'diagonal' }),
    ]);

    onChange.mockClear();

    act(() => {
      setInputValue(patternScale!, '12');
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'satin' }),
      expect.objectContaining({ id: 'pattern', scale: 12 }),
    ]);
  });

  it('adds inner glow and gradient overlay with compact controls', () => {
    const onChange = vi.fn();

    act(() => {
      root.render(
        <LayerEffectsControls
          effects={[
            makeEffect({ id: 'inner-glow', kind: 'innerGlow', size: 9 }),
            {
              id: 'gradient-overlay',
              kind: 'gradientOverlay',
              enabled: true,
              color: '#ff0000',
              secondaryColor: '#0000ff',
              opacity: 1,
              angle: 0,
              scale: 1,
              reverse: false,
            } as ImageLayerEffect,
          ]}
          onChange={onChange}
        />,
      );
    });

    const addInnerGlow = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Inner Glow');
    const addGradientOverlay = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Gradient Overlay');
    const innerGlowSize = container.querySelector<HTMLInputElement>('input[aria-label="Inner glow size"]');
    const gradientAngle = container.querySelector<HTMLInputElement>('input[aria-label="Gradient overlay angle"]');
    const gradientScale = container.querySelector<HTMLInputElement>('input[aria-label="Gradient overlay scale"]');
    const gradientReverse = container.querySelector<HTMLInputElement>('input[aria-label="Reverse gradient overlay"]');

    expect(addInnerGlow).not.toBeNull();
    expect(addGradientOverlay).not.toBeNull();
    expect(innerGlowSize).not.toBeNull();
    expect(gradientAngle).not.toBeNull();
    expect(gradientScale).not.toBeNull();
    expect(gradientReverse).not.toBeNull();

    act(() => {
      setInputValue(innerGlowSize!, '16');
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'inner-glow', size: 16 }),
      expect.objectContaining({ id: 'gradient-overlay' }),
    ]);

    onChange.mockClear();

    act(() => {
      setInputValue(gradientAngle!, '45');
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'inner-glow' }),
      expect.objectContaining({ id: 'gradient-overlay', angle: 45 }),
    ]);

    onChange.mockClear();

    act(() => {
      gradientReverse?.click();
    });

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'inner-glow' }),
      expect.objectContaining({ id: 'gradient-overlay', reverse: true }),
    ]);
  });

  it('synchronizes shadow angles from global light and exposes style preset apply/save controls', () => {
    const onChange = vi.fn();
    const onGlobalLightAngleChange = vi.fn();
    const onApplyStylePreset = vi.fn();
    const onSaveStylePreset = vi.fn();
    const effects = [
      makeEffect({ id: 'drop-shadow', kind: 'dropShadow', angle: 15 }),
      makeEffect({ id: 'inner-shadow', kind: 'innerShadow', angle: -15 }),
      makeEffect({ id: 'glow', kind: 'outerGlow' }),
    ];

    act(() => {
      root.render(
        <LayerEffectsControls
          effects={effects}
          globalLightAngle={45}
          onApplyStylePreset={onApplyStylePreset}
          onChange={onChange}
          onGlobalLightAngleChange={onGlobalLightAngleChange}
          onSaveStylePreset={onSaveStylePreset}
          stylePresets={[{ id: 'layer-style-soft-shadow', label: 'Soft Shadow', style: { opacity: 1, blendMode: 'normal', effects, filters: [] } }]}
        />,
      );
    });

    const globalAngle = container.querySelector<HTMLInputElement>('input[aria-label="Global light angle"]');
    const presetSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Layer style preset"]');
    const readinessSummary = container.querySelector<HTMLElement>('[data-layer-effect-readiness-signature]');
    const saveButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Save Style');
    const dropShadowLabel = Array.from(container.querySelectorAll('span')).find((node) => node.textContent === 'Drop Shadow');

    expect(globalAngle).not.toBeNull();
    expect(presetSelect).not.toBeNull();
    expect(readinessSummary?.dataset.layerEffectReadinessStatus).toBe('warning');
    expect(readinessSummary?.dataset.layerEffectReadinessSignature).toContain('layer-effect-readiness-stack:v1:');
    expect(readinessSummary?.textContent).toBe('2 global-light effects / Photoshop live effects flatten on export');
    expect(saveButton).not.toBeNull();
    expect(dropShadowLabel?.getAttribute('title')).toBe(
      'Portable inside Sloom Studio with deterministic preview/export signatures. This-Layer Blend If and bounded Bevel & Emboss are executable; Photoshop Underlying Layer, split sliders, contour, and noise parity remain unavailable.',
    );

    act(() => {
      setInputValue(globalAngle!, '120');
    });

    expect(onGlobalLightAngleChange).toHaveBeenCalledWith(120);
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'drop-shadow', angle: 120 }),
      expect.objectContaining({ id: 'inner-shadow', angle: 120 }),
      expect.objectContaining({ id: 'glow' }),
    ]);

    act(() => {
      setSelectValue(presetSelect!, 'layer-style-soft-shadow');
    });

    expect(onApplyStylePreset).toHaveBeenCalledWith('layer-style-soft-shadow');

    act(() => {
      saveButton?.click();
    });

    expect(onSaveStylePreset).toHaveBeenCalled();
  });
});
