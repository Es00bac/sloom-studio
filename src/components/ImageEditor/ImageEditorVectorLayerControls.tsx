import type { CustomVectorShapePreset, CustomVectorShapePresetKind, ImageLayer, ImageVectorShape } from '../../types/imageEditor';
import { useState } from 'react';
import { AdvancedColorPicker } from '../Common/AdvancedColorPicker';
import { AdjustmentSlider } from './ImageEditorAdjustmentControls';
import { describeImagePathEditReadiness } from './ImagePaths';
import { describeImageRasterVectorShapeReadiness, getEditableVectorShape } from './ImageVectorShape';
import {
  deleteImageCustomShapeLibraryRecord,
  loadImageCustomShapeLibrary,
  saveImageCustomShapeLibraryRecord,
  shapeLibraryRecordFromVectorShape,
} from './ImageCustomShapeLibrary';

export function EditableVectorShapeLayerControls({
  disabled,
  layer,
  onChange,
}: {
  disabled?: boolean;
  layer: ImageLayer;
  onChange: (patch: Partial<ImageVectorShape>) => void;
}) {
  const shape = getEditableVectorShape(layer);
  const [library, setLibrary] = useState(() => loadImageCustomShapeLibrary());
  const [libraryName, setLibraryName] = useState('');
  if (!shape) return null;
  const preset = shape.kind === 'path' ? shape.preset : undefined;
  const editReadiness = describeImagePathEditReadiness(shape);
  const rasterVectorReadiness = describeImageRasterVectorShapeReadiness(layer);
  const controlSignature = `image-vector-layer-controls:v1:${JSON.stringify({
    layerId: layer.id,
    kind: shape.kind,
    presetKind: preset?.kind ?? null,
    pointCount: shape.kind === 'path' ? shape.points.length : shape.kind === 'rect' ? 4 : 0,
    editSignature: editReadiness.previewSignature,
    fillColor: shape.fillColor,
    fillOpacity: shape.fillOpacity,
    strokeColor: shape.strokeColor,
    strokeOpacity: shape.strokeOpacity,
    strokeWidth: shape.strokeWidth,
  })}`;

  return (
    <div className="mt-2 border-t border-cyan-300/10 pt-2" data-vector-controls-signature={controlSignature}>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-cyan-100/40">Vector Shape</label>
        <span className="text-[10px] uppercase tracking-wide text-cyan-100/30">
          {preset ? formatCustomPresetLabel(preset.kind) : shape.kind === 'ellipse' ? 'Ellipse' : shape.kind === 'path' ? 'Path' : 'Rectangle'}
        </span>
      </div>
      {preset ? (
        <div className="mb-2 space-y-2 rounded border border-cyan-300/10 bg-[#10131b] p-2">
          <label className="block">
            <span className="mb-1 block text-cyan-100/40">Preset</span>
            <select
              aria-label="Vector preset"
              className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-xs text-cyan-100/80 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={disabled}
              onChange={(event) => onChange({ preset: buildPresetPatch(event.target.value as CustomVectorShapePresetKind, preset) })}
              value={preset.kind}
            >
              <option value="line">Line</option>
              <option value="triangle">Triangle</option>
              <option value="diamond">Diamond</option>
              <option value="polygon">Polygon</option>
              <option value="star">Star</option>
            </select>
          </label>
          {preset.kind === 'polygon' || preset.kind === 'star' ? (
            <label className="block">
              <span className="mb-1 block text-cyan-100/40">{preset.kind === 'star' ? 'Points' : 'Sides'}</span>
              <select
                aria-label="Vector preset points"
                className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-xs text-cyan-100/80 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={disabled}
                onChange={(event) => onChange({
                  preset: {
                    ...preset,
                    polygonSides: parseInt(event.target.value, 10),
                  } as CustomVectorShapePreset,
                })}
                value={preset.polygonSides ?? 5}
              >
                {Array.from({ length: 10 }, (_, index) => index + 3).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {preset.kind === 'star' ? (
            <AdjustmentSlider
              ariaLabel="Vector star inner radius"
              disabled={disabled}
              label="Inner"
              max={0.9}
              min={0.1}
              onChange={(starInnerRadius) => onChange({
                preset: {
                  ...preset,
                  starInnerRadius,
                },
              })}
              step={0.01}
              value={preset.starInnerRadius ?? 0.5}
            />
          ) : null}
          <div className="border-t border-cyan-300/10 pt-2">
            <label className="mb-1 block text-cyan-100/40">Custom shape library</label>
            <div className="flex gap-1">
              <input aria-label="Custom shape library name" className="min-w-0 flex-1 rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-xs text-cyan-100/80" onChange={(event) => setLibraryName(event.target.value)} placeholder="Save current shape" value={libraryName} />
              <button className="rounded border border-cyan-300/20 px-2 text-[10px] text-cyan-100" onClick={() => {
                const record = shapeLibraryRecordFromVectorShape(libraryName, shape);
                if (record) setLibrary(saveImageCustomShapeLibraryRecord(record));
              }} type="button">Save</button>
            </div>
            {library.length > 0 ? <div className="mt-2 flex gap-1">
              <select aria-label="Custom shape library entries" className="min-w-0 flex-1 rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-xs text-cyan-100/80" defaultValue="" onChange={(event) => {
                const record = library.find((item) => item.id === event.target.value);
                if (record) onChange({ preset: { ...record.preset }, fillColor: record.fillColor, fillOpacity: record.fillOpacity, strokeColor: record.strokeColor, strokeOpacity: record.strokeOpacity, strokeWidth: record.strokeWidth });
              }}>
                <option value="">Apply saved shape…</option>
                {library.map((record) => <option key={record.id} value={record.id}>{record.name}</option>)}
              </select>
              <button className="rounded border border-cyan-300/20 px-2 text-[10px] text-cyan-100" disabled={library.length === 0} onClick={() => setLibrary(deleteImageCustomShapeLibraryRecord(library[0].id))} title="Delete newest saved shape" type="button">Delete newest</button>
            </div> : null}
          </div>
        </div>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        <AdjustmentSlider
          disabled={disabled}
          label="Fill Opacity"
          max={1}
          min={0}
          onChange={(fillOpacity) => onChange({ fillOpacity })}
          step={0.01}
          value={shape.fillOpacity}
        />
        <AdjustmentSlider
          disabled={disabled}
          label="Stroke Opacity"
          max={1}
          min={0}
          onChange={(strokeOpacity) => onChange({ strokeOpacity })}
          step={0.01}
          value={shape.strokeOpacity}
        />
        <AdjustmentSlider
          ariaLabel="Vector stroke width"
          disabled={disabled}
          label="Stroke Width"
          max={64}
          min={0}
          onChange={(strokeWidth) => onChange({ strokeWidth })}
          step={1}
          value={shape.strokeWidth}
        />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <label className="w-12 text-cyan-100/40">Fill</label>
        <AdvancedColorPicker
          className="h-6 w-12"
          buttonClassName="rounded border border-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          label="Vector fill color"
          onChange={(fillColor) => onChange({ fillColor })}
          value={shape.fillColor}
        />
        <input
          aria-label="Vector fill color"
          className="flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-0.5 text-xs text-cyan-100/80 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onChange={(event) => onChange({ fillColor: event.target.value })}
          type="text"
          value={shape.fillColor}
        />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <label className="w-12 text-cyan-100/40">Stroke</label>
        <AdvancedColorPicker
          className="h-6 w-12"
          buttonClassName="rounded border border-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          label="Vector stroke color"
          onChange={(strokeColor) => onChange({ strokeColor })}
          value={shape.strokeColor}
        />
        <input
          aria-label="Vector stroke color"
          className="flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-0.5 text-xs text-cyan-100/80 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled}
          onChange={(event) => onChange({ strokeColor: event.target.value })}
          type="text"
          value={shape.strokeColor}
        />
      </div>
      <div className="mt-2 space-y-1 rounded border border-cyan-300/10 bg-[#10131b] p-2 text-[10px] text-cyan-100/45">
        <div className="font-semibold uppercase tracking-[0.14em] text-cyan-100/35">Edit Readiness</div>
        <p>{editReadiness.anchorPointEditReadiness.state === 'ready-for-retained-anchor-editing' ? 'Retained anchors ready' : 'Shape bounds only'}</p>
        <p>{shape.kind === 'path' ? 'Bezier handles editable on retained paths' : 'Bezier handles after Convert to Editable Path'}</p>
        <p>Boolean combine uses separate vector layers</p>
        <p>Live boolean stack not retained</p>
        {preset ? <p>Preset metadata retained</p> : null}
        {preset ? <p>Native custom shape library instance not retained</p> : null}
        {rasterVectorReadiness.booleanOperations.exactSubsets.length > 0 ? (
          <p>Exact boolean outputs export as materialized paths</p>
        ) : null}
        <p>Vector mask stores a closed local copy</p>
        <p>SVG keeps straight segments only</p>
        <p>PSD keeps layer-backed paths only</p>
        {preset ? <p>Custom preset regenerates until points are edited</p> : null}
      </div>
    </div>
  );
}

function formatCustomPresetLabel(kind: CustomVectorShapePresetKind): string {
  switch (kind) {
    case 'line':
      return 'Line';
    case 'triangle':
      return 'Triangle';
    case 'diamond':
      return 'Diamond';
    case 'polygon':
      return 'Polygon';
    case 'star':
      return 'Star';
  }
}

function buildPresetPatch(
  kind: CustomVectorShapePresetKind,
  current: CustomVectorShapePreset,
): CustomVectorShapePreset {
  if (kind === 'polygon') {
    return {
      kind,
      polygonSides: current.polygonSides ?? 5,
    };
  }
  if (kind === 'star') {
    return {
      kind,
      polygonSides: current.polygonSides ?? 5,
      starInnerRadius: current.starInnerRadius ?? 0.5,
    };
  }
  return { kind };
}
