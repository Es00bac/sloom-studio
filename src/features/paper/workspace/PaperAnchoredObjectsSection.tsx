import { useEffect, useMemo, useState } from 'react';
import type { PaperAnchoredObject, PaperDocument, PaperFrame, PaperPage } from '../../../types/paper';
import { PAPER_ANCHORED_OBJECT_LIMITS } from '../../../lib/paperAnchoredObjects';
import { usePaperStore } from '../../../store/paperStore';

const TEXT_ANCHOR_KINDS = new Set<PaperFrame['kind']>(['text', 'caption', 'speechBubble', 'thoughtBubble']);

function frameLabel(frame: PaperFrame): string {
  return frame.label?.trim() || `${frame.kind} · ${frame.id}`;
}

function anchorIdForObject(relationships: PaperAnchoredObject[], objectFrameId: string): string {
  const base = `anchor-${objectFrameId}`.slice(0, 96);
  const used = new Set(relationships.map((relationship) => relationship.id));
  if (!used.has(base)) return base;
  let index = 2;
  while (index < 10_000) {
    const suffix = `-${index}`;
    const candidate = `${base.slice(0, 96 - suffix.length)}${suffix}`;
    if (!used.has(candidate)) return candidate;
    index += 1;
  }
  return `${base.slice(0, 91)}-link`;
}

