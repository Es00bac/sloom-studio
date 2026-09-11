// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PaperShortcutHelpPanel } from './PaperShortcutHelpPanel';

const roots: Root[] = [];
vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
});

describe('PaperShortcutHelpPanel', () => {
  it('renders searchable, grouped, accessible shortcut help for a docked panel', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    roots.push(root);

    await act(async () => root.render(
      <PaperShortcutHelpPanel shortcuts={{ 'paper:toggle-rulers': 'Alt+R' }} />,
    ));

    expect(host.querySelector('[data-paper-shortcut-help="true"]')).not.toBeNull();
    expect(host.querySelector('section[aria-labelledby][aria-describedby]')).not.toBeNull();
    const labelledSearch = host.querySelector<HTMLInputElement>('[role="search"] input[type="search"]');
    expect(labelledSearch).not.toBeNull();
    expect(labelledSearch?.labels?.[0]?.textContent).toBe('Search Paper shortcuts');
    expect(host.querySelectorAll('h3').length).toBeGreaterThan(3);
    expect(host.textContent).toContain('Toggle Rulers');
    expect(host.textContent).toContain('Alt+R');
    expect(host.textContent).toContain('Ctrl/Cmd+Z');

    const input = host.querySelector<HTMLInputElement>('input[type="search"]');
    if (!input) throw new Error('Missing shortcut search field.');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'precisely');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(host.querySelectorAll('[data-paper-shortcut-id]')).toHaveLength(1);
    expect(host.textContent).toContain('Nudge selected frame precisely');
    expect(host.textContent).toContain('1 shortcut');
    expect(host.textContent).not.toContain('Toggle Rulers');
  });

  it('announces an empty result without dropping its search control', async () => {
    const host = document.createElement('div');
    const root = createRoot(host);
    roots.push(root);

    await act(async () => root.render(<PaperShortcutHelpPanel />));
    const input = host.querySelector<HTMLInputElement>('input[type="search"]');
    if (!input) throw new Error('Missing shortcut search field.');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, 'definitely-not-a-paper-command');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });

    expect(host.textContent).toContain('No Paper shortcuts match this search.');
    expect(host.textContent).toContain('0 shortcuts');
    expect(host.querySelector('input[type="search"]')).not.toBeNull();
  });
});
