import { Download, Eye, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useImageEditorStore } from '../../store/imageEditorStore';
import type {
  ImageDocument,
  ImageColorChannel,
  QuickMaskViewMode,
  SelectAndMaskOutputMode,
  SelectAndMaskPreviewMode,
  SelectionMode,
} from '../../types/imageEditor';
import {
  applySavedSelectionChannel,
  buildAlphaChannelPanelDescriptor,
  buildImageChannelRowDescriptors,
  buildSavedSelectionChannel,
  getActiveImageColorChannel,
  getImageChannelEditTarget,
  IMAGE_COLOR_CHANNELS,
  sanitizeSavedSelectionChannelName,
  truncateSavedSelectionChannels,
} from './ImageSelectionChannels';
import {
  buildImageSpotChannelEntry,
  buildImageSpotChannelGrayscalePlate,
  buildImageSpotChannelPanelDescriptor,
  buildImageSpotChannelWorkflowDescriptors,
  updateImageSpotChannelMetadata,
} from './ImageSpotChannels';
import { createLayerMaskFromSelection } from './LayerMaskOps';
import {
  buildSelectAndMaskPreviewMask,
} from './ImageSelectAndMask';
import { maskBoundingBox, toSnapshot, type SelectionMask } from './SelectionMask';
import {
  borderSelection,
  featherSelection,
  growSelection,
  shrinkSelection,
  smoothSelection,
} from './photoshopQuickActions/selectionActions';
import { clearSelection, getSelection, setSelection } from './selectionRegistry';
import { downloadBlobWithOutcome } from '../../shared/files/downloads';

const LOAD_MODES: Array<{ value: SelectionMode; label: string }> = [
  { value: 'replace', label: 'Replace' },
  { value: 'add', label: 'Add' },
  { value: 'subtract', label: 'Subtract' },
  { value: 'intersect', label: 'Intersect' },
];

const QUICK_MASK_VIEW_MODES: Array<{ value: QuickMaskViewMode; label: string }> = [
  { value: 'maskedAreas', label: 'Masked Areas' },
  { value: 'selectedAreas', label: 'Selected Areas' },
];

const SELECT_AND_MASK_PREVIEW_MODES: Array<{ value: SelectAndMaskPreviewMode; label: string }> = [
  { value: 'maskedAreas', label: 'Masked Areas' },
  { value: 'selectedAreas', label: 'Selected Areas' },
  { value: 'onBlack', label: 'On Black' },
  { value: 'onWhite', label: 'On White' },
  { value: 'blackWhite', label: 'Black & White' },
];

const SELECT_AND_MASK_OUTPUT_MODES: Array<{ value: SelectAndMaskOutputMode; label: string }> = [
  { value: 'selection', label: 'Selection' },
  { value: 'quickMask', label: 'Quick Mask' },
  { value: 'layerMask', label: 'Layer Mask' },
  { value: 'newAlphaChannel', label: 'New Alpha Channel' },
];

const SELECTION_REFINEMENT_ACTIONS = [
  { id: 'grow', label: 'Grow', ariaLabel: 'Grow selection' },
  { id: 'shrink', label: 'Shrink', ariaLabel: 'Shrink selection' },
  { id: 'feather', label: 'Feather', ariaLabel: 'Feather selection' },
  { id: 'border', label: 'Border', ariaLabel: 'Border selection' },
  { id: 'smooth', label: 'Smooth', ariaLabel: 'Smooth selection' },
] as const;

export function ImageEditorChannelsPanel() {
  const activeDoc = useImageEditorStore((state) =>
    state.documents.find((document) => document.id === state.activeDocId) ?? null,
  );

  if (!activeDoc) {
    return (
      <div className="flex h-full items-center justify-center bg-[#1a1b23] p-3 text-xs text-cyan-100/40">
        No document open
      </div>
    );
  }

  return <ChannelsPanelInner doc={activeDoc} />;
}

