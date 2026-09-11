import { describe, expect, it } from 'vitest';
import {
  EDITOR_INK_BACKDROP,
  EDITOR_PAPER_BACKDROP,
  EDITOR_READABLE_CONTRAST_RATIO,
  compositeEffectiveBackground,
  contrastRatio,
  relativeLuminance,
  resolveEditorBackdrop,
} from './editorContrast';

describe('relativeLuminance', () => {
  it('is 1 for white and 0 for black', () => {
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
  });

  it('treats the literal transparent keyword as black (alpha is the caller\'s concern)', () => {
    expect(relativeLuminance('transparent')).toBeCloseTo(0, 5);
  });
});

describe('contrastRatio', () => {
  it('is 1 for a colour against itself', () => {
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#f59e0b', '#f59e0b')).toBeCloseTo(1, 5);
  });

  it('is the full 21:1 for black against white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('is symmetric', () => {
    expect(contrastRatio('#111827', '#f59e0b')).toBeCloseTo(contrastRatio('#f59e0b', '#111827'), 5);
  });

  it('matches the document default ink-on-paper pairing at high contrast (~17.7:1)', () => {
    // #111827 / #ffffff are DEFAULT_PAPER_TYPOGRAPHY.color / DEFAULT_PAPER_BACKGROUND.color in paperDocument.ts.
    expect(contrastRatio('#111827', '#ffffff')).toBeCloseTo(17.74, 1);
  });
});

describe('compositeEffectiveBackground', () => {
  it('returns the page background untouched when the fill is fully transparent', () => {
    expect(compositeEffectiveBackground('transparent', 1, '#ffffff')).toBe('#ffffff');
    expect(compositeEffectiveBackground('#111827', 0, '#ffffff')).toBe('#ffffff');
  });

  it('returns the fill colour untouched when it is fully opaque', () => {
    expect(compositeEffectiveBackground('#111827', 1, '#ffffff')).toBe('#111827');
  });

  it('alpha-blends a partially-opaque fill over the page background', () => {
    // #111827 (17,24,39) at 50% over #ffffff (255,255,255): midpoint per channel, rounded.
    expect(compositeEffectiveBackground('#111827', 0.5, '#ffffff')).toBe('rgb(136, 140, 147)');
  });
});

describe('resolveEditorBackdrop', () => {
  it('needs no backdrop for the ordinary case: dark ink text on an opaque white fill', () => {
    const decision = resolveEditorBackdrop({
      textColor: '#111827',
      fillColor: '#ffffff',
      fillOpacity: 1,
      pageBackground: '#000000', // deliberately hostile — the opaque fill must win, not the page.
    });
    expect(decision.effectiveBackground).toBe('#ffffff');
    expect(decision.contrastRatio).toBeGreaterThanOrEqual(EDITOR_READABLE_CONTRAST_RATIO);
    expect(decision.needsBackdrop).toBe(false);
    expect(decision.backdropColor).toBeUndefined();
  });

  it('reproduces the reported bug: white typography.color on a transparent fill over a white page needs a dark backdrop', () => {
    // Exact values pulled from the reported reference document's page-1 sidebar "name" frame: fillColor
    // 'transparent', fillOpacity 1, typography.color '#ffffff', doc.background solid '#ffffff'. Effective
    // background composites to white, so white-on-white was unreadable before this fix.
    const decision = resolveEditorBackdrop({
      textColor: '#ffffff',
      fillColor: 'transparent',
      fillOpacity: 1,
      pageBackground: '#ffffff',
    });
    expect(decision.effectiveBackground).toBe('#ffffff');
    expect(decision.contrastRatio).toBeCloseTo(1, 1);
    expect(decision.needsBackdrop).toBe(true);
    expect(decision.backdropColor).toBe(EDITOR_INK_BACKDROP);
  });

  it('gives dark text a light-paper backdrop when its real background is also dark (mirror case of the bug)', () => {
    const decision = resolveEditorBackdrop({
      textColor: '#111827',
      fillColor: '#000000',
      fillOpacity: 1,
      pageBackground: '#000000',
    });
    expect(decision.needsBackdrop).toBe(true);
    expect(decision.backdropColor).toBe(EDITOR_PAPER_BACKDROP);
  });

  it('does not need a backdrop when a frame genuinely has a dark opaque fill behind light text', () => {
    // A frame that legitimately paints its own dark box (fillColor opaque near-black) reads fine with white
    // text with no help needed — the fix must not slap a backdrop on every light-text frame indiscriminately.
    const decision = resolveEditorBackdrop({
      textColor: '#ffffff',
      fillColor: '#111827',
      fillOpacity: 1,
      pageBackground: '#ffffff',
    });
    expect(decision.needsBackdrop).toBe(false);
  });

  describe('low-contrast mid-tone cases', () => {
    it('a saturated amber (#f59e0b) on white reads under the floor and prefers the ink backdrop', () => {
      // Real value from the same reference document (its amber accent headings/labels): contrast against
      // white is ~2.15:1 (below the 3:1 floor) but ~8.3:1 against ink, so ink wins.
      const decision = resolveEditorBackdrop({
        textColor: '#f59e0b',
        fillColor: 'transparent',
        fillOpacity: 1,
        pageBackground: '#ffffff',
      });
      expect(decision.contrastRatio).toBeCloseTo(2.15, 1);
      expect(decision.needsBackdrop).toBe(true);
      expect(decision.backdropColor).toBe(EDITOR_INK_BACKDROP);
    });

    it('a light grey (#e5e7eb) on white reads under the floor and prefers the ink backdrop', () => {
      const decision = resolveEditorBackdrop({
        textColor: '#e5e7eb',
        fillColor: 'transparent',
        fillOpacity: 1,
        pageBackground: '#ffffff',
      });
      expect(decision.needsBackdrop).toBe(true);
      expect(decision.backdropColor).toBe(EDITOR_INK_BACKDROP);
    });

    it('a darker amber (#b45309) on white clears the floor on its own (~5:1) and needs no backdrop', () => {
      const decision = resolveEditorBackdrop({
        textColor: '#b45309',
        fillColor: 'transparent',
        fillOpacity: 1,
        pageBackground: '#ffffff',
      });
      expect(decision.contrastRatio).toBeCloseTo(5.02, 1);
      expect(decision.needsBackdrop).toBe(false);
      expect(decision.backdropColor).toBeUndefined();
    });

    it('straddles the 3:1 floor: a mid-grey just above it needs no backdrop, just below it does', () => {
      const justAboveFloor = resolveEditorBackdrop({
        textColor: '#909090', // ~3.19:1 against white
        fillColor: 'transparent',
        fillOpacity: 1,
        pageBackground: '#ffffff',
      });
      expect(justAboveFloor.contrastRatio).toBeGreaterThanOrEqual(EDITOR_READABLE_CONTRAST_RATIO);
      expect(justAboveFloor.needsBackdrop).toBe(false);

      const justBelowFloor = resolveEditorBackdrop({
        textColor: '#969696', // ~2.96:1 against white
        fillColor: 'transparent',
        fillOpacity: 1,
        pageBackground: '#ffffff',
      });
      expect(justBelowFloor.contrastRatio).toBeLessThan(EDITOR_READABLE_CONTRAST_RATIO);
      expect(justBelowFloor.needsBackdrop).toBe(true);
      expect(justBelowFloor.backdropColor).toBe(EDITOR_INK_BACKDROP);
    });
  });
});
