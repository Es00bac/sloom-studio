import { useMemo, useRef, useState } from 'react';
import { Upload, X } from 'lucide-react';
import { useSourceBinStore } from '../../store/sourceBinStore';
import { showAlertDialog } from '../../store/alertDialogStore';
import type { GenerativeFillReferenceInput } from '../../lib/imageEditorAi';
import {
  getDraggedSourceLibraryItemId,
  hasDraggedSourceLibraryItem,
} from '../../lib/sourceLibraryWorkspaceActions';

interface GenerativeFillReferencesProps {
  references: GenerativeFillReferenceInput[];
  onChange: (next: GenerativeFillReferenceInput[]) => void;
  /** Max references the selected model accepts; Infinity = unbounded (generic HTTP). */
  maxReferenceImages: number;
  disabled?: boolean;
  compact?: boolean;
}

/**
 * Reference-image editor for the generative dialog: pick from the Source Library (thumbnails), drag in
 * from the library/canvas, or upload — each reference can ALSO carry a text description (some models use
 * described references), and references show as draggable thumbnail chips capped at the model's limit.
 */
/** Mint a unique reference-chip id (module scope: called from event handlers, never render). */
function mintReferenceId(index: number): string {
  return `ref-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`;
}

export function GenerativeFillReferences({
  references,
  onChange,
  maxReferenceImages,
  disabled,
  compact,
}: GenerativeFillReferencesProps) {
  const bins = useSourceBinStore((s) => s.bins);
  const libraryImages = useMemo(
    () => bins.flatMap((bin) => bin.items).filter((item) => item.kind === 'image' && item.assetUrl),
    [bins],
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const [descriptionDraft, setDescriptionDraft] = useState('');

  const limited = Number.isFinite(maxReferenceImages);
  const atLimit = references.length >= maxReferenceImages;
  const remainingLabel = limited ? `${references.length} / ${maxReferenceImages}` : `${references.length}`;

  const addReference = (reference: Omit<GenerativeFillReferenceInput, 'id'>) => {
    if (atLimit) return;
    onChange([
      ...references,
      { id: mintReferenceId(references.length), ...reference },
    ]);
  };
  const updateReference = (id: string, patch: Partial<GenerativeFillReferenceInput>) => {
    onChange(references.map((reference) => (reference.id === id ? { ...reference, ...patch } : reference)));
  };
  const removeReference = (id: string) => {
    onChange(references.filter((reference) => reference.id !== id));
  };
  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0 || from >= references.length || to >= references.length) return;
    const next = [...references];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  const handleDrop = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedSourceLibraryItem(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const itemId = getDraggedSourceLibraryItemId(event.dataTransfer);
    const item = itemId
      ? useSourceBinStore.getState().getAllItems().find((candidate) => candidate.id === itemId)
      : undefined;
    if (item && item.kind === 'image' && item.assetUrl) {
      addReference({ label: item.label, imageUrl: item.assetUrl });
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ''));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        });
        addReference({ label: file.name, imageUrl: dataUrl });
      } catch (err: unknown) {
        await showAlertDialog({
          title: 'Reference File Failed',
          message: `Failed to read the local reference file. ${err instanceof Error ? err.message : ''}`.trim(),
          tone: 'danger',
        });
      }
    }
    event.target.value = '';
  };

  return (
    <div className="space-y-2 rounded border border-cyan-300/15 bg-[#0d0f15]/80 p-2">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-semibold text-cyan-100/60">Reference images</span>
        <span className="font-mono text-cyan-100/45">{remainingLabel}</span>
      </div>

      {/* Source Library thumbnail picker */}
      {libraryImages.length > 0 ? (
        <div
          className="flex gap-1.5 overflow-x-auto rounded border border-dashed border-cyan-400/20 bg-[#070a10] p-1.5"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={handleDrop}
          title="Click a library image to add it as a reference, or drag images here"
        >
          {libraryImages.map((item) => (
            <button
              key={item.id}
              type="button"
              disabled={disabled || atLimit}
              onClick={() => addReference({ label: item.label, imageUrl: item.assetUrl })}
              className="group relative h-12 w-12 shrink-0 overflow-hidden rounded border border-cyan-300/15 hover:border-cyan-300/60 disabled:opacity-30 disabled:cursor-not-allowed"
              title={atLimit ? 'Reference limit reached' : `Add "${item.label}"`}
            >
              <img alt={item.label} src={item.assetUrl} className="h-full w-full object-cover" />
              <span className="absolute inset-0 hidden items-center justify-center bg-cyan-500/30 text-lg font-bold text-white group-hover:flex group-disabled:hidden">+</span>
            </button>
          ))}
        </div>
      ) : (
        <div
          className="rounded border border-dashed border-cyan-400/20 bg-[#070a10] px-2 py-3 text-center text-[10px] text-cyan-100/40"
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'copy';
          }}
          onDrop={handleDrop}
        >
          Drag images from the Source Library or canvas here, or upload below.
        </div>
      )}

      {/* Added references as thumbnail chips (drag to reorder, edit description, remove) */}
      {references.length > 0 && (
        <div className={compact ? 'grid grid-cols-2 gap-1.5' : 'grid grid-cols-3 gap-1.5'}>
          {references.map((reference, index) => (
            <div
              key={reference.id}
              draggable={!disabled}
              onDragStart={() => { dragIndexRef.current = index; }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                if (dragIndexRef.current !== null) reorder(dragIndexRef.current, index);
                dragIndexRef.current = null;
              }}
              className="relative flex flex-col gap-1 rounded border border-cyan-300/15 bg-[#070a10] p-1"
              title="Drag to reorder"
            >
              <div className="flex items-start gap-1">
                {reference.imageUrl ? (
                  <img alt={reference.label ?? 'reference'} src={reference.imageUrl} className="h-10 w-10 shrink-0 rounded object-cover" />
                ) : (
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-cyan-500/10 text-[9px] text-cyan-100/50">text</span>
                )}
                <span className="min-w-0 flex-1 truncate text-[10px] text-cyan-100/60">{`#${index + 1}`}</span>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => removeReference(reference.id)}
                  className="shrink-0 rounded p-0.5 text-cyan-100/40 hover:bg-red-500/20 hover:text-red-200"
                  title="Remove reference"
                >
                  <X size={12} />
                </button>
              </div>
              <input
                className="min-w-0 rounded border border-cyan-300/10 bg-[#0d0f15] px-1 py-0.5 text-[10px] text-cyan-50 placeholder:text-cyan-100/25"
                disabled={disabled}
                value={reference.description ?? ''}
                onChange={(event) => updateReference(reference.id, { description: event.target.value })}
                placeholder="Describe this reference…"
              />
            </div>
          ))}
        </div>
      )}

      {/* Add a description-only reference + upload */}
      <div className="flex gap-1.5">
        <input
          className="min-w-0 flex-1 rounded border border-cyan-300/10 bg-[#070a10] px-2 py-1 text-xs text-cyan-50 placeholder:text-cyan-100/30"
          disabled={disabled || atLimit}
          value={descriptionDraft}
          onChange={(event) => setDescriptionDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && descriptionDraft.trim()) {
              addReference({ description: descriptionDraft.trim(), label: descriptionDraft.trim().slice(0, 40) });
              setDescriptionDraft('');
            }
          }}
          placeholder="Add a text-only reference description…"
        />
        <button
          type="button"
          disabled={disabled || atLimit || !descriptionDraft.trim()}
          onClick={() => {
            addReference({ description: descriptionDraft.trim(), label: descriptionDraft.trim().slice(0, 40) });
            setDescriptionDraft('');
          }}
          className="shrink-0 rounded border border-cyan-300/15 bg-[#1b2230] px-2 py-1 text-xs font-semibold text-cyan-50 hover:border-cyan-300/40 disabled:opacity-40"
          title={atLimit ? 'Reference limit reached' : 'Add a description-only reference'}
        >
          Add
        </button>
        <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />
        <button
          type="button"
          disabled={disabled || atLimit}
          onClick={() => fileInputRef.current?.click()}
          className="shrink-0 rounded border border-cyan-300/15 bg-[#1b2230] px-2 py-1 text-xs font-semibold text-cyan-50 hover:border-cyan-300/40 disabled:opacity-40"
          title={atLimit ? 'Reference limit reached' : 'Upload a reference image from your machine'}
        >
          <Upload size={13} />
        </button>
      </div>
    </div>
  );
}
