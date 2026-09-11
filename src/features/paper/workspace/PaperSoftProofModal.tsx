// Soft-proof preview modal: shows the current Paper page rendered through the real lcms2 CMYK soft
// proof (paperSoftProofBrowser), so a pro can see how their sRGB design will look on the chosen press
// condition before exporting. "Simulate paper color" toggles the absolute-colorimetric paper-white
// simulation. This is a view-only preview — nothing about the document changes.

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { softProofPaperPageInBrowser, type SoftProofPreviewResult } from '../../../lib/paperSoftProofBrowser';
import type { PaperDocument } from '../../../types/paper';
import { PAPER_OUTPUT_INTENT_PROFILES } from '../../../lib/paperPrintProduction';
import {
  PaperIccProfileManager,
  type PaperIccProfileManagerChange,
} from './PaperIccProfileManager';

interface PaperSoftProofModalProps {
  document: PaperDocument;
  pageId: string;
  onClose: () => void;
  onConfigureProfile?: (change: PaperIccProfileManagerChange) => void;
}

export function PaperSoftProofModal({ document, pageId, onClose, onConfigureProfile }: PaperSoftProofModalProps) {
  const [simulatePaperWhite, setSimulatePaperWhite] = useState(false);
  const [preview, setPreview] = useState<SoftProofPreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestIdRef = useRef(0);
  const selectedProfile = document.managedIccProfiles?.find(
    (profile) => profile.id === document.printProduction.outputIntentProfileAssetId,
  );
  const outputIntent = PAPER_OUTPUT_INTENT_PROFILES[document.printProduction.outputIntentProfileId];
  const outputConditionId = document.printProduction.outputIntentProfileId === 'custom'
    ? document.printProduction.customOutputIntentName.trim()
    : outputIntent.printingCondition ?? '';
  const pageIndex = document.pages.findIndex((page) => page.id === pageId);
  const pageLabel = `Page ${pageIndex >= 0 ? pageIndex + 1 : 1} of ${Math.max(1, document.pages.length)}`;

  useEffect(() => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    if (!selectedProfile) return;
    void (async () => {
      await Promise.resolve();
      if (requestIdRef.current !== requestId) return;
      setLoading(true);
      setError(null);
      try {
        const result = await softProofPaperPageInBrowser(document, pageId, { simulatePaperWhite });
        if (requestIdRef.current !== requestId) return;
        setPreview(result);
        setLoading(false);
      } catch (err: unknown) {
        if (requestIdRef.current !== requestId) return;
        setError(err instanceof Error ? err.message : 'Could not build the soft-proof preview.');
        setLoading(false);
      }
    })();
  }, [document, pageId, selectedProfile, simulatePaperWhite]);

  return (
    <div
      aria-label="CMYK soft proof"
      aria-modal="true"
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-sm p-6"
      data-paper-soft-proof-modal="true"
      onClick={onClose}
      role="dialog"
    >
      <div
        className="flex max-h-[88vh] w-[min(880px,92vw)] flex-col rounded-2xl border border-cyan-500/25 bg-[#0b1320]/97 p-5 text-white shadow-[0_24px_60px_rgba(0,0,0,0.7)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between border-b border-cyan-300/10 pb-3">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-cyan-200">CMYK Soft Proof</div>
            <div className="mt-1 text-[11px] text-cyan-100/50">
              {pageLabel} · Simulating {preview?.profileName ?? 'the document output condition'} — on-screen preview only.
            </div>
          </div>
          <button
            aria-label="Close soft proof"
            className="rounded-md p-1 text-cyan-100/40 transition-all duration-150 hover:bg-cyan-500/15 hover:text-white"
            onClick={onClose}
            type="button"
          >
            <X size={14} />
          </button>
        </div>

        <div className="flex min-h-[280px] flex-1 items-center justify-center overflow-auto rounded-xl border border-cyan-300/10 bg-[#050a12] p-4">
          {!selectedProfile && onConfigureProfile ? (
            <div className="w-full max-w-xl rounded-xl border border-cyan-300/15 bg-[#0b1320] p-5 text-left">
              <div className="text-sm font-semibold text-white">Choose an exact CMYK output profile</div>
              <p className="mt-2 text-xs leading-5 text-cyan-100/60">
                Soft Proof needs a managed printer profile. Use one of the redistribution-cleared offline profiles
                included with Sloom Studio, or import the exact profile supplied by your print provider.
              </p>
              <PaperIccProfileManager
                onChange={onConfigureProfile}
                outputConditionId={outputConditionId}
                profiles={document.managedIccProfiles}
                registryName={outputIntent.registryName}
                selectedProfileAssetId={document.printProduction.outputIntentProfileAssetId}
              />
            </div>
          ) : loading ? (
            <div className="text-sm text-cyan-100/60" data-soft-proof-status="loading">
              Building soft-proof preview…
            </div>
          ) : error ? (
            <div className="w-full max-w-xl text-center text-sm text-rose-300/90" data-soft-proof-status="error">
              <div>{error}</div>
              {onConfigureProfile ? (
                <div className="mt-4 rounded-xl border border-cyan-300/15 bg-[#0b1320] p-4 text-left text-white">
                  <PaperIccProfileManager
                    onChange={onConfigureProfile}
                    outputConditionId={outputConditionId}
                    profiles={document.managedIccProfiles}
                    registryName={outputIntent.registryName}
                    selectedProfileAssetId={document.printProduction.outputIntentProfileAssetId}
                  />
                </div>
              ) : null}
            </div>
          ) : preview ? (
            <img
              alt="CMYK soft-proof preview of the current page"
              className="max-h-[62vh] max-w-full rounded shadow-[0_8px_24px_rgba(0,0,0,0.5)]"
              data-soft-proof-status="ready"
              src={preview.dataUrl}
            />
          ) : null}
        </div>

        {selectedProfile ? <label className="mt-4 flex cursor-pointer items-center gap-2.5 text-[12px] text-cyan-100/80">
          <input
            checked={simulatePaperWhite}
            className="h-3.5 w-3.5 accent-cyan-400"
            onChange={(event) => setSimulatePaperWhite(event.target.checked)}
            type="checkbox"
          />
          Simulate paper color
          <span className="text-cyan-100/40">— tints white toward the stock (absolute colorimetric)</span>
        </label> : null}
        {selectedProfile ? <div className="mt-2 text-[11px] text-cyan-100/45">
          This previews the current page only. Export PDF/X to create the printer handoff file.
        </div> : null}
      </div>
    </div>
  );
}
