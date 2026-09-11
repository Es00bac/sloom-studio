import { describe, expect, it } from 'vitest';
import {
  GPU_ADJUSTMENT_VERTEX_SHADER,
  GPU_ADJUSTMENT_FRAGMENT_SHADER,
  GPU_BLACK_WHITE_ROUNDING_OFFSET,
  GPU_BLACK_WHITE_WEIGHTS,
  GPU_TEXTURE_V_FROM_NDC_Y_GLSL,
  blackWhiteLumaByte,
  describeGpuAdjustmentPreview,
  gpuTextureVFromNdcY,
  tryApplyAdjustmentGpu,
} from './ImageAdjustmentGpuPreview';

const source = {
  width: 2,
  height: 1,
  data: new Uint8ClampedArray([20, 40, 60, 255, 100, 120, 140, 255]),
} as ImageData;

describe('GPU adjustment preview eligibility', () => {
  it('allows only the bounded unmasked full-opacity adjustment route', () => {
    expect(describeGpuAdjustmentPreview({ kind: 'invert' }).eligible).toBe(true);
    expect(describeGpuAdjustmentPreview({ kind: 'brightnessContrast', brightness: 0, contrast: 0 }, { opacity: 0.5 }).reason)
      .toContain('Partial-opacity');
    expect(describeGpuAdjustmentPreview({ kind: 'blackWhite' }, { hasMask: true }).reason).toContain('masks');
    expect(describeGpuAdjustmentPreview({ kind: 'hueSaturation', hue: 0, saturation: 0, lightness: 0 }).eligible).toBe(false);
  });

  it('fails closed to the CPU compositor when WebGL2 is unavailable', () => {
    expect(tryApplyAdjustmentGpu(source, { kind: 'invert' })).toBeNull();
  });

  it('keeps non-symmetric ImageData rows upright across the shader/readback orientation seam', () => {
    const sourceRows = ['top', 'middle', 'bottom'];
    const readbackRows = sourceRows.map((_, framebufferRow) => {
      const ndcY = -1 + (framebufferRow * 2) / (sourceRows.length - 1);
      const sourceRow = Math.round(gpuTextureVFromNdcY(ndcY) * (sourceRows.length - 1));
      return sourceRows[sourceRow];
    });

    expect(readbackRows).toEqual(sourceRows);
    expect(GPU_ADJUSTMENT_VERTEX_SHADER).toContain(GPU_TEXTURE_V_FROM_NDC_Y_GLSL);
    expect(GPU_TEXTURE_V_FROM_NDC_Y_GLSL).not.toContain('0.5 - aPos.y');
    expect(blackWhiteLumaByte(0, 68, 12)).toBe(50);
    expect(blackWhiteLumaByte(0, 41, 44)).toBe(33);
    expect(GPU_BLACK_WHITE_WEIGHTS).toEqual([2126, 7152, 722]);
    expect(GPU_BLACK_WHITE_ROUNDING_OFFSET).toBe(5000);
    expect(GPU_ADJUSTMENT_FRAGMENT_SHADER).toContain('int weightedLuma = sourceBytes.r * 2126 + sourceBytes.g * 7152 + sourceBytes.b * 722;');
  });
});
