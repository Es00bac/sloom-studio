// @vitest-environment jsdom

import { flushSync } from 'react-dom';
import { createRoot as createClientRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SourceCatalogDialog } from './SourceCatalogDialog';
import { useSourceCatalogStore } from '../../store/sourceCatalogStore';
import {
  buildSourceCatalogProjectRecord,
  SOURCE_CATALOG_MAX_SEARCH_RESULTS,
  type SourceCatalogProjectRecord,
} from '../../lib/sourceCatalog';
import { useSettingsStore } from '../../store/settingsStore';
import type { SourceBinProjectSnapshot } from '../../store/sourceBinStore';

function snapshot(items: Array<Record<string, unknown>>): SourceBinProjectSnapshot {
  return {
    bins: [{ id: 'bin-1', name: 'Bin', items: items as never, collapsed: false, createdAt: 1 }],
    dismissedSourceKeys: [],
  };
}

function seedRecord(
  projectId: string,
  projectName: string,
  savedAt: number,
  items: Array<Record<string, unknown>>,
): SourceCatalogProjectRecord {
  return buildSourceCatalogProjectRecord({ projectId, projectName, savedAt, snapshot: snapshot(items) });
}

describe('SourceCatalogDialog', () => {
  const originalLocale = useSettingsStore.getState().locale;
  let tracked: Array<{ container: HTMLElement; unmount: () => void }>;

  beforeEach(() => {
    tracked = [];
    useSettingsStore.getState().setLocale('en');
    useSourceCatalogStore.setState({ records: [], activeProjectId: undefined, activeProjectName: undefined });
  });

  afterEach(() => {
    useSettingsStore.getState().setLocale(originalLocale);
    for (const entry of tracked) {
      entry.unmount();
      entry.container.remove();
    }
  });

  const mountDialog = (onClose: () => void = () => undefined) => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createClientRoot(container);
    tracked.push({ container, unmount: () => root.unmount() });
    flushSync(() => root.render(<SourceCatalogDialog onClose={onClose} />));
    return container;
  };

  const setSearch = (container: HTMLElement, value: string) => {
    const input = container.querySelector<HTMLInputElement>('[data-source-catalog-search="true"]')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync(() => undefined);
  };

  const setSelect = (container: HTMLElement, selector: string, value: string) => {
    const select = container.querySelector<HTMLSelectElement>(selector)!;
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync(() => undefined);
  };

  it('explains the empty state before any project is recorded', () => {
    const container = mountDialog();
    expect(container.querySelector('[data-source-catalog-empty="true"]')?.textContent)
      .toContain('No projects recorded yet');
    expect(container.querySelector('[data-source-catalog-results="true"]')).toBeNull();
  });

  it('lists indexed entries with project provenance, generated badges, and the metadata boundary', () => {
    useSourceCatalogStore.setState({
      records: [
        seedRecord('p1', 'Comic Issue 4', 2000, [
          { id: 'i1', label: 'Hero render', kind: 'image', createdAt: 12, isGenerated: true },
          { id: 'i2', label: 'Script notes', kind: 'text', createdAt: 11 },
        ]),
        seedRecord('p2', 'Book Trailer', 1000, [
          { id: 'i3', label: 'Voice take', kind: 'audio', createdAt: 5 },
        ]),
      ],
      activeProjectId: 'p1',
      activeProjectName: 'Comic Issue 4',
    });
    const container = mountDialog();

    const results = container.querySelectorAll('[data-source-catalog-result]');
    expect(results).toHaveLength(3);
    expect(results[0].getAttribute('data-source-catalog-result')).toBe('p1:i1');
    expect(results[0].textContent).toContain('Hero render');
    expect(results[0].textContent).toContain('Comic Issue 4 (current project)');
    expect(results[0].textContent).toContain('Generated');
    expect(results[2].textContent).toContain('Book Trailer');
    // The honest bytes boundary is visible.
    expect(container.querySelector('[data-source-catalog-dialog="true"]')!.textContent)
      .toContain('their bytes live in that project');
  });

  it('filters by search text, generated origin, and project', () => {
    useSourceCatalogStore.setState({
      records: [
        seedRecord('p1', 'Alpha', 2000, [
          { id: 'a1', label: 'Hero render', kind: 'image', createdAt: 10, isGenerated: true },
          { id: 'a2', label: 'Hero sketch', kind: 'image', createdAt: 11 },
        ]),
        seedRecord('p2', 'Beta', 1000, [
          { id: 'b1', label: 'Hero render alt', kind: 'image', createdAt: 5, isGenerated: true },
        ]),
      ],
    });
    const container = mountDialog();
    expect(container.querySelectorAll('[data-source-catalog-result]')).toHaveLength(3);

    setSearch(container, 'sketch');
    expect(container.querySelectorAll('[data-source-catalog-result]')).toHaveLength(1);
    expect(container.querySelector('[data-source-catalog-result]')!.getAttribute('data-source-catalog-result')).toBe('p1:a2');

    setSearch(container, '');
    setSelect(container, '[data-source-catalog-generated-filter="true"]', 'generated');
    expect(container.querySelectorAll('[data-source-catalog-result]')).toHaveLength(2);

    setSelect(container, '[data-source-catalog-project-filter="true"]', 'p2');
    expect(container.querySelectorAll('[data-source-catalog-result]')).toHaveLength(1);
    expect(container.querySelector('[data-source-catalog-result]')!.getAttribute('data-source-catalog-result')).toBe('p2:b1');
  });

  it('shows same-source lineage across projects', () => {
    useSourceCatalogStore.setState({
      records: [
        seedRecord('p1', 'Alpha', 2000, [
          { id: 'a1', label: 'Shared source', kind: 'image', createdAt: 10, sourceKey: 'source:shared' },
        ]),
        seedRecord('p2', 'Beta', 1000, [
          { id: 'b1', label: 'Shared copy', kind: 'image', createdAt: 5, sourceKey: 'source:shared' },
        ]),
      ],
    });
    const container = mountDialog();
    const betaRow = container.querySelector('[data-source-catalog-result="p2:b1"]')!;
    expect(betaRow.querySelector('[data-source-catalog-lineage="true"]')?.textContent)
      .toContain('Same source also in: Alpha');
  });

  it('reports truncation instead of silently hiding matches', () => {
    const many = Array.from({ length: SOURCE_CATALOG_MAX_SEARCH_RESULTS + 3 }, (_, index) => ({
      id: `i${index}`,
      label: `Render ${index}`,
      kind: 'image',
      createdAt: index,
    }));
    useSourceCatalogStore.setState({ records: [seedRecord('p1', 'Dense', 1, many)] });
    const container = mountDialog();
    expect(container.querySelectorAll('[data-source-catalog-result]'))
      .toHaveLength(SOURCE_CATALOG_MAX_SEARCH_RESULTS);
    expect(container.querySelector('[data-source-catalog-truncated="true"]')?.textContent)
      .toContain(`of ${SOURCE_CATALOG_MAX_SEARCH_RESULTS + 3} matches`);
  });

  it('forgets a selected project record and clears the whole catalogue', () => {
    useSourceCatalogStore.setState({ records: [seedRecord('p1', 'Alpha', 2, []), seedRecord('p2', 'Beta', 1, [])] });
    const container = mountDialog();

    const clearButton = container.querySelector<HTMLButtonElement>('[data-source-catalog-clear="true"]')!;
    clearButton.click();
    flushSync(() => undefined);
    expect(useSourceCatalogStore.getState().records).toHaveLength(0);

    useSourceCatalogStore.setState({ records: [seedRecord('p1', 'Alpha', 2, [])] });
    // zustand setState outside React needs a flush before the select's option exists.
    flushSync(() => undefined);
    setSelect(container, '[data-source-catalog-project-filter="true"]', 'p1');
    const forgetButton = container.querySelector<HTMLButtonElement>('[data-source-catalog-forget="true"]')!;
    expect(forgetButton.disabled).toBe(false);
    forgetButton.click();
    flushSync(() => undefined);
    expect(useSourceCatalogStore.getState().records).toHaveLength(0);
  });

  it('closes on Escape and restores focus to the element that opened it', () => {
    const opener = document.createElement('button');
    opener.type = 'button';
    document.body.appendChild(opener);
    opener.focus();

    const onClose = vi.fn();
    const container = mountDialog(onClose);
    const search = container.querySelector<HTMLInputElement>('[data-source-catalog-search="true"]')!;
    // The dialog focuses its search input on open.
    expect(document.activeElement).toBe(search);

    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    flushSync(() => undefined);
    expect(onClose).toHaveBeenCalledTimes(1);

    // The parent removes the dialog after onClose: focus returns to the opener.
    const entry = tracked[tracked.length - 1];
    entry.unmount();
    tracked.pop();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('presents an accessible dialog with labelled filters', () => {
    const container = mountDialog();
    const dialog = container.querySelector('[data-source-catalog-dialog="true"]')!;
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(container.querySelector('#source-catalog-title')?.textContent).toBe('Cross-project asset catalogue');
    expect(container.querySelector('[data-source-catalog-search="true"]')?.getAttribute('aria-label'))
      .toBe('Search the catalogue');
    expect(container.querySelector('[data-source-catalog-project-filter="true"]')?.getAttribute('aria-label'))
      .toBe('Filter by project');
  });
});
