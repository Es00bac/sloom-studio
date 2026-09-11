import { describe, expect, it, vi } from 'vitest';
import type {
  NativePreparedProjectSwitchResult,
  NativeProjectAuthorityDescriptor,
  NativeStartupProjectRecovery,
  SignalLoomNativeBridge,
} from './nativeApp';
import { ProjectAuthorityClient } from './projectAuthorityClient';
import {
  reduceStartupProjectRecovery,
  requestStartupProjectRecoveryAction,
} from './startupProjectRecovery';

const blankAuthority: NativeProjectAuthorityDescriptor = {
  authorityId: 'blank-startup-authority',
  version: 1,
};

const recovery: NativeStartupProjectRecovery = {
  filePath: '/projects/original.sloom',
  failure: { code: 'unreadable', message: 'The drive is temporarily unavailable.' },
  backups: [{ filePath: '/projects/original.sloom.bak-new', modifiedAtMs: 2 }],
};

function prepared(filePath: string): NativePreparedProjectSwitchResult {
  return { canceled: false, filePath, transactionId: 'switch-1' };
}

function bridge() {
  return {
    dismissStartupProjectRecovery: vi.fn(async () => ({ ok: true })),
    openProjectFile: vi.fn(async () => prepared('/projects/another.sloom')),
    recoverStartupProjectBackup: vi.fn(async () => prepared('/projects/original.sloom.bak-new')),
    retryStartupProject: vi.fn(async () => prepared('/projects/original.sloom')),
  } satisfies Pick<
    SignalLoomNativeBridge,
    'dismissStartupProjectRecovery' | 'openProjectFile' | 'recoverStartupProjectBackup' | 'retryStartupProject'
  >;
}

describe('startup project recovery actions', () => {
  it('retries the remembered path through a prepared project switch', async () => {
    const native = bridge();
    await expect(requestStartupProjectRecoveryAction({ action: 'retry', bridge: native })).resolves.toMatchObject({
      status: 'prepared',
      result: { filePath: '/projects/original.sloom', transactionId: 'switch-1' },
    });
    expect(native.retryStartupProject).toHaveBeenCalledWith({ claim: undefined });
  });

  it('opens another project through the normal native file chooser', async () => {
    const native = bridge();
    await expect(requestStartupProjectRecoveryAction({ action: 'open-another', bridge: native })).resolves.toMatchObject({
      status: 'prepared',
      result: { filePath: '/projects/another.sloom' },
    });
    expect(native.openProjectFile).toHaveBeenCalledOnce();
  });

  it('leaves recovery open when Open Another is canceled', async () => {
    const native = bridge();
    native.openProjectFile.mockResolvedValueOnce({ canceled: true });
    await expect(requestStartupProjectRecoveryAction({ action: 'open-another', bridge: native })).resolves.toEqual({
      status: 'prepared',
      result: { canceled: true },
    });
    expect(native.dismissStartupProjectRecovery).not.toHaveBeenCalled();
  });

  it('prepares only the selected discovered backup', async () => {
    const native = bridge();
    await requestStartupProjectRecoveryAction({
      action: 'recover-backup',
      bridge: native,
      backupPath: '/projects/original.sloom.bak-new',
    });
    expect(native.recoverStartupProjectBackup).toHaveBeenCalledWith({
      filePath: '/projects/original.sloom.bak-new',
      claim: undefined,
    });
  });

  it('continues blank without opening a file or erasing persistent state in the renderer', async () => {
    const native = bridge();
    await expect(requestStartupProjectRecoveryAction({ action: 'continue-blank', bridge: native })).resolves.toEqual({
      status: 'dismissed',
    });
    expect(native.dismissStartupProjectRecovery).toHaveBeenCalledOnce();
    expect(native.openProjectFile).not.toHaveBeenCalled();
    expect(native.retryStartupProject).not.toHaveBeenCalled();
  });
});

describe('startup project recovery authority ordering', () => {
  it('presents typed recovery after adopting the exact blank authority even though adoption advances the request epoch', async () => {
    let authorityEpoch = 0;
    const capturedStartupEpoch = authorityEpoch;
    const client = new ProjectAuthorityClient({
      bridge: {
        confirmProjectAdoption: async () => ({ ok: true }),
      },
      restoreSnapshot: async () => undefined,
      resetSnapshot: async () => undefined,
      onStateChanged: () => {
        authorityEpoch += 1;
      },
    });

    await client.adoptSnapshot({ authority: blankAuthority });

    // The old startup-scope check is now false by design: adopting authority is a real epoch
    // transition. Exact adopted identity, not that stale pre-adoption epoch, authorizes display.
    expect(authorityEpoch).not.toBe(capturedStartupEpoch);
    expect(reduceStartupProjectRecovery(undefined, {
      type: 'startup-authority-adopted',
      recovery,
      expectedAuthority: blankAuthority,
      adoptedState: client.getState(),
      windowEligible: true,
    })).toEqual(recovery);
  });

  it('does not present delayed recovery after a different authority wins', () => {
    expect(reduceStartupProjectRecovery(undefined, {
      type: 'startup-authority-adopted',
      recovery,
      expectedAuthority: blankAuthority,
      adoptedState: {
        claim: { authorityId: 'newer-project', version: 1 },
        stale: false,
      },
      windowEligible: true,
    })).toBeUndefined();
  });

  it.each(['canceled', 'rejected'] as const)('preserves recovery after a %s prepared switch', (outcome) => {
    expect(reduceStartupProjectRecovery(recovery, {
      type: 'prepared-switch-finished',
      outcome,
    })).toEqual(recovery);
  });

  it('clears recovery only after a prepared switch commits', () => {
    expect(reduceStartupProjectRecovery(recovery, {
      type: 'prepared-switch-finished',
      outcome: 'committed',
    })).toBeUndefined();
  });

  it('clears recovery when another window commits a canonical blank authority', () => {
    expect(reduceStartupProjectRecovery(recovery, {
      type: 'canonical-authority-committed',
    })).toBeUndefined();
  });
});
