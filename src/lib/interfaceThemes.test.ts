import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INTERFACE_THEME_ID,
  INTERFACE_THEME_VARIABLES,
  INTERFACE_THEMES,
  buildInterfaceThemeStyle,
  resolveInterfaceTheme,
} from './interfaceThemes';

describe('interfaceThemes', () => {
  it('offers a full catalog of distinct user-facing appearance themes', () => {
    expect(INTERFACE_THEMES.length).toBe(20);
    expect(new Set(INTERFACE_THEMES.map((theme) => theme.id)).size).toBe(INTERFACE_THEMES.length);
    expect(INTERFACE_THEMES.map((theme) => theme.id)).toContain(DEFAULT_INTERFACE_THEME_ID);
    expect(new Set(INTERFACE_THEMES.map((theme) => theme.colors['--sl-accent'])).size).toBeGreaterThanOrEqual(15);
  });

  it('defines every required CSS variable for each theme', () => {
    for (const theme of INTERFACE_THEMES) {
      for (const variable of INTERFACE_THEME_VARIABLES) {
        expect(theme.colors[variable], `${theme.id} missing ${variable}`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('resolves invalid theme ids to the default and builds CSS custom property styles', () => {
    const fallback = resolveInterfaceTheme('missing-theme');
    expect(fallback.id).toBe(DEFAULT_INTERFACE_THEME_ID);

    const style = buildInterfaceThemeStyle(resolveInterfaceTheme('emerald-graphite'));
    expect(style['--sl-bg']).toBe('#07110f');
    expect(style['--sl-accent']).toBe('#34d399');
  });
});
