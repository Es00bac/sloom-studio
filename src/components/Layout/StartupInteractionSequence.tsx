import { useSettingsStore } from '../../store/settingsStore';
import { FirstRunLanguageGate } from './FirstRunLanguageGate';

/**
 * Owns the startup interaction order after persisted settings are known. Exactly one startup
 * overlay can be mounted at a time: a fresh profile chooses its language first, while returning
 * profiles need no further startup overlay.
 */
export function StartupInteractionSequence() {
  const settingsHydrated = useSettingsStore((state) => state.settingsHydrated);
  const localeChosen = useSettingsStore((state) => state.localeChosen);

  if (!settingsHydrated) {
    return null;
  }

  return localeChosen ? null : <FirstRunLanguageGate />;
}
