import { useMemo, useState } from 'react';
import { DockableDialog } from '../DockablePanel/DockableDialog';
import { AdjustmentLayerControls } from './ImageEditorAdjustmentControls';
import { adjustmentLayerLabel } from './ImageAdjustmentLayer';
import { buildAdjustmentLayerHistogram } from './ImageAdjustmentHistogram';
import { IMAGE_DOCKABLE_WORKSPACE_ID } from './ImageDockablePanels';
import { useImageEditorStore } from '../../store/imageEditorStore';
import {
  addAdjustmentLayerUndoable,
  addCameraRawDevelopmentStackUndoable,
  commitAdjustmentSettingsUndoable,
} from './imageAdjustmentActions';
import {
  DEFAULT_CAMERA_RAW_DEVELOPMENT_DRAFT,
  type CameraRawDevelopmentDraft,
} from './ImageCameraRawDevelopment';
import type { AdjustmentLayerKind } from '../../types/imageEditor';

export const IMAGE_ADJUSTMENTS_DIALOG_ID = 'adjustments';

/** Quick-add buttons shown when no adjustment layer is selected. */
const QUICK_ADD_KINDS: AdjustmentLayerKind[] = [
  'brightnessContrast',
  'levels',
  'curves',
  'hueSaturation',
  'exposure',
  'temperatureTint',
  'blackWhite',
  'invert',
];

/**
 * The Photoshop-style Image > Adjustments dialog: an independent, non-modal
 * floating palette (full-screen sheet on phones) that edits the active
 * non-destructive adjustment layer. The menu commands create/select the layer
 * before opening; if none is selected it offers quick-add buttons. Closing the
 * dialog (its handle "x") leaves the adjustment layer in place, exactly like
 * Adobe's adjustment-layer workflow.
 */
