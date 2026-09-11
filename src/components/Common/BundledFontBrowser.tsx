import { ChevronDown, ChevronUp, LoaderCircle, Search, ShieldCheck, Type } from 'lucide-react';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  bundledFontFaceRuntimeFamilyName,
  bundledFontFaceIdentitySignature,
  bundledFontFaceStyleDescriptor,
  bundledFontFaceVariationSettingsCss,
  createBundledFontFaceReference,
  ensureBundledFontFaceRegistered,
  loadBundledFontCatalog,
  selectBundledFontFace,
  useBundledFontLibraryCapability,
  type BundledFontCatalog,
  type BundledFontFace,
  type BundledFontFamily,
  type BundledFontRole,
} from '../../lib/bundledFontLibrary';
import { getSignalLoomNativeBridge, type SignalLoomNativeBridge } from '../../lib/nativeApp';
import type { PaperManagedFontStyle } from '../../types/paper';
import { formatFontFamily } from '../../lib/formatFontFamily';
import { useI18n } from '../../lib/useI18n';
import type { MessageKey } from '../../lib/i18n';

const ROLE_OPTIONS: Array<{ value: '' | BundledFontRole; labelKey: MessageKey }> = [
  { value: '', labelKey: 'fonts.browser.role.all' },
  { value: 'sans', labelKey: 'fonts.browser.role.sans' },
  { value: 'serif', labelKey: 'fonts.browser.role.serif' },
  { value: 'mono', labelKey: 'fonts.browser.role.mono' },
  { value: 'display', labelKey: 'fonts.browser.role.display' },
  { value: 'handwriting', labelKey: 'fonts.browser.role.handwriting' },
  { value: 'japanese', labelKey: 'fonts.browser.role.japanese' },
  { value: 'cjk', labelKey: 'fonts.browser.role.cjk' },
];

interface BridgeScopedCatalogState {
  bridge: SignalLoomNativeBridge | undefined;
  catalog?: BundledFontCatalog;
  error: string | null;
}

/**
 * A selection remains authoritative only while its exact bridge and selection turn remain
 * current. Async consumers may retain this small check across their own awaits.
 */
export interface BundledFontSelectionAuthority {
  isCurrent: () => boolean;
}

interface SelectionAuthorityGeneration {
  id: number;
}

interface SelectionScopedErrorState {
  authority: BundledFontSelectionAuthority;
  error: string | null;
  generation: SelectionAuthorityGeneration;
}

interface SelectionScopedBusyState {
  authority: BundledFontSelectionAuthority;
  faceId: string;
  generation: SelectionAuthorityGeneration;
}

// An identity is never reused, including after A → B → A bridge replacement or an unmount and
// remount that happens to receive the same bridge object again.
let nextSelectionAuthorityGeneration = 0;

function createSelectionAuthorityGeneration(..._inputs: readonly unknown[]): SelectionAuthorityGeneration {
  return { id: ++nextSelectionAuthorityGeneration };
}

type SpecimenState =
  | { bridge: SignalLoomNativeBridge | undefined; identity: string; status: 'waiting' | 'loading' }
  | { bridge: SignalLoomNativeBridge | undefined; identity: string; status: 'ready'; fontFamily: string; fontStretch: string; fontStyle: string; fontVariationSettings?: string; fontWeight: number }
  | { bridge: SignalLoomNativeBridge | undefined; identity: string; status: 'error'; detail: string };

function bundledFontSpecimenInputIdentity(family: BundledFontFamily, face: BundledFontFace): string {
  return bundledFontFaceIdentitySignature({
    kind: 'bundled',
    schemaVersion: 2,
    faceId: face.id,
    family: family.family,
    weight: face.weight,
    style: face.style,
    ...(face.style === 'oblique' ? { obliqueAngleDeg: 14 } : {}),
    stretchPercent: face.stretchPercent,
    ...(face.variable ? { variationSettings: Object.fromEntries(Object.entries(face.axes).map(([tag, axis]) => [tag, axis.default])) } : {}),
    collectionIndex: face.collectionIndex,
    sha256: face.sha256,
    byteLength: face.byteLength,
  });
}

