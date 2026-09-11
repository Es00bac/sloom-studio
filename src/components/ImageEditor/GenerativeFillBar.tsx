import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Loader2, Sparkles, X } from 'lucide-react';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { useProjectUsageStore } from '../../store/projectUsageStore';
import {
  buildGenerativeFillPrompt,
  runGenerativeFill,
  type GenerativeFillReferenceInput,
  type GenerativeFillProvider,
} from '../../lib/imageEditorAi';
import {
  canRunImageEditorOperation,
  estimateImageEditorOperationCostUsd,
  getImageEditorOperationsForModel,
  listImageEditorOperationDefinitions,
  type ImageEditorOperationDefinition,
  type ImageEditorOperationId,
  type ImageEditorProviderId,
} from '../../lib/imageEditorOperations';
import {
  getImageModelCapabilities,
  listImageModelDefinitions,
  type FirstClassImageProviderId,
} from '../../lib/imageProviderCapabilities';
import { getSelection, setSelection } from './selectionRegistry';
import { cloneMask, createMask, maskBoundingBox } from './SelectionMask';
import { docRectToScreen } from './viewport';
import { buildGenerativeFillRequestArtifacts } from './GenerativeFillArtifacts';
import { createGenerativeFillLayerFromBlob } from './GenerativeFillLayer';
import { GenerativeFillReferences } from './GenerativeFillReferences';
import { renderImageDocumentLayersToBitmap } from './ImageAdjustmentLayer';
import { createBitmap } from './LayerBitmap';
import { configureDetectorKeys, listConfiguredDetectors } from '../../lib/imageMask/objectMaskDetectors';
import { useSettingsStore } from '../../store/settingsStore';
import type { ApiKeys, ProviderSettings, RuntimeSettingsSnapshot } from '../../types/flow';
import { getConfiguredProviders } from '../../lib/providerCatalog';
import { useConfirmationStore } from '../../store/confirmationStore';

const COST_THRESHOLD_USD = 0.5;

const PROVIDER_LABELS: { value: GenerativeFillProvider; label: string }[] = [
  { value: 'gemini', label: 'Gemini' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'atlas', label: 'Atlas Cloud' },
  { value: 'huggingface', label: 'Hugging Face' },
  { value: 'bfl', label: 'BFL FLUX.2' },
  { value: 'stability', label: 'Stability' },
  { value: 'localOpen', label: 'Local/Open' },
  { value: 'generic', label: 'Generic HTTP' },
];

export interface GenerativeFillBarReferenceSlotDescriptor {
  slotIndex: number;
  id: string;
  label: string;
  sourceSummary: string;
  chipLabel: string;
  removeTitle: string;
}

export function describeGenerativeFillBarReferenceSlots(
  references: Array<Pick<GenerativeFillReferenceInput, 'id' | 'label' | 'description' | 'imageUrl'>>,
): GenerativeFillBarReferenceSlotDescriptor[] {
  return references.map((reference, index) => {
    const slotIndex = index + 1;
    const sourceSummary = describeReferenceSlotSource(reference);
    const label = describeReferenceSlotLabel(reference, slotIndex);

    return {
      slotIndex,
      id: reference.id,
      label,
      sourceSummary,
      chipLabel: `Ref ${slotIndex}: ${label}`,
      removeTitle: `Remove reference slot ${slotIndex} (${sourceSummary})`,
    };
  });
}

