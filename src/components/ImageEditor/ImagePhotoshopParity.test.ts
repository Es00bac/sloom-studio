import { describe, expect, it } from 'vitest';
import type { ImageLayer } from '../../types/imageEditor';
import { getImageLayerWorkflowBadges } from './ImageLayerWorkflowMetadata';
import {
  IMAGE_PHOTOSHOP_PARITY_ITEMS,
  countImageParityStatuses,
  getHighPriorityImageParityItems,
  getImageParityChecklistStatus,
} from './ImagePhotoshopParity';

const expectOneExactPhrase = (copy: string | undefined, phrases: readonly string[]): void => {
  expect(copy).toEqual(expect.any(String));
  expect(phrases.filter((phrase) => copy?.includes(phrase))).not.toEqual([]);
};

describe('ImagePhotoshopParity', () => {
  it('counts checklist-complete rows as done instead of trusting stale manual partial status', () => {
    const statuses = countImageParityStatuses([
      {
        id: 'brush-engine',
        area: 'Brush / Eraser Engine',
        photoshop: 'Brush presets, tips, textures, dynamics, smoothing, symmetry, pressure and tilt response',
        signalLoom: 'Brush presets, tips, textures, dynamics, smoothing, symmetry, pressure and tilt response now exist',
        priority: 'high',
        status: 'partial',
        parityEstimate: 75,
        workflowReason: 'Painting and retouching quality rises or falls with the brush engine.',
      },
    ]);

    expect(statuses).toEqual({ done: 1, partial: 0, remaining: 0 });
  });

  it('tracks the audit-grounded Image parity surface honestly', () => {
    const highPriority = getHighPriorityImageParityItems();
    const statuses = countImageParityStatuses();
    const lowProgressPartialRows = IMAGE_PHOTOSHOP_PARITY_ITEMS.filter((item) => (
      item.status === 'partial' && item.parityEstimate <= 12
    ));

    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.length).toBeGreaterThanOrEqual(45);
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.every((item) => item.photoshop && item.signalLoom)).toBe(true);
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.every((item) => typeof item.parityEstimate === 'number')).toBe(true);
    expect(statuses.partial).toBeGreaterThan(25);
    expect(statuses.remaining).toBeGreaterThanOrEqual(0);
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'bit-depth-workflow')).toMatchObject({
      status: 'partial',
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'bit-depth-workflow')?.parityEstimate).toBeGreaterThanOrEqual(24);
    expect(lowProgressPartialRows.map((item) => item.id)).not.toContain('camera-raw');
    expect(statuses.done).toBeGreaterThan(0);
    expect(statuses.done).toBeLessThan(IMAGE_PHOTOSHOP_PARITY_ITEMS.length);
    expect(highPriority.map((item) => item.id)).toEqual([
      'free-transform',
      'crop',
      'brush-engine',
      'text-tool',
      'layer-stack',
      'layer-masks',
      'adjustment-layers',
      'channels',
      'layer-styles',
      'layer-filters',
      'smart-source-linked-layers',
      'vector-layers',
      'selection-tools',
      'magic-wand-paint-bucket',
      'clone-heal-retouch',
      'gradients',
      'file-interop',
      'history-actions',
      'android-parity',
      'workspace-launch-icons',
    ]);
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'pen-tool',
        'paths-panel',
        'layer-groups',
        'clipping-masks',
        'channels-panel-alpha',
        'histogram-panel',
        'color-management',
        'content-aware-fill-remove-patch',
        'liquify',
        'artboards-print-proof',
      ]),
    );
  });

  it('distinguishes high-bit capability absence from executable refusal boundaries', () => {
    const row = IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'bit-depth-workflow');
    expect(row?.signalLoom).toContain('Native GPU high-bit and CMYK routes are unavailable capabilities');
    expect(row?.signalLoom).toContain('high-bit PSD ingress');
    expect(row?.signalLoom).toContain('refuse before mutation');
    expect(row?.signalLoom).toContain('compositor-side support; live mask editing remains separately bounded');
    expect(row?.signalLoom).toContain('worker request coalescing plus permanent synchronous fallback');
    expect(row?.signalLoom).not.toContain('GPU high-bit, served-client high-bit editing, and unsupported codec variants refuse');
  });

  it('tracks bounded multi-select and group-caveat progress in layer-stack and layer-groups rows', () => {
    const layerStackRow = IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-stack');
    const layerGroupRow = IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-groups');

    expect(layerStackRow).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('selected-group boundary summaries'),
    });
    expect(layerStackRow?.signalLoom).toContain('group hierarchy readiness descriptors');
    expect(layerStackRow?.signalLoom).toContain('bounded multi-select and group hierarchy readiness');
    expect(layerStackRow?.signalLoom).toContain('grouped stack descriptors');
    expect(layerStackRow?.signalLoom).toContain('clipping base visibility through groups');
    expect(layerGroupRow?.signalLoom).toContain('organization boundary summaries');
    expect(layerGroupRow?.signalLoom).toContain('image-layer-grouped-stack-readiness');
    expect(layerGroupRow?.signalLoom).toContain('normal vs pass-through caveats');
  });

  it('marks the histogram panel as partial once the document histogram UI exists', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'histogram-panel')).toMatchObject({
      status: 'partial',
      parityEstimate: expect.any(Number),
      signalLoom: expect.stringContaining('channel switching and clipping readouts'),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'histogram-panel')?.signalLoom).toContain('before/after histogram comparison helpers');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'histogram-panel')?.signalLoom).toContain('adjustment-preview feedback descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'histogram-panel')?.signalLoom).toContain('histogram panel/readout descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'histogram-panel')?.signalLoom).toContain('aggregate clipping counters');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'histogram-panel')?.signalLoom).toContain('explicit non-tonal alpha histogram mode');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'histogram-panel')?.signalLoom).toContain('histogram feedback descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'histogram-panel')?.signalLoom).toContain('describeAdjustmentHistogramFeedbackReadiness');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'histogram-panel')?.signalLoom).toContain('visible-pixel deltas');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'histogram-panel')?.signalLoom).toContain('stable preview IDs');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'histogram-panel')?.signalLoom).toContain('bounded GPU compositor for only four');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'histogram-panel')?.signalLoom).toContain('before/after adjustment feedback');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'histogram-panel')?.signalLoom).toContain('stable histogram signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'histogram-panel')?.signalLoom).toContain('per-channel clipping delta descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'histogram-panel')?.signalLoom).toContain('broader live-preview wiring remains incomplete');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'histogram-panel')?.parityEstimate).toBeGreaterThanOrEqual(53);
  });

  it('tracks histogram-aware Levels and Curves as adjustment-layer parity progress', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'adjustment-layers')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('histogram-aware Levels/Curves'),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'adjustment-layers')?.signalLoom).toContain('preview-feedback helpers');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'adjustment-layers')?.signalLoom).toContain('adjustment plan descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'adjustment-layers')?.signalLoom).toContain('describeAdjustmentStackReadiness');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'adjustment-layers')?.signalLoom).toContain('validateAdjustmentPresetCompatibility');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'adjustment-layers')?.signalLoom).toContain('preset compatibility validation');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'adjustment-layers')?.signalLoom).toContain('before/after visible-pixel deltas');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'adjustment-layers')?.signalLoom).toContain('adjustment stack planning descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'adjustment-layers')?.signalLoom).toContain('per-kind channel summaries');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'adjustment-layers')?.signalLoom).toContain('mask interaction summaries');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'adjustment-layers')?.signalLoom).toContain('preset serialization');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'adjustment-layers')?.signalLoom).toContain('preset import/export warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'adjustment-layers')?.signalLoom).toContain('readiness blockers');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'adjustment-layers')?.signalLoom).toContain('missing histogram source data');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'adjustment-layers')?.signalLoom).toContain('readiness signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'adjustment-layers')?.signalLoom).toContain('stable stack preview/plan signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'adjustment-layers')?.signalLoom).toContain('unsupported clipping');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'adjustment-layers')?.signalLoom).toContain('typed adjustment histogram feedback checks');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'adjustment-layers')?.signalLoom).toContain('hardware-accelerated point-wise preview path');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'adjustment-layers')?.signalLoom).toContain('deterministic CPU fallback for every other adjustment or safety condition');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'adjustment-layers')?.signalLoom).toContain('unsupported true 16/32-bit processing');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'adjustment-layers')?.signalLoom).toContain('unsupported LAB/CMYK native adjustment operations');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'adjustment-layers')?.parityEstimate).toBeGreaterThanOrEqual(71);
  });

  it('tracks transform preview sessions as free-transform parity progress without overstating the remaining layer-side pro transform gaps', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'free-transform')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('apply/cancel transform preview sessions'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'free-transform')?.signalLoom).toContain('pivot control');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'free-transform')?.signalLoom).toContain('layer-side skew/distort/perspective/warp modes now exist');
    expectOneExactPhrase(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'free-transform')?.signalLoom, [
      'buildImageLayerTransformReadiness descriptors',
      'transform capability descriptors',
    ]);
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'free-transform')?.signalLoom).toContain('preview-session descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'free-transform')?.signalLoom).toContain('transform-control handle plans');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'free-transform')?.signalLoom).toContain('numeric transform through ImageLayerNumericTransformDescriptor');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'free-transform')?.signalLoom).toContain('rotate/pivot handle metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'free-transform')?.signalLoom).toContain('runtime document/layer edge and center snapping');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'free-transform')?.signalLoom).not.toContain('layer-side warp and richer');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'free-transform')?.parityEstimate).toBeGreaterThanOrEqual(53);
  });

  it('tracks destructive, non-destructive, and straighten crop progress without claiming full crop parity', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'crop')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('Delete Cropped Pixels'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'crop')?.signalLoom).toContain('guide overlays');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'crop')?.signalLoom).toContain('straighten / rotate-crop');
    expectOneExactPhrase(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'crop')?.signalLoom, [
      'describeCropToolReadiness working-state descriptors',
      'crop planning metadata',
    ]);
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'crop')?.signalLoom).toContain('visible export planning');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'crop')?.signalLoom).toContain('crop handle readiness descriptors for eight resize handles plus rotate-crop handle');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'crop')?.signalLoom).toContain('crop commit plan signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'crop')?.signalLoom).toContain('destructive/non-destructive commit descriptors');
    // Interactive Perspective Crop shipped — claimed as done, not as a remaining gap.
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'crop')?.signalLoom).toContain('interactive Perspective Crop mode');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'crop')?.signalLoom).toContain('one-undo destructive-flatten store operation');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'crop')?.signalLoom).not.toContain('perspective crop, and true content-aware fill');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'crop')?.signalLoom).not.toContain('straighten and rotate-crop behavior remain incomplete');
    // Custom crop preset management shipped — claimed as done, not as a remaining gap.
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'crop')?.signalLoom).toContain('custom aspect-ratio preset management');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'crop')?.signalLoom).not.toContain('and preset management remain incomplete');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'crop')?.parityEstimate).toBeGreaterThanOrEqual(49);
  });

  it('counts Brush / Eraser Engine as done after the advanced completion atoms are implemented', () => {
    const brushRow = IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine');

    expect(brushRow).toMatchObject({
      status: 'done',
      signalLoom: expect.stringContaining('broader standard preset library'),
      parityEstimate: 100,
    });
    expect(getImageParityChecklistStatus(brushRow!)).toBe('done');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('centered vertical/horizontal/four-way symmetry');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('previewable preset tiles');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('JSON export/import');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('stroke preview metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('capability summaries');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('brush preset descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('Brush presets now include the standard built-in preset library');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('brush-tip metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('describeBrushDynamicsSupportMatrix');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('dynamic settings signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('validateImageBrushPresetPack');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('accepted/rejected preset counts');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('data-brush-preset-preview-signature');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('preset-pack metadata');
    expectOneExactPhrase(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom, [
      'buildBrushEngineReadiness descriptors',
      'brush workflow support descriptors',
    ]);
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('preset pack serialization planning');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('support matrix');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('unsupported dynamics warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('brush/eraser workflow descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('channel/mask/QuickMask route summaries');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('brush/eraser preview signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('advanced dynamics');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('velocity dynamics');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('wet media');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('GPU brush engine targets for desktop AMD, desktop Nvidia, and Android Qualcomm/Adreno');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('Android/gamepad brush controls');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('native ABR import fidelity');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('describeAdvancedBrushEngineSupport');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).toContain('compact Brush panel controls');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.signalLoom).not.toContain('advanced dynamics are still missing');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'brush-engine')?.parityEstimate).toBe(100);
  });

  it('tracks standard, Background Eraser, and Magic Eraser route descriptors honestly', () => {
    const row = IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'eraser');

    expect(row).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('brush engine'),
      parityEstimate: expect.any(Number),
    });
    expect(row?.signalLoom).toContain('deterministic workflow descriptor metadata');
    expect(row?.signalLoom).toContain('Eraser inherits brush-engine dab dynamics');
    expect(row?.signalLoom).toContain('Eraser opacity/flow controls');
    expect(row?.signalLoom).toContain('pixel, RGB-channel, layer-mask, and QuickMask routes');
    expect(row?.signalLoom).toContain('Magic Eraser is now a dedicated toolbar/tool-dispatch path');
    expect(row?.signalLoom).toContain('clears active pixel-layer alpha by tolerance');
    expect(row?.signalLoom).toContain('Background Eraser is now a bounded active-pixel-layer alpha-clear brush');
    expect(row?.signalLoom).toContain('sampling once/continuous');
    expect(row?.signalLoom).toContain('background swatch');
    expect(row?.signalLoom).toContain('heuristic limits/protect-foreground semantics');
    expect(row?.signalLoom).toContain('undoable paint operations');
    expect(row?.signalLoom).toContain('compact tolerance/contiguous Properties controls');
    expect(row?.signalLoom).toContain('edgeSummary');
    expect(row?.signalLoom).toContain('Photoshop edge cleanup now exists through anti-aliased one-pixel alpha-fringe cleanup');
    expect(row?.signalLoom).toContain('per-route eraser support paths');
    expect(row?.signalLoom).toContain('route signatures');
    expect(row?.signalLoom).toContain('Background Eraser and Magic Eraser mask/channel/QuickMask routes remain missing');
    expect(row?.signalLoom).not.toContain('Photoshop edge cleanup plus true sampling/limits semantics remain incomplete');
    expect(row?.signalLoom).not.toContain('magic eraser unsupported');
    expect(row?.signalLoom).not.toContain('background eraser unsupported');
    expect(row?.parityEstimate).toBeGreaterThanOrEqual(52);
  });

  it('tracks retained typography controls without claiming live type or OpenType parity', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('baseline shift'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('canvas kerning mode');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('caps variant controls');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('named typography presets');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('standard font stack picker');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('visible OpenType feature toggles');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('style-level OpenType feature persistence');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('OpenType descriptor normalization');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('unsupported OpenType tag reporting');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('typography readiness descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('describeImageTextTypographySupportMatrix');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('style package signature helpers');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('font fallback stack signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('bounded native PSD text export state signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('native horizontal unwarped solid-colour PSD text records');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('support-matrix summaries in selected text controls');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('retained straight-segment text-on-path attachment controls');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('text-on-path glyph raster previews');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('native PSD text-on-path export warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('style package signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('font fallback persistence');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('native PSD text subset warning states');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('rasterized preview/editability descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('retained live-edit descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('live type editing on canvas');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('style controls');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('text preview IDs/signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('image-text-typography-parity-progress');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('stableSignatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('native PSD text subset warning states');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('bounded multi-column vertical-rl/vertical-lr raster type');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).toContain('full Japanese vertical glyph substitutions/shaping, kinsoku, tate-chu-yoko');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.signalLoom).not.toContain('vertical type, editable text warps, and native text interop still lag badly');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'text-tool')?.parityEstimate).toBeGreaterThanOrEqual(72);

    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('retained baseline shift'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('named typography presets');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('serialized character/paragraph style descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('styles');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('retained straight-segment text-on-path controls');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('path reference metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('path layout metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('sampled cubic Bezier text-on-path layout planning');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('style package serialization warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('style package signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('describeImageTextTypographySupportMatrix');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('OpenType support matrix descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('font fallback stack signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('bounded native horizontal unwarped solid-colour export records');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('support-matrix UI summaries');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('find/replace readiness operations');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('native PSD text subset warning states');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('font fallback persistence descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('font fallback/persistence notes');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('font discovery/fallback metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('standard font stack catalog');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('visible OpenType feature toggles');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('style preset portability descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('retained text find/replace planning');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('pure replacement helpers');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('spellcheck/readability planning descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('typography parity-progress descriptor');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('live-edit readiness checks');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('native PSD text caveats');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('serialized paragraph style controls including vertical orientation');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('8-Mpixel raster gate');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.signalLoom).toContain('kinsoku, tate-chu-yoko');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'typography-workflows')?.parityEstimate).toBeGreaterThanOrEqual(69);
  });

  it('tracks direct on-canvas selection skew/distort progress without claiming the remaining selection gaps', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'selection-tools')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('direct on-canvas rotation handle'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'selection-tools')?.signalLoom).toContain('numeric rotation preview/apply-cancel');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'selection-tools')?.signalLoom).toContain('Move-tool drag handoff from active selection masks');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'selection-tools')?.signalLoom).toContain('direct on-canvas move/resize/skew/distort handles');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'selection-tools')?.signalLoom).toContain('selection transform descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'selection-tools')?.signalLoom).toContain('apply/cancel readiness');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'selection-tools')?.signalLoom).toContain('numeric geometry/pivot signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'selection-tools')?.signalLoom).toContain('skew/distort caveats');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'selection-tools')?.signalLoom).toContain('marching-ants/overlay unsupported states');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'selection-tools')?.signalLoom).toContain('local alpha/luminance foreground object selection');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'selection-tools')?.signalLoom).toContain('direct undoable selection nudging');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'selection-tools')?.signalLoom).toContain('selection nudge quick actions');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'selection-tools')?.signalLoom).toContain('Arrow-key nudging of committed selections');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'selection-tools')?.signalLoom).toContain('AI subject detection');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'selection-tools')?.parityEstimate).toBeGreaterThanOrEqual(80);
  });

  it('tracks Magic Wand anti-aliased selection edges without claiming full Paint Bucket edge parity', () => {
    const row = IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'magic-wand-paint-bucket');

    expect(row).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('workflow descriptors'),
      parityEstimate: expect.any(Number),
    });
    expect(row?.signalLoom).toContain('target channel metadata');
    expect(row?.signalLoom).toContain('opacity controls');
    expect(row?.signalLoom).toContain('fill blend modes');
    expect(row?.signalLoom).toContain('preserve-transparency behavior');
    expect(row?.signalLoom).toContain('stable preview signatures');
    expect(row?.signalLoom).toContain('Magic Wand anti-aliased selection edge alpha');
    expect(row?.signalLoom).toContain('Paint Bucket anti-aliased fill edge quality via a one-pixel neighbor-coverage fringe');
    expect(row?.signalLoom).toContain('gap-close');
    expect(row?.signalLoom).toContain('channel-specific fill');
    expect(row?.signalLoom).not.toContain('explicit unsupported anti-alias');
    expect(row?.signalLoom).not.toContain('Paint Bucket anti-aliased fill edge quality, and richer channel-specific fill behavior remain incomplete');
    expect(row?.parityEstimate).toBeGreaterThanOrEqual(55);
  });

  it('tracks QuickMask and selection-mask overlay descriptors without claiming full refine visualization parity', () => {
    const row = IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'selection-mask-system');

    expect(row).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('QuickMask overlay summaries'),
      parityEstimate: expect.any(Number),
    });
    expect(row?.signalLoom).toContain('selection alpha combine mode formulas');
    expect(row?.signalLoom).toContain('QuickMask edit readiness descriptors');
    expect(row?.signalLoom).toContain('selection-to-layer-mask readiness summaries');
    expect(row?.signalLoom).toContain('saved selections');
    expect(row?.signalLoom).toContain('overlays');
    expect(row?.signalLoom).toContain('animated marching ants for committed active selection outlines');
    expect(row?.signalLoom).toContain('Select and Mask local matte preview controls');
    expect(row?.signalLoom).toContain('enter/exit selection-to-mask and mask-to-selection semantics');
    expect(row?.signalLoom).toContain('brush-route blocker metadata');
    expect(row?.signalLoom).toContain('stable QuickMask edit signatures');
    expect(row?.signalLoom).toContain('selection-mask overlay alpha summaries');
    expect(row?.signalLoom).toContain('opacity/feather display metadata');
    expect(row?.signalLoom).toContain('selection refine handoff');
    expect(row?.signalLoom).toContain('richer visualization through QuickMask overlays, selection-mask overlays, animated marching ants, and Select and Mask local matte previews');
    expect(row?.signalLoom).not.toContain('richer visualization and brush-based edge refinement remain missing');
    expect(row?.parityEstimate).toBeGreaterThanOrEqual(79);
  });

  it('tracks local object selection as partial without claiming AI subject detection', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'select-subject-object')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('largest connected alpha/luminance foreground component'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'select-subject-object')?.signalLoom).toContain('minimum component area');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'select-subject-object')?.signalLoom).toContain('disconnected-island inclusion');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'select-subject-object')?.signalLoom).toContain('hole fill');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'select-subject-object')?.signalLoom).toContain('selected/rejected component descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'select-subject-object')?.signalLoom).toContain('cleanup metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'select-subject-object')?.signalLoom).toContain('object-selection preview signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'select-subject-object')?.signalLoom).toContain('AI subject detection remains unsupported');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'select-subject-object')?.signalLoom).toContain('selection bounds/foreground scoring');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'select-subject-object')?.signalLoom).toContain('handoff metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'select-subject-object')?.signalLoom).toContain('Local object selection handoff metadata targets Select');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'select-subject-object')?.signalLoom).toContain('Mask for edge refinement');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'select-subject-object')?.signalLoom).toContain('component diagnostics');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'select-subject-object')?.signalLoom).toContain('output routing handoff');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'select-subject-object')?.signalLoom).toContain('Subject/object selection with cloud/local fallbacks now has fallback-route descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'select-subject-object')?.signalLoom).toContain('image-object-selection-fallback-routes:v1');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'select-subject-object')?.parityEstimate).toBeGreaterThanOrEqual(31);
  });

  it('tracks Select and Mask planning descriptors and mounted refinement workspace controls', () => {
    const row = IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'select-mask-workspace');

    expect(row).toMatchObject({
      status: 'done',
      signalLoom: expect.stringContaining('planning descriptors'),
      parityEstimate: expect.any(Number),
    });
    expect(row?.signalLoom).toContain('brush-refinement signatures');
    expect(row?.signalLoom).toContain('output target summaries');
    expect(row?.signalLoom).toContain('describeSelectAndMaskPreviewModeCoverage');
    expect(row?.signalLoom).toContain('richer edge-visualization modes through local matte previews');
    expect(row?.signalLoom).toContain('refine-edge unsupported caveat');
    expect(row?.signalLoom).toContain('radius/decontaminate warnings');
    expect(row?.signalLoom).toContain('mounted Channels-panel Select & Mask workspace UI');
    expect(row?.signalLoom).toContain('Smart Radius controls');
    expect(row?.signalLoom).toContain('Decontaminate Colors controls');
    expect(row?.signalLoom).toContain('store-backed settings persistence');
    expect(row?.signalLoom).not.toContain('dedicated refine workspace UI and radius/decontaminate controls remain missing');
    expect(row?.parityEstimate).toBe(100);
  });

  it('tracks layer search/filtering and color labels as layer-stack parity progress', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-stack')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('search/filtering'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-stack')?.signalLoom).toContain('color labels');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-stack')?.signalLoom).toContain('basic layer groups/folders');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-stack')?.signalLoom).toContain('group inheritance summaries');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-stack')?.signalLoom).toContain('organization descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-stack')?.signalLoom).toContain('lock workflow descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-stack')?.signalLoom).toContain('link workflow descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-stack')?.signalLoom).toContain('selected-layer property descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-stack')?.signalLoom).toContain('lock batch planning descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-stack')?.signalLoom).toContain('link batch planning descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-stack')?.signalLoom).toContain('same-width organization summaries');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-stack')?.signalLoom).toContain('selected-group boundary summaries');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-stack')?.signalLoom).toContain('group hierarchy readiness descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-stack')?.signalLoom).toContain('tree warning codes');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-stack')?.signalLoom).toContain('inherited-lock caveats');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-stack')?.parityEstimate).toBeGreaterThanOrEqual(72);
  });

  it('tracks layer-mask operation planning without claiming full refine/copy-link parity', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-masks')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('Reveal/hide/from selection/invert/apply/delete'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-masks')?.signalLoom).toContain('mask operation descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-masks')?.signalLoom).toContain('explicit reveal/hide/from-selection readiness paths');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-masks')?.signalLoom).toContain('selection blocker summaries');
    expectOneExactPhrase(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-masks')?.signalLoom, [
      'layer-mask readiness descriptors',
      'layer-mask readiness signatures',
    ]);
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-masks')?.signalLoom).toContain('copy/link workflow warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-masks')?.signalLoom).toContain('layer-mask operation signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-masks')?.signalLoom).toContain('mask-vs-pixel target mismatch warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-masks')?.signalLoom).toContain('copy/link/apply/refine handoff caveats');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-masks')?.signalLoom).toContain('richer preview modes through typed preview-mode descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-masks')?.signalLoom).toContain('refine workspace');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-masks')?.signalLoom).not.toContain('richer preview modes remain incomplete');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-masks')?.parityEstimate).toBeGreaterThanOrEqual(68);
  });

  it('tracks one-level layer groups as partial progress without claiming full group parity', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-groups')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('Basic one-level group/folder layers'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-groups')?.signalLoom).toContain('nested groups');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-groups')?.signalLoom).toContain('deterministic nested group tree normalization');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-groups')?.signalLoom).toContain('group hierarchy readiness descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-groups')?.signalLoom).toContain('readiness signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-groups')?.signalLoom).toContain('batch-operation blocker metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-groups')?.signalLoom).toContain('organization boundary summaries for bounded multi-select');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-groups')?.signalLoom).toContain('group planning descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-groups')?.signalLoom).toContain('pass-through/group-mask warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-groups')?.signalLoom).toContain('group preview signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-groups')?.signalLoom).toContain('grouped stack descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-groups')?.signalLoom).toContain('bounds');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-groups')?.parityEstimate).toBeGreaterThanOrEqual(48);
  });

  it('tracks linked layer movement groups as layer-stack parity progress', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-stack')?.signalLoom).toContain('linked movement groups');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-stack')?.signalLoom).toContain('full multi-select linked-transform semantics remain incomplete');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-stack')?.parityEstimate).toBeGreaterThanOrEqual(62);
  });

  it('tracks move-tool workflow descriptors with runtime snapping but without claiming distribution parity', () => {
    const row = IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'move-tool');

    expect(row).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('move workflow descriptors'),
      parityEstimate: expect.any(Number),
    });
    expect(row?.signalLoom).toContain('link/lock movement planning');
    expect(row?.signalLoom).toContain('nudge');
    expect(row?.signalLoom).toContain('canvas-align');
    expect(row?.signalLoom).toContain('Move-tool selection drag handoff from active selection masks');
    expect(row?.signalLoom).toContain('deterministic snapping/distribution planning helpers');
    expect(row?.signalLoom).toContain('snap guide/candidate summaries');
    expect(row?.signalLoom).toContain('runtime document/layer edge and center snapping');
    expect(row?.signalLoom).toContain('snapped-delta helpers used by runtime dragging');
    expect(row?.signalLoom).toContain('snapping');
    expect(row?.signalLoom).toContain('distribution');
    expect(row?.parityEstimate).toBeGreaterThanOrEqual(42);
  });

  it('tracks selection-mode and marquee/lasso workflow descriptors with truthful magnetic runtime boundaries', () => {
    const marquee = IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'marquee');
    const lasso = IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'lasso');

    expect(marquee).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('marquee workflow descriptors'),
      parityEstimate: expect.any(Number),
    });
    expect(marquee?.signalLoom).toContain('selection-mode semantics');
    expect(marquee?.signalLoom).toContain('preview signatures');
    expect(marquee?.signalLoom).toContain('runtime feathered selection masks');
    expect(marquee?.signalLoom).toContain('feathering through runtime feathered selection masks');
    expect(marquee?.signalLoom).toContain('transform through shared Transform Selection handoff');
    expect(marquee?.signalLoom).toContain('describeMarqueeSelectionGeometry');
    expect(marquee?.signalLoom).toContain('zero-area invalid metadata');
    expect(marquee?.signalLoom).toContain('invalid marquee geometry blockers');
    expect(marquee?.signalLoom).toContain('zero-area marquee drags cancel');
    expect(marquee?.parityEstimate).toBeGreaterThanOrEqual(62);

    expect(lasso).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('lasso workflow descriptors'),
      parityEstimate: expect.any(Number),
    });
    expect(lasso?.signalLoom).toContain('open polygonal preview');
    expect(lasso?.signalLoom).toContain('freehand smoothing limitations');
    expect(lasso?.signalLoom).toContain('composite-derived Sobel edge field');
    expect(lasso?.signalLoom).toContain('snap radius');
    expect(lasso?.signalLoom).toContain('falls back to freehand');
    expect(lasso?.signalLoom).toContain('commit vs cursor-preview geometry');
    expect(lasso?.signalLoom).toContain('bounds, area, path length');
    expect(lasso?.signalLoom).toContain('invalid lasso path blockers');
    expect(lasso?.signalLoom).toContain('underspecified freehand lasso strokes cancel');
    expect(lasso?.signalLoom).toContain('refinement workflows remain missing');
    expect(lasso?.signalLoom).not.toContain('true image-edge magnetic snapping');
    expect(lasso?.parityEstimate).toBeGreaterThanOrEqual(57);

    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'selection-tools')?.signalLoom)
      .toContain('composite-derived Sobel magnetic lasso snapping');
  });

  it('tracks clipping masks as implemented-but-incomplete layer-stack progress', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-stack')?.signalLoom).toContain('clipping masks');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-stack')?.signalLoom).toContain('pixel/position lock variants');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-stack')?.signalLoom).not.toContain('lock variants, linked-layer');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clipping-masks')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('pixel clipping, adjustment clipping'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clipping-masks')?.signalLoom).toContain('group-base alpha clipping');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clipping-masks')?.signalLoom).toContain('batch create/release controls');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clipping-masks')?.signalLoom).toContain('typed clipping-chain readiness metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clipping-masks')?.signalLoom).toContain('chainValidation descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clipping-masks')?.signalLoom).toContain('grouped clipping-chain depth');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clipping-masks')?.signalLoom).toContain('sourceSafety descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clipping-masks')?.signalLoom).toContain('source-linked safety summaries');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clipping-masks')?.signalLoom).toContain('image-clipping-mask-readiness');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clipping-masks')?.signalLoom).not.toContain('source-linked destructive safety blockers');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clipping-masks')?.signalLoom).not.toContain('group clipping, nested groups');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clipping-masks')?.signalLoom).not.toContain('richer batch controls remain incomplete');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clipping-masks')?.parityEstimate).toBeGreaterThanOrEqual(48);
  });

  it('tracks the new History panel without overstating missing actions and batch automation', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'history-actions')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('History panel with clickable state navigation'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'history-actions')?.signalLoom).toContain('named snapshot controls');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'history-actions')?.signalLoom).toContain('named states, snapshots');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'history-actions')?.signalLoom).toContain('snapshot rename controls');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'history-actions')?.signalLoom).toContain('persisted quick-action recording/playback');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'history-actions')?.signalLoom).toContain('batch playback across currently open Image documents now exist');
    expectOneExactPhrase(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'history-actions')?.signalLoom, [
      'buildImageSnapshotReadinessDescriptor diagnostics',
      'history/action workflow descriptors',
    ]);
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'history-actions')?.signalLoom).toContain('snapshot identity summaries');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'history-actions')?.signalLoom).toContain('per-document playback diagnostics');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'history-actions')?.signalLoom).toContain('macroRunIdentity');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'history-actions')?.signalLoom).toContain('stepExecutionLog');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'history-actions')?.signalLoom).toContain('importValidation descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'history-actions')?.signalLoom).toContain('fixed-command limitations');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'history-actions')?.signalLoom).toContain('full arbitrary command recording');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'history-actions')?.signalLoom).toContain('unattended file/folder batch processing remain missing');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'history-actions')?.parityEstimate).toBeGreaterThanOrEqual(73);
  });

  it('tracks file/folder queue planning as partial batch-processor progress without claiming unattended file batches', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'actions-batch-processor')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('dry-run file/folder queue planning'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'actions-batch-processor')?.signalLoom).toContain('import/exportable action-set manifests');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'actions-batch-processor')?.signalLoom).toContain('queueIdentity metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'actions-batch-processor')?.signalLoom).toContain('queueDiagnostics per-item records');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'actions-batch-processor')?.signalLoom).toContain('dry-run executionLog entries');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'actions-batch-processor')?.signalLoom).toContain('stepExecutionLog');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'actions-batch-processor')?.signalLoom).toContain('referenced-id validation');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'actions-batch-processor')?.signalLoom).toContain('per-item audit logs');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'actions-batch-processor')?.signalLoom).toContain('batch queue audit summaries');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'actions-batch-processor')?.signalLoom).toContain('unavailable command warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'actions-batch-processor')?.signalLoom).toContain('macro descriptor normalization');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'actions-batch-processor')?.signalLoom).toContain('schema-versioned macro import/export');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'actions-batch-processor')?.signalLoom).toContain('saved quick-action macro management');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'actions-batch-processor')?.signalLoom).toContain('batch actions across currently open Image documents');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'actions-batch-processor')?.signalLoom).toContain('queue readiness');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'actions-batch-processor')?.signalLoom).toContain('retry/error policy');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'actions-batch-processor')?.signalLoom).toContain('output naming collision policy');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'actions-batch-processor')?.signalLoom).toContain('Image Automation handoff readiness');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'actions-batch-processor')?.signalLoom).toContain('preview IDs/signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'actions-batch-processor')?.signalLoom).toContain('actual unattended native execution');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'actions-batch-processor')?.signalLoom).toContain('real filesystem execution logs remain incomplete');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'actions-batch-processor')?.parityEstimate).toBeGreaterThanOrEqual(64);
  });

  it('tracks the bounded local liquify helper and mounted Liquify workspace panel', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'liquify')).toMatchObject({
      status: 'done',
      signalLoom: expect.stringContaining('deterministic local push, twirl, pucker, and bloat'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'liquify')?.signalLoom).toContain('session/control descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'liquify')?.signalLoom).toContain('brush preview metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'liquify')?.signalLoom).toContain('falloff');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'liquify')?.signalLoom).toContain('freeze/thaw masks');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'liquify')?.signalLoom).toContain('tool support matrix');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'liquify')?.signalLoom).toContain('freeze/thaw summaries');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'liquify')?.signalLoom).toContain('falloff limitation metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'liquify')?.signalLoom).toContain('smart-object unsupported warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'liquify')?.signalLoom).toContain('face-aware');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'liquify')?.signalLoom).toContain('reconstruct');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'liquify')?.signalLoom).toContain('smooth');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'liquify')?.signalLoom).toContain('non-destructive mesh');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'liquify')?.signalLoom).toContain('source preservation descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'liquify')?.signalLoom).toContain('descriptor-only on-canvas readiness');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'liquify')?.signalLoom).toContain('buildLiquifyWorkspaceUiDescriptor descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'liquify')?.signalLoom).toContain('mounted Liquify Workspace panel UI');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'liquify')?.signalLoom).toContain('preview/apply/cancel commands');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'liquify')?.signalLoom).toContain('history-backed bitmap apply');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'liquify')?.signalLoom).not.toContain('no full Liquify workspace UI exists yet');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'liquify')?.parityEstimate).toBe(100);
  });

  it('tracks the executable bounded Puppet mesh without claiming weighted or smart-object parity', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'puppet-warp-advanced-warp')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('retained on-canvas Puppet mesh'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'puppet-warp-advanced-warp')?.signalLoom).toContain('draggable 4×4 cage');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'puppet-warp-advanced-warp')?.signalLoom).toContain('Apply/Cancel');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'puppet-warp-advanced-warp')?.signalLoom).toContain('one-step undo/redo');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'puppet-warp-advanced-warp')?.signalLoom).toContain('single-plane grid');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'puppet-warp-advanced-warp')?.signalLoom).toContain('native smart-object deformation');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'puppet-warp-advanced-warp')?.parityEstimate).toBeGreaterThanOrEqual(62);
  });

  it('derives lightweight workflow badges without changing bitmap state', () => {
    const layer = {
      id: 'layer-1',
      name: 'Generated panel',
      type: 'text',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      x: 0,
      y: 0,
      bitmap: null,
      bitmapVersion: 4,
      mask: null,
      metadata: {
        smartLinkedSourceId: 'source-1',
        sourceLabel: 'Panel A',
      },
    } satisfies ImageLayer;

    expect(getImageLayerWorkflowBadges(layer).map((badge) => badge.label)).toEqual(['TXT', 'SRC']);
    expect(layer.bitmapVersion).toBe(4);
  });

  it('tracks bounded multi-stop gradient progress without claiming full gradient editor parity', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'gradients')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('Linear, radial, angle/conical, reflected, and diamond gradients now exist'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'gradients')?.signalLoom).toContain('foreground-to-background');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'gradients')?.signalLoom).toContain('foreground-to-transparent');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'gradients')?.signalLoom).toContain('custom multi-stop gradients');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'gradients')?.signalLoom).toContain('deterministic gradient parity descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'gradients')?.signalLoom).toContain('alpha stop handling');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'gradients')?.signalLoom).toContain('portable preset metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'gradients')?.signalLoom).toContain('standard preset library');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'gradients')?.signalLoom).toContain('add/remove/offset stop editing');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'gradients')?.signalLoom).toContain('per-stop opacity controls');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'gradients')?.signalLoom).toContain('deterministic ordered dithering');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'gradients')?.signalLoom).toContain('gradient readiness descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'gradients')?.signalLoom).toContain('editable-native-gradient-layer/mesh/noise/gradient-map unsupported warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'gradients')?.signalLoom).toContain('export flattening caveats');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'gradients')?.signalLoom).not.toContain('conical unsupported warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'gradients')?.signalLoom).not.toContain('angle gradients, richer');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'gradients')?.signalLoom).not.toContain('preset libraries');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'gradients')?.signalLoom).not.toContain('transparency-stop editing');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'gradients')?.signalLoom).not.toContain('dithering remain missing');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'gradients')?.parityEstimate).toBeGreaterThanOrEqual(63);
  });

  it('tracks global light and preset helper progress for layer styles without claiming bevel parity', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('inner shadow'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('renderer output');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('global light angle synchronization');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('style preset helpers');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('inner glow');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('satin');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('pattern overlay');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('gradient overlay');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('pattern selector');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('inner-glow size controls');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('gradient overlay start/end colors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('capability catalog');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('capability-group descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('supported-effect catalog metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('describeLayerEffectUnsupportedStateDescriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('describeImageLayerStyleSignatureSet');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('style-set signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('preview-risk signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('export-risk signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('compact Layer Effects readiness summary attributes');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('structured blockers');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('unsupported-state tags');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('preview IDs/signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('global-light participation metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('unsupported-effect warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('style portability descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('per-effect export caveats');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('style clipboard suitability checks');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('global-light portability carry-through');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('preset portability metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('flattened export rasterization warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('Blend If');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('native PSD live effect fidelity unsupported state');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('Smart Object effect preservation unsupported state');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).toContain('bevel/emboss');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.signalLoom).not.toContain('satin and pattern overlay remain missing');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-styles')?.parityEstimate).toBeGreaterThanOrEqual(75);
  });

  it('tracks filter stack descriptors without claiming full smart-filter parity', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-filters')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('non-destructive stack ordering'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-filters')?.signalLoom).toContain('filter stack descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-filters')?.signalLoom).toContain('filter stack interop planning');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-filters')?.signalLoom).toContain('blend/opacity/mask controls');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-filters')?.signalLoom).toContain('blend/order signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-filters')?.signalLoom).toContain('parameter caveats');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-filters')?.signalLoom).toContain('owned per-filter alpha masks');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-filters')?.signalLoom).toContain('filter-family gap descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-filters')?.signalLoom).toContain('preview/control readiness');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-filters')?.signalLoom).toContain('preset portability status');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-filters')?.signalLoom).toContain('flattened export warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-filters')?.signalLoom).toContain('preset serialization');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-filters')?.signalLoom).toContain('per-filter alpha masks');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'layer-filters')?.parityEstimate).toBeGreaterThanOrEqual(52);
  });

  it('tracks RGB, alpha, and panel-backed spot-channel metadata without claiming native separation parity', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('active RGB/Red/Green/Blue channel target'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels')?.signalLoom).toContain('brush/eraser routing');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels')?.signalLoom).toContain('RGB channel target summaries');
    expectOneExactPhrase(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels')?.signalLoom, [
      'channel readiness descriptors',
      'direct RGB edit readiness metadata',
    ]);
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels')?.signalLoom).toContain('alpha save/load action summaries');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels')?.signalLoom).toContain('selection-channel round-trip descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels')?.signalLoom).toContain('invalid-mask and size-mismatch blockers');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels')?.signalLoom).toContain('direct RGB edit readiness metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels')?.signalLoom).toContain('channel preview/readiness signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels')?.signalLoom).toContain('direct alpha painting unsupported');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels')?.signalLoom).toContain('persisted spot-channel metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels')?.signalLoom).toContain('spot-channel preview/readiness signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels')?.signalLoom).toContain('spot-channel RGB-tint preview metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels')?.signalLoom).toContain('RGB component channel editing through brush/eraser routing');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels')?.signalLoom).toContain('direct spot-channel painting');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels')?.signalLoom).not.toContain('spot channels and deeper per-channel operations remain missing');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels')?.parityEstimate).toBeGreaterThanOrEqual(59);

    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels-panel-alpha')?.signalLoom).toContain('RGB channel target controls');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels-panel-alpha')?.signalLoom).toContain('channel readiness descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels-panel-alpha')?.signalLoom).toContain('selection-channel round-trip descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels-panel-alpha')?.signalLoom).toContain('channel row/action descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels-panel-alpha')?.signalLoom).toContain('load-selection action metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels-panel-alpha')?.signalLoom).toContain('selection save/load caveats');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels-panel-alpha')?.signalLoom).toContain('panel-backed spot-channel section');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels-panel-alpha')?.signalLoom).toContain('spot-channel create/rename/delete');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels-panel-alpha')?.signalLoom).toContain('tint/opacity/solidity/visibility controls');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels-panel-alpha')?.signalLoom).toContain('spot-channel workflow descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels-panel-alpha')?.signalLoom).toContain('spot-channel readiness descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels-panel-alpha')?.signalLoom).toContain('RGB-tint preview metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels-panel-alpha')?.signalLoom).toContain('alpha/spot panel descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels-panel-alpha')?.signalLoom).toContain('panel summary lines');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels-panel-alpha')?.signalLoom).toContain('size-mismatch blockers');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels-panel-alpha')?.signalLoom).toContain('direct spot-channel painting support status');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels-panel-alpha')?.signalLoom).toContain('print separation limits');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels-panel-alpha')?.parityEstimate).toBeGreaterThanOrEqual(61);
  });

  it('tracks workspace launch and transparent-icon descriptors without claiming full package identity', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'workspace-launch-icons')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('workspace tab PNGs'),
      parityEstimate: expect.any(Number),
    });
    expectOneExactPhrase(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'workspace-launch-icons')?.signalLoom, [
      'workspace app launch descriptors',
      'workspace launch/icon readiness summaries',
    ]);
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'workspace-launch-icons')?.signalLoom).toContain('icon readiness descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'workspace-launch-icons')?.signalLoom).toContain('desktop workspace launch readiness descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'workspace-launch-icons')?.signalLoom).toContain('Windows/macOS/Linux packaging readiness');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'workspace-launch-icons')?.signalLoom).toContain('Distinct app launch identity with clean transparent icons');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'workspace-launch-icons')?.parityEstimate).toBeGreaterThanOrEqual(42);
  });

  it('tracks bounded spot-channel metadata helpers without claiming spot paint or print separation parity', () => {
    const row = IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'channels-panel-alpha');

    expect(row).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('spot-channel metadata helpers'),
      parityEstimate: expect.any(Number),
    });
    expect(row?.signalLoom).toContain('channel manifest descriptors');
    expect(row?.signalLoom).toContain('tint-preview serialization');
    expect(row?.signalLoom).toContain('selection-channel planning summaries');
    expect(row?.signalLoom).toContain('spot-channel workflow descriptors');
    expect(row?.signalLoom).toContain('print separation limits');
    expect(row?.signalLoom).toContain('direct spot-channel painting');
    expect(row?.signalLoom).toContain('print separations remain missing');
    expect(row?.parityEstimate).toBeGreaterThanOrEqual(45);
  });

  it('tracks blend-mode capability descriptors without claiming Blend If parity', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'blend-modes')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('Sixteen blend modes'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'blend-modes')?.signalLoom).toContain('capability descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'blend-modes')?.signalLoom).toContain('deterministic preview/export parity signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'blend-modes')?.signalLoom).toContain('Fill Opacity unsupported state');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'blend-modes')?.signalLoom).toContain('channel targeting unsupported state');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'blend-modes')?.signalLoom).toContain('blend portability checks');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'blend-modes')?.signalLoom).toContain('stable signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'blend-modes')?.signalLoom).toContain('preview-risk signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'blend-modes')?.signalLoom).toContain('export-risk signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'blend-modes')?.signalLoom).toContain('Blend If');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'blend-modes')?.parityEstimate).toBeGreaterThanOrEqual(70);
  });

  it('tracks retouch sample source progress without claiming clone-source transform or patch parity', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clone-heal-retouch')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('current-and-below'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clone-heal-retouch')?.signalLoom).toContain('all-layers sampling');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clone-heal-retouch')?.signalLoom).toContain('blur/sharpen now use current-layer/current-and-below/all-layers stroke snapshots');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clone-heal-retouch')?.signalLoom).toContain('aligned versus restart-source strokes');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clone-heal-retouch')?.signalLoom).toContain('clone-source overlay planning');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clone-heal-retouch')?.signalLoom).toContain('spot-heal patch sampling plans');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clone-heal-retouch')?.signalLoom).toContain('healing brush');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clone-heal-retouch')?.signalLoom).toContain('retouch brush planning metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clone-heal-retouch')?.signalLoom).toContain('stable capability descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clone-heal-retouch')?.signalLoom).toContain('clone workflow descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clone-heal-retouch')?.signalLoom).toContain('sample readiness');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clone-heal-retouch')?.signalLoom).toContain('sample-source-required blockers');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clone-heal-retouch')?.signalLoom).toContain('preview IDs/signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clone-heal-retouch')?.signalLoom).toContain('active-layer destructive output caveats');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clone-heal-retouch')?.signalLoom).toContain('bounded smudge current-and-below/all-layers live composite resampling');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clone-heal-retouch')?.signalLoom).toContain('tone-range targeting');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clone-heal-retouch')?.signalLoom).toContain('protect-tones controls');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clone-heal-retouch')?.signalLoom).toContain('Sponge vibrance');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clone-heal-retouch')?.signalLoom).toContain('source overlay/transform');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clone-heal-retouch')?.signalLoom).toContain('describeRetouchParityChecks');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clone-heal-retouch')?.signalLoom).toContain('non-destructive output planning');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clone-heal-retouch')?.signalLoom).toContain('patch/remove/new-layer caveats');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'clone-heal-retouch')?.parityEstimate).toBeGreaterThanOrEqual(70);
  });

  it('tracks blur and sharpen composite sample-source support without overstating smudge parity', () => {
    const row = IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'blur-sharpen-smudge');

    expect(row).toMatchObject({
      status: 'partial',
      parityEstimate: expect.any(Number),
    });
    expect(row?.signalLoom).toContain('blur and sharpen now support current-layer, current-and-below, and all-layers stroke snapshots');
    expect(row?.signalLoom).toContain('live brush strokes');
    expect(row?.signalLoom).toContain('smudge keeps previous-point current-layer sampling');
    expect(row?.signalLoom).toContain('smudge with strength');
    expect(row?.signalLoom).toContain('sample controls');
    expect(row?.signalLoom).toContain('smudge composite sampling');
    expect(row?.signalLoom).toContain('bounded smudge composite sampling descriptors');
    expect(row?.signalLoom).not.toContain('smudge composite blockers');
    expect(row?.signalLoom).toContain('shared finishing readiness signatures');
    expect(row?.signalLoom).toContain('bounded live composite resampling');
    expect(row?.signalLoom).not.toContain('live smudge composite resampling');
    expect(row?.signalLoom).toContain('deeper dynamics remain missing');
    expect(row?.parityEstimate).toBeGreaterThanOrEqual(52);
  });

  it('tracks completed dodge burn and sponge brush parity with non-destructive retouch output', () => {
    const row = IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'dodge-burn-sponge');
    expect(row).toMatchObject({
      status: 'done',
      parityEstimate: expect.any(Number),
    });
    expect(row?.signalLoom).toContain('protect-tones scaling');
    expect(row?.signalLoom).toContain('vibrance-weighted saturation response');
    expect(row?.signalLoom).toContain('optional luminance preservation');
    expect(row?.signalLoom).toContain('bounded rate controls');
    expect(row?.signalLoom).toContain('Range-aware tonal');
    expect(row?.signalLoom).toContain('saturation brushes with protect-tones');
    expect(row?.signalLoom).toContain('exposure/rate controls');
    expect(row?.signalLoom).toContain('airbrush metadata');
    expect(row?.signalLoom).toContain('non-destructive retouch output now exists');
    expect(row?.signalLoom).toContain('New Retouch Layer output mode');
    expect(row?.signalLoom).toContain('source-layer preservation');
    expect(row?.signalLoom).toContain('generated retouch layer metadata');
    expect(row?.signalLoom).toContain('undoable layerOp commits');
    expect(row?.signalLoom).toContain('Retouch output mode controls');
    expect(row?.signalLoom).not.toContain('non-destructive retouch output remains missing');
    expect(row?.parityEstimate).toBe(100);
  });

  it('tracks local content-aware fill/remove/patch progress without claiming Photoshop AI parity', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('deterministic local content-aware fill'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')?.signalLoom).toContain('active selection or transparent blemish pixels');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')?.signalLoom).toContain('not Photoshop AI generative fill');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')?.signalLoom).toContain('quick-action capability metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')?.signalLoom).toContain('patch descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')?.signalLoom).toContain('source pixel summaries');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')?.signalLoom).toContain('radius rings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')?.signalLoom).toContain('candidate counts');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')?.signalLoom).toContain('nearest source distance');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')?.signalLoom).toContain('usable source ratio');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')?.signalLoom).toContain('repair operation descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')?.signalLoom).toContain('selection vs transparent target policy');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')?.signalLoom).toContain('sampling-area policy descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')?.signalLoom).toContain('sampling-area descriptors stay metadata-only');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')?.signalLoom).toContain('patch-source support status');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')?.signalLoom).toContain('output-to-new-layer unsupported');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')?.signalLoom).toContain('active-layer-only output warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')?.signalLoom).toContain('selection mask size validation');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')?.signalLoom).toContain('quick-action compatibility descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')?.signalLoom).toContain('automation dry-run blocking');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')?.signalLoom).toContain('local-vs-AI limitation warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')?.signalLoom).toContain('no native Photoshop AI path is wired yet');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')?.signalLoom).toContain('preview IDs/signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')?.signalLoom).toContain('sampling-area preview');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'content-aware-fill-remove-patch')?.parityEstimate).toBeGreaterThanOrEqual(54);
  });

  it('tracks proof setup metadata without claiming ICC or true CMYK conversion parity', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('CMYK soft-proof intent metadata'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')?.signalLoom).toContain('true ICC conversion');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')?.signalLoom).toContain('ICC profiles are represented');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')?.signalLoom).toContain('proof setup');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')?.signalLoom).toContain('output intents');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')?.signalLoom).toContain('color conversion warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')?.signalLoom).toContain('operation-limit policies');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')?.signalLoom).toContain('proof/workflow descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')?.signalLoom).toContain('color-mode planning descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')?.signalLoom).toContain('color-proof planning descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')?.signalLoom).toContain('color-mode readiness descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')?.signalLoom).toContain('read-only proof preview states');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')?.signalLoom).toContain('metadata-only ICC/profile behavior');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')?.signalLoom).toContain('print/export implication summaries');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')?.signalLoom).toContain('source bit-depth export metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')?.signalLoom).toContain('gamut-warning');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')?.signalLoom).toContain('ICC limitations');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')?.signalLoom).toContain('operationCaveats');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')?.signalLoom).toContain('coded unsupportedStates');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')?.signalLoom).toContain('separation readiness metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')?.signalLoom).toContain('describeImageColorProofHighBitImplications');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')?.signalLoom).toContain('high-bit proof/export limits');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')?.signalLoom).toContain('external proofing fallbacks');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')?.signalLoom).toContain('press-ready separations unsupported');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'color-management')?.parityEstimate).toBeGreaterThanOrEqual(52);

    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'cmyk-lab-grayscale')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('grayscale and CMYK soft-proof metadata'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'cmyk-lab-grayscale')?.signalLoom).toContain('RGB-centric rendering with grayscale and CMYK proof/status metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'cmyk-lab-grayscale')?.signalLoom).toContain('color-mode conversion planning descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'cmyk-lab-grayscale')?.signalLoom).toContain('per-mode operation-limit policies');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'cmyk-lab-grayscale')?.signalLoom).toContain('operation limits through per-mode operation-limit policies');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'cmyk-lab-grayscale')?.signalLoom).toContain('operation policies');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'cmyk-lab-grayscale')?.signalLoom).toContain('indexed preview limits');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'cmyk-lab-grayscale')?.signalLoom).toContain('color-mode readiness descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'cmyk-lab-grayscale')?.signalLoom).toContain('read-only preview states');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'cmyk-lab-grayscale')?.signalLoom).toContain('proof/workflow descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'cmyk-lab-grayscale')?.signalLoom).toContain('conversion/flattening limits');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'cmyk-lab-grayscale')?.signalLoom).toContain('precision notes');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'cmyk-lab-grayscale')?.signalLoom).toContain('Lab');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'cmyk-lab-grayscale')?.signalLoom).toContain('black-generation');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'cmyk-lab-grayscale')?.signalLoom).toContain('TAC');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'cmyk-lab-grayscale')?.parityEstimate).toBeGreaterThanOrEqual(42);
  });

  it('tracks image and canvas resize planning without claiming high-bit preservation', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'document-canvas-size')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('deterministic resize planning descriptors'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'document-canvas-size')?.signalLoom).toContain('Image size controls');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'document-canvas-size')?.signalLoom).toContain('resampling through resample method planning');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'document-canvas-size')?.signalLoom).toContain('print DPI');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'document-canvas-size')?.signalLoom).toContain('document-level universal upscale readiness descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'document-canvas-size')?.signalLoom).toContain('target/print-resolution upscale policy');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'document-canvas-size')?.signalLoom).toContain('upscale route signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'document-canvas-size')?.signalLoom).toContain('transparent expansion');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'document-canvas-size')?.signalLoom).toContain('resize preview descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'document-canvas-size')?.signalLoom).toContain('stable preview signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'document-canvas-size')?.signalLoom).toContain('anchor offset descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'document-canvas-size')?.signalLoom).toContain('unsupported high-bit-depth preservation warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'document-canvas-size')?.parityEstimate).toBeGreaterThanOrEqual(57);
  });

  it('tracks the bounded native high-bit route without claiming arbitrary Photoshop parity', () => {
    const item = IMAGE_PHOTOSHOP_PARITY_ITEMS.find((candidate) => candidate.id === 'bit-depth-workflow');
    expect(item).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('bounded native RGB high-bit route'),
      parityEstimate: 68,
    });
    expect(item?.signalLoom).toContain('PNG16, TIFF16, TIFF32f');
    expect(item?.signalLoom).toContain('u16 or f32 per-layer pixel authority');
    expect(item?.signalLoom).toContain('derived 8-bit display proxy');
    expect(item?.signalLoom).toContain('sixteen admitted blend modes');
    expect(item?.signalLoom).toContain('bit-exact .slimg persistence');
    expect(item?.signalLoom).toContain('refuse instead of silently downsampling');
    expect(item?.signalLoom).not.toContain('true high-bit document storage, edits, filters, and export remain missing');
  });

  it('tracks Camera Raw detection and explicit unsupported flow without claiming RAW development', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'camera-raw')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('Camera Raw extensions'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'camera-raw')?.signalLoom).toContain('demosaic');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'camera-raw')?.signalLoom).toContain('external RAW');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'camera-raw')?.signalLoom).toContain('no in-app RAW demosaic');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'camera-raw')?.signalLoom).toContain('format-policy descriptions');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'camera-raw')?.signalLoom).toContain('source policy signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'camera-raw')?.signalLoom).toContain('describeCameraRawOpenPolicy');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'camera-raw')?.signalLoom).toContain('develop-first/open-as-pixels policy');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'camera-raw')?.signalLoom).toContain('fallback routes');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'camera-raw')?.signalLoom).toContain('unsupported RAW states');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'camera-raw')?.signalLoom).toContain('Raw development entry point or clear unsupported file flow');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'camera-raw')?.signalLoom).toContain('handoff-required readiness');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'camera-raw')?.signalLoom).toContain('round-trip caveats');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'camera-raw')?.parityEstimate).toBeGreaterThanOrEqual(34);
  });

  it('tracks file interop descriptors without claiming native PSD or XCF round-trip completion', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'smart-source-linked-layers')?.signalLoom).toContain('source-linked/smart-object round-trip strategy descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'smart-source-linked-layers')?.signalLoom).toContain('Smart Filter metadata-only caveat descriptors');

    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'file-interop')?.signalLoom).toContain('XCF import/export policy warning descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'file-interop')?.signalLoom).toContain('source-format policy warning descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'file-interop')?.signalLoom).toContain('native groups through PSD group folder export/import');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'file-interop')?.signalLoom).toContain('native PSD Smart Object/editable text/adjustment/effect/mask/filter constructs remain flattened/partial');

    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'psd-roundtrip')?.signalLoom).toContain('deterministic per-layer warning descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'psd-roundtrip')?.signalLoom).toContain('source-linked/smart-object round-trip strategy descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'psd-roundtrip')?.signalLoom).toContain('native editable PSD constructs remain partial');

    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'xcf-interoperability')?.signalLoom).toContain('XCF import/export policy warning descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'xcf-interoperability')?.signalLoom).toContain('bounded XCF layered raster import');
  });

  it('tracks bounded Image-native artboards and print proof metadata without claiming Paper export parity', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'artboards-print-proof')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('artboard'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'artboards-print-proof')?.signalLoom).toContain('Properties');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'artboards-print-proof')?.signalLoom).toContain('print-proof descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'artboards-print-proof')?.signalLoom).toContain('deterministic batch export planning');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'artboards-print-proof')?.signalLoom).toContain('bounded Image print/proof export planning workflow');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'artboards-print-proof')?.signalLoom).toContain('artboard preview descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'artboards-print-proof')?.signalLoom).toContain('printProduction metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'artboards-print-proof')?.signalLoom).toContain('batchPlan descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'artboards-print-proof')?.signalLoom).toContain('per-artboard export filenames');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'artboards-print-proof')?.signalLoom).toContain('print-proof disposition');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'artboards-print-proof')?.signalLoom).toContain('imposition/package warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'artboards-print-proof')?.signalLoom).toContain('Paper owns the stronger print export');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'artboards-print-proof')?.signalLoom).toContain('Paper');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'artboards-print-proof')?.parityEstimate).toBeGreaterThanOrEqual(40);
  });

  it('tracks PSD metadata preservation progress without claiming native PSD Smart Object parity', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'file-interop')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('source-link status/history'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'file-interop')?.signalLoom).toContain('native PSD Smart Object');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'file-interop')?.signalLoom).toContain('format-policy descriptions');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'file-interop')?.signalLoom).toContain('PSD export manifests');
    expectOneExactPhrase(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'file-interop')?.signalLoom, [
      'PSD/XCF native-construct readiness descriptors',
      'format export-readiness helpers',
    ]);
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'file-interop')?.signalLoom).toContain('compact compatibility signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'file-interop')?.signalLoom).toContain('per-layer warning descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'file-interop')?.signalLoom).toContain('source format import-policy metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'file-interop')?.signalLoom).toContain('stable policy signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'file-interop')?.signalLoom).toContain('print/proof export readiness descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'file-interop')?.signalLoom).toContain('XCF extension/MIME/header import-readiness detection');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'file-interop')?.signalLoom).toContain('PNG/TIFF/PSD/source-library fallback route descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'file-interop')?.parityEstimate).toBeGreaterThanOrEqual(50);

    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'smart-source-linked-layers')?.signalLoom).toContain('PSD metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'smart-source-linked-layers')?.signalLoom).toContain('smart/source-linked layer metadata descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'smart-source-linked-layers')?.signalLoom).toContain('relink history');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'smart-source-linked-layers')?.signalLoom).toContain('relink/repair readiness descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'smart-source-linked-layers')?.signalLoom).toContain('edit-original metadata-only status');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'smart-source-linked-layers')?.signalLoom).toContain('replace-contents readiness');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'smart-source-linked-layers')?.signalLoom).toContain('rasterize readiness');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'smart-source-linked-layers')?.signalLoom).toContain('scale preservation');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'smart-source-linked-layers')?.signalLoom).toContain('source snapshot preservation');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'smart-source-linked-layers')?.signalLoom).toContain('smart-filter limitation metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'smart-source-linked-layers')?.signalLoom).toContain('metadata-only PSD Smart Object warning');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'smart-source-linked-layers')?.signalLoom).toContain('missing source-linked refresh blockers');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'smart-source-linked-layers')?.parityEstimate).toBeGreaterThanOrEqual(63);
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'psd-roundtrip')?.signalLoom).toContain('metadata-only warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'psd-roundtrip')?.signalLoom).toContain('PSD native-construct readiness descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'psd-roundtrip')?.signalLoom).toContain('retained metadata summaries');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'psd-roundtrip')?.signalLoom).toContain('fallback route recommendations');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'psd-roundtrip')?.signalLoom).toContain('compatibility descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'psd-roundtrip')?.signalLoom).toContain('stable manifest serialization');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'psd-roundtrip')?.signalLoom).toContain('source-link preview signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'psd-roundtrip')?.signalLoom).toContain('source-link roundtrip summaries');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'psd-roundtrip')?.signalLoom).toContain('source snapshot preservation metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'psd-roundtrip')?.signalLoom).toContain('Smart Filter metadata-only caveat descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'psd-roundtrip')?.parityEstimate).toBeGreaterThanOrEqual(50);
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'xcf-interoperability')?.signalLoom).toContain('bounded XCF layered raster import');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'xcf-interoperability')?.signalLoom).toContain('compatibility descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'xcf-interoperability')?.signalLoom).toContain('source policy signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'xcf-interoperability')?.signalLoom).toContain('native round-trip caveats');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'xcf-interoperability')?.signalLoom).toContain('native XCF edit state is not reconstructed');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'xcf-interoperability')?.signalLoom).toContain('XCF extension/MIME/header detection');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'xcf-interoperability')?.signalLoom).toContain('XCF import compatibility signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'xcf-interoperability')?.signalLoom).toContain('filter-metadata-flattened export warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'xcf-interoperability')?.signalLoom).toContain('detected GIMP 3 non-destructive-effect warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'xcf-interoperability')?.signalLoom).toContain('fallback routes');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'xcf-interoperability')?.signalLoom).toContain('high round-trip risk metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'xcf-interoperability')?.signalLoom).toContain('Not applicable; GIMP-native XCF import/export expectations apply');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'xcf-interoperability')?.parityEstimate).toBeGreaterThanOrEqual(33);
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'export-formats')?.signalLoom).toContain('Broad format import/export with color now exists');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'export-formats')?.signalLoom).toContain('honest format-policy descriptions');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'export-formats')?.signalLoom).toContain('visible export planning metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'export-formats')?.signalLoom).toContain('Export As / Save for Web readiness descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'export-formats')?.signalLoom).toContain('format capability matrix metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'export-formats')?.signalLoom).toContain('export preset readiness');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'export-formats')?.signalLoom).toContain('batch export readiness');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'export-formats')?.signalLoom).toContain('source-bit-depth metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'export-formats')?.signalLoom).toContain('export bit-depth descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'export-formats')?.signalLoom).toContain('source-high-bit-depth downsample warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'export-formats')?.signalLoom).toContain('XCF compatibility metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'export-formats')?.signalLoom).toContain('DPI/PPI checks');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'export-formats')?.signalLoom).toContain('color profile non-embedding');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'export-formats')?.signalLoom).toContain('TIFF/GIF/SVG export policy warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'export-formats')?.signalLoom).toContain('format readiness descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'export-formats')?.signalLoom).toContain('round-trip caveats for TIFF/GIF/SVG');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'export-formats')?.signalLoom).toContain('per-operation print/export warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'export-formats')?.signalLoom).toContain('pressReady export caveats');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'export-formats')?.signalLoom).toContain('unsupported CMYK/spot separations');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'export-formats')?.parityEstimate).toBeGreaterThanOrEqual(70);
  });

  it('tracks standalone save/open workflow descriptors without claiming full native roundtrip parity', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'standalone-quick-edit')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('save/open workflow descriptors'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'standalone-quick-edit')?.signalLoom).toContain('quick-edit');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'standalone-quick-edit')?.signalLoom).toContain('destructive overwrite');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'standalone-quick-edit')?.signalLoom).toContain('source state descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'standalone-quick-edit')?.signalLoom).toContain('save source state signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'standalone-quick-edit')?.signalLoom).toContain('save/export policy signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'standalone-quick-edit')?.signalLoom).toContain('destructive save policy');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'standalone-quick-edit')?.signalLoom).toContain('destructive overwrite safeguard descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'standalone-quick-edit')?.signalLoom).toContain('export-only reasons');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'standalone-quick-edit')?.signalLoom).toContain('save preview metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'standalone-quick-edit')?.signalLoom).toContain('export-only copy warning');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'standalone-quick-edit')?.signalLoom).toContain('native roundtrip');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'standalone-quick-edit')?.signalLoom).toContain('standard installer targets');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'standalone-quick-edit')?.signalLoom).toContain('Mac packaging caveats');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'standalone-quick-edit')?.signalLoom).toContain('standalone state descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'standalone-quick-edit')?.signalLoom).toContain('source-linked quick-edit relink/repair readiness');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'standalone-quick-edit')?.signalLoom).toContain('OS identity descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'standalone-quick-edit')?.signalLoom).toContain('direct local raster image opening from the Image tab into an editable document');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'standalone-quick-edit')?.signalLoom).toContain('Quick Edit layout preset plus standalone crop/resize save/export readiness');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'standalone-quick-edit')?.signalLoom).toContain('Open an image directly');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'standalone-quick-edit')?.signalLoom).toContain('edit quickly');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'standalone-quick-edit')?.signalLoom).toContain('suite package descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'standalone-quick-edit')?.signalLoom).toContain('source snapshot risk descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'standalone-quick-edit')?.parityEstimate).toBeGreaterThanOrEqual(70);
  });

  it('tracks Source Library handoff descriptors without claiming every blob is durable', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'source-library-handoff')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('Source assets'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'source-library-handoff')?.signalLoom).toContain('handoff descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'source-library-handoff')?.signalLoom).toContain('Flow/Video/Paper readiness');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'source-library-handoff')?.signalLoom).toContain('document state classification');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'source-library-handoff')?.signalLoom).toContain('save source state signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'source-library-handoff')?.signalLoom).toContain('save/export policy signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'source-library-handoff')?.signalLoom).toContain('typed Source Library layer handoff signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'source-library-handoff')?.signalLoom).toContain('source-linked relink/repair UI');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'source-library-handoff')?.signalLoom).toContain('shared-binary non-standalone package caveats');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'source-library-handoff')?.signalLoom).toContain('Source Library-backed external/source links');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'source-library-handoff')?.signalLoom).toContain('source-linked asset packaging preserves Source Library provenance');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'source-library-handoff')?.signalLoom).toContain('asset packaging that keep source data traceable');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'source-library-handoff')?.signalLoom).toContain('external asset package signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'source-library-handoff')?.signalLoom).toContain('source snapshot risk descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'source-library-handoff')?.signalLoom).toContain('generated/reference layer summaries');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'source-library-handoff')?.signalLoom).toContain('blob-only warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'source-library-handoff')?.signalLoom).toContain('suite package descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'source-library-handoff')?.parityEstimate).toBeGreaterThanOrEqual(88);
  });

  it('tracks quick-action catalog capability descriptors without overstating AI parity', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'quick-actions')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('capability descriptors'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'quick-actions')?.signalLoom).toContain('Task shortcuts that apply predictable edits');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'quick-actions')?.signalLoom).toContain('surface undoable state through input/output/undoability metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'quick-actions')?.signalLoom).toContain('catalog summaries');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'quick-actions')?.signalLoom).toContain('local approximations');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'quick-actions')?.signalLoom).toContain('macro playback diagnostics');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'quick-actions')?.signalLoom).toContain('native execution unsupported');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'quick-actions')?.signalLoom).toContain('browser/store-only playback');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'quick-actions')?.signalLoom).toContain('per-document blockers');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'quick-actions')?.parityEstimate).toBeGreaterThanOrEqual(42);
  });

  it('tracks universal upscaler descriptors without claiming every source needs upscaling', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'ai-generative-hooks')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('universal upscaler'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'ai-generative-hooks')?.signalLoom).toContain('method/cost/capability descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'ai-generative-hooks')?.signalLoom).toContain('on-device preferred routing');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'ai-generative-hooks')?.signalLoom).toContain('bitmap fallback');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'ai-generative-hooks')?.signalLoom).toContain('dependency/model/runtime blockers');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'ai-generative-hooks')?.signalLoom).toContain('selected-provider/local/cloud/browser fallback states');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'ai-generative-hooks')?.signalLoom).toContain('credential/provider/runtime blockers');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'ai-generative-hooks')?.signalLoom).toContain('native/cloud execution warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'ai-generative-hooks')?.signalLoom).toContain('stable upscale signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'ai-generative-hooks')?.signalLoom).toContain('comic sound-effect exclusions');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'ai-generative-hooks')?.signalLoom).toContain('sourceExclusion policy descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'ai-generative-hooks')?.signalLoom).toContain('fallback order descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'ai-generative-hooks')?.parityEstimate).toBeGreaterThanOrEqual(61);

    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'android-parity')?.signalLoom).toContain('Android accelerator');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'android-parity')?.signalLoom).toContain('method/cost/capability descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'android-parity')?.signalLoom).toContain('Dex 4K display evidence');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'android-parity')?.signalLoom).toContain('Image workspace screenshot evidence');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'android-parity')?.signalLoom).toContain('opened-document edit evidence');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'android-parity')?.signalLoom).toContain('visible brush marks');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'android-parity')?.signalLoom).toContain('android-on-device-upscale-readiness');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'android-parity')?.signalLoom).toContain('single-app runtime');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'android-parity')?.signalLoom).toContain('single-app handoff guard');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'android-parity')?.signalLoom).toContain('Mobile-capable color picking');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'android-parity')?.signalLoom).toContain('accelerated local processing');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'android-parity')?.signalLoom).toContain('feature parity where platform permits');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'android-parity')?.signalLoom).toContain('accelerated execution unproven');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'android-parity')?.signalLoom).not.toContain('opened-document editing coverage remains required');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'android-parity')?.parityEstimate).toBeGreaterThanOrEqual(73);
  });

  it('tracks rendered dockable tab groups and current Android 1080p DeX evidence without overstating parity', () => {
    const dockableRow = IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'dockable-tab-groups');
    const registryRow = IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'tool-registry');
    const toolsRow = IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'compact-tools-palette');
    const androidRow = IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'android-parity');

    expect(dockableRow).toMatchObject({
      status: 'done',
      signalLoom: expect.stringContaining('stable tabbed dialog groups'),
      parityEstimate: expect.any(Number),
    });
    expect(dockableRow?.signalLoom).toContain('stable externalWindowKey/native popup size while switching tabs');
    expect(dockableRow?.signalLoom).toContain('Tabbed docked');
    expect(dockableRow?.signalLoom).toContain('persistent geometry');
    expect(dockableRow?.signalLoom).toContain('default preset grouping for Layers, Channels, and Paths');
    expect(dockableRow?.signalLoom).toContain('visible ungroup');
    expect(dockableRow?.signalLoom).toContain('compact floating chrome implies fixed native popup geometry');
    expect(dockableRow?.signalLoom).toContain('suppresses dock affordances');
    expect(dockableRow?.signalLoom).toContain('ungrouping docked tabs reassigns dock-stack z-order');
    expect(dockableRow?.signalLoom).toContain('richer tab context menus with activate, move left/right, ungroup, float, and reset actions now exist');
    expect(dockableRow?.signalLoom).not.toContain('richer tab context menus remain incomplete');
    expect(dockableRow?.parityEstimate).toBe(100);

    expect(registryRow?.signalLoom).toContain('user-reorderable toolbar customization now exists');
    expect(registryRow?.signalLoom).toContain('customization:user-reorderable-flyout-groups:no-dock:no-resize');
    expect(registryRow?.signalLoom).not.toContain('user-reorderable toolbar customization remains limited');

    expect(toolsRow?.signalLoom).toContain('no Dock button for fixed tool palettes');
    expect(toolsRow?.signalLoom).toContain('no wasted area');
    expect(toolsRow?.signalLoom).toContain('nested tool flyouts now exist');
    expect(toolsRow?.signalLoom).toContain('absolute-overlay');
    expect(toolsRow?.signalLoom).toContain('broader toolbar customization now exists through user-reorderable compact flyout slots');
    expect(toolsRow?.signalLoom).toContain('customization:user-reorderable-flyout-groups:no-dock:no-resize');
    expect(toolsRow?.signalLoom).not.toContain('customization:fixed-order-flyout-groups:no-dock:no-resize');
    expect(toolsRow?.signalLoom).not.toContain('broader toolbar customization remains incomplete');
    expect(toolsRow?.signalLoom).not.toContain('nested tool flyouts remain incomplete');

    expect(androidRow).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('Android 1080p DeX workspace evidence'),
      parityEstimate: expect.any(Number),
    });
    expect(androidRow?.signalLoom).toContain('1920x1080');
    expect(androidRow?.signalLoom).toContain('no-document-open');
    expect(androidRow?.signalLoom).toContain('imported/opened editing still needs coverage');
    expect(androidRow?.signalLoom).toContain('blank-canvas opened-document edit');
    expect(androidRow?.signalLoom).toContain('runtime assets');
    expect(androidRow?.signalLoom).toContain('upscaler model');
    expect(androidRow?.parityEstimate).toBeGreaterThanOrEqual(73);
  });

  it('tracks Image hand navigation controls, stable mixed-tool interaction, and navigation affordances', () => {
    const row = IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'hand-navigation');

    expect(row).toMatchObject({
      status: 'done',
      signalLoom: expect.stringContaining('Hand tool'),
      parityEstimate: expect.any(Number),
    });
    expect(row?.signalLoom).toContain('explicit top-bar Fit / 100% / zoom in / zoom out controls');
    expect(row?.signalLoom).toContain('Ctrl/Cmd zoom/focus shortcuts');
    expect(row?.signalLoom).toContain('shared viewport command helpers');
    expect(row?.signalLoom).toContain('viewportTarget');
    expect(row?.signalLoom).toContain('shortcutKeys');
    expect(row?.signalLoom).toContain('editable-target shortcut routing policy');
    expect(row?.signalLoom).toContain('resolveImageNavigationKeyboardShortcut');
    expect(row?.signalLoom).toContain('stable mixed-tool canvas interaction');
    expect(row?.signalLoom).toContain('preservesActiveTool');
    expect(row?.signalLoom).toContain('temporaryHandPan');
    expect(row?.signalLoom).toContain('pointer capture');
    expect(row?.signalLoom).toContain('deeper navigation affordance descriptors');
    expect(row?.signalLoom).toContain('wheel zoom');
    expect(row?.signalLoom).toContain('pinch zoom');
    expect(row?.signalLoom).toContain('two-finger pan');
    expect(row?.signalLoom).not.toContain('remain incomplete');
    expect(row?.parityEstimate).toBe(100);
  });

  it('tracks move source safety and snap candidate planning used by runtime snapping', () => {
    const row = IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'move-tool');

    expect(row).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('move workflow descriptors'),
      parityEstimate: expect.any(Number),
    });
    expect(row?.signalLoom).toContain('source-safety summaries');
    expect(row?.signalLoom).toContain('metadata-only source-linked moves');
    expect(row?.signalLoom).toContain('missing source-link warnings');
    expect(row?.signalLoom).toContain('snap candidate summaries');
    expect(row?.signalLoom).toContain('guide counts');
    expect(row?.signalLoom).toContain('closest candidates by axis');
    expect(row?.signalLoom).toContain('in-range counts');
    expect(row?.signalLoom).toContain('active locks');
    expect(row?.signalLoom).toContain('group layers');
    expect(row?.signalLoom).toContain('stationary linked members');
    expect(row?.signalLoom).toContain('full smart-guide overlay feedback');
    expect(row?.signalLoom).toContain('multi-layer distribution');
    expect(row?.parityEstimate).toBeGreaterThanOrEqual(62);
  });

  it('tracks the vector-shape-backed Paths panel without overstating saved-work-path parity', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('Paths panel now exists for vector shape and straight-segment Pen path layers'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.signalLoom).toContain('load-selection actions');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.signalLoom).toContain('fill/stroke layer generation');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.signalLoom).toContain('saved paths independent of layers');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.signalLoom).toContain('independent saved-path metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.signalLoom).toContain('thumbnail readiness/signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.parityEstimate).toBeGreaterThanOrEqual(58);
  });

  it('tracks vector-backed rectangle, ellipse, and first Pen paths without claiming full boolean parity', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-layers')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('editable fill/stroke properties'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-layers')?.signalLoom).toContain('Convert Shape to Editable Path');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-layers')?.signalLoom).toContain('rasterize support');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-layers')?.signalLoom).toContain('first retained straight/cubic Pen paths');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-layers')?.signalLoom).toContain('numeric retained path point editing');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-layers')?.signalLoom).toContain('direct draggable anchor handles and retained cubic Bezier handle controls');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-layers')?.signalLoom).toContain('materializeImageVectorBooleanLayers');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-layers')?.signalLoom).toContain('direct Layers context-menu Vector Boolean actions');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-layers')?.signalLoom).toContain('unsupported vector boolean warnings');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-layers')?.signalLoom).toContain('unsupportedResultPolicy');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-layers')?.signalLoom).toContain('sourceMutation: none');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-layers')?.signalLoom).toContain('handoffSignatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-layers')?.signalLoom).toContain('vectorBooleanSource metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-layers')?.signalLoom).toContain('axis-aligned rectangles');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-layers')?.signalLoom).toContain('non-overlapping simple polygons');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-layers')?.signalLoom).toContain('vector planning descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-layers')?.signalLoom).toContain('SVG/PSD vector handoff limitations');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-layers')?.signalLoom).toContain('path-point editability boundaries');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-layers')?.signalLoom).toContain('Pen click-drag Bezier handle creation');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-layers')?.signalLoom).toContain('live boolean operation stacks');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-layers')?.signalLoom).toContain('overlapping polygon/Bezier booleans');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-layers')?.signalLoom).not.toContain('full boolean UI');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-layers')?.parityEstimate).toBeGreaterThanOrEqual(68);
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'raster-shapes')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('editable vector-backed layers'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'raster-shapes')?.signalLoom).toContain('Rectangle and ellipse');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'raster-shapes')?.signalLoom).toContain('Vector-backed rectangles');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'raster-shapes')?.signalLoom).toContain('circle/ellipse shape tool');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'raster-shapes')?.signalLoom).toContain('strokes');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'raster-shapes')?.signalLoom).toContain('fills');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'raster-shapes')?.signalLoom).toContain('retained fill/stroke controls');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'raster-shapes')?.signalLoom).toContain('ellipse convert-to-path support for general boolean workflows');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'raster-shapes')?.signalLoom).toContain('Convert Shape to Editable Path');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'raster-shapes')?.signalLoom).toContain('materialization');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'raster-shapes')?.signalLoom).toContain('overlapping simple-polygon pairs through real Greiner-Hormann polygon clipping');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'raster-shapes')?.signalLoom).toContain('direct context-menu boolean actions');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'raster-shapes')?.signalLoom).toContain('drawVectorPathOnImageData');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'raster-shapes')?.signalLoom).toContain('open vector paths as stroke-only');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'raster-shapes')?.signalLoom).toContain('live boolean operation stacks');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'raster-shapes')?.parityEstimate).toBeGreaterThanOrEqual(64);
  });

  it('tracks custom vector shape presets without overstating boolean operations', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'custom-vector-shapes')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('line'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'custom-vector-shapes')?.signalLoom).toContain('triangle');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'custom-vector-shapes')?.signalLoom).toContain('star');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'custom-vector-shapes')?.signalLoom).toContain('fills');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'custom-vector-shapes')?.signalLoom).toContain('strokes');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'custom-vector-shapes')?.signalLoom).toContain('boolean operations');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'custom-vector-shapes')?.signalLoom).toContain('exact boolean result materialization tracked for axis-aligned rectangle');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'custom-vector-shapes')?.signalLoom).toContain('retained custom shape descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'custom-vector-shapes')?.signalLoom).toContain('describeCustomVectorShapePresetGeometry');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'custom-vector-shapes')?.signalLoom).toContain('line direction');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'custom-vector-shapes')?.signalLoom).toContain('clamped star parameters');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'custom-vector-shapes')?.signalLoom).toContain('SVG/PSD caveats');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'custom-vector-shapes')?.signalLoom).toContain('SVG, PSD, and source-bin handoff signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'custom-vector-shapes')?.signalLoom).toContain('non-overlapping simple-polygon operands');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'custom-vector-shapes')?.signalLoom).toContain('non-mutating boolean policies');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'custom-vector-shapes')?.signalLoom).toContain('vectorBooleanSource metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'custom-vector-shapes')?.signalLoom).toContain('overlapping polygon/Bezier booleans');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'custom-vector-shapes')?.parityEstimate).toBeGreaterThanOrEqual(52);
  });

  it('tracks the first Pen tool workflow and retained cubic handle editing without claiming curvature parity', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'pen-tool')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('retained straight/cubic Pen workflow'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'pen-tool')?.signalLoom).toContain('Enter commit');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'pen-tool')?.signalLoom).toContain('Escape cancel');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'pen-tool')?.signalLoom).toContain('first-anchor close-path gesture');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'pen-tool')?.signalLoom).toContain('numeric point editing');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'pen-tool')?.signalLoom).toContain('direct draggable anchor handles');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'pen-tool')?.signalLoom).toContain('click-drag cubic Bezier handle creation');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'pen-tool')?.signalLoom).toContain('Move-tool retained in/out handle adjustment');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'pen-tool')?.signalLoom).toContain('straight anchor add/delete after commit');
    expectOneExactPhrase(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'pen-tool')?.signalLoom, [
      'describePenToolReadiness descriptors',
      'Pen workflow descriptors',
    ]);
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'pen-tool')?.signalLoom).toContain('creation/edit session descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'pen-tool')?.signalLoom).toContain('saved/work path classification');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'pen-tool')?.signalLoom).toContain('separate-layer boolean readiness');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'pen-tool')?.signalLoom).toContain('SVG/PSD caveats');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'pen-tool')?.signalLoom).toContain('preview ID/signature v2');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'pen-tool')?.signalLoom).toContain('delegated post-commit anchor editing');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'pen-tool')?.signalLoom).toContain('Paths-panel selection/fill/stroke/vector-mask interoperability');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'pen-tool')?.signalLoom).toContain('shape creation, selections, strokes, and masks');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'pen-tool')?.signalLoom).toContain('typed Pen Bezier handle readiness descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'pen-tool')?.signalLoom).not.toContain('Bezier handle editing, curvature mode');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'pen-tool')?.signalLoom).toContain('one-step live Pen-tool vector-mask creation');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'pen-tool')?.signalLoom).not.toContain('direct vector-mask creation from Pen paths');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'pen-tool')?.parityEstimate).toBeGreaterThanOrEqual(31);
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.signalLoom).toContain('straight-segment Pen path layers');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.signalLoom).toContain('path workflow descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.signalLoom).toContain('layer-backed path classification');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.signalLoom).toContain('shape-to-path conversion');
    expectOneExactPhrase(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.signalLoom, [
      'describeImagePathsPanelReadiness descriptors',
      'operation readiness descriptors',
    ]);
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.signalLoom).toContain('operation blocker summaries');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.signalLoom).toContain('SVG/PSD caveats');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.signalLoom).toContain('rasterize vector mask readiness');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.signalLoom).toContain('numeric point controls');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.signalLoom).toContain('add/delete straight anchor controls');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.signalLoom).toContain('direct canvas anchor handles');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.signalLoom).toContain('retained vector-mask creation on the active target layer');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.signalLoom).toContain('path operation checks');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.signalLoom).toContain('Bezier unsupported states');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.signalLoom).toContain('active anchor session state/signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.signalLoom).toContain('selectable anchor rows');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.signalLoom).toContain('thumbnails through ImagePathsPanel thumbnail readiness/signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.parityEstimate).toBeGreaterThanOrEqual(45);
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'path-anchor-editing')).toMatchObject({
      status: 'partial',
      signalLoom: expect.stringContaining('direct canvas draggable anchor handles'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'path-anchor-editing')?.signalLoom).toContain('anchor editing descriptors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'path-anchor-editing')?.signalLoom).toContain('describeImagePathAnchorEditSession');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'path-anchor-editing')?.signalLoom).toContain('moveImagePathAnchors');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'path-anchor-editing')?.signalLoom).toContain('insertImagePathAnchor/deleteImagePathAnchor');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'path-anchor-editing')?.signalLoom).toContain('straight anchor add/delete controls');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'path-anchor-editing')?.signalLoom).toContain('retained cubic in/out handle controls');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'path-anchor-editing')?.signalLoom).toContain('bounded multi-anchor move helper');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'path-anchor-editing')?.signalLoom).toContain('shape-to-path conversion');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'path-anchor-editing')?.signalLoom).toContain('anchor conversion');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'path-anchor-editing')?.signalLoom).toContain('Direct Selection');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'path-anchor-editing')?.signalLoom).toContain('Path Selection');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'path-anchor-editing')?.signalLoom).toContain('Curvature Pen');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'path-anchor-editing')?.signalLoom).not.toContain('independent saved work paths');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'path-anchor-editing')?.signalLoom).toContain('native PSD path fidelity');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'path-anchor-editing')?.parityEstimate).toBeGreaterThanOrEqual(42);
  });

  it('tracks path-backed vector-mask descriptors without claiming editable vector-mask UI or PSD parity', () => {
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-masks')).toMatchObject({
      status: 'done',
      signalLoom: expect.stringContaining('path-backed vector-mask descriptors'),
      parityEstimate: expect.any(Number),
    });
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-masks')?.signalLoom).toContain('deterministically evaluate/rasterize');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-masks')?.signalLoom).toContain('target layer/invert/link normalization');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-masks')?.signalLoom).toContain('rasterization planning metadata');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-masks')?.signalLoom).toContain('live preview/export compositing');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-masks')?.signalLoom).toContain('intersects retained vector masks with raster layer masks');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-masks')?.signalLoom).toContain('renderer cache signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-masks')?.signalLoom).toContain('vector-mask creation/boolean/Bezier/rasterization parity signatures');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-masks')?.signalLoom).toContain('Paths panel can create retained vector masks from selected path layers');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-masks')?.signalLoom).toContain('Independent editable vector-mask UI now edits active retained vector-mask path points');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-masks')?.signalLoom).toContain('preserving the pixel mask and bitmap version');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-masks')?.signalLoom).toContain('path-backed masks are editable independently from pixel masks');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-masks')?.signalLoom).toContain('explicit unsupported states');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-masks')?.signalLoom).toContain('PSD vector mask semantics');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-masks')?.signalLoom).not.toContain('direct Pen-to-vector-mask creation');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-masks')?.signalLoom).not.toContain('live non-destructive render integration remain incomplete');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-masks')?.signalLoom).not.toContain('remain incomplete');
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'vector-masks')?.parityEstimate).toBe(100);
    expect(IMAGE_PHOTOSHOP_PARITY_ITEMS.find((item) => item.id === 'paths-panel')?.signalLoom).toContain('raster layer-mask creation');
  });
});
