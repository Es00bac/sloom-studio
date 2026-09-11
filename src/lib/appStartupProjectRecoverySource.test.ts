import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('App startup project recovery wiring', () => {
  it('offers recovery only after blank startup adoption and commits prepared choices through the shared guard', () => {
    const source = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');

    expect(source).toMatch(/state\.startupProjectRecovery[\s\S]*type: 'startup-authority-adopted'[\s\S]*expectedAuthority: state\.projectAuthority[\s\S]*adoptedState: authorityClient\.getState\(\)/);
    expect(source).toMatch(/requestStartupProjectRecoveryAction\([\s\S]*applyPreparedNativeProjectOpen\(prepared/);
    expect(source).toMatch(/requestProjectReplacementAuthorization\([\s\S]*prepareProjectDocumentTransaction\(result\.document[\s\S]*commitProjectSwitch/);
    expect(source).toContain('<StartupProjectRecoveryDialog');
    expect(source).toMatch(/onProjectAuthorityChanged\(\(event\) => \{[\s\S]*clearStartupRecoveryAfterCanonicalCommit\(\)[\s\S]*handleAuthorityChanged\(event\)/);
    expect(source).toMatch(/commitProjectSwitch\([\s\S]*outcome: 'committed'/);
  });
});
