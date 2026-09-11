import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StartupProjectRecoveryDialog } from './StartupProjectRecoveryDialog';

describe('StartupProjectRecoveryDialog', () => {
  it('offers Retry, Open Another, Recover Backup, and a safe blank continuation', () => {
    const html = renderToStaticMarkup(
      <StartupProjectRecoveryDialog
        onAction={vi.fn()}
        recovery={{
          filePath: '/projects/issue-one.sloom',
          failure: { code: 'unreadable', message: 'The drive is temporarily unavailable.' },
          backups: [{ filePath: '/projects/issue-one.sloom.bak-20260718', modifiedAtMs: 1_752_840_000_000 }],
        }}
      />,
    );

    expect(html).toContain('The remembered project did not open');
    expect(html).toContain('/projects/issue-one.sloom');
    expect(html).toContain('Continue Blank');
    expect(html).toContain('Open Another');
    expect(html).toContain('Recover Backup');
    expect(html).toContain('Retry');
    expect(html).toContain('issue-one.sloom.bak-20260718');
  });

  it('keeps backup recovery unavailable when no matching backup exists', () => {
    const html = renderToStaticMarkup(
      <StartupProjectRecoveryDialog
        onAction={vi.fn()}
        recovery={{
          filePath: '/projects/missing.sloom',
          failure: { code: 'missing', message: 'ENOENT' },
          backups: [],
        }}
      />,
    );

    expect(html).toContain('No matching project backups were found');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^<]*(?:<svg[\s\S]*?<\/svg>[^<]*)?Recover Backup/);
  });
});
