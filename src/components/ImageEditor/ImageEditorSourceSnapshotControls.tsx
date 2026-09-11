import { useRef, useState } from 'react';
import type { ImageDocument, ImageLayer } from '../../types/imageEditor';
import type { SourceBinLibraryItem } from '../../store/sourceBinStore';
import { inspectImageDocumentSnapshotIntegrity } from './ImageSnapshots';

export type ImageSuiteHandoffTarget = 'flow' | 'video' | 'paper';
export type ImageSourceLibraryAssetUrlKind = 'none' | 'blob' | 'data' | 'native' | 'remote' | 'file';
export type ImageSourceLibraryHandoffWarningCode =
  | 'missing-durable-source-id'
  | 'missing-asset-url'
  | 'blob-only-asset';

export interface ImageSourceLibraryHandoffWarning {
  code: ImageSourceLibraryHandoffWarningCode;
  message: string;
}

export interface ImageSourceLibraryHandoffTargetDescriptor {
  target: ImageSuiteHandoffTarget;
  ready: boolean;
  reason: string;
}

export interface ImageSourceLibraryHandoffDescriptor {
  descriptorId: 'image-source-library-handoff:v1';
  documentId: string;
  layerId: string;
  label: string;
  mimeType?: string;
  sourceId: string | null;
  sourceKind: 'source-linked-layer' | 'generated-source-asset' | 'document-source';
  sourceDimensions?: { width: number; height: number };
  asset: {
    assetUrlKind: ImageSourceLibraryAssetUrlKind;
    blobOnly: boolean;
    durableAsset: boolean;
    hasAssetUrl: boolean;
  };
  sendTo: Record<ImageSuiteHandoffTarget, ImageSourceLibraryHandoffTargetDescriptor>;
  warnings: ImageSourceLibraryHandoffWarning[];
  previewSignature: string;
}

export interface ImageReferenceSnapshotLayerDescriptor {
  snapshotId: string;
  name: string;
  createdAt: number;
  width: number;
  height: number;
  layerCount: number;
  activeLayerId: string | null;
  hasSelection: boolean;
  selectionVersion: number;
  sourceIds: string[];
  missingSourceLayerIds: string[];
}

export interface ImageReferenceSnapshotsHandoffDescriptor {
  descriptorId: 'image-reference-snapshots-handoff:v1';
  documentId: string;
  snapshotCount: number;
  snapshots: ImageReferenceSnapshotLayerDescriptor[];
  warnings: Array<{ code: 'snapshot-missing-source-id'; message: string; snapshotId: string }>;
  previewSignature: string;
}

export function describeImageSourceLibraryHandoff({
  doc,
  layer,
  sourceItem,
}: {
  doc: ImageDocument;
  layer: ImageLayer;
  sourceItem?: SourceBinLibraryItem;
}): ImageSourceLibraryHandoffDescriptor {
  const sourceId = getLayerDurableSourceId(layer, sourceItem, doc);
  const label = sourceItem?.label
    ?? layer.metadata?.sourceLink?.label
    ?? layer.metadata?.sourceLabel
    ?? layer.name;
  const mimeType = sourceItem?.mimeType ?? layer.metadata?.sourceMimeType;
  const assetUrlKind = getSourceAssetUrlKind(sourceItem?.assetUrl);
  const blobOnly = isBlobOnlySourceAsset(sourceItem);
  const hasAssetUrl = Boolean(sourceItem?.assetUrl);
  const warnings = buildSourceLibraryHandoffWarnings({ layer, sourceId, sourceItem, blobOnly, hasAssetUrl });
  const durableAsset = Boolean(sourceId && hasAssetUrl && !blobOnly);
  const sourceDimensions = getLayerSourceDimensions(layer, sourceItem);
  const sendTo = {
    flow: describeSourceLibraryTargetReadiness('flow', { sourceId, sourceItem, blobOnly, hasAssetUrl }),
    video: describeSourceLibraryTargetReadiness('video', { sourceId, sourceItem, blobOnly, hasAssetUrl }),
    paper: describeSourceLibraryTargetReadiness('paper', { sourceId, sourceItem, blobOnly, hasAssetUrl }),
  };

  return {
    descriptorId: 'image-source-library-handoff:v1',
    documentId: doc.id,
    layerId: layer.id,
    label,
    ...(mimeType ? { mimeType } : {}),
    sourceId,
    sourceKind: getSourceLibraryHandoffKind(layer, sourceItem),
    ...(sourceDimensions ? { sourceDimensions } : {}),
    asset: {
      assetUrlKind,
      blobOnly,
      durableAsset,
      hasAssetUrl,
    },
    sendTo,
    warnings,
    previewSignature: `image-source-library-handoff:v1:${JSON.stringify({
      documentId: doc.id,
      layerId: layer.id,
      sourceId,
      assetUrlKind,
      blobOnly,
      warnings: warnings.map((warning) => warning.code),
    })}`,
  };
}

