import { describe, expect, it } from 'vitest';
import type { PaperRichParagraph } from '../types/paper';
import { flattenPaperRichText } from './paperRichText';
import { hasPaperFolioToken, resolvePaperFolioText, resolvePaperRichTextFolios } from './paperFolios';

describe('resolvePaperFolioText', () => {
  it('replaces page and pages tokens (both spellings)', () => {
    expect(resolvePaperFolioText('Page {page} of {pages}', 3, 12)).toBe('Page 3 of 12');
    expect(resolvePaperFolioText('{#} / {##}', 7, 40)).toBe('7 / 40');
  });

  it('returns text unchanged when there is no token', () => {
    expect(resolvePaperFolioText('No markers here', 3, 12)).toBe('No markers here');
    expect(resolvePaperFolioText('', 3, 12)).toBe('');
  });

  it('rounds and floors negative values', () => {
    expect(resolvePaperFolioText('{page}', 4.6, 9.2)).toBe('5');
    expect(resolvePaperFolioText('{pages}', 1, -3)).toBe('0');
  });
});

describe('resolvePaperRichTextFolios', () => {
  it('resolves tokens split across styled runs without mutating the authoritative rich source', () => {
    const source: PaperRichParagraph[] = [{
      id: 'p',
      runs: [
        { id: 'a', text: 'Page {pa', fontWeight: '700' },
        { id: 'b', text: 'ge} of {', fontStyle: 'italic' },
        { id: 'c', text: 'pages}', link: 'https://example.test' },
      ],
    }];
    const snapshot = structuredClone(source);
    const resolved = resolvePaperRichTextFolios(source, 7, 24)!;

    expect(flattenPaperRichText(resolved)).toBe('Page 7 of 24');
    expect(resolved).not.toBe(source);
    expect(resolved[0].runs).not.toBe(source[0].runs);
    expect(source).toEqual(snapshot);
    expect(flattenPaperRichText(source)).toBe('Page {page} of {pages}');
  });

  it('applies each page number independently to computed head and continuation render slices', () => {
    const headSlice: PaperRichParagraph[] = [{ runs: [{ text: 'Head {' }, { text: '#}', fontWeight: '700' }] }];
    const continuationSlice: PaperRichParagraph[] = [{ runs: [{ text: 'Continuation {pa' }, { text: 'ge}', fontStyle: 'italic' }] }];

    expect(flattenPaperRichText(resolvePaperRichTextFolios(headSlice, 2, 8))).toBe('Head 2');
    expect(flattenPaperRichText(resolvePaperRichTextFolios(continuationSlice, 5, 8))).toBe('Continuation 5');
    expect(flattenPaperRichText(headSlice)).toBe('Head {#}');
    expect(flattenPaperRichText(continuationSlice)).toBe('Continuation {page}');
  });
});

describe('hasPaperFolioToken', () => {
  it('detects any folio token', () => {
    expect(hasPaperFolioToken('Footer {page}')).toBe(true);
    expect(hasPaperFolioToken('Total {##}')).toBe(true);
    expect(hasPaperFolioToken('plain footer')).toBe(false);
    expect(hasPaperFolioToken(undefined)).toBe(false);
  });
});
