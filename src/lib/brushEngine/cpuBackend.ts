import type { LayerBitmap } from '../../types/imageEditor';
import type { BrushBackend, BrushDab, Rect, StrokeSession } from './backend';
import { clampRect, dabRect, isEmptyRect, unionRect } from './dirtyRect';
import { blurRegion, sharpenRegion, smudgeRegion } from './cpuKernels';

function cloneImageData(source: ImageData): ImageData {
  const data = new Uint8ClampedArray(source.data);
  // Real ImageData is required by the browser's putImageData; fall back to a plain shape under Node tests.
  if (typeof ImageData !== 'undefined') {
    return new ImageData(data, source.width, source.height);
  }
  return { width: source.width, height: source.height, data } as ImageData;
}

/**
 * Region-bounded CPU brush backend. Seeds a resident working ImageData once, applies each dab over
 * only its dirty-rect, and writes the accumulated dirty region back to the layer once on commit.
 * This is the reference implementation later GPU backends are validated against.
 */
export function createCpuBrushBackend(): BrushBackend {
  return {
    id: 'cpu',
    beginStroke({ source, sampleSource, width, height }) {
      const working = cloneImageData(source);
      let dirty: Rect | null = null;

      const writeBack = (target: LayerBitmap): Rect | null => {
        if (!dirty || isEmptyRect(dirty)) return null;
        const ctx = target.getContext('2d');
        if (!ctx) return null;
        ctx.putImageData(working, 0, 0, dirty.x, dirty.y, dirty.width, dirty.height);
        return dirty;
      };

      const session: StrokeSession = {
        stampDab(dab: BrushDab) {
          const rect = clampRect(dabRect(dab.to.x, dab.to.y, dab.size), width, height);
          if (isEmptyRect(rect)) return;
          if (dab.op === 'smudge') {
            smudgeRegion(working, sampleSource.imageData, {
              from: dab.from,
              to: dab.to,
              size: dab.size,
              strength: dab.strength,
              rect,
            });
          } else if (dab.op === 'blur') {
            blurRegion(working, sampleSource.imageData, { to: dab.to, size: dab.size, strength: dab.strength, rect });
          } else {
            sharpenRegion(working, sampleSource.imageData, { to: dab.to, size: dab.size, strength: dab.strength, rect });
          }
          dirty = unionRect(dirty, rect);
        },
        dirtyRect: () => dirty,
        previewInto: writeBack,
        commit: writeBack,
        dispose() {
          dirty = null;
        },
      };
      return session;
    },
  };
}
