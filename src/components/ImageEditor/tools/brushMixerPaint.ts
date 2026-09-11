import type { MixerColor } from '../ImageBrushMixer';
import { mixDabColor, updateSmudgeState } from '../ImageBrushMixer';
import { mixSpectral } from '../ImageBrushSpectral';

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

/** Average colour of a clamped disc/box around (cx,cy) read from `ctx`, as a MixerColor (0..255). */
export function sampleCanvasAverage(ctx: Ctx, cx: number, cy: number, radius: number, width: number, height: number): MixerColor {
  const r = Math.max(1, Math.round(radius));
  const x0 = Math.max(0, Math.round(cx) - r);
  const y0 = Math.max(0, Math.round(cy) - r);
  const x1 = Math.min(width, Math.round(cx) + r);
  const y1 = Math.min(height, Math.round(cy) + r);
  if (x1 <= x0 || y1 <= y0) return [0, 0, 0, 0];
  const data = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
  let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) { sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; sa += data[i + 3]; n += 1; }
  return n === 0 ? [0, 0, 0, 0] : [sr / n, sg / n, sb / n, sa / n];
}

export interface MixerDabInput { x: number; y: number; index?: number }
export interface MixerPaintParams {
  state: MixerColor;            // running smudge state (carried across calls)
  fg: MixerColor;               // foreground/brush colour
  smudgeLength: number;
  colorRate: number;
  smudgeRadius: number;
  mixMode: 'rgb' | 'spectral';
  smudgeMode?: 'dulling' | 'smearing';
  layerX: number; layerY: number; width: number; height: number;
  /** Paint one dab at its (doc-space) position with the given css colour. Injected so this module
   *  stays testable without the full brush engine. */
  paintDab: (ctx: Ctx, dab: MixerDabInput, cssColor: string) => void;
}

/** For each dab: sample the canvas under it, update the smudge state, mix with fg, paint that dab.
 *  Returns the updated smudge state to carry into the next call. */
export function paintMixerDabs(ctx: Ctx, dabs: MixerDabInput[], params: MixerPaintParams): MixerColor {
  let state = params.state;
  const sampleRadius = (params.smudgeMode ?? 'dulling') === 'smearing' ? Math.min(2, params.smudgeRadius) : params.smudgeRadius;
  for (const dab of dabs) {
    const sampled = sampleCanvasAverage(ctx, dab.x - params.layerX, dab.y - params.layerY, sampleRadius, params.width, params.height);
    state = updateSmudgeState(state, sampled, params.smudgeLength);
    const dabColor = params.mixMode === 'spectral'
      ? mixSpectral(state, params.fg, params.colorRate)
      : mixDabColor(state, params.fg, params.colorRate);
    const [r, g, b, a] = dabColor;
    params.paintDab(ctx, dab, `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${(a / 255).toFixed(4)})`);
  }
  return state;
}
