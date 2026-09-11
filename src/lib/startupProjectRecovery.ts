import type {
  NativePreparedProjectSwitchResult,
  NativeProjectAuthorityDescriptor,
  NativeStartupProjectRecovery,
  SignalLoomNativeBridge,
} from './nativeApp';
import type { ProjectAuthorityClientState } from './projectAuthorityClient';

export type StartupProjectRecoveryAction = 'retry' | 'open-another' | 'recover-backup' | 'continue-blank';

export type StartupProjectRecoveryActionResult =
  | { status: 'dismissed' }
  | { status: 'prepared'; result: NativePreparedProjectSwitchResult };

type StartupRecoveryBridge = Pick<
  SignalLoomNativeBridge,
  'dismissStartupProjectRecovery' | 'openProjectFile' | 'recoverStartupProjectBackup' | 'retryStartupProject'
>;

export type StartupProjectRecoveryStateEvent =
  | {
    type: 'startup-authority-adopted';
    recovery?: NativeStartupProjectRecovery;
    expectedAuthority?: NativeProjectAuthorityDescriptor;
    adoptedState: Pick<ProjectAuthorityClientState, 'claim' | 'stale'>;
    windowEligible: boolean;
  }
  | {
    type: 'prepared-switch-finished';
    outcome: 'committed' | 'canceled' | 'rejected';
  }
  | { type: 'canonical-authority-committed' }
  | { type: 'dismissed' };

function authorityMatches(
  expected: NativeProjectAuthorityDescriptor | undefined,
  actual: NativeProjectAuthorityDescriptor | undefined,
): boolean {
  if (!expected || !actual) return expected === undefined && actual === undefined;
  return expected.authorityId === actual.authorityId && expected.version === actual.version;
}

/**
 * Renderer-local recovery state follows committed project authority, not the delayed startup
 * request epoch. Confirming the expected blank startup authority legitimately advances that
 * epoch; exact post-adoption authority identity distinguishes that expected transition from a
 * newer project winning while startup was waiting.
 */
export function reduceStartupProjectRecovery(
  current: NativeStartupProjectRecovery | undefined,
  event: StartupProjectRecoveryStateEvent,
): NativeStartupProjectRecovery | undefined {
  if (event.type === 'startup-authority-adopted') {
    return event.recovery
      && event.windowEligible
      && !event.adoptedState.stale
      && authorityMatches(event.expectedAuthority, event.adoptedState.claim)
      ? event.recovery
      : current;
  }

  if (event.type === 'prepared-switch-finished') {
    return event.outcome === 'committed' ? undefined : current;
  }

  // Authority notifications are emitted only after main has committed publication. This also
  // covers another window replacing the failed startup project with a canonical blank project.
  return undefined;
}

/**
 * Keeps the four recovery choices explicit and independently testable. Project-producing choices
 * only prepare a native switch; App still applies its Paper/Image replacement guard before commit.
 */
export async function requestStartupProjectRecoveryAction(options: {
  action: StartupProjectRecoveryAction;
  bridge: StartupRecoveryBridge;
  claim?: NativeProjectAuthorityDescriptor;
  backupPath?: string;
}): Promise<StartupProjectRecoveryActionResult> {
  const { action, bridge, claim, backupPath } = options;
  if (action === 'continue-blank') {
    if (!bridge.dismissStartupProjectRecovery) {
      throw new Error('This desktop build cannot dismiss startup recovery.');
    }
    const result = await bridge.dismissStartupProjectRecovery();
    if (!result.ok) throw new Error('Sloom Studio could not continue with the blank project.');
    return { status: 'dismissed' };
  }

  if (action === 'retry') {
    if (!bridge.retryStartupProject) throw new Error('This desktop build cannot retry the remembered project.');
    return { status: 'prepared', result: await bridge.retryStartupProject({ claim }) };
  }

  if (action === 'recover-backup') {
    if (!backupPath) throw new Error('Choose a project backup to recover.');
    if (!bridge.recoverStartupProjectBackup) throw new Error('This desktop build cannot recover project backups.');
    return {
      status: 'prepared',
      result: await bridge.recoverStartupProjectBackup({ filePath: backupPath, claim }),
    };
  }

  return { status: 'prepared', result: await bridge.openProjectFile({ claim }) };
}
