import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AdjustmentLayerKind } from '../../types/imageEditor';
import {
  adjustmentLayerLabel,
  defaultAdjustmentSettings,
  serializeAdjustmentLayerPreset,
} from './ImageAdjustmentLayer';
import { AdjustmentLayerControls } from './ImageEditorAdjustmentControls';
import { buildImageHistogram } from './ImageHistogram';

const ADJUSTMENT_LAYER_KINDS: AdjustmentLayerKind[] = [
  'brightnessContrast',
  'hueSaturation',
  'blackWhite',
  'invert',
  'exposure',
  'temperatureTint',
  'levels',
  'curves',
];

function makeImageData(width: number, height: number, data: number[]): ImageData {
  return {
    width,
    height,
    data: new Uint8ClampedArray(data),
  } as ImageData;
}

describe('ImageEditorAdjustmentControls', () => {
  it('renders every default adjustment kind while keeping defaults preset-serializable', () => {
    for (const kind of ADJUSTMENT_LAYER_KINDS) {
      const adjustment = defaultAdjustmentSettings(kind);
      const html = renderToStaticMarkup(
        <AdjustmentLayerControls
          adjustment={adjustment}
          onChange={vi.fn()}
        />,
      );

      expect(html.replace(/&amp;/g, '&')).toContain(`Reset ${adjustmentLayerLabel(kind)}`);
      expect(serializeAdjustmentLayerPreset(`${kind} preset`, adjustment)).toMatchObject({
        version: 1,
        kind,
      });
    }
  });

  it('mounts GPU compositor eligibility that is truthful about the active layer scope', () => {
    const eligible = renderToStaticMarkup(
      <AdjustmentLayerControls
        adjustment={{ kind: 'invert' }}
        onChange={vi.fn()}
      />,
    );
    const cpuOnly = renderToStaticMarkup(
      <AdjustmentLayerControls
        adjustment={{ kind: 'hueSaturation', hue: 0, saturation: 0, lightness: 0 }}
        onChange={vi.fn()}
      />,
    );
    const masked = renderToStaticMarkup(
      <AdjustmentLayerControls
        adjustment={{ kind: 'invert' }}
        gpuPreviewOptions={{ hasMask: true }}
        onChange={vi.fn()}
      />,
    );
    const clipped = renderToStaticMarkup(
      <AdjustmentLayerControls
        adjustment={{ kind: 'invert' }}
        gpuPreviewOptions={{ hasClippingMask: true }}
        onChange={vi.fn()}
      />,
    );
    const partialOpacity = renderToStaticMarkup(
      <AdjustmentLayerControls
        adjustment={{ kind: 'invert' }}
        gpuPreviewOptions={{ opacity: 0.5 }}
        onChange={vi.fn()}
      />,
    );

    expect(eligible).toContain('data-image-gpu-adjustment-preview');
    expect(eligible).toContain('GPU compositor');
    expect(eligible).toContain('merge/flatten');
    expect(eligible).toContain('raster export');
    expect(eligible).toContain('CPU fallback');
    expect(cpuOnly).toContain('deterministic CPU adjustment renderer');
    expect(masked).toContain('Layer masks use the deterministic CPU adjustment renderer.');
    expect(clipped).toContain('Clipped adjustments use the deterministic CPU adjustment renderer.');
    expect(partialOpacity).toContain('Partial-opacity adjustments use the deterministic CPU adjustment renderer.');
  });

  it('renders histogram-aware Levels controls with channel-specific clipping readouts', () => {
    const histogram = buildImageHistogram(makeImageData(3, 1, [
      0, 0, 0, 255,
      128, 64, 32, 255,
      255, 255, 255, 255,
    ]));

    const html = renderToStaticMarkup(
      <AdjustmentLayerControls
        adjustment={{
          kind: 'levels',
          channel: 'red',
          inputBlack: 0,
          inputWhite: 255,
          gamma: 1,
          outputBlack: 0,
          outputWhite: 255,
        }}
        histogram={histogram}
        onChange={vi.fn()}
      />,
    );

    expect(html).toContain('Levels Histogram');
    expect(html).toContain('Document Red adjustment histogram');
    expect(html).toContain('Shadow Clip');
    expect(html).toContain('Highlight Clip');
  });

  it('renders histogram-aware Curves controls using luminance for RGB channel edits', () => {
    const histogram = buildImageHistogram(makeImageData(2, 1, [
      0, 0, 0, 255,
      255, 255, 255, 255,
    ]));

    const html = renderToStaticMarkup(
      <AdjustmentLayerControls
        adjustment={{
          kind: 'curves',
          channel: 'rgb',
          points: [{ input: 0, output: 0 }, { input: 255, output: 255 }],
          shadows: 0,
          midtones: 0,
          highlights: 0,
        }}
        histogram={histogram}
        onChange={vi.fn()}
      />,
    );

    expect(html).toContain('Curves Histogram');
    expect(html).toContain('Document Lum adjustment histogram');
  });

  it('renders histogram readiness guidance when Levels preview data is unavailable', () => {
    const html = renderToStaticMarkup(
      <AdjustmentLayerControls
        adjustment={{
          kind: 'levels',
          channel: 'rgb',
          inputBlack: 0,
          inputWhite: 255,
          gamma: 1,
          outputBlack: 0,
          outputWhite: 255,
        }}
        histogram={null}
        onChange={vi.fn()}
      />,
    );

    expect(html).toContain('Histogram preview pending');
    expect(html).toContain('Render lower visible layers to inspect Levels or Curves clipping before applying changes.');
  });

  it('displays loading state when histogram is computing', () => {
    const html = renderToStaticMarkup(
      <AdjustmentLayerControls
        adjustment={{
          kind: 'levels',
          channel: 'red',
          inputBlack: 0,
          inputWhite: 255,
          gamma: 1,
          outputBlack: 0,
          outputWhite: 255,
        }}
        histogram={null}
        histogramLoading={true}
        onChange={vi.fn()}
      />,
    );

    expect(html).toContain('Computing');
    expect(html).toContain('Computing histogram from visible layers...');
  });

  it('displays error state when histogram computation fails', () => {
    const errorMsg = 'Layer rendering failed: out of memory';
    const html = renderToStaticMarkup(
      <AdjustmentLayerControls
        adjustment={{
          kind: 'curves',
          channel: 'green',
          points: [{ input: 0, output: 0 }, { input: 255, output: 255 }],
          shadows: 0,
          midtones: 0,
          highlights: 0,
        }}
        histogram={null}
        histogramError={errorMsg}
        onChange={vi.fn()}
      />,
    );

    expect(html).toContain('Error');
    expect(html).toContain(errorMsg);
  });

  it('includes accessible aria-label on histogram visualization', () => {
    const histogram = buildImageHistogram(makeImageData(2, 1, [
      64, 64, 64, 255,
      192, 192, 192, 255,
    ]));

    const html = renderToStaticMarkup(
      <AdjustmentLayerControls
        adjustment={{
          kind: 'levels',
          channel: 'rgb',
          inputBlack: 0,
          inputWhite: 255,
          gamma: 1,
          outputBlack: 0,
          outputWhite: 255,
        }}
        histogram={histogram}
        onChange={vi.fn()}
      />,
    );

    expect(html).toContain('Document Lum adjustment histogram');
    expect(html).toContain('aria-label');
    expect(html).toContain('mean');
    expect(html).toContain('range');
    expect(html).toContain('pixels');
    expect(html).toContain('clipped');
  });

  it('preserves histogram lifecycle across adjustment kind changes', () => {
    const histogram = buildImageHistogram(makeImageData(1, 1, [128, 128, 128, 255]));
    const onChange = vi.fn();

    const html = renderToStaticMarkup(
      <AdjustmentLayerControls
        adjustment={{
          kind: 'levels',
          channel: 'blue',
          inputBlack: 0,
          inputWhite: 255,
          gamma: 1,
          outputBlack: 0,
          outputWhite: 255,
        }}
        histogram={histogram}
        onChange={onChange}
      />,
    );

    expect(html).toContain('Levels Histogram');
    expect(html).toContain('Blue');
    expect(onChange).not.toHaveBeenCalled();
  });
});
