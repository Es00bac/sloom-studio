import { Play, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useImageEditorStore } from '../../store/imageEditorStore';
import type { ImageDocument } from '../../types/imageEditor';
import { advanceAnimationPlaybackCursor, appendAnimationFrame, applyAnimationFrame, applyAnimationFrameAt, getImageFrameAnimation } from './ImageFrameAnimation';

export function ImageFrameAnimationPanel() {
  // Hooks run unconditionally, above any conditional return: document appearance/disappearance
  // during mount must never change this component's hook count (a past revision returned null
  // first and crashed with "Rendered fewer hooks than expected" under keep-mounted relocation).
  const activeId = useImageEditorStore((state) => state.activeDocId);
  const document = useImageEditorStore((state) => state.documents.find((candidate) => candidate.id === activeId) ?? null);
  const [playing, setPlaying] = useState(false);
  const playedDocRef = useRef<string | null>(null);

  const documentId = document?.id ?? null;
  const animation = document ? getImageFrameAnimation(document) : null;
  const frameCount = animation?.frames.length ?? 0;
  const frameRate = animation?.frameRate ?? 12;

  useEffect(() => {
    // A play session owns exactly the document it started on: switching or losing the document
    // pauses instead of retargeting the timer. Ticks write ONLY the ephemeral store cursor —
    // never documents, history stacks, or dirty flags — so displayed cels change while every
    // saved/dirty fact about the document stays untouched.
    if (!playing || !documentId || frameCount < 2 || playedDocRef.current !== documentId) {
      if (playing && playedDocRef.current !== documentId) setPlaying(false);
      return undefined;
    }
    useImageEditorStore.setState({ animationPlayback: { docId: documentId, frameId: resolveSeededFrameId(documentId) } });
    const timer = window.setInterval(() => {
      const store = useImageEditorStore.getState();
      const live = store.documents.find((item) => item.id === documentId);
      if (!live) {
        useImageEditorStore.setState({ animationPlayback: null });
        return;
      }
      const nextCursor = advanceAnimationPlaybackCursor(getImageFrameAnimation(live), documentId, store.animationPlayback);
      if (!nextCursor) {
        useImageEditorStore.setState({ animationPlayback: null });
        return;
      }
      useImageEditorStore.setState({ animationPlayback: nextCursor });
    }, Math.max(40, 1000 / Math.max(1, frameRate)));
    return () => {
      window.clearInterval(timer);
      useImageEditorStore.setState((state) => (state.animationPlayback?.docId === documentId ? { animationPlayback: null } : {}));
    };
  }, [documentId, frameCount, frameRate, playing]);

  if (!document || !animation) return null;

  const commit = (next: ImageDocument) => {
    const store = useImageEditorStore.getState();
    store.pushOperation({ kind: 'documentState', docId: document.id, before: document, after: next });
    useImageEditorStore.setState((state) => ({ documents: state.documents.map((item) => item.id === document.id ? { ...next, dirty: true } : item) }));
  };

  /** Removal acts on array position, never id equality: against hostile duplicated ids from an
   * edited file, filtering by id could delete two entries with one click. */
  const removeFrameAt = (index: number) => {
    if (animation.frames.length <= 1) return;
    const frames = animation.frames.filter((_, position) => position !== index);
    if (frames.length === animation.frames.length) return;
    const next = { ...animation, frames, currentFrameId: frames[0]!.id };
    commit(applyAnimationFrame(document, next, next.currentFrameId));
  };

  const selectFrameAt = (index: number) => {
    const target = animation.frames[index];
    if (!target) return;
    commit(applyAnimationFrameAt(document, animation, index));
  };

  const togglePlayback = () => {
    if (animation.frames.length < 2) return; // no timer exists, so the label must stay "Play"
    if (playing) {
      setPlaying(false);
      return;
    }
    playedDocRef.current = document.id;
    setPlaying(true);
  };

  return <div className="mt-3 space-y-2 rounded border border-cyan-300/10 bg-[#10131b] p-2 text-xs text-cyan-100/65" data-image-frame-animation="true">
    <div className="flex items-center justify-between"><span className="font-semibold uppercase tracking-[0.14em] text-cyan-100/50">Frame Animation</span><span>{animation.frames.length} frames · {animation.frameRate} fps</span></div>
    <div className="flex flex-wrap gap-1">{animation.frames.map((frame, index) => <span className="inline-flex" key={`${index}:${frame.id}`}><button aria-label={`Show ${frame.name}`} className="rounded-l border border-cyan-300/15 px-2 py-1" onClick={() => selectFrameAt(index)} type="button">{frame.name}</button>{animation.frames.length > 1 ? <button aria-label={`Remove ${frame.name}`} className="rounded-r border border-l-0 border-cyan-300/15 px-1" onClick={() => removeFrameAt(index)} type="button"><Trash2 size={11}/></button> : null}</span>)}</div>
    <div className="flex gap-2"><button aria-label="Add animation frame" className="inline-flex items-center gap-1 rounded border border-cyan-300/15 px-2 py-1" onClick={() => { const next = appendAnimationFrame(document); commit(applyAnimationFrame(document, next, next.currentFrameId)); }} type="button"><Plus size={12}/>Frame</button><button aria-label="Toggle animation playback" className="inline-flex items-center gap-1 rounded border border-cyan-300/15 px-2 py-1" disabled={animation.frames.length < 2} onClick={togglePlayback} type="button"><Play size={12}/>{playing ? 'Pause' : 'Play'}</button></div>
    <label className="flex items-center gap-2 text-[10px]"><input aria-label="Enable onion skin" checked={animation.onionSkin.enabled} onChange={(event) => commit({ ...document, metadata: { ...document.metadata, animation: { ...animation, onionSkin: { ...animation.onionSkin, enabled: event.target.checked } } } })} type="checkbox"/>Onion skin enabled (previous {Math.round(animation.onionSkin.previousOpacity * 100)}% / next {Math.round(animation.onionSkin.nextOpacity * 100)}%)</label>
    <p className="text-[10px] text-cyan-100/40">Retained visibility cels for short Image studies; no video timeline, audio, encoded animation, or external render claim.</p>
  </div>;
}

function resolveSeededFrameId(docId: string): string {
  const live = useImageEditorStore.getState().documents.find((item) => item.id === docId);
  if (!live) return '';
  const current = getImageFrameAnimation(live);
  return current.currentFrameId;
}