export function ImageAdjustmentsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [cameraRawSetupOpen, setCameraRawSetupOpen] = useState(false);
  const [cameraRawDraft, setCameraRawDraft] = useState<CameraRawDevelopmentDraft>(DEFAULT_CAMERA_RAW_DEVELOPMENT_DRAFT);
  const [cameraRawRefusal, setCameraRawRefusal] = useState<string | null>(null);
  const [adjustmentRefusal, setAdjustmentRefusal] = useState<string | null>(null);
  const activeDocId = useImageEditorStore((state) => state.activeDocId);
  const doc = useImageEditorStore(
    (state) => state.documents.find((candidate) => candidate.id === state.activeDocId) ?? null,
  );
  const activeLayer = useMemo(
    () => (doc ? doc.layers.find((layer) => layer.id === doc.activeLayerId) ?? null : null),
    [doc],
  );
  const adjustment =
    activeLayer && activeLayer.type === 'adjustment' ? activeLayer.adjustment ?? null : null;

  const { histogram, histogramError } = useMemo(() => {
    if (!doc || !activeLayer || !adjustment) {
      return { histogram: null, histogramError: null };
    }

    try {
      return {
        histogram: buildAdjustmentLayerHistogram(doc, activeLayer),
        histogramError: null,
      };
    } catch (error) {
      return {
        histogram: null,
        histogramError: error instanceof Error
          ? `Failed to compute histogram: ${error.message}`
          : 'Failed to compute histogram',
      };
    }
  }, [doc, activeLayer, adjustment]);

  const title = adjustment ? `Adjustments — ${adjustmentLayerLabel(adjustment.kind)}` : 'Adjustments';

  return (
    <DockableDialog
      open={open}
      onClose={onClose}
      workspaceId={IMAGE_DOCKABLE_WORKSPACE_ID}
      dialogId={IMAGE_ADJUSTMENTS_DIALOG_ID}
      title={title}
      modal={false}
      defaultFloatingRect={{ x: 320, y: 140, width: 340, height: 460 }}
      minSize={{ width: 280, height: 220 }}
    >
      <div className="signal-loom-themed flex min-h-0 flex-1 flex-col gap-3 p-3 text-sm text-gray-100">
        {!activeDocId ? (
          <p className="text-cyan-100/60">Open an image to use adjustments.</p>
        ) : adjustment && activeLayer ? (
          <AdjustmentLayerControls
            adjustment={adjustment}
            disabled={activeLayer.locked}
            gpuPreviewOptions={{
              opacity: activeLayer.opacity,
              hasMask: Boolean(activeLayer.mask || activeLayer.maskData || activeLayer.maskLinkSourceLayerId),
              hasClippingMask: Boolean(activeLayer.clippingMask),
            }}
            histogram={histogram}
            histogramError={histogramError}
            onChange={(next) => commitAdjustmentSettingsUndoable(activeLayer.id, next)}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-cyan-100/60">
              Add a non-destructive adjustment layer, or select an existing one in the Layers panel.
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {QUICK_ADD_KINDS.map((kind) => (
                <button
                  key={kind}
                  className="theme-surface theme-border rounded-md border px-2 py-1.5 text-left text-xs text-gray-100 transition-colors hover:bg-cyan-500/15"
                  onClick={() => {
                    const added = addAdjustmentLayerUndoable(kind);
                    setAdjustmentRefusal(added ? null : doc?.metadata?.bitDepth === 16 || doc?.metadata?.bitDepth === 32
                      ? `Refused before mutation: ${doc.metadata.bitDepth}-bit adjustment processing has no native round-trip authority; no pixels or history were changed.`
                      : null);
                  }}
                  type="button"
                >
                  {adjustmentLayerLabel(kind)}
                </button>
              ))}
            </div>
            {adjustmentRefusal ? <p className="mt-1 text-[10px] text-rose-200" role="alert">{adjustmentRefusal}</p> : null}
            {cameraRawSetupOpen ? (
              <div className="mt-2 rounded border border-amber-300/25 bg-amber-300/5 p-2" data-testid="camera-raw-development-setup">
                <p className="text-xs font-semibold text-amber-100">Camera Raw-style development</p>
                <p className="mt-1 text-[10px] leading-relaxed text-amber-100/60">
                  Applies a bounded RGB development stack to already-imported image pixels. It does not decode a camera RAW file.
                </p>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <CameraRawNumber label="Temperature" value={cameraRawDraft.temperature} min={-100} max={100} onChange={(temperature) => setCameraRawDraft((draft) => ({ ...draft, temperature }))} />
                  <CameraRawNumber label="Tint" value={cameraRawDraft.tint} min={-100} max={100} onChange={(tint) => setCameraRawDraft((draft) => ({ ...draft, tint }))} />
                  <CameraRawNumber label="Exposure" value={cameraRawDraft.exposure} min={-5} max={5} step={0.1} onChange={(exposure) => setCameraRawDraft((draft) => ({ ...draft, exposure }))} />
                  <CameraRawNumber label="Brightness" value={cameraRawDraft.brightness} min={-100} max={100} onChange={(brightness) => setCameraRawDraft((draft) => ({ ...draft, brightness }))} />
                  <CameraRawNumber label="Contrast" value={cameraRawDraft.contrast} min={-100} max={100} onChange={(contrast) => setCameraRawDraft((draft) => ({ ...draft, contrast }))} />
                </div>
                {cameraRawRefusal ? <p className="mt-2 text-[10px] text-rose-200" role="alert">{cameraRawRefusal}</p> : null}
                <div className="mt-2 flex gap-2">
                  <button className="theme-surface theme-border flex-1 rounded border px-2 py-1 text-xs text-gray-100" onClick={() => {
                    const result = addCameraRawDevelopmentStackUndoable(cameraRawDraft);
                    if (result.status === 'applied') {
                      setCameraRawRefusal(null);
                      setCameraRawSetupOpen(false);
                      setCameraRawDraft(DEFAULT_CAMERA_RAW_DEVELOPMENT_DRAFT);
                    } else {
                      setCameraRawRefusal(result.reason === 'unsafe-document-bounds'
                        ? 'Camera Raw-style development is limited to documents up to 32 megapixels.'
                        : result.reason === 'high-bit-adjustment-unsupported'
                          ? `Refused before mutation: ${doc?.metadata?.bitDepth}-bit adjustment processing has no native round-trip authority; no pixels or history were changed.`
                          : 'Open an image with loaded photographic pixels before applying development.');
                    }
                  }} type="button">Apply development stack</button>
                  <button className="theme-surface theme-border rounded border px-2 py-1 text-xs text-gray-100" onClick={() => {
                    setCameraRawRefusal(null);
                    setCameraRawDraft(DEFAULT_CAMERA_RAW_DEVELOPMENT_DRAFT);
                    setCameraRawSetupOpen(false);
                  }} type="button">Cancel</button>
                </div>
              </div>
            ) : (
              <button className="rounded border border-amber-300/30 bg-amber-300/5 px-2 py-1.5 text-left text-xs text-amber-100 hover:bg-amber-300/10" data-testid="camera-raw-development-start" onClick={() => setCameraRawSetupOpen(true)} type="button">
                Camera Raw-style development
              </button>
            )}
          </div>
        )}
      </div>
    </DockableDialog>
  );
}

function CameraRawNumber({ label, value, min, max, step = 1, onChange }: {
  label: string; value: number; min: number; max: number; step?: number; onChange: (value: number) => void;
}) {
  return <label className="flex flex-col gap-0.5 text-[10px] text-cyan-100/65">{label}
    <input aria-label={`Camera Raw ${label}`} className="rounded border border-cyan-300/15 bg-black/20 px-1 py-0.5 text-xs text-white" max={max} min={min} onChange={(event) => onChange(Number(event.target.value))} step={step} type="number" value={value} />
  </label>;
}
