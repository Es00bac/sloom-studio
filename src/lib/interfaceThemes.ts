export const INTERFACE_THEME_VARIABLES = [
  '--sl-bg',
  '--sl-surface',
  '--sl-panel',
  '--sl-border',
  '--sl-text',
  '--sl-muted',
  '--sl-accent',
  '--sl-accent-contrast',
  '--sl-danger',
] as const;

export type InterfaceThemeVariable = typeof INTERFACE_THEME_VARIABLES[number];

export interface InterfaceTheme {
  id: string;
  name: string;
  colors: Record<InterfaceThemeVariable, string>;
}

export const DEFAULT_INTERFACE_THEME_ID = 'signal-dark';

export const INTERFACE_THEMES: InterfaceTheme[] = [
  theme('signal-dark', 'Signal Dark', '#0b0c10', '#11141d', '#1a1b23', '#263244', '#f3f7fb', '#92a3b8', '#22d3ee', '#061018', '#fb7185'),
  theme('graphite-cyan', 'Graphite Cyan', '#0d0f12', '#15191f', '#202630', '#394455', '#f4f7fa', '#a4b1c2', '#67e8f9', '#081014', '#f87171'),
  theme('emerald-graphite', 'Emerald Graphite', '#07110f', '#101a17', '#18251f', '#2c443a', '#ecfdf5', '#9fbdb1', '#34d399', '#04130d', '#f43f5e'),
  theme('deep-ruby', 'Deep Ruby', '#15090d', '#211016', '#301924', '#523040', '#fff1f2', '#c6a8b2', '#fb7185', '#19080d', '#f97316'),
  theme('blueprint', 'Blueprint', '#071016', '#101923', '#172434', '#2d4a63', '#eff6ff', '#9bb7d4', '#38bdf8', '#06121a', '#fb7185'),
  theme('violet-steel', 'Violet Steel', '#100b16', '#191423', '#241c31', '#443653', '#f5f3ff', '#b8abc8', '#a78bfa', '#13071c', '#fb7185'),
  theme('oxide', 'Oxide', '#120d0a', '#1d1712', '#2a2018', '#493b2d', '#fff7ed', '#c7b39f', '#f59e0b', '#180d03', '#ef4444'),
  theme('teal-ink', 'Teal Ink', '#061112', '#0e1b1d', '#16282b', '#28494e', '#f0fdfa', '#9abec0', '#2dd4bf', '#031412', '#f43f5e'),
  theme('mono-lab', 'Mono Lab', '#0e0f10', '#17191b', '#24272a', '#3e444a', '#f8fafc', '#a8b3bd', '#d1d5db', '#111827', '#ef4444'),
  theme('midnight-amber', 'Midnight Amber', '#080d16', '#111827', '#1b2534', '#354154', '#f8fafc', '#aab7c8', '#fbbf24', '#1a1003', '#fb7185'),
  theme('orchid-night', 'Orchid Night', '#120914', '#1e1420', '#2b1d31', '#50385b', '#fdf4ff', '#c8afd1', '#e879f9', '#17051b', '#fb7185'),
  theme('forest-terminal', 'Forest Terminal', '#081008', '#111a11', '#1a271a', '#334433', '#f0fdf4', '#a9bda8', '#86efac', '#071407', '#f87171'),
  theme('arctic-slate', 'Arctic Slate', '#081016', '#121b24', '#1c2935', '#314456', '#f0f9ff', '#a6bbcb', '#7dd3fc', '#061019', '#fb7185'),
  theme('high-contrast', 'High Contrast', '#050505', '#101010', '#1c1c1c', '#4b5563', '#ffffff', '#cbd5e1', '#fde047', '#111111', '#ff4d6d'),
  theme('plum-copper', 'Plum Copper', '#120b10', '#1c1419', '#2a1f26', '#4f3b43', '#fff7fb', '#c4aeb9', '#fb923c', '#180b03', '#f43f5e'),
  theme('sky-matrix', 'Sky Matrix', '#061017', '#0f1b22', '#172832', '#2a4b5a', '#ecfeff', '#9ec2cc', '#06b6d4', '#041318', '#f87171'),
  theme('solar-noir', 'Solar Noir', '#0f0d07', '#19160d', '#262014', '#4a3d21', '#fffbea', '#c9bd8d', '#facc15', '#171004', '#fb7185'),
  theme('moss-studio', 'Moss Studio', '#08100b', '#121a14', '#1d2a20', '#3a4f3f', '#f5fff7', '#aec4b3', '#bef264', '#0b1405', '#f97316'),
  theme('ember-neutral', 'Ember Neutral', '#100b0b', '#1a1414', '#261d1d', '#463836', '#fff8f6', '#c4b1ae', '#ff7a45', '#1a0903', '#ef4444'),
  theme('indigo-lime', 'Indigo Lime', '#090b16', '#121527', '#1d2138', '#383d61', '#f5f7ff', '#afb7d2', '#a3e635', '#0b1204', '#fb7185'),
];

export function resolveInterfaceTheme(themeId: string | undefined | null): InterfaceTheme {
  return INTERFACE_THEMES.find((themeOption) => themeOption.id === themeId)
    ?? INTERFACE_THEMES.find((themeOption) => themeOption.id === DEFAULT_INTERFACE_THEME_ID)
    ?? INTERFACE_THEMES[0];
}

export function buildInterfaceThemeStyle(theme: InterfaceTheme): Record<InterfaceThemeVariable, string> {
  return { ...theme.colors };
}

export function applyInterfaceTheme(theme: InterfaceTheme, root: HTMLElement = document.documentElement): void {
  for (const variable of INTERFACE_THEME_VARIABLES) {
    root.style.setProperty(variable, theme.colors[variable]);
  }
  root.dataset.interfaceTheme = theme.id;
}

function theme(
  id: string,
  name: string,
  bg: string,
  surface: string,
  panel: string,
  border: string,
  text: string,
  muted: string,
  accent: string,
  accentContrast: string,
  danger: string,
): InterfaceTheme {
  return {
    id,
    name,
    colors: {
      '--sl-bg': bg,
      '--sl-surface': surface,
      '--sl-panel': panel,
      '--sl-border': border,
      '--sl-text': text,
      '--sl-muted': muted,
      '--sl-accent': accent,
      '--sl-accent-contrast': accentContrast,
      '--sl-danger': danger,
    },
  };
}
