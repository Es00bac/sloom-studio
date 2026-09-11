// Custom-font import UI for the Paper workspace. Lets the user upload a .ttf/.otf, vets it (unbroken +
// embeddable) before accepting it, stores it on the document, and registers it as a live browser FontFace
// so the editor renders it and the PDF/X export embeds the user's REAL font instead of a Liberation
// substitute. A broken or un-embeddable file is refused with a plain-language reason.

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePaperStore } from '../../../store/paperStore';
import { useSettingsStore } from '../../../store/settingsStore';
import { vetFontBytes } from '../../../lib/paperFontVetting';
import { buildImportedFont } from '../../../lib/paperFontLibrary';
import type { PaperImportedFont } from '../../../types/paper';
import type { OpenFontLibraryFace } from '../../../lib/paperOpenFontCatalog';
import { createBinaryAssetRecord } from '../../../shared/assets/contentAddressedAsset';
import { verifyBinaryAssetRecord } from '../../../shared/assets/contentAddressedAsset';
import { paperAssetRepository } from '../assets/PaperAssetRuntime';
import {
  assertBrowserPaintablePaperManagedFace,
  PaperExactManagedFontError,
  paperFontStyleDescriptor,
  paperManagedFontLoadTimeoutMs,
  paperManagedFontCssSource,
  paperManagedFontFamilyAlias,
  verifyExactPaperManagedFaceRegistration,
} from '../../../lib/paperExactManagedFonts';

