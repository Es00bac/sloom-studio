import { describe, expect, it } from 'vitest';
import {
  buildTimelineOpacityPoint,
  isPrimaryTimelinePointerButton,
  resizeTimelineTrackHeight,
} from './editorTimelineInteraction';

describe('resizeTimelineTrackHeight', () => {
  it('uses vertical pointer travel to resize a timeline track', () => {
    expect(resizeTimelineTrackHeight(84, 100, 136)).toBe(120);
    expect(resizeTimelineTrackHeight(84, 100, 40)).toBe(24);
  });
});

describe('buildTimelineOpacityPoint', () => {
  it('creates a clamped opacity point from pointer position inside the opacity lane', () => {
    expect(
      buildTimelineOpacityPoint(
        { left: 10, top: 20, width: 200, height: 50 },
        110,
        45,
      ),
    ).toEqual({
      timePercent: 50,
      valuePercent: 50,
    });

    expect(
      buildTimelineOpacityPoint(
        { left: 10, top: 20, width: 200, height: 50 },
        -20,
        200,
      ),
    ).toEqual({
      timePercent: 0,
      valuePercent: 0,
    });
  });
});

describe('isPrimaryTimelinePointerButton', () => {
  it('only treats the primary mouse button as a timeline drag/select gesture', () => {
    expect(isPrimaryTimelinePointerButton(0)).toBe(true);
    expect(isPrimaryTimelinePointerButton(1)).toBe(false);
    expect(isPrimaryTimelinePointerButton(2)).toBe(false);
  });
});
