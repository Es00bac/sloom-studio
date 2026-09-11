import { useCallback, useMemo, useRef, useState } from 'react';
import type { BinaryAssetId } from '../../../shared/assets/contentAddressedAsset';
import type { PaperManagedIccProfile } from '../../../types/paper';
import {
  importPaperManagedIccProfile,
  installBundledPaperManagedIccProfile,
} from '../../../lib/paperManagedIccProfiles';
import { BUNDLED_CMYK_PROFILES, DEFAULT_CMYK_PROFILE_ID } from '../../../lib/paperIccProfiles';
import type { PaperAssetRepository } from '../assets/PaperAssetRepository';
import { paperAssetRepository } from '../assets/PaperAssetRuntime';

export interface PaperIccProfileManagerChange {
  profiles: PaperManagedIccProfile[];
  selectedProfileAssetId?: BinaryAssetId;
  outputConditionId?: string;
}

export interface PaperIccProfileManagerProps {
  profiles: readonly PaperManagedIccProfile[] | undefined;
  selectedProfileAssetId: BinaryAssetId | undefined;
  outputConditionId: string;
  registryName?: string;
  onChange: (change: PaperIccProfileManagerChange) => void;
  repository?: PaperAssetRepository;
}

function replaceProfile(
  profiles: readonly PaperManagedIccProfile[],
  profile: PaperManagedIccProfile,
): PaperManagedIccProfile[] {
  const existing = profiles.findIndex((candidate) => candidate.id === profile.id);
  if (existing < 0) return [...profiles, profile];
  return profiles.map((candidate, index) => index === existing ? profile : candidate);
}

export function PaperIccProfileManager({
  profiles,
  selectedProfileAssetId,
  outputConditionId,
  registryName,
  onChange,
  repository = paperAssetRepository,
}: PaperIccProfileManagerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [bundledProfileId, setBundledProfileId] = useState(DEFAULT_CMYK_PROFILE_ID);
  const [installingBundled, setInstallingBundled] = useState(false);
  const managedProfiles = useMemo(() => profiles ?? [], [profiles]);

  const handleFile = useCallback(async (file: File | undefined) => {
    setError(null);
    setNotice(null);
    if (!file) return;
    try {
      const profile = await importPaperManagedIccProfile(file, { outputConditionId, registryName }, repository);
      const nextProfiles = replaceProfile(managedProfiles, profile);
      onChange({
        profiles: nextProfiles,
        selectedProfileAssetId: profile.id,
        outputConditionId: profile.outputConditionId,
      });
      setNotice(`Managed ${profile.description} for ${profile.outputConditionId}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The ICC profile could not be imported.');
    }
  }, [managedProfiles, onChange, outputConditionId, registryName, repository]);

  const handleBundledProfile = useCallback(async () => {
    setError(null);
    setNotice(null);
    setInstallingBundled(true);
    try {
      const installed = await installBundledPaperManagedIccProfile(bundledProfileId, repository);
      const nextProfiles = replaceProfile(managedProfiles, installed.profile);
      onChange({
        profiles: nextProfiles,
        selectedProfileAssetId: installed.profile.id,
        outputConditionId: installed.outputConditionId,
      });
      setNotice(`Managed ${installed.profile.description} for ${installed.outputConditionId}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The bundled ICC profile could not be installed.');
    } finally {
      setInstallingBundled(false);
    }
  }, [bundledProfileId, managedProfiles, onChange, repository]);

  return (
    <div className="mt-2 space-y-2 border-t border-cyan-300/10 pt-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-cyan-100/70">Managed CMYK ICC</span>
        <button
          type="button"
          className="rounded border border-cyan-300/20 bg-cyan-400/10 px-2 py-1 text-xs text-cyan-100 hover:bg-cyan-400/20"
          onClick={() => inputRef.current?.click()}
        >
          Import profile…
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".icc,.icm,application/vnd.iccprofile"
        className="hidden"
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <select
          aria-label="Bundled CMYK profile"
          className="paper-input min-w-0"
          onChange={(event) => setBundledProfileId(event.target.value)}
          value={bundledProfileId}
        >
          {BUNDLED_CMYK_PROFILES.map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.displayName}</option>
          ))}
        </select>
        <button
          aria-label="Use bundled CMYK profile"
          className="rounded border border-cyan-300/20 bg-cyan-400/10 px-2 py-1 text-xs text-cyan-100 hover:bg-cyan-400/20 disabled:opacity-50"
          disabled={installingBundled}
          onClick={() => { void handleBundledProfile(); }}
          type="button"
        >
          {installingBundled ? 'Installing…' : 'Use bundled'}
        </button>
      </div>
      {error ? <p className="text-xs text-rose-300">{error}</p> : null}
      {notice ? <p className="text-xs text-emerald-300">{notice}</p> : null}
      {managedProfiles.length ? (
        <ul className="space-y-1">
          {managedProfiles.map((profile) => {
            const selected = profile.id === selectedProfileAssetId;
            return (
              <li key={profile.id} className="flex items-center justify-between gap-2 text-xs text-slate-200">
                <span className="min-w-0 truncate" title={`${profile.description} (${profile.outputConditionId})`}>
                  {profile.description} · {profile.outputConditionId}
                </span>
                <span className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    aria-label={`Use ${profile.description}`}
                    className="rounded border border-cyan-300/15 px-1.5 py-0.5 text-[10px] text-cyan-100 hover:bg-cyan-400/10 disabled:opacity-50"
                    disabled={selected}
                    onClick={() => onChange({
                      profiles: [...managedProfiles],
                      selectedProfileAssetId: profile.id,
                      outputConditionId: profile.outputConditionId,
                    })}
                  >
                    {selected ? 'Selected' : 'Use'}
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${profile.description}`}
                    className="text-slate-400 hover:text-rose-300"
                    onClick={() => {
                      const nextProfiles = managedProfiles.filter((candidate) => candidate.id !== profile.id);
                      onChange({
                        profiles: nextProfiles,
                        selectedProfileAssetId: selected ? undefined : selectedProfileAssetId,
                      });
                    }}
                  >
                    ×
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-slate-400">PDF/X requires a managed CMYK printer profile selected for this document.</p>
      )}
    </div>
  );
}