function parseNumber(value: string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Mounted authoring route for the bounded persisted relationship implemented in paperAnchoredObjects.
 * It deliberately links existing frames only; it does not represent paragraph shaping or text-frame resizing.
 */
export function PaperAnchoredObjectsSection({
  document,
  page,
  selectedFrameId,
}: {
  document: PaperDocument;
  page: PaperPage | undefined;
  selectedFrameId?: string | null;
}) {
  const updatePaperAnchoredObjects = usePaperStore((state) => state.updatePaperAnchoredObjects);
  const frames = page?.frames ?? [];
  const objectFrames = useMemo(() => frames.filter((frame) => !TEXT_ANCHOR_KINDS.has(frame.kind)), [frames]);
  const textFrames = useMemo(() => frames.filter((frame) => TEXT_ANCHOR_KINDS.has(frame.kind)), [frames]);
  const preferredObjectId = objectFrames.some((frame) => frame.id === selectedFrameId)
    ? selectedFrameId!
    : objectFrames[0]?.id ?? '';
  const [objectFrameId, setObjectFrameId] = useState(preferredObjectId);
  const relationships = document.anchoredObjects ?? [];
  const selectedRelationship = relationships.find((relationship) => relationship.objectFrameId === objectFrameId);
  const [anchorFrameId, setAnchorFrameId] = useState('');
  const [textOffset, setTextOffset] = useState('0');
  const [offsetX, setOffsetX] = useState('0');
  const [offsetY, setOffsetY] = useState('0');
  const [missingAnchorPolicy, setMissingAnchorPolicy] = useState<'hide' | 'retain'>('hide');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!objectFrames.some((frame) => frame.id === objectFrameId)) setObjectFrameId(preferredObjectId);
  }, [objectFrameId, objectFrames, preferredObjectId]);

  useEffect(() => {
    const fallbackAnchor = textFrames.find((frame) => frame.id !== objectFrameId)?.id ?? '';
    setAnchorFrameId(selectedRelationship?.anchorFrameId ?? fallbackAnchor);
    setTextOffset(String(selectedRelationship?.textOffset ?? 0));
    setOffsetX(String(selectedRelationship?.offsetMm?.x ?? 0));
    setOffsetY(String(selectedRelationship?.offsetMm?.y ?? 0));
    setMissingAnchorPolicy(selectedRelationship?.missingAnchorPolicy === 'retain' ? 'retain' : 'hide');
  }, [objectFrameId, selectedRelationship?.anchorFrameId, selectedRelationship?.id, selectedRelationship?.missingAnchorPolicy, selectedRelationship?.offsetMm?.x, selectedRelationship?.offsetMm?.y, selectedRelationship?.textOffset, textFrames]);

  const canSave = Boolean(objectFrameId && anchorFrameId && objectFrameId !== anchorFrameId);
  const saveRelationship = () => {
    if (!canSave) return;
    const previous = relationships.find((relationship) => relationship.objectFrameId === objectFrameId);
    if (!previous && relationships.length >= PAPER_ANCHORED_OBJECT_LIMITS.maxObjects) {
      setMessage(`This document already has the maximum of ${PAPER_ANCHORED_OBJECT_LIMITS.maxObjects} anchored objects. Unlink one before adding another.`);
      return;
    }
    const x = parseNumber(offsetX);
    const y = parseNumber(offsetY);
    const next: PaperAnchoredObject = {
      id: previous?.id ?? anchorIdForObject(relationships, objectFrameId),
      objectFrameId,
      anchorFrameId,
      textOffset: Math.max(0, Math.floor(parseNumber(textOffset))),
      ...(x !== 0 || y !== 0 ? { offsetMm: { x, y } } : {}),
      missingAnchorPolicy,
    };
    updatePaperAnchoredObjects([
      ...relationships.filter((relationship) => relationship.objectFrameId !== objectFrameId),
      next,
    ]);
    setMessage(previous ? 'Updated the anchored object relationship.' : 'Linked the object to the selected text frame.');
  };

  const unlinkRelationship = () => {
    if (!selectedRelationship) return;
    updatePaperAnchoredObjects(relationships.filter((relationship) => relationship.objectFrameId !== objectFrameId));
    setMessage('Unlinked the object; its authored frame coordinates are unchanged.');
  };

  if (!page) {
    return <div className="text-[11px] text-cyan-100/45">Choose a document page to manage anchored objects.</div>;
  }

  if (!objectFrames.length || !textFrames.length) {
    return (
      <div className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1 text-[11px] leading-4 text-cyan-100/55">
        Add an object frame and a text, caption, or bubble frame on this page before linking an anchored object.
      </div>
    );
  }

  return (
    <div className="space-y-2" data-paper-anchored-objects="true">
      <div className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1 text-[11px] leading-4 text-cyan-100/55">
        Link an existing object to a character offset in an existing text frame. The object follows the bounded text geometry in canvas and output; this does not reshape paragraphs or resize frames.
      </div>
      <Field label="Object frame">
        <select aria-label="Anchored object frame" className="paper-input" onChange={(event) => setObjectFrameId(event.target.value)} value={objectFrameId}>
          {objectFrames.map((frame) => <option key={frame.id} value={frame.id}>{frameLabel(frame)}</option>)}
        </select>
      </Field>
      <Field label="Text owner">
        <select aria-label="Text anchor owner" className="paper-input" onChange={(event) => setAnchorFrameId(event.target.value)} value={anchorFrameId}>
          {textFrames.filter((frame) => frame.id !== objectFrameId).map((frame) => <option key={frame.id} value={frame.id}>{frameLabel(frame)}</option>)}
        </select>
      </Field>
      <Field label="Text offset">
        <input aria-label="Anchor text offset" className="paper-input" min={0} onChange={(event) => setTextOffset(event.target.value)} step={1} type="number" value={textOffset} />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Offset X (mm)">
          <input aria-label="Anchor offset X mm" className="paper-input" onChange={(event) => setOffsetX(event.target.value)} step={0.1} type="number" value={offsetX} />
        </Field>
        <Field label="Offset Y (mm)">
          <input aria-label="Anchor offset Y mm" className="paper-input" onChange={(event) => setOffsetY(event.target.value)} step={0.1} type="number" value={offsetY} />
        </Field>
      </div>
      <Field label="If owner is missing">
        <select aria-label="Missing anchor policy" className="paper-input" onChange={(event) => setMissingAnchorPolicy(event.target.value as 'hide' | 'retain')} value={missingAnchorPolicy}>
          <option value="hide">Hide object until relinked</option>
          <option value="retain">Keep its authored position</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <button className="rounded-md border border-cyan-300/25 bg-cyan-400/10 px-2 py-1 text-xs font-semibold text-cyan-100 hover:border-cyan-300/60 disabled:opacity-40" disabled={!canSave} onClick={saveRelationship} type="button">
          {selectedRelationship ? 'Update link' : 'Link object'}
        </button>
        <button aria-label="Unlink anchored object" className="rounded-md border border-rose-300/20 px-2 py-1 text-xs font-semibold text-rose-100/70 hover:border-rose-300/50 disabled:opacity-40" disabled={!selectedRelationship} onClick={unlinkRelationship} type="button">Unlink</button>
      </div>
      <div className="text-[10px] leading-3.5 text-cyan-100/40">
        {selectedRelationship
          ? `Current owner: ${selectedRelationship.anchorFrameId} at text offset ${selectedRelationship.textOffset}. Changes are undoable and persist with the Paper document.`
          : 'This object is not currently anchored.'}
      </div>
      {message ? <div className="rounded border border-cyan-300/15 bg-[#10131b] px-2 py-1 text-[11px] text-cyan-100/70" role="status">{message}</div> : null}
    </div>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[10px] uppercase tracking-[0.14em] text-cyan-100/40">{label}</span>
      {children}
    </label>
  );
}