export function describeImageReferenceSnapshotsHandoff(
  doc: ImageDocument,
): ImageReferenceSnapshotsHandoffDescriptor {
  const snapshots = (doc.snapshots ?? []).map((snapshot) => {
    const sourceIds = dedupeAndSortStrings(snapshot.layers.flatMap((layer) => {
      const sourceId = getLayerDurableSourceId(layer);
      return sourceId ? [sourceId] : [];
    }));
    const missingSourceLayerIds = snapshot.layers
      .filter((layer) => layerHasSourceMetadata(layer) && !getLayerDurableSourceId(layer))
      .map((layer) => layer.id)
      .sort();

    return {
      snapshotId: snapshot.id,
      name: snapshot.name,
      createdAt: snapshot.createdAt,
      width: snapshot.width,
      height: snapshot.height,
      layerCount: snapshot.layers.length,
      activeLayerId: snapshot.activeLayerId,
      hasSelection: snapshot.hasSelection,
      selectionVersion: snapshot.selectionVersion,
      sourceIds,
      missingSourceLayerIds,
    };
  });
  const warnings = snapshots.flatMap((snapshot) => (
    snapshot.missingSourceLayerIds.length > 0
      ? [{
          code: 'snapshot-missing-source-id' as const,
          snapshotId: snapshot.snapshotId,
          message: `Snapshot "${snapshot.name}" has ${snapshot.missingSourceLayerIds.length} source-linked layer(s) without durable Source Library ids.`,
        }]
      : []
  ));

  return {
    descriptorId: 'image-reference-snapshots-handoff:v1',
    documentId: doc.id,
    snapshotCount: snapshots.length,
    snapshots,
    warnings,
    previewSignature: `image-reference-snapshots-handoff:v1:${JSON.stringify({
      documentId: doc.id,
      snapshots: snapshots.map((snapshot) => ({
        snapshotId: snapshot.snapshotId,
        sourceIds: snapshot.sourceIds,
        missingSourceLayerIds: snapshot.missingSourceLayerIds,
      })),
    })}`,
  };
}

export function SourceLinkedLayerControls({
  disabled,
  layer,
  sourceItems,
  sourceExists,
  onRelink,
  onReveal,
  onUpdate,
}: {
  disabled?: boolean;
  layer: ImageLayer;
  sourceItems: Array<{ id: string; label: string }>;
  sourceExists: boolean;
  onRelink: (sourceId: string) => void;
  onReveal: () => void;
  onUpdate: () => void;
}) {
  const sourceId = layer.metadata?.smartLinkedSourceId ?? '';
  const sourceLink = layer.metadata?.sourceLink;
  return (
    <div className="mt-2 border-t border-cyan-300/10 pt-2">
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-cyan-100/40">Source Link</label>
        <span className={`text-[10px] uppercase tracking-wide ${sourceExists ? 'text-emerald-100/50' : 'text-red-200/55'}`}>
          {sourceExists ? 'Found' : 'Missing'}
        </span>
      </div>
      <div className="mb-2 truncate rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1 text-[10px] text-cyan-100/45" title={sourceId}>
        {layer.metadata?.sourceLabel || sourceId}
        {sourceLink?.width && sourceLink?.height ? ` · ${sourceLink.width}×${sourceLink.height}` : ''}
      </div>
      <select
        className="mb-2 w-full rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-1 text-[11px] text-cyan-100/70 disabled:cursor-not-allowed disabled:opacity-40"
        disabled={disabled}
        onChange={(event) => onRelink(event.target.value)}
        value={sourceId}
      >
        {sourceItems.map((item) => (
          <option key={item.id} value={item.id}>{item.label}</option>
        ))}
      </select>
      <div className="grid grid-cols-3 gap-1">
        <button
          className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-cyan-100/60 hover:border-cyan-300/35 hover:text-white"
          onClick={onReveal}
          type="button"
        >
          Reveal Source
        </button>
        <button
          className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-cyan-100/60 hover:border-emerald-300/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          disabled={disabled || !sourceExists}
          onClick={onUpdate}
          type="button"
        >
          Update Layer
        </button>
        <button
          className="rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-[11px] font-semibold text-cyan-100/60 hover:border-emerald-300/40 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          disabled={disabled || sourceExists}
          onClick={() => onRelink(sourceItems[0]?.id ?? '')}
          type="button"
        >
          Repair
        </button>
      </div>
      {sourceLink?.relinkHistory?.length ? (
        <p className="mt-1 text-[10px] text-cyan-100/30">Relinked {sourceLink.relinkHistory.length} time(s).</p>
      ) : null}
      <div className="mt-2 space-y-1 text-[10px] text-cyan-100/35">
        <p>Replace updates this layer from Source Library metadata without rewriting the original source asset.</p>
        <p>Edit Original remains metadata-only; Sloom Studio does not launch a native Smart Object editor.</p>
        <p>
          {sourceExists
            ? 'Video handoff uses flattened pixels plus Source Library provenance; native Smart Object parity is unavailable.'
            : 'Repair the durable Source Library asset before relying on source-aware refresh or Video handoff.'}
        </p>
      </div>
    </div>
  );
}

