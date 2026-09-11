import { afterEach, describe, expect, it, vi } from 'vitest';
import { shouldBypassConfirmations } from './automationBypass';

describe('automation bypass helper', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('does not bypass confirmations in a normal renderer session', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubGlobal('window', {});

    expect(shouldBypassConfirmations()).toBe(false);
  });

  it('bypasses confirmations when Electron preload exposes the automation flag', () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubGlobal('window', {
      SIGNAL_LOOM_ENABLE_AUTOMATION_PATHS: '1',
    });

    expect(shouldBypassConfirmations()).toBe(true);
  });
});
