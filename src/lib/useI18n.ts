import { useCallback } from 'react';

import { useSettingsStore } from '../store/settingsStore';
import { translate, translateBoth, translateFormat, type AppLocale, type MessageKey } from './i18n';

export interface UseI18n {
  /** The active interface language. */
  locale: AppLocale;
  /** Translate a key into the active language (the default for UI chrome). */
  t: (key: MessageKey) => string;
  /** Translate a key into the active language, substituting `{name}` placeholders. */
  tf: (key: MessageKey, params: Record<string, string | number>) => string;
  /** Render a key in BOTH languages, regardless of the setting (Japanese typographic terms). */
  tBoth: (key: MessageKey) => string;
}

/** React binding for the message catalog: re-renders the caller when the language setting changes. */
export function useI18n(): UseI18n {
  const locale = useSettingsStore((state) => state.locale);
  const t = useCallback((key: MessageKey) => translate(key, locale), [locale]);
  const tf = useCallback(
    (key: MessageKey, params: Record<string, string | number>) => translateFormat(key, locale, params),
    [locale],
  );
  return { locale, t, tf, tBoth: translateBoth };
}