function BundledFontSpecimen({
  bridge,
  face,
  family,
}: {
  bridge: SignalLoomNativeBridge | undefined;
  face: BundledFontFace;
  family: BundledFontFamily;
}) {
  const { t } = useI18n();
  const specimenRef = useRef<HTMLSpanElement | null>(null);
  const identity = bundledFontSpecimenInputIdentity(family, face);
  const [state, setState] = useState<SpecimenState>({ bridge, identity, status: 'waiting' });
  // Passive effects run after a new face has already committed. Never let the preceding face's
  // ready alias cross that render boundary: readiness belongs to one bridge + complete face identity.
  const currentState: SpecimenState = state.bridge === bridge && state.identity === identity
    ? state
    : { bridge, identity, status: 'waiting' };

  useEffect(() => {
    let cancelled = false;
    let started = false;
    let observer: IntersectionObserver | undefined;
    const requestIdentity = bundledFontSpecimenInputIdentity(family, face);
    const load = () => {
      if (started) return;
      started = true;
      setState((current) => (
        current.bridge === bridge && current.identity === requestIdentity && current.status === 'ready'
          ? current
          : { bridge, identity: requestIdentity, status: 'loading' }
      ));
      void ensureBundledFontFaceRegistered(family, face).then(() => {
        if (cancelled || getSignalLoomNativeBridge() !== bridge) return;
        const reference = createBundledFontFaceReference(family, face);
        setState({
          bridge,
          identity: bundledFontSpecimenInputIdentity(family, face),
          status: 'ready',
          fontFamily: formatFontFamily(bundledFontFaceRuntimeFamilyName(reference)),
          fontStretch: `${reference.stretchPercent}%`,
          fontStyle: bundledFontFaceStyleDescriptor(reference),
          fontVariationSettings: bundledFontFaceVariationSettingsCss(reference),
          fontWeight: reference.weight,
        });
      }).catch((reason) => {
        if (cancelled || getSignalLoomNativeBridge() !== bridge) return;
        setState({ bridge, identity: requestIdentity, status: 'error', detail: reason instanceof Error ? reason.message : t('fonts.browser.specimenUnavailable') });
      });
    };

    const specimen = specimenRef.current;
    if (specimen && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer?.disconnect();
          load();
        }
      });
      observer.observe(specimen);
    } else {
      load();
    }

    return () => {
      cancelled = true;
      observer?.disconnect();
    };
  }, [bridge, face, family, identity, t]);

  if (currentState.status === 'ready') {
    return (
      <span
        data-bundled-font-specimen={face.id}
        data-font-ready="true"
        ref={specimenRef}
        style={{
          fontFamily: currentState.fontFamily,
          fontStretch: currentState.fontStretch,
          fontStyle: currentState.fontStyle,
          fontVariationSettings: currentState.fontVariationSettings,
          fontWeight: currentState.fontWeight,
        }}
      >
        Ag あア
      </span>
    );
  }

  return (
    <span
      aria-busy={currentState.status === 'loading'}
      className="font-sans"
      data-bundled-font-specimen={face.id}
      data-font-ready="false"
      ref={specimenRef}
      title={currentState.status === 'error' ? currentState.detail : undefined}
    >
      {currentState.status === 'error' ? t('fonts.browser.specimenUnavailable') : t('fonts.browser.specimenLoading')}
    </span>
  );
}

export interface BundledFontBrowserProps {
  catalog?: BundledFontCatalog;
  disabled?: boolean;
  initiallyOpen?: boolean;
  onSelect: (family: BundledFontFamily, face: BundledFontFace, authority: BundledFontSelectionAuthority) => void | Promise<void>;
  style?: PaperManagedFontStyle;
  value: string;
  weight?: number;
}

