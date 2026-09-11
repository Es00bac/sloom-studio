import { describe, expect, it } from 'vitest';
import { EYEDROPPER_MODIFIER_TOOLS, coalescedPointerEvents, shouldUseEyedropperOverride } from './dispatcher';

const noMods = { shift: false, alt: false, ctrl: false, meta: false };

describe('shouldUseEyedropperOverride', () => {
  it('treats Ctrl over a paint tool as the eyedropper', () => {
    expect(shouldUseEyedropperOverride('brush', { ...noMods, ctrl: true })).toBe(true);
    expect(shouldUseEyedropperOverride('paintBucket', { ...noMods, ctrl: true })).toBe(true);
    expect(shouldUseEyedropperOverride('gradientTool', { ...noMods, ctrl: true })).toBe(true);
  });

  it('does not trigger without Ctrl, or on non-paint tools', () => {
    expect(shouldUseEyedropperOverride('brush', noMods)).toBe(false);
    expect(shouldUseEyedropperOverride('hand', { ...noMods, ctrl: true })).toBe(false);
    expect(shouldUseEyedropperOverride('marquee', { ...noMods, ctrl: true })).toBe(false);
    expect(shouldUseEyedropperOverride('eyedropper', { ...noMods, ctrl: true })).toBe(false);
  });

  it('keeps the modifier tool set focused on colour-using paint tools', () => {
    expect(EYEDROPPER_MODIFIER_TOOLS.has('brush')).toBe(true);
    expect(EYEDROPPER_MODIFIER_TOOLS.has('crop')).toBe(false);
    expect(EYEDROPPER_MODIFIER_TOOLS.has('move')).toBe(false);
  });
});

describe('coalescedPointerEvents', () => {
  it('returns the OS sub-frame samples when getCoalescedEvents is available', () => {
    const samples = [{ clientX: 1 }, { clientX: 2 }, { clientX: 3 }] as unknown as PointerEvent[];
    const event = { getCoalescedEvents: () => samples } as unknown as PointerEvent;
    expect(coalescedPointerEvents(event)).toBe(samples);
  });

  it('falls back to the event itself when the API is missing', () => {
    const event = { clientX: 5 } as unknown as PointerEvent;
    expect(coalescedPointerEvents(event)).toEqual([event]);
  });

  it('falls back to the event itself when no samples are reported', () => {
    const event = { clientX: 7, getCoalescedEvents: () => [] } as unknown as PointerEvent;
    expect(coalescedPointerEvents(event)).toEqual([event]);
  });
});
