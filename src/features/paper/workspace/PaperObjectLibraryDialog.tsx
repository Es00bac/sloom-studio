import { useMemo, useState } from 'react';
import { Library, Plus, Trash2, X } from 'lucide-react';
import {
  materializePaperObjectLibraryItem,
  searchPaperObjectLibrary,
  validatePaperObjectLibraryFrame,
  type PaperObjectLibraryItem,
} from '../../../lib/paperObjectLibrary';
import { usePaperObjectLibraryStore } from '../../../store/paperObjectLibraryStore';
import type { PaperFrame, PaperFramePatch, PaperFrameKind } from '../../../types/paper';

export function PaperObjectLibraryDialog({
  selectedFrame,
  onClose,
  onInsert,
}: {
  selectedFrame: PaperFrame | null;
  onClose: () => void;
  onInsert: (kind: PaperFrameKind, patch: PaperFramePatch) => void;
}) {
  const items = usePaperObjectLibraryStore((state) => state.items);
  const saveFrame = usePaperObjectLibraryStore((state) => state.saveFrame);
  const removeItem = usePaperObjectLibraryStore((state) => state.removeItem);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [notice, setNotice] = useState('');
  const filteredItems = useMemo(() => searchPaperObjectLibrary(items, query), [items, query]);
  const selectedValidation = selectedFrame ? validatePaperObjectLibraryFrame(selectedFrame) : undefined;

  const saveSelected = () => {
    if (!selectedFrame) {
      setNotice('Select a text, caption, bubble, panel, or shape first.');
      return;
    }
    if (!selectedValidation?.ok) {
      setNotice(selectedValidation?.reason ?? 'This frame cannot be saved as a local snippet.');
      return;
    }
    const id = saveFrame(selectedFrame, { name, description });
    if (!id) {
      setNotice('Enter a name up to 80 characters.');
      return;
    }
    setName('');
    setDescription('');
    setNotice('Saved the selected frame to the local object library.');
  };

  const insert = (item: PaperObjectLibraryItem) => {
    const materialized = materializePaperObjectLibraryItem(item);
    if (!materialized) {
      setNotice('This snippet is no longer valid and was not inserted.');
      return;
    }
    onInsert(materialized.kind, materialized.patch);
    setNotice(`Inserted “${item.name}” on the selected page.`);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section aria-labelledby="paper-object-library-title" aria-modal="true" className="flex max-h-[80vh] w-full max-w-xl flex-col rounded-2xl border border-gray-700/70 bg-[#10151f] p-4 text-gray-100 shadow-2xl" data-paper-object-library-dialog="true" role="dialog">
        <header className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300"><Library aria-hidden="true" size={14} /> Paper object library</div>
            <h2 className="mt-1 text-base font-semibold" id="paper-object-library-title">Reusable objects and snippets</h2>
            <p className="mt-1 text-xs text-gray-400">Local device library for editable text, panels, bubbles, captions, and shapes. Project assets stay in their source project.</p>
          </div>
          <button aria-label="Close object library" className="rounded-lg border border-gray-700/60 p-1.5 text-gray-300 hover:text-white" onClick={onClose} type="button"><X size={16} /></button>
        </header>

        <div className="mt-3 rounded-xl border border-cyan-300/20 bg-cyan-300/5 p-3">
          <div className="text-xs font-semibold text-gray-200">Save selected frame</div>
          <div className="mt-2 flex gap-2">
            <input aria-label="Snippet name" className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-[#0d1118] px-2 py-1.5 text-xs text-gray-100" maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Name this object" value={name} />
            <button className="inline-flex items-center gap-1 rounded-lg border border-cyan-300/30 bg-cyan-300/10 px-2 py-1.5 text-xs font-semibold text-cyan-100 hover:bg-cyan-300/20" onClick={saveSelected} type="button"><Plus size={13} /> Save</button>
          </div>
          <input aria-label="Snippet description" className="mt-2 w-full rounded-lg border border-gray-700 bg-[#0d1118] px-2 py-1.5 text-xs text-gray-100" maxLength={240} onChange={(event) => setDescription(event.target.value)} placeholder="Optional description" value={description} />
          {notice ? <p aria-live="polite" className="mt-2 text-[11px] text-amber-200/90">{notice}</p> : null}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <input aria-label="Search object library" className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-[#0d1118] px-2 py-1.5 text-xs text-gray-100" onChange={(event) => setQuery(event.target.value)} placeholder="Search saved objects" value={query} />
          <span className="text-[11px] text-gray-500">{filteredItems.length} saved</span>
        </div>
        <div className="mt-3 min-h-0 flex-1 overflow-y-auto pr-1">
          {filteredItems.length === 0 ? <p className="rounded-lg border border-gray-700/60 bg-[#0d1118] px-3 py-5 text-center text-xs text-gray-500">No saved snippets yet.</p> : (
            <ul className="space-y-1.5">
              {filteredItems.map((item) => <li className="flex items-center gap-2 rounded-xl border border-gray-700/60 bg-[#0d1118] px-3 py-2" key={item.id}>
                <div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold text-gray-100">{item.name}</div><div className="truncate text-[11px] text-gray-500">{item.kind}{item.description ? ` · ${item.description}` : ''}</div></div>
                <button className="rounded-lg border border-cyan-300/30 px-2 py-1 text-[11px] font-semibold text-cyan-100 hover:bg-cyan-300/10" onClick={() => insert(item)} type="button">Insert</button>
                <button aria-label={`Delete ${item.name}`} className="rounded-lg border border-rose-300/20 p-1 text-rose-200/80 hover:bg-rose-300/10" onClick={() => removeItem(item.id)} type="button"><Trash2 size={13} /></button>
              </li>)}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