export function BundledFontBrowser({
  catalog: suppliedCatalog,
  disabled = false,
  initiallyOpen = false,
  onSelect,
  style = 'normal',
  value,
  weight = 400,
}: BundledFontBrowserProps) {
  const { t, tf } = useI18n();
  // Starts (and stays) false until the main-process round trip positively confirms a usable
  // font-library root — fail closed while pending, not just once it resolves negative.
  const bridge = getSignalLoomNativeBridge();
  const available = useBundledFontLibraryCapability();
  const [open, setOpen] = useState(initiallyOpen);
  const [catalogState, setCatalogState] = useState<BridgeScopedCatalogState>({ bridge, error: null });
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<'' | BundledFontRole>('');
  const [busyState, setBusyState] = useState<SelectionScopedBusyState | null>(null);
  const [selectionErrorState, setSelectionErrorState] = useState<SelectionScopedErrorState | null>(null);
  const selectionTurn = useRef(0);
  const activeSelectionGeneration = useRef<SelectionAuthorityGeneration | null>(null);
  const selectionInputGeneration = useMemo(
    () => createSelectionAuthorityGeneration(bridge, suppliedCatalog, value, style, weight, onSelect),
    [bridge, onSelect, style, suppliedCatalog, value, weight],
  );

  // A selection authority belongs to one committed input generation, not merely a bridge object.
  // Cleanup irrevocably revokes it before the next input generation commits and on unmount.
  useLayoutEffect(() => {
    activeSelectionGeneration.current = selectionInputGeneration;
    return () => {
      if (activeSelectionGeneration.current === selectionInputGeneration) {
        activeSelectionGeneration.current = null;
      }
    };
  }, [selectionInputGeneration]);

  // A catalog/error has authority only while the exact bridge that loaded it remains current.
  // This makes bridge replacement fail closed even in the render before effects can clean up.
  const loadedCatalog = catalogState.bridge === bridge ? catalogState.catalog : undefined;
  const catalogError = catalogState.bridge === bridge ? catalogState.error : null;
  const selectionError = selectionErrorState?.generation === selectionInputGeneration && selectionErrorState.authority.isCurrent()
    ? selectionErrorState.error
    : null;
  const busyFace = busyState?.generation === selectionInputGeneration && busyState.authority.isCurrent()
    ? busyState.faceId
    : null;
  const error = catalogError
    ? tf('fonts.browser.catalogError', { detail: catalogError })
    : selectionError
      ? tf('fonts.browser.selectionError', { detail: selectionError })
      : null;
  const catalog = suppliedCatalog ?? loadedCatalog;

  useEffect(() => {
    if (!available || !open || catalog) return;
    let cancelled = false;
    void loadBundledFontCatalog().then((loaded) => {
      if (!cancelled && getSignalLoomNativeBridge() === bridge) {
        setCatalogState({ bridge, catalog: loaded, error: null });
      }
    }).catch((reason) => {
      if (!cancelled && getSignalLoomNativeBridge() === bridge) {
        setCatalogState({
          bridge,
          error: reason instanceof Error ? reason.message : t('fonts.browser.catalogFailureFallback'),
        });
      }
    });
    return () => { cancelled = true; };
  }, [available, bridge, catalog, open, t]);

  const visibleFamilies = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return (catalog?.families ?? []).filter((family) => (
      (!role || family.role === role)
      && (!needle || `${family.family} ${family.role} ${family.faces.map((face) => face.subfamily).join(' ')}`.toLocaleLowerCase().includes(needle))
    ));
  }, [catalog, query, role]);

  const choose = async (family: BundledFontFamily, face: BundledFontFace) => {
    const generation = activeSelectionGeneration.current;
    if (!generation) return;
    const turn = ++selectionTurn.current;
    const authority: BundledFontSelectionAuthority = {
      isCurrent: () => (
        activeSelectionGeneration.current === generation
        && getSignalLoomNativeBridge() === bridge
        && selectionTurn.current === turn
      ),
    };
    if (!authority.isCurrent()) return;
    setBusyState({ authority, faceId: face.id, generation });
    setSelectionErrorState(null);
    try {
      await ensureBundledFontFaceRegistered(family, face);
      // Registration can outlive a bridge replacement. Check both directly after it settles and
      // at the ordinary-callback boundary so no stale renderer authority can publish selection.
      if (!authority.isCurrent()) return;
      await onSelect(family, face, authority);
    } catch (reason) {
      if (authority.isCurrent()) {
        setSelectionErrorState({
          authority,
          error: reason instanceof Error ? reason.message : t('fonts.browser.selectionFailureFallback'),
          generation,
        });
      }
    } finally {
      // A replacement bridge can begin a new selection while this old registration settles.
      // Only the exact selection that published the busy state may clear it.
      setBusyState((current) => current?.authority === authority ? null : current);
    }
  };

  if (!available) return null;

  return (
    <div className="rounded-lg border border-cyan-300/15 bg-[#0b121d]">
      <button
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs text-cyan-100 hover:bg-cyan-400/5 disabled:opacity-50"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        title={t('fonts.browser.browseTooltip')}
        type="button"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Type className="shrink-0 text-cyan-300" size={15} />
          <span className="min-w-0">
            <span className="block font-semibold">{t('fonts.browser.browse')}</span>
            <span className="block truncate text-[10px] text-cyan-100/45">{value || t('fonts.browser.chooseExact')}</span>
          </span>
        </span>
        {open ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
      </button>

      {open ? (
        <div className="space-y-2 border-t border-cyan-300/10 p-3">
          <div className="grid grid-cols-[1fr_8rem] gap-2">
            <label className="relative block">
              <span className="sr-only">{t('fonts.browser.search')}</span>
              <Search className="pointer-events-none absolute left-2 top-2 text-cyan-100/35" size={14} />
              <input
                aria-label={t('fonts.browser.search')}
                className="w-full rounded border border-cyan-300/15 bg-[#151d29] py-1.5 pl-7 pr-2 text-xs text-white outline-none focus:border-cyan-300/50"
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('fonts.browser.searchPlaceholder')}
                role="searchbox"
                value={query}
              />
            </label>
            <select
              aria-label={t('fonts.browser.role')}
              className="rounded border border-cyan-300/15 bg-[#151d29] px-2 py-1.5 text-xs text-cyan-100 outline-none focus:border-cyan-300/50"
              onChange={(event) => setRole(event.target.value as '' | BundledFontRole)}
              value={role}
            >
              {ROLE_OPTIONS.map((option) => <option key={option.value || 'all'} value={option.value}>{t(option.labelKey)}</option>)}
            </select>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-cyan-100/45">
            <span>{catalog ? tf('fonts.browser.summary', {
              faceCount: catalog.faceCount,
              faceUnit: t(catalog.faceCount === 1 ? 'fonts.browser.face.one' : 'fonts.browser.face.many'),
              familyCount: catalog.familyCount,
              familyUnit: t(catalog.familyCount === 1 ? 'fonts.browser.family.one' : 'fonts.browser.family.many'),
            }) : t('fonts.browser.loadingLibrary')}</span>
            <span className="inline-flex items-center gap-1 text-emerald-200/70"><ShieldCheck size={12} /> {t('fonts.browser.offlineAudited')}</span>
          </div>
          <p className="text-[10px] leading-4 text-cyan-100/45">{t('fonts.browser.outputTruth')}</p>

          {error ? <p className="rounded border border-rose-400/25 bg-rose-400/10 px-2 py-1 text-[11px] text-rose-100">{error}</p> : null}
          <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
            {!catalog && !error ? <div className="flex justify-center p-5"><LoaderCircle className="animate-spin text-cyan-300" size={18} /></div> : null}
            {visibleFamilies.map((family) => {
              const face = selectBundledFontFace(family, weight, style);
              const selected = family.family === value || value.split(',')[0]?.replace(/["']/g, '').trim() === family.family;
              return (
                <div className={`rounded border ${selected ? 'border-cyan-300/45 bg-cyan-400/10' : 'border-cyan-300/10 bg-[#151d29]'}`} key={family.id}>
                  <button
                    aria-label={tf('fonts.browser.familyFaceAria', { family: family.family, face: face.subfamily })}
                    className="flex w-full items-center justify-between gap-3 px-2.5 py-2 text-left transition-colors hover:bg-cyan-400/5"
                    disabled={busyFace !== null}
                    onClick={() => void choose(family, face)}
                    type="button"
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-sans text-sm text-white">{family.family}</span>
                      <span className="block truncate text-[10px] text-cyan-100/45">
                        <BundledFontSpecimen bridge={bridge} face={face} family={family} />
                        <span className="font-sans"> · {t(`fonts.browser.role.${family.role}` as MessageKey)} · {tf(family.faces.length === 1 ? 'fonts.browser.faceCount.one' : 'fonts.browser.faceCount.many', { count: family.faces.length })}</span>
                      </span>
                    </span>
                    <span className="shrink-0 text-right font-sans text-[10px] text-cyan-100/55">
                      <span className="block">{face.weight} {face.subfamily}</span>
                      <span className="block">{face.variable ? t('fonts.browser.variableDefault') : family.licenseId}</span>
                    </span>
                  </button>
                  {selected && family.faces.length > 1 ? (
                    <div className="flex flex-wrap gap-1 border-t border-cyan-300/10 px-2 py-2 font-sans">
                      {family.faces.map((exactFace) => (
                        <button
                          aria-label={tf('fonts.browser.useFaceAria', { family: family.family, face: exactFace.subfamily })}
                          className={`rounded border px-1.5 py-1 text-[10px] ${exactFace.weight === weight && exactFace.style === style ? 'border-cyan-300/45 bg-cyan-300/10 text-cyan-50' : 'border-cyan-300/10 text-cyan-100/55 hover:border-cyan-300/35'}`}
                          disabled={busyFace !== null}
                          key={exactFace.id}
                          onClick={() => void choose(family, exactFace)}
                          type="button"
                        >
                          {exactFace.weight} {exactFace.subfamily}{exactFace.variable ? ` · ${t('fonts.browser.variable')}` : ''}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {catalog && visibleFamilies.length === 0 ? <p className="p-4 text-center text-xs text-cyan-100/40">{t('fonts.browser.noMatches')}</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