export function GenerativeFillBar() {
  const activeDoc = useImageEditorStore((s) =>
    s.documents.find((d) => d.id === s.activeDocId) ?? null,
  );
  const dismissed = useImageEditorStore((s) =>
    s.activeDocId ? Boolean(s.generativeFillDismissedByDocId[s.activeDocId]) : false,
  );
  const addLayer = useImageEditorStore((s) => s.addLayer);
  const viewportContainerSize = useImageEditorStore((s) => s.viewportContainerSize);

  const [prompt, setPrompt] = useState('');
  const [provider, setProvider] = useState<GenerativeFillProvider>('gemini');
  const [model, setModel] = useState(() => getDefaultModelForProvider('gemini'));
  const [operation, setOperation] = useState<ImageEditorOperationId>('inpaint');
  // Minimal-by-default: the panel shows as a small pill that does not cover the canvas, and expands to
  // the full controls only on demand, so it never gets in the way of selection/transform work.
  const [expanded, setExpanded] = useState(false);
  const [searchPrompt, setSearchPrompt] = useState('');
  const [outpaint, setOutpaint] = useState({
    left: 0,
    right: 0,
    up: 0,
    down: 0,
    creativity: 0.5,
  });
  const [edgeFeatherPx, setEdgeFeatherPx] = useState(3);
  const [references, setReferences] = useState<GenerativeFillReferenceInput[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const providerSettings = useSettingsStore((s) => s.providerSettings);
  const [detectPhrase, setDetectPhrase] = useState('');
  const [detecting, setDetecting] = useState(false);
  const settingsSnapshot = useMemo(
    () => ({ apiKeys, providerSettings }) as RuntimeSettingsSnapshot,
    [apiKeys, providerSettings],
  );
  const maskDetector = useMemo(() => listConfiguredDetectors(settingsSnapshot)[0], [settingsSnapshot]);

  const handleDetect = async () => {
    if (!activeDoc || !maskDetector || !detectPhrase.trim()) {
      return;
    }
    setDetecting(true);
    setError(null);
    const flattened = renderImageDocumentLayersToBitmap(activeDoc);
    const sourceCanvas = createBitmap(activeDoc.width, activeDoc.height);
    const sourceCtx = sourceCanvas.getContext('2d');
    if (!sourceCtx) {
      setDetecting(false);
      setError('Failed to flatten the document for detection.');
      return;
    }
    sourceCtx.drawImage(flattened, 0, 0);
    const sourceBlob = await sourceCanvas.convertToBlob({ type: 'image/png' });
    const sourceUrl = URL.createObjectURL(sourceBlob);
    try {
      configureDetectorKeys(settingsSnapshot);
      const detection = await maskDetector.detect({
        sourceImageDataUrl: sourceUrl,
        phrase: detectPhrase.trim(),
        width: activeDoc.width,
        height: activeDoc.height,
      });
      const detectedImage = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Unable to decode detection mask.'));
        img.src = detection.maskDataUrl;
      });
      const maskCanvas = createBitmap(activeDoc.width, activeDoc.height);
      const maskCtx = maskCanvas.getContext('2d');
      if (!maskCtx) throw new Error('Failed to read the detection mask.');
      maskCtx.drawImage(detectedImage, 0, 0, activeDoc.width, activeDoc.height);
      const maskData = maskCtx.getImageData(0, 0, activeDoc.width, activeDoc.height).data;
      const mask = createMask(activeDoc.width, activeDoc.height);
      for (let p = 0; p < mask.data.length; p += 1) {
        mask.data[p] = maskData[p * 4 + 3];
      }
      setSelection(activeDoc.id, mask);
      const store = useImageEditorStore.getState();
      store.setHasSelection(activeDoc.id, Boolean(maskBoundingBox(mask)));
      store.bumpSelectionVersion(activeDoc.id);
    } catch (detectError) {
      setError(detectError instanceof Error ? detectError.message : 'Object detection failed.');
    } finally {
      URL.revokeObjectURL(sourceUrl);
      setDetecting(false);
    }
  };
  const abortRef = useRef<AbortController | null>(null);
  const visible = Boolean(activeDoc?.hasSelection) && !dismissed;

  const anchor = useMemo(() => {
    if (!activeDoc) return null;
    const mask = getSelection(activeDoc.id);
    if (!mask) return null;
    const bbox = maskBoundingBox(mask);
    if (!bbox) return null;
    const view = viewportContainerSize.width > 0 && viewportContainerSize.height > 0
      ? viewportContainerSize
      : undefined;
    return docRectToScreen(bbox, activeDoc.viewport, view);
  }, [activeDoc, viewportContainerSize]);

  useEffect(() => {
    if (!visible) {
      abortRef.current?.abort();
      queueMicrotask(() => setError(null));
    }
  }, [visible]);

  // Capability-first across ALL configured providers: pick an operation, then see EVERY model that can
  // perform it from every provider you have credentials for (each labelled with its provider) — no
  // separate provider chooser. Selecting a model sets its provider + id.
  const configuredProviders = useMemo(
    () => getConfiguredImageProviders(apiKeys, providerSettings),
    [apiKeys, providerSettings],
  );
  const operationOptions = useMemo(
    () => getAllEditorOperations(configuredProviders).filter((candidate) => !candidate.localOnly),
    [configuredProviders],
  );
  const effectiveOperationId = operationOptions.some((candidate) => candidate.id === operation)
    ? operation
    : operationOptions[0]?.id;
  const modelOptions = useMemo(
    () => getModelsForOperation(configuredProviders, effectiveOperationId),
    [configuredProviders, effectiveOperationId],
  );
  const selectedModelEntry = modelOptions.find((entry) => entry.providerId === provider && entry.modelId === model)
    ?? modelOptions[0];
  const effectiveProvider = selectedModelEntry?.providerId ?? 'generic';
  const effectiveModel = selectedModelEntry?.modelId ?? 'generic-http';
  // Reference images: only offer them when the SELECTED MODEL actually accepts reference images
  // (maxReferenceImages > 0) — Generic HTTP has no capability metadata, so it allows them uncapped.
  const maxReferenceImages = useMemo(
    () => (effectiveProvider === 'generic'
      ? Number.POSITIVE_INFINITY
      : getImageModelCapabilities(effectiveProvider as FirstClassImageProviderId, effectiveModel).maxReferenceImages),
    [effectiveProvider, effectiveModel],
  );
  const modelAcceptsReferences = effectiveProvider === 'generic' || maxReferenceImages > 0;

  if (!visible || !activeDoc || !anchor) return null;

  const containerHeight = viewportContainerSize.height;
  const containerWidth = viewportContainerSize.width;

  const compactPanel = containerWidth < 640;
  const horizontalMargin = compactPanel ? 8 : 16;
  const preferredPanelWidth = Math.min(780, Math.max(500, containerWidth - 32));
  const maxPanelWidth = Math.max(240, containerWidth - horizontalMargin * 2);
  const panelWidth = Math.min(preferredPanelWidth, maxPanelWidth);
  const estimatedPanelHeight = compactPanel ? Math.min(520, Math.max(280, containerHeight - horizontalMargin * 2)) : 260;
  const placeAbove = anchor.y > 60;
  const belowAnchorTop = anchor.y + anchor.height + 8;
  const aboveAnchorTop = anchor.y - estimatedPanelHeight - 8;
  const maxTop = Math.max(horizontalMargin, containerHeight - estimatedPanelHeight - horizontalMargin);
  // On narrow screens dock the bar as a full-width sheet pinned to the top, clear of the left-edge
  // tool palette (a vertical strip lower on the canvas). Otherwise anchor it near the selection.
  const top = compactPanel
    ? horizontalMargin
    : (placeAbove
      ? Math.max(horizontalMargin, aboveAnchorTop)
      : Math.min(maxTop, Math.max(horizontalMargin, belowAnchorTop)));
  const left = compactPanel
    ? horizontalMargin
    : Math.min(
      Math.max(horizontalMargin, anchor.x),
      Math.max(horizontalMargin, containerWidth - panelWidth - horizontalMargin),
    );
  const maxHeight = Math.max(96, containerHeight - top - horizontalMargin);
  const primaryControlsClassName = compactPanel ? 'grid grid-cols-2 gap-2' : 'grid grid-cols-3 gap-2';

  const selectedOperation = operationOptions.find((candidate) => candidate.id === effectiveOperationId) ?? operationOptions[0];
  const runCheck = selectedOperation
    ? canRunImageEditorOperation({
        operationId: selectedOperation.id,
        providerId: effectiveProvider as ImageEditorProviderId,
        modelId: effectiveModel,
        hasActiveLayer: Boolean(activeDoc.activeLayerId),
        hasSelection: Boolean(activeDoc.hasSelection),
      })
    : { ok: false as const, reason: 'Select a model with an image edit operation.' };
  const cost = selectedOperation
    ? estimateImageEditorOperationCostUsd({
        operationId: selectedOperation.id,
        providerId: effectiveProvider as ImageEditorProviderId,
        modelId: effectiveModel,
      })
    : undefined;
  const costLabel = cost?.costUsd === undefined
    ? (cost?.unitLabel ?? 'provider-defined')
    : `~$${cost.costUsd.toFixed(3)} (${cost.unitLabel})`;
  const effectivePrompt = buildGenerativeFillPrompt({
    prompt: prompt.trim(),
    references: selectedOperation?.supportsReferenceImages ? references : [],
  });
  const requiresPrompt = selectedOperation?.supportsPrompt ?? true;
  const outpaintHasMargin = selectedOperation?.id !== 'outpaint'
    || outpaint.left + outpaint.right + outpaint.up + outpaint.down > 0;
  const canSubmit =
    !running &&
    Boolean(selectedOperation) &&
    runCheck.ok &&
    outpaintHasMargin &&
    (!requiresPrompt || Boolean(prompt.trim())) &&
    (!selectedOperation?.supportsSearchPrompt || Boolean(searchPrompt.trim()));

  const handleSubmit = async () => {
    if (!canSubmit || !selectedOperation) return;
    const estCost = cost?.costUsd ?? 0;
    if (estCost > COST_THRESHOLD_USD) {
      const ok = await useConfirmationStore.getState().requestConfirmation(
        `This generation is estimated at $${estCost.toFixed(3)}. Continue?`,
        'Budget Confirmation'
      );
      if (!ok) return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setError(null);
    try {
      const selection = getSelection(activeDoc.id);
      if (!selection) throw new Error('No active selection — select an area before generating.');
      const capturedSelection = cloneMask(selection);
      const { source, mask, placementBounds } = await buildGenerativeFillRequestArtifacts(activeDoc, capturedSelection);
      const result = await runGenerativeFill({
        source,
        mask,
        prompt: effectivePrompt,
        provider: effectiveProvider,
        model: effectiveModel,
        operation: selectedOperation.id,
        searchPrompt: searchPrompt.trim(),
        outpaint: selectedOperation.id === 'outpaint' ? outpaint : undefined,
        references: selectedOperation.supportsReferenceImages ? references : [],
        abortSignal: controller.signal,
      });
      const newLayer = await createGenerativeFillLayerFromBlob({
        doc: activeDoc,
        edgeFeatherPx,
        placementBounds,
        png: result.png,
        prompt: prompt.trim() || selectedOperation.label,
        selection: capturedSelection,
      });
      addLayer(activeDoc.id, newLayer);
      useProjectUsageStore.getState().recordUsage({
        nodeId: `image:${activeDoc.id}`,
        nodeType: 'advancedImageEditor',
        nodeData: {},
        workspace: 'image',
        operation: selectedOperation.id,
        usage: {
          source: 'actual',
          confidence: cost?.costUsd === undefined ? 'unknown' : 'fixed',
          provider: effectiveProvider,
          modelId: effectiveModel,
          imageCount: 1,
          costUsd: cost?.costUsd,
          notes: cost?.notes,
        },
      });
      setPrompt('');
      setSearchPrompt('');
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      setError((err as Error).message);
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  // Collapsed state: a small pill that doesn't cover the canvas. Expands to the full panel on click.
  if (!expanded) {
    return (
      <div
        data-image-generative-fill-bar="true"
        className="absolute z-[70] flex items-center gap-1 rounded-full border border-cyan-300/30 bg-[#10151f]/95 px-2 py-1 shadow-2xl backdrop-blur"
        style={{ left, top }}
      >
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1.5 rounded-full px-1.5 py-0.5 text-xs font-semibold text-cyan-50 hover:text-white"
          title="Open generative edit"
        >
          <Sparkles className="text-cyan-400" size={14} />
          Generative Edit
        </button>
        <button
          aria-label="Dismiss generative edit"
          className="rounded-full p-0.5 text-cyan-100/40 hover:text-white"
          onClick={() => {
            useImageEditorStore.getState().setGenerativeFillDismissed(activeDoc.id, true);
          }}
          type="button"
        >
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <div
      data-image-generative-fill-bar="true"
      // z above the floating tool palette (z-60) and brush quick control (z-65): when this panel is open
      // it must be the topmost layer, otherwise on a narrow portrait phone the left-edge tool palette
      // overlaps and hides its left column (provider/operation selectors), forcing a rotate to landscape.
      className="absolute z-[70] flex flex-col gap-2 rounded-xl border border-cyan-300/30 bg-[#10151f]/95 p-2 shadow-2xl backdrop-blur"
      style={{
        left,
        maxHeight,
        overscrollBehavior: 'contain',
        overflowY: 'auto',
        top,
        width: panelWidth,
      }}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
        <Sparkles className="text-cyan-400" size={16} />
        <input
          autoFocus
          className="min-w-0 rounded border border-cyan-300/10 bg-[#0d0f15] px-2 py-1 text-sm text-cyan-50 placeholder:text-cyan-100/30"
          disabled={running || !selectedOperation?.supportsPrompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void handleSubmit();
            }
            if (e.key === 'Escape') {
              useImageEditorStore.getState().setGenerativeFillDismissed(activeDoc.id, true);
            }
          }}
          placeholder={selectedOperation ? promptPlaceholder(selectedOperation.id) : 'Select an edit operation'}
          type="text"
          value={prompt}
        />
        <div className="flex items-center gap-0.5">
          <button
            aria-label="Collapse generative edit"
            className="rounded p-1 text-cyan-100/40 hover:text-white"
            onClick={() => setExpanded(false)}
            title="Collapse"
            type="button"
          >
            <ChevronDown size={14} />
          </button>
          <button
            aria-label="Dismiss generative edit"
            className="rounded p-1 text-cyan-100/40 hover:text-white"
            onClick={() => {
              useImageEditorStore.getState().setGenerativeFillDismissed(activeDoc.id, true);
            }}
            type="button"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {maskDetector ? (
        <div className="mt-2 flex items-center gap-2">
          <input
            className="min-w-0 flex-1 rounded border border-cyan-300/10 bg-[#0d0f15] px-2 py-1 text-xs text-cyan-50 placeholder:text-cyan-100/30"
            disabled={detecting}
            onChange={(e) => setDetectPhrase(e.target.value)}
            placeholder={`Detect with ${maskDetector.label}, e.g. the sky`}
            value={detectPhrase}
          />
          <button
            className="shrink-0 rounded border border-cyan-300/30 bg-cyan-500/15 px-2 py-1 text-xs font-semibold text-cyan-50 hover:bg-cyan-500/25 disabled:opacity-50"
            disabled={detecting || !detectPhrase.trim()}
            onClick={() => void handleDetect()}
            type="button"
          >
            {detecting ? 'Detecting…' : 'Detect → select'}
          </button>
        </div>
      ) : null}

      <div className={primaryControlsClassName}>
        <select
          aria-label="Operation"
          className="min-w-0 rounded border border-cyan-300/10 bg-[#0d0f15] px-2 py-1 text-xs text-cyan-100/80"
          disabled={running || operationOptions.length === 0}
          onChange={(e) => setOperation(e.target.value as ImageEditorOperationId)}
          value={selectedOperation?.id ?? effectiveOperationId ?? 'inpaint'}
        >
          {operationOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
        <select
          aria-label="Model"
          className="min-w-0 rounded border border-cyan-300/10 bg-[#0d0f15] px-2 py-1 text-xs text-cyan-100/80"
          disabled={running || modelOptions.length === 0}
          onChange={(e) => {
            const [nextProvider, ...rest] = e.target.value.split('|');
            setProvider(nextProvider as GenerativeFillProvider);
            setModel(rest.join('|'));
          }}
          value={`${effectiveProvider}|${effectiveModel}`}
          title={`${modelOptions.length} model${modelOptions.length === 1 ? '' : 's'} (across configured providers) can ${selectedOperation?.label ?? 'do this'}`}
        >
          {modelOptions.length === 0 && (
            <option value="generic|generic-http">No configured provider has a model for this operation</option>
          )}
          {modelOptions.map((option) => (
            <option key={`${option.providerId}|${option.modelId}`} value={`${option.providerId}|${option.modelId}`}>
              {option.label}
            </option>
          ))}
        </select>
        {running ? (
          <button
            className="flex items-center justify-center gap-1 rounded bg-red-500/20 px-3 py-1 text-xs text-red-200 hover:bg-red-500/30"
            onClick={handleCancel}
            type="button"
          >
            <Loader2 className="animate-spin" size={12} />
            Cancel
          </button>
        ) : (
          <button
            className="rounded bg-cyan-400 px-3 py-1 text-xs font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-50"
            disabled={!canSubmit}
            onClick={() => void handleSubmit()}
            type="button"
          >
            Generate
          </button>
        )}
      </div>

      {selectedOperation?.supportsSearchPrompt && (
        <input
          className="rounded border border-cyan-300/10 bg-[#0d0f15] px-2 py-1 text-xs text-cyan-50 placeholder:text-cyan-100/30"
          disabled={running}
          onChange={(event) => setSearchPrompt(event.target.value)}
          placeholder="What should the provider search for?"
          value={searchPrompt}
        />
      )}

      {selectedOperation?.id === 'outpaint' && (
        <div className="grid grid-cols-5 gap-2 rounded border border-cyan-300/10 bg-[#0d0f15]/70 p-2">
          <SmallNumberField
            label="L"
            min={0}
            onChange={(value) => setOutpaint((current) => ({ ...current, left: value }))}
            value={outpaint.left}
          />
          <SmallNumberField
            label="R"
            min={0}
            onChange={(value) => setOutpaint((current) => ({ ...current, right: value }))}
            value={outpaint.right}
          />
          <SmallNumberField
            label="U"
            min={0}
            onChange={(value) => setOutpaint((current) => ({ ...current, up: value }))}
            value={outpaint.up}
          />
          <SmallNumberField
            label="D"
            min={0}
            onChange={(value) => setOutpaint((current) => ({ ...current, down: value }))}
            value={outpaint.down}
          />
          <SmallNumberField
            label="Cr"
            max={1}
            min={0}
            onChange={(value) => setOutpaint((current) => ({ ...current, creativity: value }))}
            step={0.05}
            value={outpaint.creativity}
          />
        </div>
      )}

      {selectedOperation?.id === 'inpaint' ? (
        <div className="grid grid-cols-[6rem_1fr_3rem] items-center gap-2 rounded border border-cyan-300/10 bg-[#0d0f15]/70 px-2 py-1">
          <span className="text-[11px] font-semibold text-cyan-100/45">Blend Edge</span>
          <input
            className="w-full accent-cyan-400"
            disabled={running}
            max={24}
            min={0}
            onChange={(event) => setEdgeFeatherPx(Number(event.target.value))}
            step={1}
            type="range"
            value={edgeFeatherPx}
          />
          <span className="text-right font-mono text-[11px] text-cyan-100/45">{edgeFeatherPx}px</span>
        </div>
      ) : null}

      {selectedOperation?.supportsReferenceImages && modelAcceptsReferences && (
        <GenerativeFillReferences
          references={references}
          onChange={setReferences}
          maxReferenceImages={maxReferenceImages}
          disabled={running}
          compact={compactPanel}
        />
      )}

      <div className="flex items-center justify-between gap-2 text-[11px] text-cyan-100/40">
        <span className="truncate">
          {runCheck.ok && !outpaintHasMargin
            ? 'Set at least one outpaint margin before generating.'
            : runCheck.ok ? selectedOperation?.description : runCheck.reason}
        </span>
        <span className="shrink-0 font-mono">{costLabel}</span>
      </div>
      {error && (
        <div className="truncate rounded bg-red-500/20 px-3 py-1 text-[11px] text-red-100">
          {error}
        </div>
      )}
    </div>
  );
}

function describeReferenceSlotLabel(
  reference: Pick<GenerativeFillReferenceInput, 'label' | 'description' | 'imageUrl'>,
  slotIndex: number,
): string {
  const label = reference.label?.trim();
  if (label) return label;
  const description = reference.description?.trim();
  if (description) return description;
  const imageUrl = reference.imageUrl?.trim();
  if (imageUrl?.startsWith('data:')) return 'Embedded image';
  if (imageUrl) return 'Image URL reference';
  return `Reference ${slotIndex}`;
}

function describeReferenceSlotSource(
  reference: Pick<GenerativeFillReferenceInput, 'description' | 'imageUrl'>,
): string {
  const hasDescription = Boolean(reference.description?.trim());
  const imageUrl = reference.imageUrl?.trim() ?? '';
  const imageKind = imageUrl.startsWith('data:')
    ? 'embedded image'
    : imageUrl
      ? 'image URL'
      : null;

  if (imageKind && hasDescription) return `${imageKind} + description`;
  if (imageKind) return imageKind;
  if (hasDescription) return 'description';
  return 'empty reference';
}

// Every edit operation that AT LEAST ONE of the provider's models can perform, in canonical order.
// Drives the operation dropdown so it never offers an operation with zero capable models.
function getProviderEditorOperations(provider: GenerativeFillProvider): ImageEditorOperationDefinition[] {
  if (provider === 'generic') {
    return getImageEditorOperationsForModel('generic', 'generic-http');
  }
  const order = new Map(listImageEditorOperationDefinitions().map((operation, index) => [operation.id, index]));
  const seen = new Map<ImageEditorOperationId, ImageEditorOperationDefinition>();
  for (const definition of listImageModelDefinitions(provider as FirstClassImageProviderId)) {
    for (const operation of getImageEditorOperationsForModel(provider as ImageEditorProviderId, definition.modelId)) {
      if (!seen.has(operation.id)) seen.set(operation.id, operation);
    }
  }
  return [...seen.values()].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

// Only the provider's models that can actually perform `operationId` — so the model dropdown never
// lists a model that can't do the selected operation (e.g. a whole-image-edit model under "Inpaint").
function getModelOptionsForOperation(
  provider: GenerativeFillProvider,
  operationId: ImageEditorOperationId | undefined,
): Array<{ modelId: string; label: string }> {
  if (provider === 'generic') {
    return [{ modelId: 'generic-http', label: 'Generic HTTP' }];
  }
  if (!operationId) return [];
  return listImageModelDefinitions(provider as FirstClassImageProviderId)
    .filter((definition) =>
      getImageEditorOperationsForModel(provider as ImageEditorProviderId, definition.modelId)
        .some((operation) => operation.id === operationId && !operation.localOnly),
    )
    .map((definition) => ({ modelId: definition.modelId, label: definition.label }));
}

function getDefaultModelForProvider(provider: GenerativeFillProvider): string {
  const firstOperation = getProviderEditorOperations(provider).find((operation) => !operation.localOnly);
  return getModelOptionsForOperation(provider, firstOperation?.id)[0]?.modelId ?? 'generic-http';
}

const PROVIDER_DISPLAY_LABEL = new Map(PROVIDER_LABELS.map((entry) => [entry.value, entry.label]));
function providerDisplayLabel(provider: GenerativeFillProvider): string {
  return PROVIDER_DISPLAY_LABEL.get(provider) ?? provider;
}

export interface CrossProviderModelOption {
  providerId: GenerativeFillProvider;
  modelId: string;
  label: string;
}

// Providers the user actually has credentials/endpoints for (image capability), plus the Generic HTTP
// fallback. The dialog lists models from these — never models you can't run.
export function getConfiguredImageProviders(apiKeys: ApiKeys, providerSettings: ProviderSettings): GenerativeFillProvider[] {
  const configured = getConfiguredProviders('image', apiKeys, providerSettings) as GenerativeFillProvider[];
  return [...configured, 'generic'];
}

// Every edit operation that AT LEAST ONE model of ANY configured provider can perform (canonical order),
// so the operation list spans providers and never offers an operation no configured model supports.
function getAllEditorOperations(providers: GenerativeFillProvider[]): ImageEditorOperationDefinition[] {
  const order = new Map(listImageEditorOperationDefinitions().map((operation, index) => [operation.id, index]));
  const seen = new Map<ImageEditorOperationId, ImageEditorOperationDefinition>();
  for (const provider of providers) {
    for (const operation of getProviderEditorOperations(provider)) {
      if (!seen.has(operation.id)) seen.set(operation.id, operation);
    }
  }
  return [...seen.values()].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}

// Capability-first flat list: every model that can perform `operationId` across ALL configured providers,
// each labelled with its provider (so you choose by what the model does, not by provider).
export function getModelsForOperation(
  providers: GenerativeFillProvider[],
  operationId: ImageEditorOperationId | undefined,
): CrossProviderModelOption[] {
  const out: CrossProviderModelOption[] = [];
  for (const provider of providers) {
    for (const model of getModelOptionsForOperation(provider, operationId)) {
      out.push({ providerId: provider, modelId: model.modelId, label: `${model.label} · ${providerDisplayLabel(provider)}` });
    }
  }
  return out;
}

function promptPlaceholder(operation: ImageEditorOperationId): string {
  switch (operation) {
    case 'searchReplace':
      return 'Describe the replacement…';
    case 'searchRecolor':
      return 'Describe the new color or material…';
    case 'removeBackground':
      return 'This operation does not require a prompt';
    case 'replaceBackground':
      return 'Describe the new background…';
    case 'relight':
      return 'Describe the lighting change…';
    case 'outpaint':
      return 'Describe what should continue beyond the canvas…';
    case 'upscale':
      return 'This operation does not require a prompt';
    case 'resizeImage':
    case 'resizeCanvas':
      return 'Use the document controls in Properties';
    case 'inpaint':
      return 'Describe what to fill the selection with…';
    case 'editImage':
      return 'Describe how to edit the whole image…';
    case 'erase':
      return 'No prompt required';
  }
}

function SmallNumberField(props: {
  label: string;
  min: number;
  max?: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid grid-cols-[1.25rem_1fr] items-center gap-1">
      <span className="text-[11px] font-semibold text-cyan-100/45">{props.label}</span>
      <input
        className="min-w-0 rounded border border-cyan-300/10 bg-[#070a10] px-1 py-1 font-mono text-xs text-cyan-50"
        max={props.max}
        min={props.min}
        onChange={(event) => props.onChange(Number(event.target.value))}
        step={props.step ?? 1}
        type="number"
        value={props.value}
      />
    </label>
  );
}