function getLayerDurableSourceId(
  layer: ImageLayer,
  sourceItem?: Pick<SourceBinLibraryItem, 'id'>,
  doc?: Pick<ImageDocument, 'sourceBinItemId'>,
): string | null {
  return sourceItem?.id
    ?? layer.metadata?.sourceLink?.id
    ?? layer.metadata?.smartLinkedSourceId
    ?? doc?.sourceBinItemId
    ?? null;
}

function getSourceLibraryHandoffKind(
  layer: ImageLayer,
  sourceItem: SourceBinLibraryItem | undefined,
): ImageSourceLibraryHandoffDescriptor['sourceKind'] {
  if (layer.metadata?.sourceLink || layer.metadata?.smartLinkedSourceId) return 'source-linked-layer';
  if (sourceItem?.isGenerated || layer.metadata?.sourceFormat === 'generative-fill') return 'generated-source-asset';
  return 'document-source';
}

function getSourceAssetUrlKind(assetUrl: string | undefined): ImageSourceLibraryAssetUrlKind {
  if (!assetUrl) return 'none';
  if (assetUrl.startsWith('blob:')) return 'blob';
  if (assetUrl.startsWith('data:')) return 'data';
  if (assetUrl.startsWith('signal-loom-asset:')) return 'native';
  if (/^https?:\/\//i.test(assetUrl)) return 'remote';
  return 'file';
}

function isBlobOnlySourceAsset(sourceItem: SourceBinLibraryItem | undefined): boolean {
  return Boolean(
    sourceItem?.assetUrl?.startsWith('blob:')
      && !sourceItem.assetId
      && !sourceItem.scratchFileName
      && !sourceItem.nativeFilePath,
  );
}

function getLayerSourceDimensions(
  layer: ImageLayer,
  sourceItem: SourceBinLibraryItem | undefined,
): ImageSourceLibraryHandoffDescriptor['sourceDimensions'] {
  const width = layer.metadata?.sourceLink?.width ?? sourceItem?.pixelWidth ?? layer.bitmap?.width;
  const height = layer.metadata?.sourceLink?.height ?? sourceItem?.pixelHeight ?? layer.bitmap?.height;
  if (!Number.isFinite(width) || !Number.isFinite(height) || !width || !height) return undefined;
  return { width, height };
}

function buildSourceLibraryHandoffWarnings({
  layer,
  sourceId,
  sourceItem,
  blobOnly,
  hasAssetUrl,
}: {
  layer: ImageLayer;
  sourceId: string | null;
  sourceItem: SourceBinLibraryItem | undefined;
  blobOnly: boolean;
  hasAssetUrl: boolean;
}): ImageSourceLibraryHandoffWarning[] {
  const warnings: ImageSourceLibraryHandoffWarning[] = [];
  if (!sourceId) {
    warnings.push({
      code: 'missing-durable-source-id',
      message: `Layer "${layer.id}" is not linked to a durable Source Library item.`,
    });
  }
  if (sourceId && !hasAssetUrl) {
    warnings.push({
      code: 'missing-asset-url',
      message: `Source Library item "${sourceId}" has no asset URL for suite handoff.`,
    });
  }
  if (blobOnly && sourceItem) {
    warnings.push({
      code: 'blob-only-asset',
      message: `Source Library item "${sourceItem.id}" only has a browser blob URL; persist it before cross-workspace handoff.`,
    });
  }
  return warnings;
}

function describeSourceLibraryTargetReadiness(
  target: ImageSuiteHandoffTarget,
  input: {
    sourceId: string | null;
    sourceItem: SourceBinLibraryItem | undefined;
    blobOnly: boolean;
    hasAssetUrl: boolean;
  },
): ImageSourceLibraryHandoffTargetDescriptor {
  const targetLabel = target === 'flow' ? 'Flow' : target === 'video' ? 'Video' : 'Paper';
  if (!input.sourceId) {
    return {
      target,
      ready: false,
      reason: target === 'paper'
        ? 'Link this layer to a durable Source Library item before placing it in Paper.'
        : `Link this layer to a durable Source Library item before sending it to ${targetLabel}.`,
    };
  }
  if (!input.hasAssetUrl) {
    return {
      target,
      ready: false,
      reason: target === 'paper'
        ? `Restore asset media for Source Library item "${input.sourceId}" before placing it in Paper.`
        : `Restore asset media for Source Library item "${input.sourceId}" before sending it to ${targetLabel}.`,
    };
  }
  if (input.blobOnly) {
    return {
      target,
      ready: false,
      reason: target === 'paper'
        ? `Persist blob-only Source Library asset "${input.sourceId}" before placing it in Paper.`
        : `Persist blob-only Source Library asset "${input.sourceId}" before sending it to ${targetLabel}.`,
    };
  }

  return {
    target,
    ready: true,
    reason: target === 'paper'
      ? `Ready to place Source Library asset "${input.sourceId}" in Paper.`
      : `Ready to send Source Library asset "${input.sourceId}" to ${targetLabel}.`,
  };
}

function layerHasSourceMetadata(layer: ImageLayer): boolean {
  return Boolean(
    layer.metadata?.sourceLink
      || layer.metadata?.smartLinkedSourceId
      || layer.metadata?.sourceLabel
      || layer.metadata?.sourceFormat
      || layer.metadata?.sourceMimeType,
  );
}

function dedupeAndSortStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

export function LayerSourceFormatBadges({ layer }: { layer: ImageLayer }) {
  const warnings = layer.metadata?.sourceWarnings ?? [];
  return (
    <div className="mt-2 rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1.5 text-[10px] text-cyan-100/50">
      <div className="flex flex-wrap items-center gap-1.5">
        {layer.metadata?.sourceFormat ? (
          <span className="rounded-full border border-cyan-300/15 bg-cyan-400/10 px-2 py-0.5 uppercase tracking-wide text-cyan-100/60">
            {layer.metadata.sourceFormat}
          </span>
        ) : null}
        {layer.metadata?.sourceMimeType ? (
          <span className="truncate text-cyan-100/35">{layer.metadata.sourceMimeType}</span>
        ) : null}
        {layer.metadata?.originalSvgSource ? (
          <span className="rounded-full border border-emerald-300/15 bg-emerald-400/10 px-2 py-0.5 uppercase tracking-wide text-emerald-100/60">
            SVG source retained
          </span>
        ) : null}
      </div>
      {warnings.map((warning) => (
        <div className="mt-1 text-amber-100/65" key={warning}>{warning}</div>
      ))}
    </div>
  );
}

export function SnapshotsControls({
  doc,
  onDelete,
  onNew,
  onRename,
  onRestore,
}: {
  doc: ImageDocument;
  onDelete: (snapshotId: string) => void;
  onNew: (name?: string) => void;
  onRename?: (snapshotId: string, name: string) => void;
  onRestore: (snapshotId: string) => void;
}) {
  const snapshots = doc.snapshots ?? [];
  const newSnapshotInputRef = useRef<HTMLInputElement | null>(null);
  const [newSnapshotName, setNewSnapshotName] = useState('');
  const [renamingSnapshotId, setRenamingSnapshotId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const createSnapshot = () => {
    onNew(newSnapshotInputRef.current?.value ?? newSnapshotName);
    setNewSnapshotName('');
  };
  return (
    <div className="mt-2 border-t border-cyan-300/10 pt-2">
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-cyan-100/40">Snapshots</label>
        <button aria-label="Create document snapshot" className="rounded border border-cyan-300/10 px-2 py-0.5 text-[10px] font-semibold text-cyan-100/55 hover:text-white" onClick={createSnapshot} type="button">New Snapshot</button>
      </div>
      <div className="mb-1.5">
        <input
          aria-label="New snapshot name"
          ref={newSnapshotInputRef}
          className="w-full rounded border border-cyan-300/10 bg-[#0f1420] px-2 py-1 text-[11px] text-cyan-50 outline-none placeholder:text-cyan-100/25 focus:border-cyan-300/30"
          onChange={(event) => setNewSnapshotName(event.target.value)}
          onInput={(event) => setNewSnapshotName((event.target as HTMLInputElement).value)}
          placeholder={`Snapshot ${(doc.snapshots?.length ?? 0) + 1}`}
          type="text"
          value={newSnapshotName}
        />
      </div>
      <div className="space-y-1">
        {snapshots.map((snapshot) => {
          const restorable = inspectImageDocumentSnapshotIntegrity(snapshot).complete;
          return (
            <div className="rounded border border-cyan-300/10 bg-[#10131b] px-1.5 py-1 text-[10px] text-cyan-100/55" key={snapshot.id}>
            <div className="flex items-center gap-1">
              <span className="min-w-0 flex-1 truncate">{snapshot.name}</span>
              {!restorable ? (
                <span className="text-amber-100/60" title="This snapshot has no cryptographically proven pixel and selection payload">Pixels unavailable</span>
              ) : null}
              {onRename ? (
                <button
                  aria-label={`Rename snapshot ${snapshot.name}`}
                  className="text-cyan-100/45 hover:text-white"
                  onClick={() => {
                    setRenamingSnapshotId(snapshot.id);
                    setRenameDraft(snapshot.name);
                  }}
                  type="button"
                >
                  Rename
                </button>
              ) : null}
              <button
                aria-label={`Restore snapshot ${snapshot.name}`}
                className="text-cyan-100/45 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
                disabled={!restorable}
                onClick={() => onRestore(snapshot.id)}
                title={restorable ? undefined : 'This snapshot lacks cryptographically proven pixels or selection data and cannot be restored safely.'}
                type="button"
              >
                Restore
              </button>
              <button aria-label={`Delete snapshot ${snapshot.name}`} className="text-red-100/45 hover:text-red-100" onClick={() => onDelete(snapshot.id)} type="button">Delete</button>
            </div>
            {renamingSnapshotId === snapshot.id && onRename ? (
              <div className="mt-1 flex items-center gap-1">
                <input
                  aria-label="Snapshot name"
                  className="min-w-0 flex-1 rounded border border-cyan-300/10 bg-[#0f1420] px-2 py-1 text-[11px] text-cyan-50 outline-none focus:border-cyan-300/30"
                  onChange={(event) => setRenameDraft(event.target.value)}
                  onInput={(event) => setRenameDraft((event.target as HTMLInputElement).value)}
                  type="text"
                  value={renameDraft}
                />
                <button
                  aria-label="Save snapshot name"
                  className="rounded border border-cyan-300/10 px-2 py-0.5 text-[10px] text-cyan-100/55 hover:text-white"
                  onClick={() => {
                    onRename(snapshot.id, renameDraft);
                    setRenamingSnapshotId(null);
                    setRenameDraft('');
                  }}
                  type="button"
                >
                  Save
                </button>
                <button
                  aria-label="Cancel snapshot rename"
                  className="rounded border border-cyan-300/10 px-2 py-0.5 text-[10px] text-cyan-100/55 hover:text-white"
                  onClick={() => {
                    setRenamingSnapshotId(null);
                    setRenameDraft('');
                  }}
                  type="button"
                >
                  Cancel
                </button>
              </div>
            ) : null}
            </div>
          );
        })}
        {snapshots.length === 0 ? <p className="text-[11px] text-cyan-100/30">Snapshots store immutable layer pixels, masks, and metadata.</p> : null}
      </div>
    </div>
  );
}
