import { Check, Download, LoaderCircle, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { paperAssetRepository } from '../../features/paper/assets/PaperAssetRuntime';
import type { PaperAssetRepository } from '../../features/paper/assets/PaperAssetRepository';
import {
  notifyBundledFontLibraryCapabilityChanged,
  useBundledFontLibraryCapability,
} from '../../lib/bundledFontLibrary';
import {
  cancelAndroidFontPackDownload,
  getAndroidFontPackStatus,
  isAndroidFontPackRuntime,
  requestAndroidFontPackDownload,
  requestAndroidFontPackDownloadConfirmation,
  type AndroidFontPackStatus,
} from '../../lib/androidFontPack';
import {
  createOpenFontCatalogClient,
  downloadOpenFontFace,
  type OpenFontCatalogClient,
  type OpenFontCatalogFamily,
  type OpenFontLibraryFace,
  type OpenFontStyle,
} from '../../lib/paperOpenFontCatalog';
import {
  discoverLocalFonts,
  LOCAL_FONT_DISCOVERY_LIMIT,
  type LocalFontDiscoveryResult,
} from '../../lib/localFontDiscovery';
import { useI18n } from '../../lib/useI18n';
import { BundledFontBrowser } from '../Common/BundledFontBrowser';

export interface FontLibrarySectionProps {
  library: readonly OpenFontLibraryFace[];
  onInstall: (face: OpenFontLibraryFace) => void;
  /** Removes the Settings collection reference only; documents that adopted the face keep their exact asset. */
  onRemove?: (fontAssetSha256: string) => void;
  catalog?: OpenFontCatalogClient;
  repository?: PaperAssetRepository;
}

export function FontLibrarySection({
  library,
  onInstall,
  onRemove = () => undefined,
  catalog,
  repository = paperAssetRepository,
}: FontLibrarySectionProps) {
  const { t } = useI18n();
  const androidFontPackRuntime = isAndroidFontPackRuntime();
  const bundledFontLibraryAvailable = useBundledFontLibraryCapability();
  const [client] = useState(() => catalog ?? createOpenFontCatalogClient());
  const [families, setFamilies] = useState<OpenFontCatalogFamily[]>([]);
  const [selectedFamily, setSelectedFamily] = useState<OpenFontCatalogFamily | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<'browse' | 'select' | 'download' | 'font-pack' | 'local-fonts' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bundledPreview, setBundledPreview] = useState('');
  const [fontPackStatus, setFontPackStatus] = useState<AndroidFontPackStatus | null>(null);
  const [localFontResult, setLocalFontResult] = useState<LocalFontDiscoveryResult | null>(null);

  useEffect(() => {
    if (!androidFontPackRuntime) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const status = await getAndroidFontPackStatus();
        if (!cancelled) {
          setFontPackStatus(status);
          if (status.available) notifyBundledFontLibraryCapabilityChanged();
        }
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : t('settings.fonts.pack.error.status'));
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (fontPackStatus?.status === 'pending' || fontPackStatus?.status === 'downloading'
        || fontPackStatus?.status === 'transferring') void refresh();
    }, 1_500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [androidFontPackRuntime, fontPackStatus?.status, t]);

  const visibleFamilies = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('en-US');
    return families
      .filter((family) => !normalized || family.family.toLocaleLowerCase('en-US').includes(normalized))
      .slice(0, 80);
  }, [families, query]);
  const faceChoices = useMemo(() => selectedFamily
    ? selectedFamily.weights.flatMap((weight) => selectedFamily.styles.map((style) => ({ weight, style })))
    : [], [selectedFamily]);

  const browse = async () => {
    setBusy('browse');
    setError(null);
    try {
      setFamilies(await client.listFamilies());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('settings.fonts.error.browse'));
    } finally {
      setBusy(null);
    }
  };

  const selectFamily = async (id: string) => {
    setBusy('select');
    setError(null);
    try {
      setSelectedFamily(await client.getFamily(id));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('settings.fonts.error.select'));
    } finally {
      setBusy(null);
    }
  };

  const install = async (weight: number, style: OpenFontStyle) => {
    if (!selectedFamily) return;
    setBusy('download');
    setError(null);
    try {
      const downloaded = await downloadOpenFontFace({
        id: selectedFamily.id,
        weight,
        style,
        subset: selectedFamily.defaultSubset,
        client,
        repository,
      });
      onInstall(downloaded);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('settings.fonts.error.download'));
    } finally {
      setBusy(null);
    }
  };

  const downloadFontPack = async () => {
    setBusy('font-pack');
    setError(null);
    try {
      if (fontPackStatus?.status === 'waiting-for-wifi' || fontPackStatus?.status === 'confirmation-required') {
        await requestAndroidFontPackDownloadConfirmation();
      } else {
        const requested = await requestAndroidFontPackDownload();
        setFontPackStatus(requested);
      }
      const status = await getAndroidFontPackStatus();
      setFontPackStatus(status);
      notifyBundledFontLibraryCapabilityChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('settings.fonts.pack.error.download'));
    } finally {
      setBusy(null);
    }
  };

  const cancelFontPack = async () => {
    setBusy('font-pack');
    setError(null);
    try {
      const status = await cancelAndroidFontPackDownload();
      setFontPackStatus(status);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('settings.fonts.pack.error.download'));
    } finally {
      setBusy(null);
    }
  };

  const discoverInstalledFonts = async () => {
    setBusy('local-fonts');
    setLocalFontResult(null);
    try {
      setLocalFontResult(await discoverLocalFonts());
    } finally {
      setBusy(null);
    }
  };

  const fontPackStatusLabel = fontPackStatus?.status === 'waiting-for-wifi'
    || fontPackStatus?.status === 'confirmation-required'
    ? t('settings.fonts.pack.status.waiting')
    : t('settings.fonts.pack.status.downloading');

  const installed = (weight: number, style: OpenFontStyle) => library.some((entry) =>
    entry.face.source.url?.endsWith(`/${selectedFamily?.defaultSubset}-${weight}-${style}.ttf`),
  );

  return (
    <section className="space-y-4" aria-label={t('settings.fonts.heading')}>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-gray-400">{t('settings.fonts.heading')}</h3>
        <button
          className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-sm font-medium text-cyan-100 transition-colors hover:bg-cyan-400/20 disabled:cursor-wait disabled:opacity-60"
          disabled={busy !== null}
          name="browse-open-fonts"
          onClick={() => void browse()}
          type="button"
        >
          {busy === 'browse' ? <LoaderCircle className="animate-spin" size={15} /> : <Search size={15} />}
          {t('settings.fonts.browse')}
        </button>
      </div>

      {bundledFontLibraryAvailable ? (
        <div className="space-y-2 rounded-xl border border-emerald-300/15 bg-emerald-400/[0.03] p-3">
          <div>
            <div className="text-xs font-semibold text-gray-100">{t('settings.fonts.bundled.title')}</div>
            <p className="mt-1 text-[11px] leading-4 text-gray-500">{t('settings.fonts.bundled.description')}</p>
          </div>
          <BundledFontBrowser
            onSelect={(family) => setBundledPreview(family.family)}
            value={bundledPreview}
            weight={400}
          />
        </div>
      ) : null}

      {androidFontPackRuntime && !bundledFontLibraryAvailable ? (
        <div className="space-y-3 rounded-xl border border-cyan-300/20 bg-cyan-400/[0.04] p-3">
          <div>
            <div className="text-xs font-semibold text-gray-100">{t('settings.fonts.pack.title')}</div>
            <p className="mt-1 text-[11px] leading-4 text-gray-400">
              {fontPackStatus?.supported === false
                ? t('settings.fonts.pack.playRequired')
                : t('settings.fonts.pack.description')}
            </p>
          </div>
          {fontPackStatus?.totalBytes ? (
            <div className="space-y-1" aria-label="Publishing font pack download progress">
              <div className="h-1.5 overflow-hidden rounded-full bg-gray-800">
                <div
                  className="h-full bg-cyan-300 transition-[width]"
                  style={{ width: `${Math.min(100, (fontPackStatus.bytesDownloaded / fontPackStatus.totalBytes) * 100)}%` }}
                />
              </div>
              <div className="text-[10px] text-gray-500">{fontPackStatusLabel}</div>
            </div>
          ) : null}
          {fontPackStatus?.supported !== false ? (
            <div className="flex flex-wrap gap-2">
              <button
                className="inline-flex items-center gap-2 rounded-lg border border-cyan-300/25 bg-cyan-400/10 px-3 py-2 text-xs font-medium text-cyan-100 transition-colors hover:bg-cyan-400/20 disabled:cursor-wait disabled:opacity-60"
                disabled={busy !== null || fontPackStatus?.status === 'pending' || fontPackStatus?.status === 'downloading' || fontPackStatus?.status === 'transferring'}
                name="download-publishing-font-pack"
                onClick={() => void downloadFontPack()}
                type="button"
              >
                {busy === 'font-pack' ? <LoaderCircle className="animate-spin" size={14} /> : <Download size={14} />}
                {fontPackStatus?.status === 'waiting-for-wifi' || fontPackStatus?.status === 'confirmation-required'
                  ? t('settings.fonts.pack.connection')
                  : fontPackStatus?.status === 'failed' || fontPackStatus?.status === 'canceled'
                    ? t('settings.fonts.pack.retry')
                    : t('settings.fonts.pack.download')}
              </button>
              {fontPackStatus?.status === 'pending' || fontPackStatus?.status === 'downloading' || fontPackStatus?.status === 'transferring' ? (
                <button
                  className="rounded-lg border border-gray-700 px-3 py-2 text-xs text-gray-300 hover:border-rose-300/50 hover:text-rose-100 disabled:opacity-60"
                  disabled={busy !== null}
                  name="cancel-publishing-font-pack"
                  onClick={() => void cancelFontPack()}
                  type="button"
                >
                  {t('settings.fonts.pack.cancel')}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-3 rounded-xl border border-violet-300/15 bg-violet-400/[0.03] p-3" aria-labelledby="local-font-discovery-heading">
        <div>
          <div className="text-xs font-semibold text-gray-100" id="local-font-discovery-heading">Installed fonts on this device</div>
          <p className="mt-1 text-[11px] leading-4 text-gray-500">
            Ask the browser for local font names when you need them. Names only are read; font bytes and paths are never accessed.
          </p>
        </div>
        <button
          className="inline-flex items-center gap-2 rounded-lg border border-violet-300/25 bg-violet-400/10 px-3 py-2 text-xs font-medium text-violet-100 transition-colors hover:bg-violet-400/20 disabled:cursor-wait disabled:opacity-60"
          disabled={busy !== null}
          name="discover-local-fonts"
          onClick={() => void discoverInstalledFonts()}
          type="button"
        >
          {busy === 'local-fonts' ? <LoaderCircle className="animate-spin" size={14} /> : <Search size={14} />}
          Discover installed fonts
        </button>
        {localFontResult ? (
          <div className="space-y-2" aria-live="polite" role="status">
            {localFontResult.status === 'success' ? (
              <>
                <p className="text-xs text-gray-300">
                  {localFontResult.fonts.length} installed font{localFontResult.fonts.length === 1 ? '' : 's'} discovered locally
                  {localFontResult.truncated ? ` (showing the first ${LOCAL_FONT_DISCOVERY_LIMIT})` : ''}.
                </p>
                {localFontResult.fonts.length > 0 ? (
                  <ul aria-label="Discovered local fonts" className="max-h-48 divide-y divide-gray-800 overflow-y-auto rounded-lg border border-gray-800 bg-[#111217]/60">
                    {localFontResult.fonts.slice(0, 24).map((font) => (
                      <li key={`${font.postscriptName}-${font.style}`} className="px-3 py-1.5 text-xs text-gray-300">
                        <span className="font-medium text-gray-100">{font.family}</span>
                        <span className="ml-2 text-gray-500">{font.fullName}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : localFontResult.status === 'unsupported' ? (
              <p className="text-xs text-gray-400">This browser does not expose local font discovery.</p>
            ) : localFontResult.status === 'permission-denied' ? (
              <p className="text-xs text-amber-200">Local font access was declined. You can try again when ready.</p>
            ) : (
              <p className="text-xs text-rose-200">Local font discovery failed. No local font data was retained.</p>
            )}
          </div>
        ) : null}
      </div>

      <div className="border-t border-gray-800 pt-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">Additional online fonts</div>

      {error ? <p className="rounded border border-rose-400/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">{error}</p> : null}

      {families.length > 0 ? (
        <>
          <label className="sr-only" htmlFor="open-font-search">{t('settings.fonts.search')}</label>
          <input
            className="w-full rounded-lg border border-gray-700 bg-[#111217] px-3 py-2 text-sm text-gray-100 outline-none focus:border-cyan-300"
            id="open-font-search"
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('settings.fonts.search')}
            value={query}
          />
          <ul className="max-h-64 divide-y divide-gray-800 overflow-y-auto rounded-lg border border-gray-800 bg-[#111217]/60">
            {visibleFamilies.map((family) => (
              <li key={family.id}>
                <button
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors ${
                    selectedFamily?.id === family.id ? 'bg-cyan-400/10 text-cyan-100' : 'text-gray-200 hover:bg-white/5'
                  }`}
                  disabled={busy !== null}
                  name={`select-open-font-${family.id}`}
                  onClick={() => void selectFamily(family.id)}
                  type="button"
                >
                  <span className="truncate font-medium">{family.family}</span>
                  <span className="shrink-0 text-xs text-gray-500">{family.weights.join(', ')}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {selectedFamily ? (
        <div className="space-y-2 rounded-lg border border-gray-800 bg-[#111217]/60 p-3">
          <div className="text-sm font-medium text-gray-100">{selectedFamily.family}</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {faceChoices.map(({ weight, style }) => {
              const isInstalled = installed(weight, style);
              return (
                <div key={`${weight}-${style}`} className="flex items-center justify-between gap-3 border-b border-gray-800 py-2 last:border-b-0">
                  <span className="text-sm text-gray-300">{weight} {style}</span>
                  {isInstalled ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-300"><Check size={13} />{t('settings.fonts.offline')}</span>
                  ) : (
                    <button
                      className="inline-flex items-center gap-1 rounded border border-gray-700 px-2 py-1 text-xs text-gray-200 hover:border-cyan-300 hover:text-cyan-100 disabled:cursor-wait disabled:opacity-60"
                      disabled={busy !== null}
                      name={`download-open-font-${selectedFamily.id}-${weight}-${style}`}
                      onClick={() => void install(weight, style)}
                      type="button"
                    >
                      {busy === 'download' ? <LoaderCircle className="animate-spin" size={13} /> : <Download size={13} />}
                      {t('settings.fonts.download')}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {library.length > 0 ? (
        <ul className="divide-y divide-gray-800 rounded-lg border border-gray-800 bg-[#111217]/40">
          {library.map((entry) => (
            <li key={entry.face.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="truncate text-gray-200">{entry.face.familyName} {entry.face.weight} {entry.face.style}</span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-emerald-300">{t('settings.fonts.offline')}</span>
                <button
                  aria-label={`Remove ${entry.face.familyName} ${entry.face.weight} ${entry.face.style} from the managed library`}
                  className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:border-rose-300/60 hover:text-rose-100"
                  name={`remove-open-font-${entry.face.fontAsset.sha256}`}
                  onClick={() => onRemove(entry.face.fontAsset.sha256)}
                  type="button"
                >
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