function ChannelsPanelInner({ doc }: { doc: ImageDocument }) {
  const pushOperation = useImageEditorStore((state) => state.pushOperation);
  const setHasSelection = useImageEditorStore((state) => state.setHasSelection);
  const updateLayer = useImageEditorStore((state) => state.updateLayer);
  const setActiveLayerEditTarget = useImageEditorStore((state) => state.setActiveLayerEditTarget);
  const quickMaskSettings = useImageEditorStore((state) => state.quickMaskSettings);
  const setQuickMaskSettings = useImageEditorStore((state) => state.setQuickMaskSettings);
  const toggleQuickMask = useImageEditorStore((state) => state.toggleQuickMask);
  const selectAndMaskSettings = useImageEditorStore((state) => state.selectAndMaskSettings);
  const setSelectAndMaskSettings = useImageEditorStore((state) => state.setSelectAndMaskSettings);
  const toggleSelectAndMask = useImageEditorStore((state) => state.toggleSelectAndMask);
  const channels = doc.savedSelectionChannels ?? [];
  const spotChannels = doc.spotChannels ?? [];
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(channels[0]?.id ?? null);
  const [selectedSpotChannelId, setSelectedSpotChannelId] = useState<string | null>(spotChannels[0]?.id ?? null);
  const [loadMode, setLoadMode] = useState<SelectionMode>('replace');
  const [refineRadius, setRefineRadius] = useState(2);
  const [spotPlateNotice, setSpotPlateNotice] = useState<string | null>(null);
  const activeLayer = useMemo(
    () => doc.layers.find((layer) => layer.id === doc.activeLayerId) ?? null,
    [doc.activeLayerId, doc.layers],
  );
  const layerMaskOutputBlockedByLink = selectAndMaskSettings.outputMode === 'layerMask'
    && Boolean(activeLayer?.maskLinkSourceLayerId);
  const readLiveSelection = () => getSelection(doc.id);
  const liveSelection = readLiveSelection();
  const selectedChannel = useMemo(
    () => channels.find((channel) => channel.id === selectedChannelId) ?? null,
    [channels, selectedChannelId],
  );
  const selectedSpotChannel = useMemo(
    () => spotChannels.find((channel) => channel.id === selectedSpotChannelId) ?? null,
    [spotChannels, selectedSpotChannelId],
  );
  const spotChannelRows = useMemo(
    () => buildImageSpotChannelWorkflowDescriptors(spotChannels, { targetFormat: 'psd' }),
    [spotChannels],
  );
  const activeColorChannel = getActiveImageColorChannel(doc);
  const activeColorChannelLabel = IMAGE_COLOR_CHANNELS.find((channel) => channel.value === activeColorChannel)?.label ?? 'RGB Composite';
  const channelEditTarget = getImageChannelEditTarget(doc);
  const channelRows = useMemo(() => buildImageChannelRowDescriptors(doc), [doc]);
  const colorChannelRows = useMemo(
    () => channelRows.filter((channel) => channel.source === 'color-channel'),
    [channelRows],
  );
  const alphaChannelRows = useMemo(
    () => channelRows.filter((channel) => channel.source === 'saved-selection'),
    [channelRows],
  );
  const selectedChannelRow = useMemo(
    () => alphaChannelRows.find((channel) => channel.channelId === selectedChannelId) ?? null,
    [alphaChannelRows, selectedChannelId],
  );
  const alphaPanelDescriptor = useMemo(
    () => buildAlphaChannelPanelDescriptor({
      documentWidth: doc.width,
      documentHeight: doc.height,
      savedSelectionChannels: channels,
      selectedChannelId,
      loadMode,
      targetFormat: 'psd',
    }),
    [channels, doc.height, doc.width, loadMode, selectedChannelId],
  );
  const spotPanelDescriptor = useMemo(
    () => buildImageSpotChannelPanelDescriptor(spotChannels, {
      selectedChannelId: selectedSpotChannelId,
      targetFormat: 'psd',
      documentWidth: doc.width,
      documentHeight: doc.height,
    }),
    [doc.height, doc.width, selectedSpotChannelId, spotChannels],
  );
  const selectedSpotPlateDimensions = selectedSpotChannel
    && Number.isSafeInteger(selectedSpotChannel.width)
    && Number.isSafeInteger(selectedSpotChannel.height)
    && Number.isSafeInteger(selectedSpotChannel.width * selectedSpotChannel.height)
    && selectedSpotChannel.width > 0
    && selectedSpotChannel.height > 0
    ? {
      width: selectedSpotChannel.width,
      height: selectedSpotChannel.height,
      effectiveOpacity: selectedSpotChannel.visible === false
        ? 0
        : Math.round(Math.min(1, Math.max(0, selectedSpotChannel.opacity))
          * Math.min(1, Math.max(0, selectedSpotChannel.solidity)) * 10000) / 10000,
      byteLength: new TextEncoder().encode(`P5\n${selectedSpotChannel.width} ${selectedSpotChannel.height}\n255\n`).length
        + selectedSpotChannel.width * selectedSpotChannel.height,
    }
    : null;

  useEffect(() => {
    if (selectedChannelId && channels.some((channel) => channel.id === selectedChannelId)) return;
    setSelectedChannelId(channels[0]?.id ?? null);
  }, [channels, selectedChannelId]);

  useEffect(() => {
    if (selectedSpotChannelId && spotChannels.some((channel) => channel.id === selectedSpotChannelId)) return;
    setSelectedSpotChannelId(spotChannels[0]?.id ?? null);
  }, [selectedSpotChannelId, spotChannels]);

  useEffect(() => {
    setSpotPlateNotice(null);
  }, [doc.id, selectedSpotChannelId]);

  const commitDocumentState = (nextDoc: ImageDocument) => {
    const before = doc;
    useImageEditorStore.setState((state) => ({
      documents: state.documents.map((candidate) => (candidate.id === doc.id ? nextDoc : candidate)),
    }));
    pushOperation({
      kind: 'documentState',
      docId: doc.id,
      before,
      after: nextDoc,
    });
  };

  const handleSaveSelection = () => {
    const selection = readLiveSelection();
    if (!selection) return;
    const nextChannel = buildSavedSelectionChannel(selection, channels);
    commitDocumentState({
      ...doc,
      dirty: true,
      savedSelectionChannels: truncateSavedSelectionChannels([...channels, nextChannel]),
    });
    setSelectedChannelId(nextChannel.id);
  };

  const handleDeleteSelected = () => {
    if (!selectedChannel) return;
    commitDocumentState({
      ...doc,
      dirty: true,
      savedSelectionChannels: channels.filter((channel) => channel.id !== selectedChannel.id),
    });
  };

  const handleRenameSelected = (name: string) => {
    if (!selectedChannel) return;
    const nextName = sanitizeSavedSelectionChannelName(name);
    if (!nextName || nextName === selectedChannel.name) return;
    commitDocumentState({
      ...doc,
      dirty: true,
      savedSelectionChannels: channels.map((channel) => (
        channel.id === selectedChannel.id
          ? { ...channel, name: nextName }
          : channel
      )),
    });
  };

  const handleSaveSpotChannel = () => {
    const selection = readLiveSelection();
    if (!selection) return;
    const nextChannel = buildImageSpotChannelEntry(selection, spotChannels);
    commitDocumentState({
      ...doc,
      dirty: true,
      spotChannels: [...spotChannels, nextChannel],
    });
    setSelectedSpotChannelId(nextChannel.id);
  };

  const handleUpdateSelectedSpotChannel = (
    updates: Parameters<typeof updateImageSpotChannelMetadata>[2],
  ) => {
    if (!selectedSpotChannel) return;
    const nextSpotChannels = updateImageSpotChannelMetadata(spotChannels, selectedSpotChannel.id, updates);
    if (nextSpotChannels === spotChannels) return;
    commitDocumentState({
      ...doc,
      dirty: true,
      spotChannels: nextSpotChannels,
    });
  };

  const handleDeleteSelectedSpotChannel = () => {
    if (!selectedSpotChannel) return;
    commitDocumentState({
      ...doc,
      dirty: true,
      spotChannels: spotChannels.filter((channel) => channel.id !== selectedSpotChannel.id),
    });
  };

  const handleDownloadSelectedSpotPlate = async () => {
    if (!selectedSpotChannel) {
      setSpotPlateNotice('This spot channel has invalid mask data and cannot produce a grayscale plate.');
      return;
    }
    const plate = buildImageSpotChannelGrayscalePlate(selectedSpotChannel);
    if (!plate) {
      setSpotPlateNotice('This spot channel has invalid mask data and cannot produce a grayscale plate.');
      return;
    }
    const outcome = await downloadBlobWithOutcome(
      new Blob([plate.data.buffer as ArrayBuffer], { type: plate.mimeType }),
      plate.filename,
    );
    if (outcome.status === 'saved') {
      setSpotPlateNotice(`Saved ${plate.filename} to ${outcome.location}: local grayscale coverage only, not press-ready output.`);
    } else if (outcome.status === 'started') {
      setSpotPlateNotice(`Download started for ${plate.filename}: local grayscale coverage only, not press-ready output.`);
    } else {
      setSpotPlateNotice(`Could not download ${plate.filename}: ${outcome.error}`);
    }
  };

  const handleSetActiveColorChannel = (channel: ImageColorChannel) => {
    if (channel === activeColorChannel) return;
    commitDocumentState({
      ...doc,
      dirty: true,
      activeColorChannel: channel,
    });
  };

  const handleLoadSelected = () => {
    if (!selectedChannel) return;
    if (selectedChannelRow && !selectedChannelRow.actions.loadSelection.enabled) return;
    if (selectedChannel.width !== doc.width || selectedChannel.height !== doc.height) return;
    const before = readLiveSelection();
    const after = applySavedSelectionChannel(selectedChannel, before ?? null, loadMode);
    commitSelectionChange(before ?? null, after);
  };

  const hasSelection = Boolean(liveSelection && maskBoundingBox(liveSelection));
  const sizeMismatch = Boolean(
    selectedChannel && (selectedChannel.width !== doc.width || selectedChannel.height !== doc.height),
  );
  const loadSelectedDisabled = selectedChannelRow
    ? !selectedChannelRow.actions.loadSelection.enabled
    : sizeMismatch;
  const safeRefineRadius = clampSelectionRefinementRadius(refineRadius);
  const selectAndMaskPreviewSelection = liveSelection
    ? buildSelectAndMaskPreviewMask(liveSelection, selectAndMaskSettings)
    : null;

  const commitSelectionChange = (before: SelectionMask | null, after: SelectionMask | null) => {
    pushOperation({
      kind: 'selection',
      docId: doc.id,
      before: before ? toSnapshot(before) : null,
      after: after ? toSnapshot(after) : null,
    });
    if (after && maskBoundingBox(after)) {
      setSelection(doc.id, after);
      setHasSelection(doc.id, true);
      return;
    }
    clearSelection(doc.id);
    setHasSelection(doc.id, false);
  };

  const handleSelectionRefinement = (actionId: typeof SELECTION_REFINEMENT_ACTIONS[number]['id']) => {
    const before = readLiveSelection();
    if (!before) return;
    const after = refineSelection(before, actionId, safeRefineRadius);
    commitSelectionChange(before, after);
  };

  const handleApplySelectAndMask = () => {
    const selection = readLiveSelection();
    if (!selection) return;
    const nextSelection = buildSelectAndMaskPreviewMask(selection, selectAndMaskSettings);
    switch (selectAndMaskSettings.outputMode) {
      case 'selection':
        commitSelectionChange(selection, nextSelection);
        break;
      case 'quickMask':
        commitSelectionChange(selection, nextSelection);
        setQuickMaskSettings({ enabled: true });
        break;
      case 'layerMask': {
        if (!activeLayer) return;
        // A linked consumer's mask lives in its source layer. Writing a local mask on top of
        // the retained link would leave mask + link coexisting — a state the .slimg v2
        // serializer refuses — so refuse before any mutation instead.
        if (activeLayer.maskLinkSourceLayerId) return;
        const nextMask = createLayerMaskFromSelection(doc, activeLayer, nextSelection, 'reveal-selection');
        const before = doc.layers;
        const after = doc.layers.map((layer) => (
          layer.id === activeLayer.id
            ? {
                ...activeLayer,
                mask: nextMask,
                maskDensity: activeLayer.maskDensity ?? 1,
                maskFeather: activeLayer.maskFeather ?? 0,
              }
            : layer
        ));
        pushOperation({
          kind: 'layerOp',
          docId: doc.id,
          before,
          after,
        });
        updateLayer(doc.id, activeLayer.id, {
          mask: nextMask,
          maskDensity: activeLayer.maskDensity ?? 1,
          maskFeather: activeLayer.maskFeather ?? 0,
        });
        setActiveLayerEditTarget(doc.id, 'mask');
        break;
      }
      case 'newAlphaChannel': {
        const nextChannel = buildSavedSelectionChannel(nextSelection, channels);
        commitDocumentState({
          ...doc,
          dirty: true,
          savedSelectionChannels: truncateSavedSelectionChannels([...channels, nextChannel]),
        });
        setSelectedChannelId(nextChannel.id);
        break;
      }
    }
    setSelectAndMaskSettings({ enabled: false });
  };

  return (
    <div className="h-full min-h-0 overflow-y-auto border-t border-cyan-300/10 bg-[#1a1b23] p-3 text-xs text-cyan-100/70">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="font-semibold uppercase tracking-[0.14em] text-cyan-100/55">Channels</div>
        <button
          aria-label="Save selection as alpha channel"
          className="inline-flex items-center gap-1 rounded border border-cyan-300/15 bg-[#10131b] px-2 py-1 font-semibold text-cyan-50 disabled:cursor-not-allowed disabled:text-cyan-100/25"
          disabled={!hasSelection}
          onClick={handleSaveSelection}
          type="button"
        >
          <Plus size={12} />
          Save
        </button>
      </div>

      <NativeCmykChannels doc={doc} />

      <div className="space-y-2">
        <section className="rounded border border-cyan-300/10 bg-[#10131b] p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="font-semibold text-cyan-100/80">Quick Mask</div>
            <button
              aria-label="Toggle Quick Mask"
              className={`rounded border px-2 py-1 font-semibold ${
                quickMaskSettings.enabled
                  ? 'border-cyan-300/35 bg-cyan-400/10 text-cyan-50'
                  : 'border-cyan-300/15 bg-[#0c1119] text-cyan-100/70'
              }`}
              onClick={toggleQuickMask}
              type="button"
            >
              {quickMaskSettings.enabled ? 'Exit' : 'Enter'}
            </button>
          </div>

          <div className="space-y-2 rounded border border-cyan-300/10 bg-[#0c1119] p-2">
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">View</span>
              <select
                aria-label="Quick mask view mode"
                className="w-full rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1 text-cyan-50"
                onChange={(event) => setQuickMaskSettings({ viewMode: event.target.value as QuickMaskViewMode })}
                value={quickMaskSettings.viewMode}
              >
                {QUICK_MASK_VIEW_MODES.map((mode) => (
                  <option className="bg-[#10131b]" key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Overlay Opacity</span>
              <input
                aria-label="Quick mask overlay opacity"
                className="w-full accent-cyan-300"
                max={0.9}
                min={0.1}
                onChange={(event) => setQuickMaskSettings({ overlayOpacity: Number(event.target.value) })}
                step={0.05}
                type="range"
                value={quickMaskSettings.overlayOpacity}
              />
            </label>
          </div>
        </section>

        <section className="rounded border border-cyan-300/10 bg-[#10131b] p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="font-semibold text-cyan-100/80">Refine Selection</div>
            <span className="font-mono text-[10px] text-cyan-100/35">{safeRefineRadius}px</span>
          </div>
          <div className="space-y-2 rounded border border-cyan-300/10 bg-[#0c1119] p-2">
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Radius</span>
              <input
                aria-label="Selection refinement radius"
                className="w-full rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1 text-cyan-50"
                max={64}
                min={1}
                onChange={(event) => setRefineRadius(Number(event.target.value))}
                step={1}
                type="number"
                value={safeRefineRadius}
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              {SELECTION_REFINEMENT_ACTIONS.map((action) => (
                <button
                  aria-label={action.ariaLabel}
                  className="rounded border border-cyan-300/15 bg-[#10131b] px-2 py-1 font-semibold text-cyan-50 disabled:cursor-not-allowed disabled:text-cyan-100/25"
                  disabled={!hasSelection}
                  key={action.id}
                  onClick={() => handleSelectionRefinement(action.id)}
                  type="button"
                >
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        <section className="rounded border border-cyan-300/10 bg-[#10131b] p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="font-semibold text-cyan-100/80">Select &amp; Mask</div>
            <button
              aria-label="Toggle Select and Mask preview"
              className={`rounded border px-2 py-1 font-semibold ${
                selectAndMaskSettings.enabled
                  ? 'border-cyan-300/35 bg-cyan-400/10 text-cyan-50'
                  : 'border-cyan-300/15 bg-[#0c1119] text-cyan-100/70'
              }`}
              disabled={!hasSelection}
              onClick={toggleSelectAndMask}
              type="button"
            >
              {selectAndMaskSettings.enabled ? 'Exit' : 'Enter'}
            </button>
          </div>
          <div className="space-y-2 rounded border border-cyan-300/10 bg-[#0c1119] p-2">
            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Preview</span>
              <select
                aria-label="Select and Mask preview mode"
                className="w-full rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1 text-cyan-50"
                onChange={(event) => setSelectAndMaskSettings({ previewMode: event.target.value as SelectAndMaskPreviewMode })}
                value={selectAndMaskSettings.previewMode}
              >
                {SELECT_AND_MASK_PREVIEW_MODES.map((mode) => (
                  <option className="bg-[#10131b]" key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Smooth</span>
                <input
                  aria-label="Select and Mask smooth"
                  className="w-full rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1 text-cyan-50"
                  max={8}
                  min={0}
                  onChange={(event) => setSelectAndMaskSettings({ smooth: Number(event.target.value) })}
                  step={1}
                  type="number"
                  value={selectAndMaskSettings.smooth}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Feather</span>
                <input
                  aria-label="Select and Mask feather"
                  className="w-full rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1 text-cyan-50"
                  max={32}
                  min={0}
                  onChange={(event) => setSelectAndMaskSettings({ feather: Number(event.target.value) })}
                  step={1}
                  type="number"
                  value={selectAndMaskSettings.feather}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Contrast</span>
                <input
                  aria-label="Select and Mask contrast"
                  className="w-full rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1 text-cyan-50"
                  max={100}
                  min={0}
                  onChange={(event) => setSelectAndMaskSettings({ contrast: Number(event.target.value) })}
                  step={5}
                  type="number"
                  value={selectAndMaskSettings.contrast}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Shift Edge</span>
                <input
                  aria-label="Select and Mask shift edge"
                  className="w-full rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1 text-cyan-50"
                  max={16}
                  min={-16}
                  onChange={(event) => setSelectAndMaskSettings({ shiftEdge: Number(event.target.value) })}
                  step={1}
                  type="number"
                  value={selectAndMaskSettings.shiftEdge}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Smart Radius</span>
                <input
                  aria-label="Select and Mask radius"
                  className="w-full rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1 text-cyan-50"
                  max={64}
                  min={0}
                  onChange={(event) => setSelectAndMaskSettings({ refineRadius: Number(event.target.value) })}
                  step={1}
                  type="number"
                  value={selectAndMaskSettings.refineRadius}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Decontaminate</span>
                <input
                  aria-label="Select and Mask decontaminate amount"
                  className="w-full rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1 text-cyan-50 disabled:opacity-45"
                  disabled={!selectAndMaskSettings.decontaminateColors}
                  max={1}
                  min={0}
                  onChange={(event) => setSelectAndMaskSettings({ decontaminateAmount: Number(event.target.value) })}
                  step={0.05}
                  type="number"
                  value={selectAndMaskSettings.decontaminateAmount}
                />
              </label>
            </div>

            <label className="flex items-center gap-2">
              <input
                aria-label="Select and Mask decontaminate colors"
                checked={selectAndMaskSettings.decontaminateColors}
                onChange={(event) => setSelectAndMaskSettings({ decontaminateColors: event.target.checked })}
                type="checkbox"
              />
              <span className="text-[11px] text-cyan-100/65">Decontaminate Colors</span>
            </label>

            <label className="block space-y-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Output</span>
              <select
                aria-label="Select and Mask output mode"
                className="w-full rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1 text-cyan-50"
                onChange={(event) => setSelectAndMaskSettings({ outputMode: event.target.value as SelectAndMaskOutputMode })}
                value={selectAndMaskSettings.outputMode}
              >
                {SELECT_AND_MASK_OUTPUT_MODES.map((mode) => (
                  <option className="bg-[#10131b]" key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              aria-label="Apply Select and Mask output"
              className="w-full rounded border border-cyan-300/15 bg-[#10131b] px-2 py-1 font-semibold text-cyan-50 disabled:cursor-not-allowed disabled:text-cyan-100/25"
              disabled={!selectAndMaskPreviewSelection || layerMaskOutputBlockedByLink || (selectAndMaskSettings.outputMode === 'layerMask' && !activeLayer)}
              onClick={handleApplySelectAndMask}
              type="button"
            >
              Apply
            </button>
            {layerMaskOutputBlockedByLink ? (
              <div
                className="rounded border border-amber-300/15 bg-amber-400/5 px-2 py-1.5 text-[11px] text-amber-100/70"
                data-testid="select-and-mask-refusal"
                role="alert"
              >
                Layer Mask output is unavailable while this layer shows a linked mask from another layer. Unlink it into an independent copy first.
              </div>
            ) : null}
          </div>
        </section>

        <section className="rounded border border-cyan-300/10 bg-[#10131b] p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="font-semibold text-cyan-100/80">Color Channels</div>
            <span
              className="rounded border border-cyan-300/10 bg-[#0c1119] px-2 py-0.5 font-mono text-[10px] text-cyan-100/50"
              data-testid="active-color-channel"
            >
              {activeColorChannelLabel}
            </span>
          </div>
          <div className="space-y-1">
            {colorChannelRows.map((channel) => {
              if (!channel.channel) return null;
              const colorChannel = channel.channel;
              const isActive = colorChannel === activeColorChannel;
              return (
                <button
                  aria-label={`Set active color channel to ${channel.label}`}
                  aria-pressed={isActive}
                  className={`flex w-full items-center justify-between rounded border px-2 py-1.5 text-left ${
                    isActive
                      ? 'border-cyan-300/35 bg-cyan-400/10 text-cyan-50'
                      : 'border-cyan-300/10 bg-[#0c1119] text-cyan-100/70'
                  }`}
                  key={channel.id}
                  onClick={() => handleSetActiveColorChannel(colorChannel)}
                  type="button"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{channel.label}</span>
                    <span className="mt-0.5 block truncate text-[10px] text-cyan-100/38">{channel.detail}</span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <span className="rounded border border-cyan-300/10 bg-[#070b12] px-1.5 py-0.5 text-[10px] text-cyan-100/45">
                        {channel.actions.visibility.label}
                      </span>
                      <span className="rounded border border-cyan-300/10 bg-[#070b12] px-1.5 py-0.5 text-[10px] text-cyan-100/55">
                        {channel.actions.edit.label}
                      </span>
                      <span className="rounded border border-cyan-300/10 bg-[#070b12] px-1.5 py-0.5 text-[10px] text-cyan-100/38">
                        {channel.actions.loadSelection.label}
                      </span>
                    </span>
                  </span>
                  <span className="inline-flex shrink-0 items-center gap-2 pl-2">
                    <span className="font-mono text-[10px] text-cyan-100/35">{channel.shortLabel}</span>
                    <Eye size={12} className={isActive ? 'text-cyan-100/80' : 'text-cyan-100/35'} />
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-2 rounded border border-cyan-300/10 bg-[#0c1119] px-2 py-1.5 text-[11px] text-cyan-100/45">
            Edit target: {channelEditTarget.components.join(', ')}
          </div>
          <div className="mt-2 space-y-1 rounded border border-cyan-300/10 bg-[#0c1119] px-2 py-1.5 text-[10px] text-cyan-100/38">
            {colorChannelRows[0]?.limitations.map((limitation) => (
              <div key={limitation}>{limitation}</div>
            ))}
          </div>
        </section>

        <section className="rounded border border-cyan-300/10 bg-[#10131b] p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="font-semibold text-cyan-100/80">Spot Channels</div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-[10px] text-cyan-100/40">{spotChannels.length}</span>
              <button
                aria-label="Save selection as spot channel"
                className="inline-flex items-center gap-1 rounded border border-cyan-300/15 bg-[#10131b] px-2 py-1 font-semibold text-cyan-50 disabled:cursor-not-allowed disabled:text-cyan-100/25"
                disabled={!hasSelection}
                onClick={handleSaveSpotChannel}
                type="button"
              >
                <Plus size={12} />
                Spot
              </button>
            </div>
          </div>

          <div className="space-y-1">
            {spotChannels.length === 0 ? (
              <div className="rounded border border-dashed border-cyan-300/10 bg-[#0c1119] px-2 py-2 text-cyan-100/35">
                No spot channels.
              </div>
            ) : spotChannelRows.map((channel) => (
              <button
                aria-label={`Select spot channel ${channel.name}`}
                className={`flex w-full items-center justify-between rounded border px-2 py-1.5 text-left ${
                  channel.id === selectedSpotChannelId
                    ? 'border-cyan-300/35 bg-cyan-400/10 text-cyan-50'
                    : 'border-cyan-300/10 bg-[#0c1119] text-cyan-100/70'
                }`}
                key={channel.id}
                onClick={() => setSelectedSpotChannelId(channel.id)}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate">{channel.name}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-cyan-100/38">
                    RGB tint overlay · opacity {channel.tint.opacity} · solidity {channel.tint.solidity}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded border border-cyan-300/10 bg-[#070b12] px-1.5 py-0.5 text-[10px] text-cyan-100/45">
                      {channel.tint.visible ? 'Visible' : 'Hidden'}
                    </span>
                    <span className="rounded border border-cyan-300/10 bg-[#070b12] px-1.5 py-0.5 text-[10px] text-cyan-100/55">
                      Metadata preview
                    </span>
                  </span>
                </span>
                <span className="shrink-0 pl-2 font-mono text-[10px] text-cyan-100/35">
                  {channel.dimensions}
                </span>
              </button>
            ))}
          </div>

          {!selectedSpotChannel ? (
            <div className="mt-2 space-y-1 rounded border border-cyan-300/10 bg-[#0c1119] px-2 py-1.5 text-[10px] text-cyan-100/38">
              {spotPanelDescriptor.summaryLines.map((line) => (
                <div key={line}>{line}</div>
              ))}
            </div>
          ) : null}

          {selectedSpotChannel ? (
            <div className="mt-3 space-y-2 rounded border border-cyan-300/10 bg-[#0c1119] p-2">
              <div
                data-document-signature={spotPanelDescriptor.documentCompatibility?.signature ?? 'none'}
                data-panel-signature={spotPanelDescriptor.signature}
                data-testid="spot-channel-readiness-signatures"
                hidden
              />

              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Name</span>
                <input
                  aria-label="Selected spot channel name"
                  className="w-full rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1 text-cyan-50"
                  defaultValue={selectedSpotChannel.name}
                  onChange={(event) => handleUpdateSelectedSpotChannel({ name: event.target.value })}
                  onBlur={(event) => handleUpdateSelectedSpotChannel({ name: event.target.value })}
                  type="text"
                />
              </label>

              <div className="grid grid-cols-3 gap-2">
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Red</span>
                  <input
                    aria-label="Selected spot channel red"
                    className="w-full rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1 text-cyan-50"
                    max={255}
                    min={0}
                    onChange={(event) => handleUpdateSelectedSpotChannel({ color: { r: Number(event.target.value) } })}
                    step={1}
                    type="number"
                    value={selectedSpotChannel.color.r}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Green</span>
                  <input
                    aria-label="Selected spot channel green"
                    className="w-full rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1 text-cyan-50"
                    max={255}
                    min={0}
                    onChange={(event) => handleUpdateSelectedSpotChannel({ color: { g: Number(event.target.value) } })}
                    step={1}
                    type="number"
                    value={selectedSpotChannel.color.g}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Blue</span>
                  <input
                    aria-label="Selected spot channel blue"
                    className="w-full rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1 text-cyan-50"
                    max={255}
                    min={0}
                    onChange={(event) => handleUpdateSelectedSpotChannel({ color: { b: Number(event.target.value) } })}
                    step={1}
                    type="number"
                    value={selectedSpotChannel.color.b}
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Opacity</span>
                  <input
                    aria-label="Selected spot channel opacity"
                    className="w-full rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1 text-cyan-50"
                    max={1}
                    min={0}
                    onChange={(event) => handleUpdateSelectedSpotChannel({ opacity: Number(event.target.value) })}
                    step={0.05}
                    type="number"
                    value={selectedSpotChannel.opacity}
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Solidity</span>
                  <input
                    aria-label="Selected spot channel solidity"
                    className="w-full rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1 text-cyan-50"
                    max={1}
                    min={0}
                    onChange={(event) => handleUpdateSelectedSpotChannel({ solidity: Number(event.target.value) })}
                    step={0.05}
                    type="number"
                    value={selectedSpotChannel.solidity}
                  />
                </label>
              </div>

              <label className="flex items-center justify-between gap-2 rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Visible</span>
                <input
                  aria-label="Selected spot channel visibility"
                  checked={selectedSpotChannel.visible !== false}
                  className="accent-cyan-300"
                  onChange={(event) => handleUpdateSelectedSpotChannel({ visible: event.target.checked })}
                  type="checkbox"
                />
              </label>

              <div className="space-y-1 rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1.5 text-[10px] text-cyan-100/45">
                {spotPanelDescriptor.summaryLines.map((line) => (
                  <div key={line}>{line}</div>
                ))}
                {spotPanelDescriptor.warnings.slice(1).map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </div>

              <div className="space-y-2 rounded border border-cyan-300/10 bg-[#070b12] px-2 py-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/55">
                      Local grayscale plate
                    </div>
                    <div className="mt-0.5 text-[10px] text-cyan-100/42">
                      {selectedSpotChannel && selectedSpotPlateDimensions
                        ? `${selectedSpotPlateDimensions.width}×${selectedSpotPlateDimensions.height} · ${(selectedSpotPlateDimensions.effectiveOpacity * 100).toFixed(0)}% ink coverage scale · ${selectedSpotPlateDimensions.byteLength} bytes`
                        : 'Invalid mask data blocks plate export.'}
                    </div>
                  </div>
                  <button
                    aria-label={`Download grayscale plate for ${selectedSpotChannel.name}`}
                    className="inline-flex shrink-0 items-center gap-1 rounded border border-cyan-300/15 bg-[#10131b] px-2 py-1 font-semibold text-cyan-50 disabled:cursor-not-allowed disabled:text-cyan-100/25"
                    disabled={!selectedSpotChannel || !selectedSpotPlateDimensions}
                    onClick={handleDownloadSelectedSpotPlate}
                    type="button"
                  >
                    <Download size={12} />
                    PGM plate
                  </button>
                </div>
                <div data-testid="spot-channel-grayscale-plate" data-plate-signature={selectedSpotChannel && selectedSpotPlateDimensions ? `spot-grayscale-plate:v1:${selectedSpotChannel.id}:${selectedSpotPlateDimensions.width}x${selectedSpotPlateDimensions.height}:${selectedSpotPlateDimensions.effectiveOpacity}:${selectedSpotChannel.visible === false ? 'hidden' : 'visible'}:${selectedSpotPlateDimensions.byteLength}` : 'invalid'} hidden />
                {selectedSpotChannel ? ['Local grayscale coverage preview only; native PSD and press-ready separations are not produced.'].map((limitation) => (
                  <div className="text-[10px] text-amber-100/60" key={limitation}>{limitation}</div>
                )) : null}
                {spotPlateNotice ? <div className="text-[10px] text-cyan-100/60">{spotPlateNotice}</div> : null}
              </div>

              {spotPanelDescriptor.blockers?.map((blocker) => (
                <div
                  className="rounded border border-amber-300/15 bg-amber-400/5 px-2 py-1.5 text-[11px] text-amber-100/70"
                  key={blocker}
                >
                  {blocker}
                </div>
              ))}

              <button
                aria-label="Delete selected spot channel"
                className="inline-flex items-center gap-1 rounded border border-red-300/15 bg-[#10131b] px-2 py-1 font-semibold text-red-100/85"
                onClick={handleDeleteSelectedSpotChannel}
                type="button"
              >
                <Trash2 size={12} />
                Delete
              </button>
            </div>
          ) : null}
        </section>

        <section className="rounded border border-cyan-300/10 bg-[#10131b] p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="font-semibold text-cyan-100/80">Alpha Channels</div>
            <span className="font-mono text-[10px] text-cyan-100/40">{channels.length}</span>
          </div>
          <div className="space-y-1">
            {channels.length === 0 ? (
              <div className="rounded border border-dashed border-cyan-300/10 bg-[#0c1119] px-2 py-2 text-cyan-100/35">
                No saved alpha channels.
              </div>
            ) : alphaChannelRows.map((channel) => (
              <button
                aria-label={`Select alpha channel ${channel.label}`}
                className={`flex w-full items-center justify-between rounded border px-2 py-1.5 text-left ${
                  channel.channelId === selectedChannelId
                    ? 'border-cyan-300/35 bg-cyan-400/10 text-cyan-50'
                    : 'border-cyan-300/10 bg-[#0c1119] text-cyan-100/70'
                }`}
                key={channel.id}
                onClick={() => setSelectedChannelId(channel.channelId ?? null)}
                type="button"
              >
                <span className="min-w-0">
                  <span className="block truncate">{channel.label}</span>
                  <span className="mt-0.5 block truncate text-[10px] text-cyan-100/38">{channel.detail}</span>
                  <span className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded border border-cyan-300/10 bg-[#070b12] px-1.5 py-0.5 text-[10px] text-cyan-100/45">
                      {channel.actions.visibility.label}
                    </span>
                    <span className="rounded border border-cyan-300/10 bg-[#070b12] px-1.5 py-0.5 text-[10px] text-cyan-100/55">
                      {channel.actions.loadSelection.label}
                    </span>
                  </span>
                </span>
                <span className="shrink-0 pl-2 font-mono text-[10px] text-cyan-100/35">
                  {channel.dimensions}
                </span>
              </button>
            ))}
          </div>

          {selectedChannel ? (
            <div className="mt-3 space-y-2 rounded border border-cyan-300/10 bg-[#0c1119] p-2">
              <div
                data-action-signature={alphaPanelDescriptor.actionReadiness.signature}
                data-load-mode-signatures={alphaPanelDescriptor.actionReadiness.loadModes.map((mode) => mode.signature).join('|')}
                data-testid="alpha-channel-readiness-signatures"
                hidden
              />

              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Name</span>
                <input
                  aria-label="Selected alpha channel name"
                  className="w-full rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1 text-cyan-50"
                  defaultValue={selectedChannel.name}
                  onBlur={(event) => handleRenameSelected(event.target.value)}
                  type="text"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-cyan-100/45">Load Mode</span>
                <select
                  aria-label="Alpha channel load mode"
                  className="w-full rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1 text-cyan-50"
                  onChange={(event) => setLoadMode(event.target.value as SelectionMode)}
                  value={loadMode}
                >
                  {LOAD_MODES.map((mode) => (
                    <option className="bg-[#10131b]" key={mode.value} value={mode.value}>
                      {mode.label}
                    </option>
                  ))}
                </select>
              </label>

              <div className="space-y-1 rounded border border-cyan-300/10 bg-[#070b12] px-2 py-1.5 text-[10px] text-cyan-100/45">
                {alphaPanelDescriptor.summaryLines.map((line) => (
                  <div key={line}>{line}</div>
                ))}
                <div>{alphaPanelDescriptor.actionReadiness.loadSelection.summary}</div>
                <div>{alphaPanelDescriptor.actionReadiness.exportMetadata.summary}</div>
                {selectedChannelRow?.limitations.map((limitation) => (
                  <div key={limitation}>{limitation}</div>
                ))}
                {alphaPanelDescriptor.warnings.map((warning) => (
                  <div key={warning}>{warning}</div>
                ))}
              </div>

              {[...alphaPanelDescriptor.blockers, ...(selectedChannelRow?.warnings ?? [])].map((warning) => (
                <div
                  className="rounded border border-amber-300/15 bg-amber-400/5 px-2 py-1.5 text-[11px] text-amber-100/70"
                  key={warning}
                >
                  {warning}
                </div>
              ))}

              <div className="flex gap-2">
                <button
                  aria-label="Load selected alpha channel to selection"
                  className="flex-1 rounded border border-cyan-300/15 bg-[#10131b] px-2 py-1 font-semibold text-cyan-50 disabled:cursor-not-allowed disabled:text-cyan-100/25"
                  disabled={loadSelectedDisabled}
                  onClick={handleLoadSelected}
                  type="button"
                >
                  Load
                </button>
                <button
                  aria-label="Delete selected alpha channel"
                  className="inline-flex items-center gap-1 rounded border border-red-300/15 bg-[#10131b] px-2 py-1 font-semibold text-red-100/85"
                  onClick={handleDeleteSelected}
                  type="button"
                >
                  <Trash2 size={12} />
                  Delete
                </button>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function NativeCmykChannels({ doc }: { doc: ImageDocument }) {
  const commit = useImageEditorStore((state) => state.commitCmykPlateEdit);
  const activeLayer = doc.layers.find((layer) => layer.id === doc.activeLayerId);
  const [solo, setSolo] = useState<'c' | 'm' | 'y' | 'k' | null>(null);
  if (doc.metadata?.colorMode !== 'cmyk' || !activeLayer?.cmykPixels) return null;
  const plates = [
    ['c', 'Cyan'], ['m', 'Magenta'], ['y', 'Yellow'], ['k', 'Black'],
  ] as const;
  return (
    <section aria-label="Native CMYK channels" className="mb-2 rounded border border-cyan-300/10 bg-[#10131b] p-2">
      <div className="mb-1 font-semibold text-cyan-100/80">Native CMYK plates</div>
      <div className="space-y-1">
        {plates.map(([plate, label]) => (
          <div className="flex items-center gap-1.5" key={plate}>
            <button
              aria-pressed={solo === plate}
              aria-label={`Solo ${label} plate`}
              className={`flex-1 rounded border px-2 py-1 text-left ${solo === plate ? 'border-cyan-300/35 bg-cyan-400/10' : 'border-cyan-300/10 bg-[#0c1119]'}`}
              onClick={() => setSolo((current) => current === plate ? null : plate)}
              type="button"
            >{label} <span className="font-mono text-[10px] text-cyan-100/40">{plate.toUpperCase()}</span></button>
            <button
              aria-label={`Set ${label} plate to 50 percent`}
              className="rounded border border-cyan-300/10 px-1.5 py-1 text-[10px] text-cyan-100/55"
              onClick={() => void commit(doc.id, activeLayer.id, plate, () => 128)}
              type="button"
            >50%</button>
          </div>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-cyan-100/35">Plate edits are native u8 ink history. Solo marks a proof selection; the canvas stays ICC-rendered.</p>
    </section>
  );
}

function refineSelection(
  selection: SelectionMask,
  actionId: typeof SELECTION_REFINEMENT_ACTIONS[number]['id'],
  radius: number,
): SelectionMask {
  switch (actionId) {
    case 'grow':
      return growSelection(selection, radius);
    case 'shrink':
      return shrinkSelection(selection, radius);
    case 'feather':
      return featherSelection(selection, radius);
    case 'border':
      return borderSelection(selection, radius);
    case 'smooth':
      return smoothSelection(selection);
  }
}

function clampSelectionRefinementRadius(value: number): number {
  if (!Number.isFinite(value)) return 2;
  return Math.max(1, Math.min(64, Math.round(value)));
}