function genFontId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return c?.randomUUID ? c.randomUUID() : `font-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Register every imported font as a browser FontFace (idempotent) so the editor + font picker render it.
 * Runs at the workspace root so fonts are live regardless of selection, and re-registers on reopen.
 */
export interface PaperImportedFontRegistrationState {
  pendingFaceIds: string[];
  blocked: Array<{ faceId: string; message: string }>;
}

const liveRegistrationByDocument = new WeakMap<Document, Map<string, Promise<void>>>();

function loadManagedFontFaceBounded(face: FontFace, label: string, timeoutMs: number): Promise<FontFace> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(new PaperExactManagedFontError(`${label} timed out before exact live paint; retry after restoring the standalone font.`)), timeoutMs);
    face.load().then((loaded) => {
      globalThis.clearTimeout(timer);
      resolve(loaded);
    }, (error) => {
      globalThis.clearTimeout(timer);
      reject(error);
    });
  });
}

function registrationKey(font: PaperImportedFont): string {
  return [
    font.id,
    font.fontAsset.id,
    font.fontAsset.sha256,
    font.postscriptName,
    font.weight,
    font.style,
    font.obliqueAngleDeg ?? '',
    font.stretchPercent,
    font.collectionIndex,
    JSON.stringify(font.variationSettings ?? {}),
  ].join(':');
}

/**
 * Load, register, and then authenticate one exact face for live editor paint. The promise is shared per
 * document/identity so a workspace registration effect and a rich-editor transaction cannot race two
 * different FontFace instances into the same alias.
 */
export function ensurePaperImportedFontRegistered(
  font: PaperImportedFont,
  target: Document = globalThis.document,
): Promise<void> {
  assertBrowserPaintablePaperManagedFace(font);
  if (typeof FontFace === 'undefined' || !target?.fonts) {
    return Promise.reject(new PaperExactManagedFontError('Exact managed-font registration is unavailable in this renderer; the edit was not applied.'));
  }
  const registrations = liveRegistrationByDocument.get(target) ?? new Map<string, Promise<void>>();
  liveRegistrationByDocument.set(target, registrations);
  const key = registrationKey(font);
  const existing = registrations.get(key);
  if (existing) return existing;

  const pending = (async () => {
    const record = await paperAssetRepository.get(font.fontAsset.id);
    if (!record
      || record.ref.id !== font.fontAsset.id
      || record.ref.sha256 !== font.fontAsset.sha256
      || record.ref.byteLength !== font.fontAsset.byteLength
      || record.ref.mimeType !== font.fontAsset.mimeType
      || !(await verifyBinaryAssetRecord(record))) {
      throw new PaperExactManagedFontError(`Exact bytes for ${font.postscriptName || font.id} are unavailable or do not match the document reference; restore the font and retry.`);
    }
    const face = new FontFace(paperManagedFontFamilyAlias(font), paperManagedFontCssSource(font, record.bytes), {
      weight: String(font.weight),
      style: paperFontStyleDescriptor(font.style, font.obliqueAngleDeg),
      stretch: `${font.stretchPercent}%`,
    });
    const timeoutMs = paperManagedFontLoadTimeoutMs(font.fontAsset.byteLength);
    const loaded = await loadManagedFontFaceBounded(face, `Managed face ${font.postscriptName || font.id}`, timeoutMs);
    target.fonts.add(loaded);
    await verifyExactPaperManagedFaceRegistration(target, font, timeoutMs);
  })().catch((error) => {
    registrations.delete(key);
    throw error;
  });
  registrations.set(key, pending);
  return pending;
}

export function useRegisterImportedFonts(importedFonts: readonly PaperImportedFont[] | undefined): PaperImportedFontRegistrationState {
  const registered = useRef(new Set<string>());
  const pending = useRef(new Set<string>());
  const [state, setState] = useState<PaperImportedFontRegistrationState>({ pendingFaceIds: [], blocked: [] });
  const registrationUnavailable = typeof FontFace === 'undefined' || typeof document === 'undefined';
  useEffect(() => {
    if (registrationUnavailable) return;
    let cancelled = false;
    for (const font of importedFonts ?? []) {
      const key = `${font.id}:${font.fontAsset.id}`;
      if (registered.current.has(key) || pending.current.has(key)) continue;
      pending.current.add(key);
      setState((current) => ({
        pendingFaceIds: [...new Set([...current.pendingFaceIds, font.id])],
        blocked: current.blocked.filter((entry) => entry.faceId !== font.id),
      }));
      void (async () => {
        try {
          await ensurePaperImportedFontRegistered(font);
          if (cancelled) return;
          registered.current.add(key);
        } catch (error) {
          if (!cancelled) {
            const detail = error instanceof Error ? error.message : 'registration failed';
            setState((current) => ({
              pendingFaceIds: current.pendingFaceIds.filter((faceId) => faceId !== font.id),
              blocked: [...current.blocked.filter((entry) => entry.faceId !== font.id), { faceId: font.id, message: `Exact managed face ${font.postscriptName || font.id} is blocked: ${detail}` }],
            }));
          }
        } finally {
          pending.current.delete(key);
          if (!cancelled) setState((current) => ({ ...current, pendingFaceIds: current.pendingFaceIds.filter((faceId) => faceId !== font.id) }));
        }
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [importedFonts, registrationUnavailable]);
  return registrationUnavailable
    ? { pendingFaceIds: [], blocked: (importedFonts ?? []).map((font) => ({ faceId: font.id, message: `Exact managed face ${font.postscriptName || font.id} cannot register because this renderer does not expose FontFace.` })) }
    : state;
}

function fontMimeType(file: File, format: string): string {
  if (file.type) return file.type;
  if (format === 'opentype-cff') return 'font/otf';
  if (format === 'collection') return 'font/collection';
  return 'font/ttf';
}

export interface PaperFontImportControlProps {
  /** Test and embedding seam; the workspace uses the persisted Settings collection by default. */
  managedLibrary?: readonly OpenFontLibraryFace[];
  /** The default refuses adoption unless the exact asset can register for live Paper paint. */
  registerManagedFace?: (face: PaperImportedFont) => Promise<void>;
}

export function PaperFontImportControl({
  managedLibrary: suppliedManagedLibrary,
  registerManagedFace = ensurePaperImportedFontRegistered,
}: PaperFontImportControlProps = {}) {
  const importedFonts = usePaperStore((s) => s.document.importedFonts);
  const addImportedFont = usePaperStore((s) => s.addImportedFont);
  const removeImportedFont = usePaperStore((s) => s.removeImportedFont);
  const persistedManagedLibrary = useSettingsStore((s) => s.openFontLibrary);
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [addingManagedFaceId, setAddingManagedFaceId] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      setError(null);
      setNotice(null);
      if (!file) return;
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const vet = vetFontBytes(bytes);
        if (!vet.ok) {
          setError(vet.errors[0] ?? 'This font could not be imported.');
          return;
        }
        if (vet.format === 'collection') {
          setError('TrueType/OpenType Collection files cannot be authenticated by Chromium. Extract the selected member to a standalone .ttf or .otf, then import that file.');
          return;
        }
        const record = await createBinaryAssetRecord(bytes, {
          mimeType: fontMimeType(file, vet.format),
          fileName: file.name,
        });
        const assetRef = await paperAssetRepository.put(record);
        const font = buildImportedFont(vet, assetRef, genFontId());
        if (!font) {
          setError("This font can't be embedded in a print export.");
          return;
        }
        addImportedFont(font);
        const label = `${font.familyName} ${font.weight}${font.style === 'normal' ? '' : ` ${font.style}`}`;
        setNotice(`Imported ${label}.${vet.warnings[0] ? ` ${vet.warnings[0]}` : ''}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to read the font file.');
      }
    },
    [addImportedFont],
  );

  const fonts = importedFonts ?? [];
  const managedLibrary = suppliedManagedLibrary ?? persistedManagedLibrary;
  const addManagedLibraryFace = useCallback(async (entry: OpenFontLibraryFace) => {
    setError(null);
    setNotice(null);
    setAddingManagedFaceId(entry.face.id);
    try {
      const alreadyAdded = usePaperStore.getState().document.importedFonts?.some(
        (font) => font.fontAsset.sha256 === entry.face.fontAsset.sha256,
      );
      if (alreadyAdded) {
        setNotice(`${entry.face.familyName} is already available in this document.`);
        return;
      }
      // Settings holds only the asset reference. Prove its exact bytes are still present and
      // browser-paintable before the document persists a reference to it.
      await registerManagedFace(entry.face);
      addImportedFont(entry.face);
      setNotice(`Added ${entry.face.familyName} ${entry.face.weight}${entry.face.style === 'normal' ? '' : ` ${entry.face.style}`} to this document. Select it from the Paper font menu to use it.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not add ${entry.face.familyName} to this document.`);
    } finally {
      setAddingManagedFaceId(null);
    }
  }, [addImportedFont, registerManagedFace]);

  return (
    <div className="space-y-2 rounded border border-cyan-300/10 bg-[#0b121d] p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wide text-cyan-200/70">Custom fonts</span>
        <button
          type="button"
          className="rounded border border-cyan-300/20 bg-cyan-400/10 px-2 py-1 text-xs text-cyan-100 hover:bg-cyan-400/20"
          onClick={() => inputRef.current?.click()}
        >
          Import font…
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".ttf,.otf,.ttc,.otc,font/ttf,font/otf"
        className="hidden"
        onChange={(event) => {
          void handleFile(event.target.files?.[0] ?? undefined);
          event.target.value = '';
        }}
      />
      {error ? <p className="text-xs text-rose-300">{error}</p> : null}
      {notice ? <p className="text-xs text-emerald-300">{notice}</p> : null}
      {managedLibrary.length > 0 ? (
        <div className="space-y-2 rounded border border-emerald-300/15 bg-emerald-400/[0.03] p-2" aria-label="Managed font library">
          <div>
            <div className="text-xs font-medium text-emerald-100">Managed font library</div>
            <p className="mt-0.5 text-[11px] leading-4 text-slate-400">Add a license-verified Settings face to this document. It is then available in Paper’s font menu and persists with the document.</p>
          </div>
          <ul className="space-y-1">
            {managedLibrary.map((entry) => {
              const isInDocument = fonts.some((font) => font.fontAsset.sha256 === entry.face.fontAsset.sha256);
              return (
                <li className="flex items-center justify-between gap-2 text-sm text-slate-200" key={entry.face.id}>
                  <span className="truncate">{entry.face.familyName} {entry.face.weight}{entry.face.style === 'normal' ? '' : ` ${entry.face.style}`}</span>
                  {isInDocument ? <span className="shrink-0 text-xs text-emerald-300">In this document</span> : (
                    <button
                      className="shrink-0 rounded border border-emerald-300/25 px-2 py-1 text-xs text-emerald-100 hover:bg-emerald-400/10 disabled:cursor-wait disabled:opacity-60"
                      disabled={addingManagedFaceId !== null}
                      name={`add-managed-font-${entry.face.id}`}
                      onClick={() => void addManagedLibraryFace(entry)}
                      type="button"
                    >
                      {addingManagedFaceId === entry.face.id ? 'Adding…' : 'Add to document'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {fonts.length > 0 ? (
        <ul className="space-y-1">
          {fonts.map((font) => (
            <li key={font.id} className="flex items-center justify-between gap-2 text-sm text-slate-200">
              <span className="truncate" style={{ fontFamily: font.familyName }}>
                {font.familyName}
                {` ${font.weight}${font.style === 'normal' ? '' : ` ${font.style}`}`}
                {!font.canSubset ? <span className="ml-1 text-[10px] text-amber-300/80" title="Whole font embedded (subsetting not permitted)">·full</span> : null}
              </span>
              <button
                type="button"
                className="text-slate-400 hover:text-rose-300"
                aria-label={`Remove ${font.familyName}`}
                onClick={() => removeImportedFont(font.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-slate-400">
          Import a .ttf or .otf to embed your real font in PDF/X exports (instead of a metric-compatible substitute).
        </p>
      )}
    </div>
  );
}
