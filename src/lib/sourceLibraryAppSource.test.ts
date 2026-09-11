import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('App Source Library native sync source guards', () => {
  it('repairs native Source Library version gaps from an authoritative snapshot', () => {
    const source = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');

    expect(source).toContain('shouldRepairSourceLibraryNativeVersionGap');
    expect(source).toContain('expectedNativeVersion: nativeVersion');
    expect(source).toContain('result.version < nativeVersion');
    expect(source).toContain('sourceLibraryNativeSyncStatus.lastAckVersion');
    expect(source).toContain("sourceLibraryNativeSyncStatus.repairDirection === 'pull-native-snapshot'");
    expect(source).toContain('setSourceLibraryRendererNativeVersion(ackVersion)');
    expect(source).toMatch(/bridge\.getSourceLibrarySnapshot\(\{ claim: repairScope\.claim \}\)[\s\S]*type: 'source-library-snapshot'/);
    expect(source).toContain('isCurrentProjectAuthorityMutationScope(repairScope)');
    expect(source).toMatch(/setSourceLibraryRendererNativeVersion\(result\.version\)[\s\S]*applySourceLibraryNativeChange/);
    expect(source).toContain('Source Library repaired from a native snapshot.');
  });

  it('exposes an automation-only Source hook that requires exact authority and renders only after native commit', () => {
    const source = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');

    expect(source).toContain('signalLoomAutomation');
    expect(source).toContain('SIGNAL_LOOM_ENABLE_AUTOMATION_PATHS');
    expect(source).toContain("return { error: 'exact project authority missing or stale' }");
    expect(source).toMatch(/await bridge\.applySourceLibraryChange\([\s\S]*isCurrentProjectAuthorityMutationScope\(scope\)[\s\S]*applySourceLibraryChangeToRenderer\(request\.change, result\.version/);
    expect(source).toContain("return { error: 'native bridge missing' }");
  });

  it('keeps every project replacement path on transaction-owned Source Library bookkeeping', () => {
    const source = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');

    // Browser (no native bridge) New/Open run the closed guarded replacements directly.
    expect(source).toMatch(/replaceWithBlankProject\(\{[\s\S]*key: 'app:new-project'[\s\S]*transactionBookkeeping: 'reset-source-library-native-sync'/);
    expect(source).toMatch(/replaceProjectDocument\(document, \{[\s\S]*key: 'browser:open-project'[\s\S]*transactionBookkeeping: 'reset-source-library-native-sync'/);
    // Native two-phase New/Open authorize through the guarded policy, then hand the minted
    // capability plus the bookkeeping primitive to the closed renderer transaction.
    expect(source).toMatch(/requestBlankProjectReplacementAuthorization\(\{[\s\S]*key: 'app:new-project'/);
    expect(source).toMatch(/requestProjectReplacementAuthorization\(\{[\s\S]*key: authorizationKey/);
    expect(source).toContain("applyPreparedNativeProjectOpen(result, 'app:open-project')");
    expect(source).toMatch(/case 'file:new':[\s\S]*prepareProjectDocumentTransaction\(undefined, \{[\s\S]*transactionBookkeeping: 'reset-source-library-native-sync'/);
    expect(source).toMatch(/case 'file:open':[\s\S]*prepareProjectDocumentTransaction\(result\.document, \{[\s\S]*transactionBookkeeping: 'reset-source-library-native-sync'/);
    expect(source).not.toContain('beforeReplace:');
  });
});
