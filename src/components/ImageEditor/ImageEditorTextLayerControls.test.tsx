// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageLayer } from '../../types/imageEditor';
import { normalizeImageTextStyle } from './ImageTextLayer';
import { EditableTextLayerControls } from './ImageEditorTextLayerControls';

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

function textLayer(): ImageLayer {
  return {
    id: 'text-layer',
    name: 'Text',
    type: 'text',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 0,
    y: 0,
    bitmap: null,
    bitmapVersion: 0,
    mask: null,
    text: normalizeImageTextStyle({
      content: 'Sloom Studio',
      fontSize: 32,
      baselineShift: 4,
      fontKerning: 'auto',
      fontVariantCaps: 'normal',
    }),
  };
}

function pathLayer(): ImageLayer {
  return {
    id: 'path-layer',
    name: 'Caption Path',
    type: 'vector',
    visible: true,
    locked: false,
    opacity: 1,
    blendMode: 'normal',
    x: 24,
    y: 40,
    bitmap: null,
    bitmapVersion: 7,
    mask: null,
    metadata: {
      vectorShape: {
        kind: 'path',
        width: 180,
        height: 24,
        points: [{ x: 0, y: 24 }, { x: 180, y: 0 }],
        closed: false,
        fillColor: 'transparent',
        fillOpacity: 0,
        strokeColor: '#22d3ee',
        strokeOpacity: 1,
        strokeWidth: 2,
      },
    },
  };
}

