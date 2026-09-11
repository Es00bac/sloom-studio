import { useEffect, useRef, useState } from 'react';
import { DEFAULT_CMYK_PROFILE_ID } from '../../../lib/paperIccProfiles';
import { loadBundledImageCmykProfile, resolveBundledImageCmykProfile } from './cmykProfiles';
import { useImageEditorStore } from '../../../store/imageEditorStore';
import { executeImageIccSoftProof, type ImageIccSoftProofExecution } from '../ImageColorProof';
import { getBitmapImageData } from '../LayerBitmap';

const INTENTS = [
  { value: 'relative', label: 'Relative colorimetric' },
  { value: 'perceptual', label: 'Perceptual' },
  { value: 'saturation', label: 'Saturation' },
  { value: 'absolute', label: 'Absolute colorimetric' },
] as const;

interface MountedIccProof extends ImageIccSoftProofExecution {
  width: number;
  height: number;
  profileLabel: string;
}

function IccProofPreview({ proof }: { proof: MountedIccProof }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || typeof ImageData === 'undefined') return;
    const output = new Uint8ClampedArray(proof.rgba);
    for (let pixelIndex = 0; pixelIndex < proof.gamutWarnings.length; pixelIndex += 1) {
      if (!proof.gamutWarnings[pixelIndex]) continue;
      const offset = pixelIndex * 4;
      if (output[offset + 3] === 0) continue;
      // Magenta is a read-only, deliberately unmistakable gamut-warning overlay.
      output[offset] = 255;
      output[offset + 1] = 0;
      output[offset + 2] = 255;
    }
    context.putImageData(new ImageData(output, proof.width, proof.height), 0, 0);
  }, [proof]);

  return (
    <div className="space-y-1 rounded border border-cyan-300/15 bg-[#070b12] p-1.5" data-image-icc-proof-preview data-gamut-warning-pixels={proof.outOfGamutPixels}>
      <canvas
        aria-label={`Rendered read-only ICC soft proof for ${proof.profileLabel} with gamut-warning overlay`}
        className="block h-auto max-h-40 w-full rounded bg-[#111] object-contain [image-rendering:auto]"
        height={proof.height}
        ref={canvasRef}
        width={proof.width}
      />
      <p className="text-[10px] leading-4 text-cyan-100/50">Read-only LCMS proof preview. Magenta pixels mark the destination-gamut warnings; document pixels and CMYKA authority were not changed.</p>
    </div>
  );
}

