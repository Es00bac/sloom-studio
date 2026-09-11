import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Video Source Bin chrome density', () => {
  const source = readFileSync(new URL('./VideoWorkspace.tsx', import.meta.url), 'utf8');

  it('uses compact tab/count/action rows in both dockable and fallback Video layouts', () => {
    expect(source).toContain('data-video-source-bin-compact-header="true"');
    expect(source).toContain('data-video-source-bin-compact-header="legacy"');
    expect(source).toContain('aria-label="Collapse all source items"');
    expect(source).toContain('aria-label="Expand all source items"');
    expect(source).not.toContain('Mixed media, generated assets, captions, and reusable timeline elements.');
    expect(source).not.toContain('Switch between source media and reusable editor assets for timeline compositing.');
  });

  it('exposes explicit origin filters, bounded pool paging, metadata badges, and link-versus-copy import guidance', () => {
    expect(source).toContain('data-video-source-origin-controls="true"');
    expect(source).toContain("{ id: 'ingested', label: 'Ingested' }");
    expect(source).toContain("{ id: 'generated', label: 'Generated' }");
    expect(source).toContain('SOURCE_BIN_PAGE_SIZE = 48');
    expect(source).toContain('Show next {Math.min(SOURCE_BIN_PAGE_SIZE, remainingItemCount)}');
    expect(source).toContain('data-source-origin={origin}');
    expect(source).toContain('Link to originals');
    expect(source).toContain('Copy into project media');
    expect(source).toContain('Save the project or choose a scratch folder');
  });
});