describe('EditableTextLayerControls', () => {
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
    delete window.signalLoomNative;
    vi.unstubAllGlobals();
  });

  it('commits baseline shift kerning and caps patches for retained text layers', () => {
    const onChange = vi.fn();

    act(() => {
      root.render(<EditableTextLayerControls layer={textLayer()} onChange={onChange} />);
    });

    const baseline = container.querySelector<HTMLInputElement>('input[aria-label="Text baseline shift value"]');
    const kerning = container.querySelector<HTMLSelectElement>('select[aria-label="Text kerning"]');
    const caps = container.querySelector<HTMLSelectElement>('select[aria-label="Text caps"]');

    expect(baseline).not.toBeNull();
    expect(kerning).not.toBeNull();
    expect(caps).not.toBeNull();

    act(() => {
      setInputValue(baseline!, '12');
    });
    expect(onChange).toHaveBeenLastCalledWith({ baselineShift: 12 });

    act(() => {
      setSelectValue(kerning!, 'none');
    });
    expect(onChange).toHaveBeenLastCalledWith({ fontKerning: 'none' });

    act(() => {
      setSelectValue(caps!, 'small-caps');
    });
    expect(onChange).toHaveBeenLastCalledWith({ fontVariantCaps: 'small-caps' });
  });

  it('commits named typography style preset patches through selected-layer text changes', () => {
    const onChange = vi.fn();
    const onApplyPreset = vi.fn();

    act(() => {
      root.render(
        <EditableTextLayerControls
          layer={textLayer()}
          onApplyPreset={onApplyPreset}
          onChange={onChange}
        />,
      );
    });

    const editorialPreset = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Editorial Italic');

    expect(editorialPreset).toBeDefined();

    act(() => {
      editorialPreset?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      content: 'Sloom Studio',
      fontFamily: 'Cormorant Garamond, Georgia, serif',
      fontWeight: '600',
      fontStyle: 'italic',
      fontSize: 48,
      fontKerning: 'normal',
      fontVariantCaps: 'small-caps',
      letterSpacing: 1,
      baselineShift: 0,
      align: 'center',
      lineHeight: 1.08,
    }));
    expect(onApplyPreset).not.toHaveBeenCalled();
  });

  it('surfaces retained text raster-preview and PSD roundtrip caveats', () => {
    act(() => {
      root.render(<EditableTextLayerControls layer={textLayer()} onChange={vi.fn()} />);
    });

    expect(container.textContent).toContain('Retained live text');
    expect(container.textContent).toContain('Canvas raster preview');
    expect(container.textContent).toContain('PSD export writes native editable records for ordinary horizontal unwarped solid-colour text');
  });

  it('surfaces explicit edit-readiness, installed-font fallback, and text-on-path handoff caveats', () => {
    const layerWithPath = {
      ...textLayer(),
      bitmap: { width: 180, height: 40 } as ImageLayer['bitmap'],
      bitmapVersion: 2,
      text: normalizeImageTextStyle({
        content: 'Sloom Studio',
        fontFamily: 'Poster Font, Inter, sans-serif',
        fontSize: 32,
        openTypeFeatures: {
          enabled: ['ss01', 'bad-tag!'],
          disabled: ['liga'],
        },
        pathReference: {
          kind: 'vector-layer',
          layerId: 'path-layer',
          pathId: 'Caption Path',
          revision: 7,
        },
        pathLayout: {
          sourceLayerId: 'path-layer',
          points: [{ x: 0, y: 24 }, { x: 180, y: 0 }],
          bounds: { x: 0, y: 0, width: 180, height: 24 },
          pathLength: 181.6,
          startOffset: 12,
          reverse: false,
          closed: false,
          previewSignature: 'path:path-layer:v7',
        },
      }),
      metadata: { editableText: true },
    } satisfies ImageLayer;

    act(() => {
      root.render(
        <EditableTextLayerControls
          layer={layerWithPath}
          onChange={vi.fn()}
          pathTargets={[pathLayer()]}
        />,
      );
    });

    expect(container.textContent).toContain('On-canvas edit ready');
    expect(container.textContent).toContain('Installed font fallback');
    expect(container.textContent).toContain('Poster Font');
    expect(container.textContent).toContain('Inter, sans-serif');
    expect(container.textContent).toContain('OpenType intent');
    expect(container.textContent).toContain('liga');
    expect(container.textContent).toContain('ss01');
    expect(container.textContent).toContain('Typography parity checks');
    expect(container.textContent).toContain('Typography support matrix');
    expect(container.textContent).toContain('Unsupported capabilities 0');
    expect(container.textContent).toContain('Live edit readiness');
    expect(container.textContent).toContain('OpenType unsupported states');
    expect(container.textContent).toContain('Stable signatures');
    expect(container.textContent).toContain('PSD export writes native editable records for ordinary horizontal unwarped solid-colour text');
    expect(container.textContent).toContain('Text-on-path handoff keeps the vector path reference and text style metadata, but exported/source-bin previews flatten the current glyph layout to pixels.');
  });

  it('surfaces standard font stacks and visible OpenType feature toggles', () => {
    const onChange = vi.fn();

    act(() => {
      root.render(<EditableTextLayerControls layer={textLayer()} onChange={onChange} />);
    });

    const fontStack = container.querySelector<HTMLSelectElement>('select[aria-label="Text font stack"]');
    const customFont = container.querySelector<HTMLInputElement>('input[aria-label="Text custom font family"]');
    const ligatures = container.querySelector<HTMLInputElement>('input[aria-label="OpenType ligatures"]');
    const stylisticSet = container.querySelector<HTMLInputElement>('input[aria-label="OpenType stylistic set 1"]');

    expect(fontStack).not.toBeNull();
    expect(customFont).not.toBeNull();
    expect(ligatures).not.toBeNull();
    expect(stylisticSet).not.toBeNull();
    expect(Array.from(fontStack!.options).map((option) => option.textContent)).toContain('Atkinson Hyperlegible');

    act(() => {
      setSelectValue(fontStack!, 'Atkinson Hyperlegible, Inter, sans-serif');
    });
    expect(onChange).toHaveBeenLastCalledWith({ fontFamily: 'Atkinson Hyperlegible, Inter, sans-serif' });

    act(() => {
      ligatures!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith({
      openTypeFeatures: {
        enabled: ['liga'],
        disabled: [],
        unsupported: [],
      },
    });

    act(() => {
      stylisticSet!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onChange).toHaveBeenLastCalledWith({
      openTypeFeatures: {
        enabled: ['ss01'],
        disabled: [],
        unsupported: [],
      },
    });
  });

  it('commits vertical orientation and editable warp settings from the Text panel', () => {
    const onChange = vi.fn();

    act(() => {
      root.render(<EditableTextLayerControls layer={textLayer()} onChange={onChange} />);
    });

    const orientation = container.querySelector<HTMLSelectElement>('select[aria-label="Text orientation"]');
    const warp = container.querySelector<HTMLSelectElement>('select[aria-label="Text warp"]');

    expect(orientation).not.toBeNull();
    expect(warp).not.toBeNull();
    expect(Array.from(warp!.options).map((option) => [option.value, option.textContent])).toEqual([
      ['none', 'None'],
      ['arc', 'Arc'],
      ['flag', 'Flag'],
      ['bulge', 'Bulge'],
    ]);
    expect(Array.from(orientation!.options).map((option) => [option.value, option.textContent])).toEqual([
      ['horizontal', 'Horizontal'],
      ['vertical-rl', 'Vertical RL'],
      ['vertical-lr', 'Vertical LR'],
    ]);

    act(() => {
      setSelectValue(orientation!, 'vertical-rl');
    });
    expect(onChange).toHaveBeenLastCalledWith({ orientation: 'vertical-rl' });

    act(() => {
      setSelectValue(orientation!, 'vertical-lr');
    });
    expect(onChange).toHaveBeenLastCalledWith({ orientation: 'vertical-lr' });

    act(() => {
      setSelectValue(warp!, 'flag');
    });
    expect(onChange).toHaveBeenLastCalledWith({ warp: 'flag' });

    act(() => {
      setSelectValue(warp!, 'bulge');
    });
    expect(onChange).toHaveBeenLastCalledWith({ warp: 'bulge' });
  });

  it('offers a retained text-on-path attachment control for available path layers', () => {
    const onAttachToPath = vi.fn();
    const onClearTextPath = vi.fn();

    act(() => {
      root.render(
        <EditableTextLayerControls
          layer={textLayer()}
          onAttachToPath={onAttachToPath}
          onChange={vi.fn()}
          onClearTextPath={onClearTextPath}
          pathTargets={[pathLayer()]}
        />,
      );
    });

    const selector = container.querySelector<HTMLSelectElement>('select[aria-label="Text path target"]');
    const attach = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Attach');
    const clear = Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent === 'Clear');

    expect(selector).not.toBeNull();
    expect(Array.from(selector!.options).map((option) => option.textContent)).toContain('Caption Path');
    expect(container.textContent).toContain('Text Path');
    expect(attach).toBeDefined();
    expect(clear).toBeDefined();

    act(() => {
      setSelectValue(selector!, 'path-layer');
      attach?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onAttachToPath).toHaveBeenCalledWith('path-layer', { reverse: false, startOffset: 0 });

    act(() => {
      clear?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onClearTextPath).toHaveBeenCalled();
  });

  it('labels retained sampled cubic geometry as a Bezier path', () => {
    const layer = {
      ...textLayer(),
      text: normalizeImageTextStyle({
        content: 'Curve',
        fontSize: 32,
        pathReference: { kind: 'vector-layer', layerId: 'path-layer', revision: 7 },
        pathLayout: {
          sourceLayerId: 'path-layer',
          geometry: 'bezier-sampled-path',
          points: [{ x: 0, y: 24 }, { x: 90, y: 4 }, { x: 180, y: 24 }],
          bezierSegments: [{
            from: { x: 0, y: 24 },
            control1: { x: 48, y: 0 },
            control2: { x: 132, y: 0 },
            to: { x: 180, y: 24 },
          }],
          bounds: { x: 0, y: 0, width: 180, height: 24 },
          pathLength: 184,
          startOffset: 0,
          reverse: false,
          closed: false,
          previewSignature: 'untrusted',
        },
      }),
    } satisfies ImageLayer;

    act(() => {
      root.render(
        <EditableTextLayerControls
          layer={layer}
          onChange={vi.fn()}
          pathTargets={[pathLayer()]}
        />,
      );
    });

    expect(container.textContent).toContain('Retained Bézier path');
    expect(container.textContent).not.toContain('Retained straight path');
  });

  it('protects the shared bundled font browser through the central platform capability gate (FBL-025)', async () => {
    delete window.signalLoomNative;

    act(() => {
      root.render(<EditableTextLayerControls layer={textLayer()} onChange={vi.fn()} />);
    });

    expect(container.textContent).not.toContain('Browse bundled fonts');

    // A complete generic Electron bridge is still not permission to advertise a protocol whose
    // main process found no library root.
    window.signalLoomNative = { getNativeState: vi.fn(), onMenuCommand: vi.fn() } as never;

    await act(async () => {
      root.render(<EditableTextLayerControls layer={textLayer()} onChange={vi.fn()} />);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(container.textContent).not.toContain('Browse bundled fonts');

    const bundledFontLibraryStatus = vi.fn(async () => ({ available: true }));
    window.signalLoomNative = {
      getNativeState: vi.fn(), onMenuCommand: vi.fn(), bundledFontLibraryStatus,
    } as never;
    await act(async () => {
      root.render(<EditableTextLayerControls layer={textLayer()} onChange={vi.fn()} />);
    });
    await act(async () => {
      await vi.waitFor(() => expect(container.textContent).toContain('Browse bundled fonts'));
    });
    expect(bundledFontLibraryStatus).toHaveBeenCalledTimes(1);
  });
});