/** Mounted Image mode controls. Every conversion is async and commits only after ICC succeeds. */
export function ImageCmykModePanel() {
  const document = useImageEditorStore((state) => state.documents.find((item) => item.id === state.activeDocId) ?? null);
  const convert = useImageEditorStore((state) => state.convertImageColorMode);
  const setPaperWhiteSimulation = useImageEditorStore((state) => state.setCmykPaperWhiteSimulation);
  const [profileId, setProfileId] = useState(DEFAULT_CMYK_PROFILE_ID);
  const [intent, setIntent] = useState<(typeof INTENTS)[number]['value']>('relative');
  const [bpc, setBpc] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [proof, setProof] = useState<MountedIccProof | null>(null);
  useEffect(() => {
    const onRefusal = (event: Event) => {
      const detail = (event as CustomEvent<{ disclosure?: string }>).detail;
      setMessage(detail?.disclosure ?? 'This tool is not wired to native CMYK ink authority; no pixels were changed.');
    };
    window.addEventListener('sloom-cmyk-tool-refused', onRefusal);
    return () => window.removeEventListener('sloom-cmyk-tool-refused', onRefusal);
  }, []);
  if (!document) return null;
  const isCmyk = document.metadata?.colorMode === 'cmyk';
  const selected = resolveBundledImageCmykProfile(profileId);
  const run = async (target: 'rgb' | 'cmyk') => {
    setBusy(true);
    setMessage(null);
    setProof(null);
    try {
      const currentMetadata = document.metadata?.cmyk;
      const importedProfileData = currentMetadata?.profileSource?.kind === 'imported'
        ? currentMetadata.profileBytesData
        : undefined;
      const importedBytes = isCmyk && importedProfileData
        ? (() => {
            const binary = atob(importedProfileData);
            const bytes = new Uint8Array(binary.length);
            for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
            return bytes;
          })()
        : null;
      const loaded = importedBytes
        ? { bytes: importedBytes, identity: { id: currentMetadata!.profileId, label: currentMetadata!.profileLabel, source: currentMetadata!.profileSource! } }
        : await loadBundledImageCmykProfile(isCmyk ? currentMetadata?.profileId ?? profileId : profileId);
      const result = await convert(document.id, target, {
        profileBytes: loaded.bytes,
        metadata: {
          profileId: loaded.identity.id,
          profileLabel: loaded.identity.label,
          profileSource: loaded.identity.source,
          intent: isCmyk ? document.metadata?.cmyk?.intent ?? intent : intent,
          blackPointCompensation: isCmyk ? document.metadata?.cmyk?.blackPointCompensation ?? bpc : bpc,
          paperWhiteSimulation: document.metadata?.cmyk?.paperWhiteSimulation ?? false,
        },
      });
      setMessage(result.ok ? (target === 'cmyk' ? `Native CMYK active · ${loaded.identity.label}` : 'Returned to sRGB through ICC.') : result.message);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'ICC conversion refused before mutation.');
    } finally {
      setBusy(false);
    }
  };
  const runIccProof = async () => {
    const layer = document.layers.find((candidate) => candidate.id === document.activeLayerId && candidate.bitmap);
    if (!layer?.bitmap) {
      setMessage('Select a raster layer before running the ICC soft proof.');
      return;
    }
    setBusy(true);
    setMessage(null);
    setProof(null);
    try {
      const loaded = await loadBundledImageCmykProfile(profileId);
      const image = getBitmapImageData(layer.bitmap);
      const result = await executeImageIccSoftProof(new Uint8Array(image.data), image.width, image.height, loaded.bytes, {
        intent,
        blackPointCompensation: bpc,
        paperWhiteSimulation: false,
      });
      setProof({ ...result, width: image.width, height: image.height, profileLabel: loaded.identity.label });
      setMessage(`ICC proof executed with ${loaded.identity.label}: ${result.outOfGamutPixels} of ${image.width * image.height} opaque pixels are outside the destination gamut.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'ICC proof failed before a display proxy was changed.');
    } finally {
      setBusy(false);
    }
  };
  const togglePaperWhite = async (enabled: boolean) => {
    setBusy(true);
    const result = await setPaperWhiteSimulation(document.id, enabled);
    setMessage(result.ok ? (enabled ? 'ICC paper-white simulation is rendered in the display proxy.' : 'ICC paper-white simulation is disabled.') : result.message);
    setBusy(false);
  };
  return (
    <section aria-label="CMYK document mode" className="mt-2 space-y-2 rounded border border-cyan-300/10 p-2 text-[11px] text-cyan-100/70">
      <div className="font-semibold text-cyan-100/80">Color mode · {isCmyk ? 'CMYK / native ink' : 'RGB'}</div>
      {!isCmyk ? <>
        <label className="block">ICC output profile
          <select aria-label="CMYK ICC output profile" className="mt-1 w-full rounded bg-[#10131b] px-1 py-1" onChange={(event) => setProfileId(event.target.value)} value={profileId}>
            <option value="fogra39">ISO Coated v2 / FOGRA39</option>
            <option value="fogra27">FOGRA27</option>
            <option value="gracol-tr006">US GRACoL 2006</option>
          </select>
        </label>
        <label className="block">Rendering intent
          <select aria-label="CMYK rendering intent" className="mt-1 w-full rounded bg-[#10131b] px-1 py-1" onChange={(event) => setIntent(event.target.value as typeof intent)} value={intent}>
            {INTENTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2"><input checked={bpc} onChange={(event) => setBpc(event.target.checked)} type="checkbox" /> Black-point compensation</label>
        <button aria-label="Run real ICC soft proof and gamut check" className="w-full rounded border border-cyan-300/15 px-2 py-1 text-cyan-100/80 hover:bg-cyan-400/10" disabled={busy} onClick={() => void runIccProof()} type="button">{busy ? 'Running ICC proof…' : 'Run ICC proof & gamut check'}</button>
        {proof ? <IccProofPreview proof={proof} /> : null}
        <button aria-label="Convert document to native CMYK" className="w-full rounded bg-cyan-400/15 px-2 py-1 text-cyan-100 hover:bg-cyan-400/25" disabled={busy} onClick={() => void run('cmyk')} type="button">{busy ? 'Converting…' : 'Convert to native CMYK'}</button>
      </> : <>
        <p className="text-cyan-100/45">Each raster layer owns C/M/Y/K/alpha bytes. Display and export use the selected ICC profile.</p>
        <div className="font-mono text-[10px] text-cyan-100/45">{document.metadata?.cmyk?.profileLabel ?? selected.label} · {document.metadata?.cmyk?.intent ?? 'relative'}</div>
        <label className="flex items-center gap-2"><input aria-label="Simulate ICC paper white" checked={Boolean(document.metadata?.cmyk?.paperWhiteSimulation)} disabled={busy} onChange={(event) => void togglePaperWhite(event.target.checked)} type="checkbox" /> Simulate ICC paper white</label>
        <button aria-label="Convert document to RGB through ICC" className="w-full rounded bg-cyan-400/15 px-2 py-1 text-cyan-100 hover:bg-cyan-400/25" disabled={busy} onClick={() => void run('rgb')} type="button">{busy ? 'Converting…' : 'Return to RGB through ICC'}</button>
      </>}
      {message ? <p aria-live="polite" className="text-[10px] text-cyan-100/60">{message}</p> : null}
      <p className="text-[10px] text-cyan-100/35">CMYK JPEG/PSD, 16-bit CMYK, and non-sRGB working spaces are refused.</p>
    </section>
  );
}
