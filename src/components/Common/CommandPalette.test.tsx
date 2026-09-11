import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CommandPalette } from './CommandPalette';
import type { CommandPaletteEntry } from '../../lib/commandPalette';

describe('CommandPalette', () => {
  it('renders searchable grouped commands with shortcuts and disabled state', () => {
    const entries: CommandPaletteEntry[] = [
      {
        id: 'app:open-provider-settings',
        type: 'app',
        action: 'app:open-provider-settings',
        label: 'Provider Settings',
        group: 'Settings',
        description: 'Open provider setup.',
        keywords: ['provider', 'settings'],
      },
      {
        id: 'app:clean-flow',
        type: 'app',
        action: 'app:clean-flow',
        label: 'Clean Flow Workspace',
        group: 'Flow',
        description: 'Clean Flow is available after nodes are added to the canvas.',
        keywords: ['flow', 'clean'],
        disabled: true,
      },
      {
        id: 'menu:view:image',
        type: 'menu',
        command: 'view:image',
        label: 'Open/Focus Image Window',
        group: 'View',
        description: 'Switch workspaces.',
        shortcut: 'Ctrl+3',
        keywords: ['view', 'image'],
      },
    ];

    const html = renderToStaticMarkup(
      <CommandPalette
        entries={entries}
        onClose={() => undefined}
        onRun={() => undefined}
        open
      />,
    );

    expect(html).toContain('aria-label="Command palette"');
    expect(html).toContain('Search commands');
    expect(html).toContain('Provider Settings');
    expect(html).toContain('Clean Flow Workspace');
    expect(html).toContain('cursor-not-allowed');
    expect(html).toContain('Ctrl+3');
  });

  it('does not render while closed', () => {
    const html = renderToStaticMarkup(
      <CommandPalette
        entries={[]}
        onClose={() => undefined}
        onRun={() => undefined}
        open={false}
      />,
    );

    expect(html).toBe('');
  });
});
