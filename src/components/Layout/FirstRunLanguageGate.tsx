import { useMemo } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import {
  APP_LOCALES,
  APP_LOCALE_ENDONYM,
  resolveDefaultLocale,
  translate,
  type AppLocale,
} from '../../lib/i18n';
import { BrandWordmark } from './BrandWordmark';

/**
 * First-run bilingual language chooser. Shown exactly once on a fresh install (gated by
 * `settingsStore.localeChosen`): the initial locale is pre-selected from the system language
 * (`resolveDefaultLocale`), but the user confirms or overrides it here. Everything is rendered in BOTH
 * languages because the user hasn't chosen yet — the whole point is that either audience can read it.
 */
export function FirstRunLanguageGate() {
  const localeChosen = useSettingsStore((state) => state.localeChosen);
  const setLocale = useSettingsStore((state) => state.setLocale);
  const detected = useMemo(() => resolveDefaultLocale(), []);

  if (localeChosen) return null;

  return (
    <div
      aria-label="Choose your language / 言語を選択"
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-10 bg-[#020712] px-6 text-center"
      data-first-run-language-gate="true"
      role="dialog"
      aria-modal="true"
    >
      {/* Ambient manga-glow behind the lockup. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-1/4 mx-auto h-[42vh] max-w-3xl rounded-full opacity-70 blur-3xl"
        style={{ background: 'radial-gradient(closest-side, rgba(34,211,238,0.16), transparent)' }}
      />

      <BrandWordmark scale={1.15} className="relative" />

      <div className="relative flex flex-col items-center gap-1">
        <h1 className="text-xl font-semibold text-cyan-50">
          {translate('firstRun.chooseLanguage', 'en')}
        </h1>
        <h2 className="text-lg font-semibold text-cyan-100/80">
          {translate('firstRun.chooseLanguage', 'ja')}
        </h2>
      </div>

      <div className="relative flex w-full max-w-md flex-col gap-3 sm:flex-row sm:justify-center">
        {APP_LOCALES.map((code: AppLocale) => {
          const isDetected = code === detected;
          return (
            <button
              key={code}
              type="button"
              onClick={() => setLocale(code)}
              autoFocus={isDetected}
              className={`group relative flex-1 rounded-xl border px-6 py-5 text-left transition-colors ${
                isDetected
                  ? 'border-cyan-300/60 bg-cyan-300/10 hover:bg-cyan-300/15'
                  : 'border-white/12 bg-white/[0.03] hover:border-cyan-300/40 hover:bg-white/[0.06]'
              }`}
            >
              <span className="block text-2xl font-semibold text-white">{APP_LOCALE_ENDONYM[code]}</span>
              <span className="mt-1 block text-xs uppercase tracking-wider text-cyan-100/45">
                {code === 'ja' ? 'Japanese' : 'English'}
              </span>
              {isDetected ? (
                <span className="absolute right-3 top-3 rounded-full bg-cyan-300/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-100">
                  {translate('firstRun.detected', 'en')} · {translate('firstRun.detected', 'ja')}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <p className="relative max-w-md text-xs leading-relaxed text-cyan-100/40">
        {translate('firstRun.changeLater', 'en')}
        <br />
        {translate('firstRun.changeLater', 'ja')}
      </p>
    </div>
  );
}
