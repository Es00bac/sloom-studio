// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const backing = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => backing.get(key) ?? null,
      setItem: (key: string, value: string) => backing.set(key, String(value)),
      removeItem: (key: string) => backing.delete(key),
      clear: () => backing.clear(),
      key: () => null,
      length: 0,
    },
  });
});

import { DEFAULT_PAPER_TYPOGRAPHY } from '../../../lib/paperDocument';
import { useSettingsStore } from '../../../store/settingsStore';
import { PaperRichAdvancedTypePanel } from './PaperWorkspace';

let host: HTMLDivElement | undefined;
let root: Root | undefined;

beforeEach(() => {
  useSettingsStore.setState({ locale: 'ja' });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  useSettingsStore.setState({ locale: 'en' });
});

describe('Paper rich typography localization (FBL-032)', () => {
  it('renders the complete Japanese character, paragraph, kerning, and Japanese-typesetting surface', async () => {
    await act(async () => root?.render(
      <PaperRichAdvancedTypePanel onApply={vi.fn()} typography={DEFAULT_PAPER_TYPOGRAPHY} />,
    ));

    expect(host?.textContent).toContain('高度な文字組み');
    expect(host?.textContent).toContain('文字設定は選択したテキストに');
    expect(host?.textContent).toContain('選択範囲に即時反映');
    expect(host?.textContent).toContain('字送り / ‰ em');
    expect(host?.textContent).toContain('段落前 / mm');
    expect(host?.textContent).toContain('日本語組版');
    expect(host?.textContent).toContain('禁則処理');
    expect(host?.textContent).toContain('常時表示される「ルビ」と「圏」操作');

    const kerning = [...(host?.querySelectorAll('label') ?? [])]
      .find((label) => label.textContent?.includes('カーニング'))
      ?.querySelector<HTMLSelectElement>('select');
    expect(kerning).not.toBeNull();
    expect([...kerning!.options].map((option) => [option.value, option.textContent])).toEqual([
      ['auto', '自動'],
      ['normal', 'メトリクス'],
      ['none', 'なし'],
    ]);
    expect(host?.querySelector('[aria-label="選択テキストの文字色"]')).not.toBeNull();
  });

  it('reacts to an English locale change without remounting the typography panel', async () => {
    await act(async () => root?.render(
      <PaperRichAdvancedTypePanel onApply={vi.fn()} typography={DEFAULT_PAPER_TYPOGRAPHY} />,
    ));
    await act(async () => useSettingsStore.getState().setLocale('en'));

    expect(host?.textContent).toContain('Advanced type');
    expect(host?.textContent).toContain('Character settings target highlighted text');
    expect(host?.textContent).toContain('Live selection');
    expect(host?.textContent).toContain('Metrics');
    expect(host?.textContent).not.toContain('高度な文字組み');
  });
});
