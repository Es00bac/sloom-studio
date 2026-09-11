import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPaperCanvasMeasurer } from './paperCanvasMeasurer';

describe('createPaperCanvasMeasurer rich width metrics', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('propagates exact stretch, variation, and kerning properties to the shipping canvas seam', () => {
    const context = {
      font: '',
      fontStretch: '',
      fontVariationSettings: '',
      fontKerning: '',
      measureText: vi.fn(() => ({ width: 24 })),
    };
    vi.stubGlobal('document', {
      createElement: vi.fn(() => ({ getContext: () => context })),
    });

    const width = createPaperCanvasMeasurer(4)('AV', {
      fontFamily: 'M PLUS 1, Inter, sans-serif',
      fontSizePt: 12,
      leadingPt: 14,
      tracking: 0,
      align: 'left',
      fontWeight: '620',
      fontStyle: 'oblique 12deg',
      fontStretch: 'condensed',
      fontVariationSettings: { wght: 620, wdth: 87.5 },
      fontKerning: 'none',
    });

    expect(width).toBe(6);
    expect(context.font).toContain('oblique 12deg 620 condensed 16px "M PLUS 1", Inter, sans-serif');
    expect(context.fontStretch).toBe('condensed');
    expect(context.fontVariationSettings).toBe('"wdth" 87.5, "wght" 620');
    expect(context.fontKerning).toBe('none');
  });

  it('uses an exact temporary CSS measurement seam when canvas lacks a requested font property', () => {
    const context = {
      font: '',
      fontKerning: '',
      measureText: vi.fn(() => ({ width: 999 })),
    };
    const probe = {
      style: {} as Record<string, string>,
      textContent: '',
      getBoundingClientRect: vi.fn(() => ({ width: 40 })),
      remove: vi.fn(),
    };
    const appendChild = vi.fn();
    vi.stubGlobal('document', {
      body: { appendChild },
      createElement: vi.fn((tag: string) => tag === 'canvas' ? { getContext: () => context } : probe),
    });

    const width = createPaperCanvasMeasurer(4)('variable', {
      fontFamily: 'Variable Sans',
      fontSizePt: 12,
      leadingPt: 14,
      tracking: 25,
      align: 'left',
      fontStretch: '75%',
      fontVariationSettings: { opsz: 18, wdth: 75 },
      fontKerning: 'normal',
    });

    expect(width).toBe(10);
    expect(probe.style).toMatchObject({
      fontFamily: '"Variable Sans"',
      fontStretch: '75%',
      fontVariationSettings: '"opsz" 18, "wdth" 75',
      fontKerning: 'normal',
      letterSpacing: '0.025em',
    });
    expect(appendChild).toHaveBeenCalledWith(probe);
    expect(probe.remove).toHaveBeenCalledOnce();
    expect(context.measureText).not.toHaveBeenCalled();
  });

  it('detects missing native kerning before assignment so an extensible context cannot fake support', () => {
    const context = {
      font: '',
      fontStretch: '',
      fontVariationSettings: '',
      measureText: vi.fn(() => ({ width: 999 })),
    };
    const probe = {
      style: {} as Record<string, string>,
      textContent: '',
      getBoundingClientRect: vi.fn(() => ({ width: 44 })),
      remove: vi.fn(),
    };
    vi.stubGlobal('document', {
      body: { appendChild: vi.fn() },
      createElement: vi.fn((tag: string) => tag === 'canvas' ? { getContext: () => context } : probe),
    });

    const width = createPaperCanvasMeasurer(4)('AV', {
      fontFamily: 'Kerning Test', fontSizePt: 12, leadingPt: 14, tracking: 0, align: 'left',
      fontStretch: '90%', fontVariationSettings: { wdth: 90 }, fontKerning: 'none',
    });

    expect(width).toBe(11);
    expect(context).not.toHaveProperty('fontKerning');
    expect(context.measureText).not.toHaveBeenCalled();
    expect(probe.style.fontKerning).toBe('none');
    expect(probe.remove).toHaveBeenCalledOnce();
  });

  it('bounds and keys the CSS fallback cache while removing every temporary DOM probe', () => {
    const context = {
      font: '',
      fontStretch: '',
      fontVariationSettings: '',
      measureText: vi.fn(() => ({ width: 999 })),
    };
    const attached = new Set<object>();
    let layoutCount = 0;
    const appendChild = vi.fn((probe: object) => attached.add(probe));
    vi.stubGlobal('document', {
      body: { appendChild },
      createElement: vi.fn((tag: string) => {
        if (tag === 'canvas') return { getContext: () => context };
        const probe = {
          style: {} as Record<string, string>,
          textContent: '',
          getBoundingClientRect: vi.fn(() => ({ width: ++layoutCount })),
          remove: vi.fn(() => attached.delete(probe)),
        };
        return probe;
      }),
    });
    const measureCss = createPaperCanvasMeasurer(1);
    const base = {
      fontFamily: 'Cache Sans', fontSizePt: 12, leadingPt: 14, tracking: 0, align: 'left' as const,
      fontStretch: '90%', fontVariationSettings: { wdth: 90 }, fontKerning: 'none' as const,
    };

    const first = measureCss('same', base);
    expect(measureCss('same', base)).toBe(first);
    expect(layoutCount).toBe(1);
    for (const variant of [
      { ...base, fontFamily: 'Other Sans' },
      { ...base, fontSizePt: 13 },
      { ...base, fontWeight: '700' },
      { ...base, fontStyle: 'italic' },
      { ...base, fontStretch: '80%' },
      { ...base, fontVariationSettings: { wdth: 80 } },
      { ...base, fontKerning: 'normal' as const },
      { ...base, tracking: 25 },
    ]) measureCss('same', variant);
    expect(layoutCount).toBe(9);

    for (let index = 0; index < 128; index += 1) measureCss(`unique-${index}`, base);
    const beforeRecentHit = layoutCount;
    measureCss('unique-127', base);
    expect(layoutCount).toBe(beforeRecentHit);
    measureCss('same', base);
    expect(layoutCount).toBe(beforeRecentHit + 1);
    expect(attached.size).toBe(0);
    expect(appendChild).toHaveBeenCalledTimes(layoutCount);
    expect(context.measureText).not.toHaveBeenCalled();
  });

  it('invalidates cached CSS widths when the owning document font state changes', () => {
    const context = {
      font: '',
      fontStretch: '',
      fontVariationSettings: '',
      measureText: vi.fn(() => ({ width: 999 })),
    };
    let liveWidth = 10;
    const fonts = {
      status: 'loading',
      size: 1,
      ready: Promise.resolve(undefined),
      check: vi.fn(() => true),
    };
    const layouts = vi.fn(() => ({ width: liveWidth }));
    vi.stubGlobal('document', {
      fonts,
      body: { appendChild: vi.fn() },
      createElement: vi.fn((tag: string) => tag === 'canvas'
        ? { getContext: () => context }
        : { style: {}, textContent: '', getBoundingClientRect: layouts, remove: vi.fn() }),
    });
    const measureCss = createPaperCanvasMeasurer(1);
    const spec = {
      fontFamily: 'Loading Sans', fontSizePt: 12, leadingPt: 14, tracking: 0, align: 'left' as const,
      fontStretch: '90%', fontVariationSettings: { wdth: 90 }, fontKerning: 'none' as const,
    };

    expect(measureCss('same', spec)).toBe(10);
    expect(measureCss('same', spec)).toBe(10);
    expect(layouts).toHaveBeenCalledOnce();
    liveWidth = 20;
    fonts.status = 'loaded';
    fonts.ready = Promise.resolve(undefined);
    expect(measureCss('same', spec)).toBe(20);
    expect(layouts).toHaveBeenCalledTimes(2);
  });

  it('uses CSS when a present canvas stretch property rejects the requested percentage', () => {
    let acceptedStretch = 'normal';
    const context = {
      font: '',
      measureText: vi.fn(() => ({ width: 400 })),
    };
    Object.defineProperty(context, 'fontStretch', {
      configurable: true,
      get: () => acceptedStretch,
      set: (value: string) => {
        if (value === 'normal' || value === 'condensed') acceptedStretch = value;
      },
    });
    const layouts = vi.fn(() => ({ width: 50 }));
    const probe = {
      style: {} as Record<string, string>,
      textContent: '',
      getBoundingClientRect: layouts,
      remove: vi.fn(),
    };
    vi.stubGlobal('document', {
      body: { appendChild: vi.fn() },
      createElement: vi.fn((tag: string) => tag === 'canvas' ? { getContext: () => context } : probe),
    });

    const width = createPaperCanvasMeasurer(5)('percentage', {
      fontFamily: 'Stretch Sans', fontSizePt: 12, leadingPt: 14, tracking: 0, align: 'left',
      fontStretch: '82.5%',
    });

    expect(width).toBe(10);
    expect(context.measureText).not.toHaveBeenCalled();
    expect(layouts).toHaveBeenCalledOnce();
    expect(probe.style.fontStretch).toBe('82.5%');
    expect(probe.remove).toHaveBeenCalledOnce();
  });

  it('keeps a verifiably accepted named stretch on canvas while identical percentage requests hit CSS cache', () => {
    let acceptedStretch = 'normal';
    const context = {
      font: '',
      measureText: vi.fn(() => ({ width: 30 })),
    };
    Object.defineProperty(context, 'fontStretch', {
      configurable: true,
      get: () => acceptedStretch,
      set: (value: string) => {
        if (['normal', 'condensed', 'expanded'].includes(value)) acceptedStretch = value;
      },
    });
    const layouts = vi.fn(() => ({ width: 45 }));
    const appendChild = vi.fn();
    vi.stubGlobal('document', {
      body: { appendChild },
      createElement: vi.fn((tag: string) => tag === 'canvas'
        ? { getContext: () => context }
        : { style: {}, textContent: '', getBoundingClientRect: layouts, remove: vi.fn() }),
    });
    const measure = createPaperCanvasMeasurer(5);
    const base = {
      fontFamily: 'Stretch Sans', fontSizePt: 12, leadingPt: 14, tracking: 0, align: 'left' as const,
    };

    expect(measure('named', { ...base, fontStretch: 'condensed' })).toBe(6);
    expect(context.measureText).toHaveBeenCalledOnce();
    expect(appendChild).not.toHaveBeenCalled();

    expect(measure('percentage', { ...base, fontStretch: '82.5%' })).toBe(9);
    expect(measure('percentage', { ...base, fontStretch: '82.5%' })).toBe(9);
    expect(layouts).toHaveBeenCalledOnce();
    expect(appendChild).toHaveBeenCalledOnce();
  });

  it('falls back from rejected variation and kerning requests instead of measuring stale canvas state', () => {
    let acceptedVariation = '"wght" 900';
    let acceptedKerning = 'normal';
    const context = {
      font: '',
      fontStretch: 'normal',
      measureText: vi.fn(() => ({ width: 500 })),
    };
    Object.defineProperties(context, {
      fontVariationSettings: {
        configurable: true,
        get: () => acceptedVariation,
        set: (value: string) => {
          if (value === 'normal') acceptedVariation = value;
        },
      },
      fontKerning: {
        configurable: true,
        get: () => acceptedKerning,
        set: (value: string) => {
          if (value === 'auto' || value === 'normal') acceptedKerning = value;
        },
      },
    });
    const layouts = vi.fn(() => ({ width: 55 }));
    vi.stubGlobal('document', {
      body: { appendChild: vi.fn() },
      createElement: vi.fn((tag: string) => tag === 'canvas'
        ? { getContext: () => context }
        : { style: {}, textContent: '', getBoundingClientRect: layouts, remove: vi.fn() }),
    });

    const width = createPaperCanvasMeasurer(5)('AV', {
      fontFamily: 'Variable Sans', fontSizePt: 12, leadingPt: 14, tracking: 0, align: 'left',
      fontVariationSettings: { wdth: 82.5 },
      fontKerning: 'none',
    });

    expect(width).toBe(11);
    expect(context.measureText).not.toHaveBeenCalled();
    expect(layouts).toHaveBeenCalledOnce();
  });

  it('sanitizes malformed variation and kerning requests on the CSS path without reusing canvas state', () => {
    const context = {
      font: '',
      fontStretch: 'normal',
      fontVariationSettings: '"wght" 900',
      fontKerning: 'none',
      measureText: vi.fn(() => ({ width: 500 })),
    };
    const probe = {
      style: {} as Record<string, string>,
      textContent: '',
      getBoundingClientRect: vi.fn(() => ({ width: 60 })),
      remove: vi.fn(),
    };
    vi.stubGlobal('document', {
      body: { appendChild: vi.fn() },
      createElement: vi.fn((tag: string) => tag === 'canvas' ? { getContext: () => context } : probe),
    });

    const width = createPaperCanvasMeasurer(5)('invalid', {
      fontFamily: 'Variable Sans', fontSizePt: 12, leadingPt: 14, tracking: 0, align: 'left',
      fontVariationSettings: { bad: Number.NaN } as unknown as Record<string, number>,
      fontKerning: 'invalid' as unknown as 'auto',
    });

    expect(width).toBe(12);
    expect(context.measureText).not.toHaveBeenCalled();
    expect(probe.style.fontVariationSettings).toBe('normal');
    expect(probe.style.fontKerning).toBe('auto');
    expect(probe.remove).toHaveBeenCalledOnce();
  });

  it('contains append failures, removes possibly attached probes, and leaves later calls uncontaminated', () => {
    const context = {
      font: '',
      measureText: vi.fn(() => ({ width: 999 })),
    };
    const attached = new Set<object>();
    let appendFails = true;
    let layoutWidth = 35;
    const appendChild = vi.fn((probe: object) => {
      attached.add(probe);
      if (appendFails) throw new Error('append failed after attachment');
    });
    vi.stubGlobal('document', {
      body: { appendChild },
      createElement: vi.fn((tag: string) => {
        if (tag === 'canvas') return { getContext: () => context };
        const probe = {
          style: {} as Record<string, string>,
          textContent: '',
          getBoundingClientRect: vi.fn(() => ({ width: layoutWidth })),
          remove: vi.fn(() => attached.delete(probe)),
        };
        return probe;
      }),
    });
    const measure = createPaperCanvasMeasurer(5);
    const spec = {
      fontFamily: 'Fallback Sans', fontSizePt: 12, leadingPt: 14, tracking: 0, align: 'left' as const,
      fontStretch: '82.5%',
    };

    const failedFirst = measure('probe', spec);
    const failedSecond = measure('probe', spec);
    expect(failedFirst).toBe(failedSecond);
    expect(Number.isFinite(failedFirst)).toBe(true);
    expect(Number.isNaN(failedFirst)).toBe(false);
    expect(attached.size).toBe(0);

    appendFails = false;
    layoutWidth = 40;
    expect(measure('probe', spec)).toBe(8);
    expect(attached.size).toBe(0);
    expect(context.measureText).not.toHaveBeenCalled();
  });

  it('contains document.fonts getter failures and observes a later healthy font state without contamination', () => {
    const context = {
      font: '',
      measureText: vi.fn(() => ({ width: 999 })),
    };
    const layouts = vi.fn(() => ({ width: 45 }));
    let fontsThrow = true;
    const fonts = {
      status: 'loaded',
      size: 1,
      ready: Promise.resolve(undefined),
      check: vi.fn(() => true),
    };
    const ownerDocument = {
      body: { appendChild: vi.fn() },
      createElement: vi.fn((tag: string) => tag === 'canvas'
        ? { getContext: () => context }
        : { style: {}, textContent: '', getBoundingClientRect: layouts, remove: vi.fn() }),
    };
    Object.defineProperty(ownerDocument, 'fonts', {
      configurable: true,
      get: () => {
        if (fontsThrow) throw new Error('fonts unavailable');
        return fonts;
      },
    });
    vi.stubGlobal('document', ownerDocument);
    const measure = createPaperCanvasMeasurer(5);
    const spec = {
      fontFamily: 'Fallback Sans', fontSizePt: 12, leadingPt: 14, tracking: 0, align: 'left' as const,
      fontStretch: '82.5%',
    };

    const failedFirst = measure('fonts', spec);
    const failedSecond = measure('fonts', spec);
    expect(failedFirst).toBe(failedSecond);
    expect(Number.isFinite(failedFirst)).toBe(true);
    expect(Number.isNaN(failedFirst)).toBe(false);
    expect(layouts).not.toHaveBeenCalled();

    fontsThrow = false;
    expect(measure('fonts', spec)).toBe(9);
    expect(layouts).toHaveBeenCalledOnce();
    expect(context.measureText).not.toHaveBeenCalled();
  });

  it('uses CSS after a requested font shorthand is silently rejected instead of returning stale native width', () => {
    let acceptedFont = '';
    const measureText = vi.fn(() => ({ width: 100 }));
    const context = { measureText };
    Object.defineProperty(context, 'font', {
      configurable: true,
      get: () => acceptedFont,
      set: (value: string) => {
        if (value.includes('Old')) acceptedFont = value;
      },
    });
    const layouts = vi.fn(() => ({ width: 45 }));
    vi.stubGlobal('document', {
      body: { appendChild: vi.fn() },
      createElement: vi.fn((tag: string) => tag === 'canvas'
        ? { getContext: () => context }
        : { style: {}, textContent: '', getBoundingClientRect: layouts, remove: vi.fn() }),
    });
    const measure = createPaperCanvasMeasurer(5);
    const base = { fontSizePt: 12, leadingPt: 14, tracking: 0, align: 'left' as const };

    expect(measure('native', { ...base, fontFamily: 'Old' })).toBe(20);
    expect(measure('fallback', { ...base, fontFamily: 'New' })).toBe(9);
    expect(measureText).toHaveBeenCalledOnce();
    expect(layouts).toHaveBeenCalledOnce();
  });

  it('accepts equivalent browser-normalized serialization of the complete current font on the native path', () => {
    const canonicalize = (value: string) => value.replace(/^400\s+/, '');
    let acceptedFont = '';
    const context = { measureText: vi.fn(() => ({ width: 30 })) };
    Object.defineProperty(context, 'font', {
      configurable: true,
      get: () => acceptedFont,
      set: (value: string) => { acceptedFont = canonicalize(value); },
    });
    const appendChild = vi.fn();
    vi.stubGlobal('document', {
      body: { appendChild },
      createElement: vi.fn((tag: string) => {
        if (tag === 'canvas') return { getContext: () => context };
        let font = '';
        const style = {};
        Object.defineProperty(style, 'font', {
          configurable: true,
          get: () => font,
          set: (value: string) => { font = canonicalize(value); },
        });
        return { style, textContent: '', getBoundingClientRect: vi.fn(() => ({ width: 999 })), remove: vi.fn() };
      }),
    });

    const width = createPaperCanvasMeasurer(5)('current', {
      fontFamily: 'Current Sans', fontSizePt: 12, leadingPt: 14, tracking: 0, align: 'left', fontWeight: '400',
    });
    expect(width).toBe(6);
    expect(context.measureText).toHaveBeenCalledOnce();
    expect(appendChild).not.toHaveBeenCalled();
  });

  it.each(['absent', 'throwing-getter', 'throwing-setter', 'unobservable-getter'] as const)(
    'routes a %s font property safely through CSS without native stale-state measurement',
    (mode) => {
      const context: { measureText: ReturnType<typeof vi.fn>; font?: string } = {
        measureText: vi.fn(() => ({ width: 500 })),
      };
      if (mode !== 'absent') {
        let accepted = '10px Old';
        Object.defineProperty(context, 'font', {
          configurable: true,
          get: () => {
            if (mode === 'throwing-getter') throw new Error('font getter failed');
            if (mode === 'unobservable-getter') return undefined;
            return accepted;
          },
          set: (value: string) => {
            if (mode === 'throwing-setter') throw new Error('font setter failed');
            accepted = value;
          },
        });
      }
      const layouts = vi.fn(() => ({ width: 35 }));
      vi.stubGlobal('document', {
        body: { appendChild: vi.fn() },
        createElement: vi.fn((tag: string) => tag === 'canvas'
          ? { getContext: () => context }
          : { style: {}, textContent: '', getBoundingClientRect: layouts, remove: vi.fn() }),
      });

      const width = createPaperCanvasMeasurer(5)('safe', {
        fontFamily: 'Requested', fontSizePt: 12, leadingPt: 14, tracking: 0, align: 'left',
      });
      expect(width).toBe(7);
      expect(context.measureText).not.toHaveBeenCalled();
      expect(layouts).toHaveBeenCalledOnce();
    },
  );

  it('cannot bypass CSS or poison fallback cache when shorthand rejection accompanies rich font properties', () => {
    let acceptedFont = '';
    const context = {
      fontStretch: 'normal',
      fontVariationSettings: 'normal',
      fontKerning: 'auto',
      measureText: vi.fn(() => ({ width: 500 })),
    };
    Object.defineProperty(context, 'font', {
      configurable: true,
      get: () => acceptedFont,
      set: (value: string) => {
        if (value.includes('Old')) acceptedFont = value;
      },
    });
    const layouts = vi.fn(() => ({ width: 55 }));
    vi.stubGlobal('document', {
      body: { appendChild: vi.fn() },
      createElement: vi.fn((tag: string) => tag === 'canvas'
        ? { getContext: () => context }
        : { style: {}, textContent: '', getBoundingClientRect: layouts, remove: vi.fn() }),
    });
    const measure = createPaperCanvasMeasurer(5);
    const rich = {
      fontSizePt: 12, leadingPt: 14, tracking: 0, align: 'left' as const,
      fontStretch: 'condensed', fontVariationSettings: { wdth: 82.5 }, fontKerning: 'none' as const,
    };

    expect(measure('old', { ...rich, fontFamily: 'Old' })).toBe(100);
    expect(measure('new', { ...rich, fontFamily: 'New' })).toBe(11);
    expect(measure('new', { ...rich, fontFamily: 'New' })).toBe(11);
    expect(context.measureText).toHaveBeenCalledOnce();
    expect(layouts).toHaveBeenCalledOnce();
  });

  it('does not reuse a rejected-font fallback across document replacement', () => {
    const createDocument = (cssWidth: number) => {
      let acceptedFont = '16px Old';
      const context = { measureText: vi.fn(() => ({ width: 500 })) };
      Object.defineProperty(context, 'font', {
        configurable: true,
        get: () => acceptedFont,
        set: (value: string) => {
          if (value.includes('Old')) acceptedFont = value;
        },
      });
      const layouts = vi.fn(() => ({ width: cssWidth }));
      return {
        context,
        layouts,
        document: {
          body: { appendChild: vi.fn() },
          createElement: vi.fn((tag: string) => tag === 'canvas'
            ? { getContext: () => context }
            : { style: {}, textContent: '', getBoundingClientRect: layouts, remove: vi.fn() }),
        },
      };
    };
    const first = createDocument(40);
    const second = createDocument(60);
    vi.stubGlobal('document', first.document);
    const measure = createPaperCanvasMeasurer(5);
    const spec = { fontFamily: 'New', fontSizePt: 12, leadingPt: 14, tracking: 0, align: 'left' as const };

    expect(measure('same', spec)).toBe(8);
    expect(measure('same', spec)).toBe(8);
    expect(first.layouts).toHaveBeenCalledOnce();
    vi.stubGlobal('document', second.document);
    expect(measure('same', spec)).toBe(12);
    expect(second.layouts).toHaveBeenCalledOnce();
    expect(first.context.measureText).not.toHaveBeenCalled();
    expect(second.context.measureText).not.toHaveBeenCalled();
  });
});
