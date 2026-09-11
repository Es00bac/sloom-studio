import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('App Flow workspace queue wiring (AUD-027)', () => {
  it('routes selections and targeted commands through the owned hydration queue', () => {
    const source = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');

    expect(source).toContain('createFlowWorkspaceSwitchQueue({');
    expect(source).toContain('flowWorkspaceSwitchQueue.requestDrain()');
    expect(source).toContain('flowWorkspaceSwitchQueue.ensureWorkspaceHydrated(resolvedTargetFlowWorkspaceId)');
    expect(source).toContain('if (!hydrated) return;');
    expect(source).toContain('flowWorkspaceSwitchQueue.dispose()');
    expect(source).not.toContain('flowWorkspaceSwitchInFlightRef');
  });
});
