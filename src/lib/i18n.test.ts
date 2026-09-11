import { describe, expect, it } from 'vitest';

import {
  MESSAGES,
  normalizeLocale,
  translate,
  translateBoth,
  translateFormat,
  type MessageKey,
} from './i18n';

describe('i18n message catalog', () => {
  it('has both an English and a Japanese string for every key (no gaps)', () => {
    for (const [key, message] of Object.entries(MESSAGES)) {
      expect(message.en, `${key}.en`).toBeTruthy();
      expect(message.ja, `${key}.ja`).toBeTruthy();
    }
  });

  it('translate() follows the requested locale', () => {
    expect(translate('paper.view.spreads', 'en')).toBe('Spreads');
    expect(translate('paper.view.spreads', 'ja')).toBe('見開き');
    expect(translate('settings.language', 'ja')).toBe('言語');
  });


  it('translateBoth() renders both languages regardless of locale', () => {
    // Uses the explicit `both` form when present…
    expect(translateBoth('paper.jp.rtlBinding')).toBe('RTL 右綴じ');
    // …and otherwise joins en · ja.
    expect(translateBoth('paper.view.spreads')).toBe('Spreads · 見開き');
    // A term whose both-form is a single shared token stays compact.
    expect(translateBoth('paper.jp.furigana')).toBe('ルビ');
  });

  it('falls back to the raw key for an unknown lookup', () => {
    expect(translate('nope.missing' as MessageKey, 'en')).toBe('nope.missing');
  });

  it('falls back to English (never undefined) when the locale is missing/invalid', () => {
    // e.g. a server snapshot before the store hydrates — must still return a real string.
    expect(translate('paper.view.spreads', undefined as unknown as 'en')).toBe('Spreads');
    expect(translateFormat('flow.toolbar.addNode', undefined as unknown as 'en', { name: 'X' })).toBe('Add X node');
  });

  it('translateFormat substitutes placeholders with locale-correct word order', () => {
    // English keeps the name mid-sentence; Japanese moves it to the front — interpolation, not concat.
    expect(translateFormat('flow.toolbar.addNode', 'en', { name: 'Image' })).toBe('Add Image node');
    expect(translateFormat('flow.toolbar.addNode', 'ja', { name: 'Image' })).toBe('Imageノードを追加');
  });

  it('keeps typography browser and Paper tab interpolation truthful in both locales', () => {
    const summary = { familyCount: 1, familyUnit: 'ファミリー', faceCount: 2, faceUnit: '書体' };
    expect(translateFormat('fonts.browser.summary', 'ja', summary)).toBe('1 ファミリー・2 書体');
    expect(translateFormat('fonts.browser.faceCount.one', 'en', { count: 1 })).toBe('1 face');
    expect(translateFormat('fonts.browser.faceCount.many', 'en', { count: 2 })).toBe('2 faces');
    expect(translateFormat('paper.tabs.close', 'en', { title: 'Layout A' })).toBe('Close Layout A');
    expect(translateFormat('paper.tabs.close', 'ja', { title: 'レイアウト A' })).toBe('「レイアウト A」を閉じる');
    expect(translateFormat('fonts.browser.catalogError', 'ja', { detail: '接続なし' })).toBe('同梱フォントライブラリを利用できません：接続なし');
    expect(translate('fonts.browser.catalogFailureFallback', 'ja')).toBe('カタログの診断情報が提供されませんでした。');
    expect(translate('fonts.browser.selectionFailureFallback', 'en')).toBe('No selection diagnostic was provided.');
  });

  it('discloses every restored settings category in both locales', () => {
    expect(translate('settings.backup.restoreWarning', 'en')).toContain('editor preferences');
    expect(translate('settings.backup.restoreWarning', 'en')).toContain('API keys');
    expect(translate('settings.backup.restoreWarning', 'en')).toContain('provider credentials');
    expect(translate('settings.backup.restoreWarning', 'ja')).toContain('エディター設定');
    expect(translate('settings.backup.restoreWarning', 'ja')).toContain('API キー');
    expect(translate('settings.backup.restoreWarning', 'ja')).toContain('プロバイダー認証情報');
  });
});

describe('normalizeLocale', () => {
  it('accepts valid locales and rejects stale/absent values', () => {
    expect(normalizeLocale('ja')).toBe('ja');
    expect(normalizeLocale('en')).toBe('en');
    // Unknown/absent → a valid default (env-dependent, but always a real locale).
    expect(['en', 'ja']).toContain(normalizeLocale('fr'));
    expect(['en', 'ja']).toContain(normalizeLocale(undefined));
  });
});
