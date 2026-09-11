import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  AdvancedColorPicker,
  calculateAdvancedColorPickerPosition,
  describeAdvancedColorPickerAndroidSupport,
  hexToHsv,
  hsvToHex,
  normalizePickerHex,
} from './AdvancedColorPicker';

describe('AdvancedColorPicker', () => {
  it('normalizes shorthand and invalid picker hex values', () => {
    expect(normalizePickerHex('#abc')).toBe('#aabbcc');
    expect(normalizePickerHex('#abcd')).toBe('#aabbcc');
    expect(normalizePickerHex('#11223344')).toBe('#112233');
    expect(normalizePickerHex('336699')).toBe('#336699');
    expect(normalizePickerHex('not-a-color', '#123456')).toBe('#123456');
  });

  it('round-trips hex through HSV conversion for advanced controls', () => {
    expect(hsvToHex(hexToHsv('#336699'))).toBe('#336699');
    expect(hsvToHex({ h: 0, s: 100, v: 100 })).toBe('#ff0000');
    expect(hsvToHex({ h: 120, s: 100, v: 100 })).toBe('#00ff00');
    expect(hsvToHex({ h: 240, s: 100, v: 100 })).toBe('#0000ff');
  });

  it('renders an app-controlled advanced picker instead of a native color input', () => {
    const html = renderToStaticMarkup(
      <AdvancedColorPicker
        defaultOpen
        label="Foreground color"
        onChange={vi.fn()}
        value="#336699"
      />,
    );

    expect(html).toContain('data-advanced-color-picker="true"');
    expect(html).toContain('data-advanced-color-picker-panel="true"');
    expect(html).toContain('aria-label="Foreground color"');
    expect(html).toContain('Foreground color HEX');
    expect(html).toContain('Foreground color hue');
    expect(html).toContain('Foreground color saturation');
    expect(html).toContain('Foreground color value');
    expect(html).toContain('Foreground color red');
    expect(html).not.toContain('type="color"');
  });

  it('exposes compact-layout advanced controls on Android/touch-sized viewports', () => {
    const hadWindow = typeof window !== 'undefined';
    const workingWindow = hadWindow ? window : {
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      innerHeight: 800,
      innerWidth: 390,
    } as unknown as Window;

    const originalInnerWidth = workingWindow.innerWidth;
    const originalMatchMedia = workingWindow.matchMedia;

    if (!hadWindow) {
      (globalThis as any).window = workingWindow;
    }

    Object.defineProperty(window, 'innerWidth', {
      value: 390,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn((query: string) => ({
        addEventListener: () => undefined,
        addListener: () => undefined,
        dispatchEvent: () => true,
        media: query,
        matches: query.includes('(pointer: coarse)') || query.includes('420'),
        onchange: null,
        removeEventListener: () => undefined,
        removeListener: () => undefined,
      })),
    });

    try {
      const html = renderToStaticMarkup(
        <AdvancedColorPicker
          defaultOpen
          label="Foreground color"
          onChange={vi.fn()}
          value="#336699"
        />,
      );

      expect(html).toContain('data-advanced-color-picker-compact-layout="true"');
      expect(html).toContain('Foreground color alpha');
      expect(html).toContain('Foreground color hue');
      expect(html).toContain('Foreground color saturation');
      expect(html).toContain('Foreground color value');
      expect(html).toContain('max-w-[calc(100vw-16px)]');
      expect(html).not.toContain('type="color"');
    } finally {
      if (hadWindow) {
        Object.defineProperty(window, 'innerWidth', {
          value: originalInnerWidth,
          configurable: true,
          writable: true,
        });
        Object.defineProperty(window, 'matchMedia', {
          configurable: true,
          value: originalMatchMedia,
        });
      } else {
        delete (globalThis as any).window;
      }
    }
  });

  it('publishes Android advanced color picker support state without prose parsing', () => {
    expect(describeAdvancedColorPickerAndroidSupport({
      platform: 'android',
      viewportWidth: 390,
      pointer: 'coarse',
      hasEyeDropperCallback: true,
      nativeColorInputUsed: false,
    })).toEqual({
      descriptorId: 'advanced-color-picker-android-support:v1',
      platform: 'android',
      state: 'ready',
      compactLayout: true,
      usesNativeColorInput: false,
      controls: {
        hex: 'ready',
        hsv: 'ready',
        rgb: 'ready',
        cmyk: 'ready',
        alpha: 'ready',
        swatches: 'ready',
        eyedropper: 'ready',
      },
      unsupportedStates: [],
      stableSignature: 'advanced-color-picker-android-support:v1|platform=android|state=ready|compact=yes|native-input=no|controls=hex:ready,hsv:ready,rgb:ready,cmyk:ready,alpha:ready,swatches:ready,eyedropper:ready|unsupported=none',
    });

    expect(describeAdvancedColorPickerAndroidSupport({
      platform: 'android',
      viewportWidth: 720,
      pointer: 'fine',
      hasEyeDropperCallback: false,
      nativeColorInputUsed: true,
    }).unsupportedStates.map((state) => state.code)).toEqual([
      'native-color-input',
      'eyedropper-unavailable',
    ]);
  });

  it('exposes an eyedropper affordance when a callback is provided', () => {
    const onEyeDropper = vi.fn();
    const html = renderToStaticMarkup(
      <AdvancedColorPicker
        defaultOpen
        label="Foreground color"
        onChange={vi.fn()}
        onEyeDropper={onEyeDropper}
        value="#336699"
      />,
    );

    expect(html).toContain('data-advanced-color-picker-eyedropper="true"');
    expect(html).toContain('aria-label="Foreground color eyedropper"');
  });

  it('offers square and wheel picker modes so users can pick from a large field', () => {
    const html = renderToStaticMarkup(
      <AdvancedColorPicker
        defaultOpen
        label="Foreground color"
        onChange={vi.fn()}
        value="#336699"
      />,
    );

    expect(html).toContain('data-advanced-color-picker-mode="square"');
    expect(html).toContain('data-advanced-color-picker-mode="wheel"');
    // The square mode renders an interactive saturation/value field by default.
    expect(html).toContain('aria-label="Foreground color saturation and value field"');
  });

  it('keeps swatch quick-select controls and avoids type-only color fallback', () => {
    const html = renderToStaticMarkup(
      <AdvancedColorPicker
        defaultOpen
        label="Foreground color"
        onChange={vi.fn()}
        value="#336699"
      />,
    );

    expect(html).toContain('aria-label="Foreground color preset #000000"');
    expect(html).toContain('aria-label="Foreground color preset #ec4899"');
    expect(html).not.toContain('type="color"');
  });

  it('supports optional recent swatches with distinct labels', () => {
    const html = renderToStaticMarkup(
      <AdvancedColorPicker
        defaultOpen
        label="Foreground color"
        onChange={vi.fn()}
        recentColors={['#123456', '#abcdef', '#123456']}
        value="#336699"
      />,
    );

    expect(html).toContain('aria-label="Foreground color recent #123456"');
    expect(html).toContain('aria-label="Foreground color preset #ec4899"');
  });

  it('exposes CMYK inputs, an ink-coverage readout, and print-safe palettes', () => {
    const html = renderToStaticMarkup(
      <AdvancedColorPicker
        defaultOpen
        label="Foreground color"
        onChange={vi.fn()}
        value="#336699"
      />,
    );

    expect(html).toContain('Foreground color cyan');
    expect(html).toContain('Foreground color magenta');
    expect(html).toContain('Foreground color yellow');
    expect(html).toContain('Foreground color key');
    expect(html).toContain('% ink');
    // Print-safe palette selector + at least one press-authored swatch.
    expect(html).toContain('aria-label="Print-safe palette"');
    expect(html).toContain('press-safe CMYK');
    expect(html).toContain('C100 M0 Y0 K0'); // Cyan from the CMYK Process palette
  });

  it('positions compact-palette pickers beside the palette instead of covering it', () => {
    const position = calculateAdvancedColorPickerPosition(
      { left: 380, top: 540, right: 408, bottom: 568, width: 28, height: 28 },
      { width: 1920, height: 1080 },
      { left: 368, top: 112, right: 434, bottom: 568, width: 66, height: 456 },
    );

    expect(position.left).toBe(442);
    expect(position.top).toBe(112);
  });
});
