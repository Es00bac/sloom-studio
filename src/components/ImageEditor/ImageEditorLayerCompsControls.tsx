import { useState } from 'react';
import type { ImageDocument, ImageLayerComp } from '../../types/imageEditor';

export function ImageEditorLayerCompsControls({
  comps,
  disabled,
  onApply,
  onCapture,
  onDelete,
  onRename,
}: {
  comps: readonly ImageLayerComp[];
  disabled?: boolean;
  onApply: (comp: ImageLayerComp) => void;
  onCapture: (name: string) => void;
  onDelete: (compId: string) => boolean;
  onRename: (compId: string, nextName: string) => boolean;
}) {
  const [name, setName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const controlClasses = 'rounded border border-cyan-300/10 px-2 py-1 text-[10px] font-semibold text-cyan-100/60 hover:border-cyan-300/30 hover:text-white disabled:opacity-40';

  const beginRename = (comp: ImageLayerComp) => {
    setRenamingId(comp.id);
    setRenameValue(comp.name);
  };

  return (
    <div className="border-b border-cyan-300/10 px-3 py-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-cyan-100/45">Layer Comps</span>
        <span className="text-[10px] text-cyan-100/30">{comps.length} saved</span>
      </div>
      <div className="flex gap-1">
        <input aria-label="Layer comp name" className="min-w-0 flex-1 rounded border border-cyan-300/10 bg-[#10131b] px-1.5 py-1 text-[11px] text-cyan-100/70" disabled={disabled} onChange={(event) => setName(event.target.value)} placeholder="Comp name" value={name} />
        <button className="rounded border border-cyan-300/10 px-2 py-1 text-[10px] font-semibold text-cyan-100/60 hover:border-cyan-300/30 hover:text-white disabled:opacity-40" disabled={disabled} onClick={() => { onCapture(name); setName(''); }} type="button">Capture</button>
      </div>
      {comps.length ? (
        <div className="mt-1.5 space-y-1">
          {comps.map((comp) => (
            renamingId === comp.id ? (
              <div className="flex items-center gap-1 rounded border border-cyan-300/30 bg-cyan-300/10 px-2 py-1" key={comp.id}>
                <input
                  aria-label={`Rename layer comp ${comp.name}`}
                  className="min-w-0 flex-1 rounded border border-cyan-300/20 bg-[#10131b] px-1.5 py-1 text-[11px] text-cyan-100/80"
                  disabled={disabled}
                  onChange={(event) => setRenameValue(event.target.value)}
                  value={renameValue}
                />
                <button
                  aria-label="Confirm layer comp rename"
                  className={controlClasses}
                  disabled={disabled}
                  onClick={() => {
                    if (onRename(comp.id, renameValue)) setRenamingId(null);
                  }}
                  type="button"
                >Save</button>
                <button
                  aria-label="Cancel layer comp rename"
                  className={controlClasses}
                  disabled={disabled}
                  onClick={() => setRenamingId(null)}
                  type="button"
                >Cancel</button>
              </div>
            ) : (
              <div className="flex items-center gap-1" key={comp.id}>
                <button className="min-w-0 flex-1 rounded border border-cyan-300/10 bg-cyan-300/5 px-2 py-1 text-left text-[11px] text-cyan-100/65 hover:border-cyan-300/30 hover:text-white disabled:opacity-40" disabled={disabled} onClick={() => onApply(comp)} type="button"><span className="truncate">{comp.name}</span><span className="ml-2 shrink-0 text-[10px] text-cyan-100/35">Apply</span></button>
                <button aria-label={`Rename layer comp ${comp.name}`} className={controlClasses} disabled={disabled} onClick={() => beginRename(comp)} title={`Rename ${comp.name}`} type="button">Rename</button>
                <button aria-label={`Delete layer comp ${comp.name}`} className={controlClasses} disabled={disabled} onClick={() => { onDelete(comp.id); }} title={`Delete ${comp.name}`} type="button">Delete</button>
              </div>
            )
          ))}
        </div>
      ) : <p className="mt-1 text-[10px] text-cyan-100/30">Capture visibility, opacity, and blend modes; applying is undoable.</p>}
    </div>
  );
}

export function layerCompDocumentLabel(document: ImageDocument): string {
  return `${document.layerComps?.length ?? 0} saved layer comps`;
}
