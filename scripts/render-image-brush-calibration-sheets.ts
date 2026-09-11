import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createCanvas } from 'canvas';
import {
  buildBrushDabs,
  normalizeBrushSettings,
  paintBrushDab,
  resolveBrushDabColor,
} from '../src/components/ImageEditor/ImageBrushEngine';
import { IMAGE_BRUSH_PRESETS } from '../src/components/ImageEditor/ImageBrushPresets';
import type { BrushTiltState } from '../src/components/ImageEditor/brushTiltGeometry';

const outputDirectory = resolve(process.argv[2] ?? '/mnt/d/Sloom-Studio-artifacts/brush-calibration');
mkdirSync(outputDirectory, { recursive: true });

const families = [...new Set(IMAGE_BRUSH_PRESETS.map((preset) => preset.group))];
const upright: BrushTiltState = {
  hasTilt: false,
  altitudeDeg: 90,
  azimuthDeg: 0,
  hasTwist: false,
  twistDeg: 0,
  tiltAmount: 0,
};

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function drawStroke(input: {
  context: ReturnType<ReturnType<typeof createCanvas>['getContext']>;
  settings: ReturnType<typeof normalizeBrushSettings>;
  fromX: number;
  toX: number;
  centerY: number;
  tilted: boolean;
  seed: number;
}) {
  let previous = { x: input.fromX, y: input.centerY };
  let dabIndex = 0;
  let accumulatedDistancePx = 0;
  const segments = 72;

  for (let segment = 1; segment <= segments; segment += 1) {
    const t = segment / segments;
    const x = input.fromX + (input.toX - input.fromX) * t;
    const y = input.centerY + Math.sin(t * Math.PI * 3) * 8;
    const pressure = input.tilted ? 0.52 : 0.06 + t * 0.94;
    const tiltAmount = input.tilted ? 0.18 + t * 0.7 : 0;
    const tilt: BrushTiltState = input.tilted
      ? {
          hasTilt: true,
          altitudeDeg: 90 * (1 - tiltAmount),
          azimuthDeg: 12 + t * 55,
          hasTwist: true,
          twistDeg: 18 + t * 70,
          tiltAmount,
        }
      : upright;
    const point = { x, y };
    const velocityPxPerMs = input.tilted ? 0.45 : 0.15 + t * 2.6;
    const dabs = buildBrushDabs(previous, point, input.settings, pressure, {
      seed: input.seed,
      startIndex: dabIndex,
      tilt,
      velocityPxPerMs,
      accumulatedDistancePx,
    });
    const color = resolveBrushDabColor({
      primaryColor: input.settings.color,
      secondaryColor: '#f0c78a',
      pressure,
      tiltAmount,
      pressureColor: input.settings.pressureColor ?? 0,
      tiltColor: input.settings.tiltColor ?? 0,
    });
    for (const dab of dabs) {
      paintBrushDab(input.context as unknown as CanvasRenderingContext2D, dab, color, 'source-over');
    }
    dabIndex += dabs.length;
    accumulatedDistancePx += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
}

for (const family of families) {
  const presets = IMAGE_BRUSH_PRESETS.filter((preset) => preset.group === family);
  const width = 1800;
  const rowHeight = 104;
  const height = 92 + rowHeight * presets.length;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');

  context.fillStyle = '#b9bdc4';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#171b22';
  context.font = '700 28px sans-serif';
  context.fillText(family, 30, 42);
  context.font = '15px sans-serif';
  context.fillText('Pressure ramp: light → heavy + slow → fast', 365, 42);
  context.fillText('Tilt/twist ramp: upright-ish → side of stylus', 1090, 42);

  presets.forEach((preset, index) => {
    const settings = normalizeBrushSettings({ ...preset.settings, color: preset.settings.color ?? '#20242d' });
    const y = 82 + index * rowHeight;
    context.fillStyle = index % 2 === 0 ? '#d9dadd' : '#cfd1d5';
    context.fillRect(18, y - 28, width - 36, rowHeight - 8);
    context.strokeStyle = '#8b9099';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(18, y + rowHeight - 36);
    context.lineTo(width - 18, y + rowHeight - 36);
    context.stroke();
    context.fillStyle = '#242933';
    context.font = '600 16px sans-serif';
    context.fillText(preset.label, 32, y + 8);
    context.font = '12px monospace';
    context.fillStyle = '#59606b';
    context.fillText(`${settings.size}px  H${settings.hardness.toFixed(2)}  O${settings.opacity.toFixed(2)}  F${settings.flow.toFixed(2)}`, 32, y + 30);

    drawStroke({ context, settings, fromX: 365, toX: 1010, centerY: y + 16, tilted: false, seed: 1100 + index });
    drawStroke({ context, settings, fromX: 1090, toX: 1740, centerY: y + 16, tilted: true, seed: 2100 + index });
  });

  const target = resolve(outputDirectory, `${slug(family)}.png`);
  writeFileSync(target, canvas.toBuffer('image/png'));
  process.stdout.write(`${target}\n`);
}
