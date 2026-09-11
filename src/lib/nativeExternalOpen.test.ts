import { describe, expect, it, vi } from 'vitest';
import { registerNativeExternalOpenConsumer, type NativeExternalOpenErrorContext } from './nativeExternalOpen';
import type {
  NativeExternalOpenNextResult,
  NativeExternalOpenTransitionResult,
  NativeProjectFileResult,
  SignalLoomNativeBridge,
} from './nativeApp';
import type { FlowProjectDocument } from './projectLibrary';

const projectDocumentStub = {} as FlowProjectDocument;

function createHandlers() {
  return {
    authorizeProject: vi.fn(async (_result: NativeProjectFileResult): Promise<boolean | void> => {}),
    applyProject: vi.fn(async (_result: NativeProjectFileResult) => {}),
    onProjectCommitted: vi.fn(async (
      _result: NativeProjectFileResult,
      _transition: NativeExternalOpenTransitionResult,
    ) => {}),
    applyPaper: vi.fn(async (_bytes: Uint8Array, _filePath?: string) => {}),
    onError: vi.fn(async (_context: NativeExternalOpenErrorContext) => {}),
  };
}

function createBridge(responses: NativeExternalOpenNextResult[], authorized = true) {
  const listeners = new Set<() => void>();
  const remaining = [...responses];
  const bridge = {
    authorizeExternalOpenRenderer: vi.fn(async () => authorized
      ? { authorized: true, epoch: 'epoch-1' }
      : { authorized: false, reason: 'not-designated-renderer' }),
    nextExternalOpenIntent: vi.fn(async () => remaining.shift() ?? { status: 'empty' }),
    acceptExternalOpenIntent: vi.fn(async () => ({ status: 'accepted' })),
    rejectExternalOpenIntent: vi.fn(async () => ({ status: 'rejected' })),
    commitExternalOpenIntent: vi.fn(async () => ({ status: 'committed' })),
    releaseExternalOpenRenderer: vi.fn(async () => ({ status: 'revoked' })),
    onExternalOpenPending: vi.fn((callback: () => void) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    }),
  } as unknown as SignalLoomNativeBridge;
  return {
    bridge,
    emitPending: () => {
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
  };
}

async function flushMicrotasks(rounds = 16) {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

describe('registerNativeExternalOpenConsumer', () => {
  it('is a safe no-op without the complete transactional bridge', async () => {
    const handlers = createHandlers();
    const disposeMissing = registerNativeExternalOpenConsumer(undefined, handlers);
    const disposeLegacy = registerNativeExternalOpenConsumer({} as SignalLoomNativeBridge, handlers);
    await flushMicrotasks();
    disposeMissing();
    disposeLegacy();
    expect(handlers.applyProject).not.toHaveBeenCalled();
  });

  it('subscribes before authorization and applies a project only after guard acceptance', async () => {
    const order: string[] = [];
    const projectResult = {
      canceled: false,
      filePath: '/home/user/Comic 週刊.sloom',
      document: projectDocumentStub,
    };
    const { bridge } = createBridge([{
      status: 'offered',
      state: 'offered',
      intent: { id: 'intent-1', kind: 'project', filePath: projectResult.filePath, result: projectResult },
    }]);
    const typedBridge = bridge as SignalLoomNativeBridge;
    vi.mocked(typedBridge.onExternalOpenPending!).mockImplementation((callback) => {
      order.push('subscribe');
      return () => void callback;
    });
    vi.mocked(typedBridge.authorizeExternalOpenRenderer!).mockImplementation(async () => {
      order.push('authorize-renderer');
      return { authorized: true, epoch: 'epoch-1' };
    });
    vi.mocked(typedBridge.acceptExternalOpenIntent!).mockImplementation(async () => {
      order.push('accept');
      return { status: 'accepted' };
    });
    vi.mocked(typedBridge.commitExternalOpenIntent!).mockImplementation(async () => {
      order.push('commit');
      return { status: 'committed' };
    });
    const handlers = createHandlers();
    handlers.authorizeProject.mockImplementation(async () => { order.push('dirty-guard'); });
    handlers.applyProject.mockImplementation(async () => { order.push('apply'); });
    handlers.onProjectCommitted.mockImplementation(async () => { order.push('publish-renderer-path'); });

    const dispose = registerNativeExternalOpenConsumer(bridge, handlers);
    await flushMicrotasks();
    dispose();

    expect(order).toEqual([
      'subscribe',
      'authorize-renderer',
      'dirty-guard',
      'accept',
      'apply',
      'commit',
      'publish-renderer-path',
    ]);
  });

  it('rejects a dirty-guard refusal without accepting, applying, or committing', async () => {
    const projectResult = { canceled: false, filePath: '/dirty.sloom', document: projectDocumentStub };
    const { bridge } = createBridge([{
      status: 'offered',
      state: 'offered',
      intent: { id: 'dirty-intent', kind: 'project', filePath: '/dirty.sloom', result: projectResult },
    }]);
    const handlers = createHandlers();
    handlers.authorizeProject.mockRejectedValue(new Error('dirty Image document'));

    const dispose = registerNativeExternalOpenConsumer(bridge, handlers);
    await flushMicrotasks();
    dispose();

    expect(bridge.rejectExternalOpenIntent).toHaveBeenCalledWith(expect.objectContaining({ intentId: 'dirty-intent' }));
    expect(bridge.acceptExternalOpenIntent).not.toHaveBeenCalled();
    expect(handlers.applyProject).not.toHaveBeenCalled();
    expect(bridge.commitExternalOpenIntent).not.toHaveBeenCalled();
    expect(handlers.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'dirty Image document' }));
  });

  it('treats shared dirty-project cancel as a quiet rejection that preserves the live project', async () => {
    const projectResult = { canceled: false, filePath: '/cancel.sloom', document: projectDocumentStub };
    const { bridge } = createBridge([{
      status: 'offered',
      state: 'offered',
      intent: { id: 'cancel-intent', kind: 'project', filePath: '/cancel.sloom', result: projectResult },
    }]);
    const handlers = createHandlers();
    handlers.authorizeProject.mockResolvedValue(false);

    const dispose = registerNativeExternalOpenConsumer(bridge, handlers);
    await flushMicrotasks();
    dispose();

    expect(bridge.rejectExternalOpenIntent).toHaveBeenCalledWith(expect.objectContaining({ intentId: 'cancel-intent' }));
    expect(bridge.acceptExternalOpenIntent).not.toHaveBeenCalled();
    expect(handlers.applyProject).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('commits an already-accepted intent without applying it twice', async () => {
    const projectResult = { canceled: false, filePath: '/retry.sloom', document: projectDocumentStub };
    const { bridge } = createBridge([{
      status: 'offered',
      state: 'accepted',
      intent: { id: 'accepted-intent', kind: 'project', filePath: '/retry.sloom', result: projectResult },
    }]);
    const handlers = createHandlers();

    const dispose = registerNativeExternalOpenConsumer(bridge, handlers);
    await flushMicrotasks();
    dispose();

    expect(handlers.authorizeProject).not.toHaveBeenCalled();
    expect(handlers.applyProject).not.toHaveBeenCalled();
    expect(bridge.acceptExternalOpenIntent).not.toHaveBeenCalled();
    expect(bridge.commitExternalOpenIntent).toHaveBeenCalledTimes(1);
    expect(handlers.onProjectCommitted).toHaveBeenCalledWith(
      projectResult,
      expect.objectContaining({ status: 'committed' }),
    );
  });

  it('autonomously retries a transient post-apply commit failure without rerunning replacement', async () => {
    const projectResult = { canceled: false, filePath: '/retry.sloom', document: projectDocumentStub };
    const { bridge } = createBridge([{
      status: 'offered',
      state: 'offered',
      intent: { id: 'retry-intent', kind: 'project', filePath: '/retry.sloom', result: projectResult },
    }]);
    const typedBridge = bridge as SignalLoomNativeBridge;
    vi.mocked(typedBridge.commitExternalOpenIntent!)
      .mockRejectedValueOnce(new Error('rememberProjectPath IPC failed'))
      .mockResolvedValueOnce({ status: 'committed' });
    const wait = vi.fn(async () => {});
    const handlers = createHandlers();

    const dispose = registerNativeExternalOpenConsumer(bridge, handlers, {
      commitRetryDelaysMs: [7, 11],
      wait,
    });
    await flushMicrotasks(30);
    dispose();

    expect(handlers.authorizeProject).toHaveBeenCalledTimes(1);
    expect(bridge.acceptExternalOpenIntent).toHaveBeenCalledTimes(1);
    expect(handlers.applyProject).toHaveBeenCalledTimes(1);
    expect(bridge.commitExternalOpenIntent).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(7);
    expect(handlers.onProjectCommitted).toHaveBeenCalledTimes(1);
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('bounds commit-only retries, reports exhaustion once, and never replaces twice', async () => {
    const projectResult = { canceled: false, filePath: '/exhaust.sloom', document: projectDocumentStub };
    const { bridge } = createBridge([{
      status: 'offered',
      state: 'offered',
      intent: { id: 'exhaust-intent', kind: 'project', filePath: '/exhaust.sloom', result: projectResult },
    }]);
    vi.mocked((bridge as SignalLoomNativeBridge).commitExternalOpenIntent!)
      .mockRejectedValue(new Error('persistent IPC failure'));
    const wait = vi.fn(async () => {});
    const handlers = createHandlers();

    const dispose = registerNativeExternalOpenConsumer(bridge, handlers, {
      commitRetryDelaysMs: [3, 5],
      wait,
    });
    await flushMicrotasks(30);
    dispose();

    expect(handlers.applyProject).toHaveBeenCalledTimes(1);
    expect(bridge.acceptExternalOpenIntent).toHaveBeenCalledTimes(1);
    expect(bridge.commitExternalOpenIntent).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls).toEqual([[3], [5]]);
    expect(handlers.onProjectCommitted).not.toHaveBeenCalled();
    expect(handlers.onError).toHaveBeenCalledTimes(1);
    expect(handlers.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'persistent IPC failure' }));
  });

  it('does not retry a stale epoch transition result', async () => {
    const projectResult = { canceled: false, filePath: '/stale.sloom', document: projectDocumentStub };
    const { bridge } = createBridge([{
      status: 'offered',
      state: 'accepted',
      intent: { id: 'stale-intent', kind: 'project', filePath: '/stale.sloom', result: projectResult },
    }]);
    vi.mocked((bridge as SignalLoomNativeBridge).commitExternalOpenIntent!)
      .mockResolvedValue({ status: 'unauthorized' });
    const wait = vi.fn(async () => {});
    const handlers = createHandlers();

    const dispose = registerNativeExternalOpenConsumer(bridge, handlers, {
      commitRetryDelaysMs: [1, 2, 3],
      wait,
    });
    await flushMicrotasks(20);
    dispose();

    expect(bridge.commitExternalOpenIntent).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
    expect(handlers.applyProject).not.toHaveBeenCalled();
    expect(handlers.onError).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending commit retry on renderer reload/crash disposal', async () => {
    let releaseWait = () => {};
    const retryGate = new Promise<void>((resolve) => { releaseWait = resolve; });
    const projectResult = { canceled: false, filePath: '/reload.sloom', document: projectDocumentStub };
    const { bridge } = createBridge([{
      status: 'offered',
      state: 'offered',
      intent: { id: 'reload-intent', kind: 'project', filePath: '/reload.sloom', result: projectResult },
    }]);
    vi.mocked((bridge as SignalLoomNativeBridge).commitExternalOpenIntent!)
      .mockRejectedValue(new Error('renderer connection interrupted'));
    const handlers = createHandlers();
    const dispose = registerNativeExternalOpenConsumer(bridge, handlers, {
      commitRetryDelaysMs: [10, 20],
      wait: () => retryGate,
    });
    await flushMicrotasks(20);
    expect(bridge.commitExternalOpenIntent).toHaveBeenCalledTimes(1);

    dispose();
    releaseWait();
    await flushMicrotasks(20);

    expect(handlers.applyProject).toHaveBeenCalledTimes(1);
    expect(bridge.commitExternalOpenIntent).toHaveBeenCalledTimes(1);
    expect(handlers.onError).not.toHaveBeenCalled();
    expect(bridge.releaseExternalOpenRenderer).toHaveBeenCalledWith('epoch-1');
  });

  it('asks the renderer to roll back accepted local state before releasing a disposed epoch', async () => {
    let releaseWait = () => {};
    const retryGate = new Promise<void>((resolve) => { releaseWait = resolve; });
    const projectResult = { canceled: false, filePath: '/reload.sloom', document: projectDocumentStub };
    const { bridge } = createBridge([{
      status: 'offered',
      state: 'offered',
      intent: { id: 'abandoned-intent', kind: 'project', filePath: '/reload.sloom', result: projectResult },
    }]);
    vi.mocked((bridge as SignalLoomNativeBridge).commitExternalOpenIntent!)
      .mockRejectedValue(new Error('renderer connection interrupted'));
    const events: string[] = [];
    const handlers = {
      ...createHandlers(),
      onProjectAbandoned: vi.fn(async () => { events.push('rollback-renderer'); }),
    };
    vi.mocked((bridge as SignalLoomNativeBridge).releaseExternalOpenRenderer!).mockImplementation(async () => {
      events.push('release-main');
      return { status: 'revoked' };
    });
    const dispose = registerNativeExternalOpenConsumer(bridge, handlers, {
      commitRetryDelaysMs: [10],
      wait: () => retryGate,
    });
    await flushMicrotasks(20);
    dispose();
    releaseWait();
    await flushMicrotasks(30);

    expect(handlers.onProjectAbandoned).toHaveBeenCalledTimes(1);
    expect(events).toEqual(['rollback-renderer', 'release-main']);
  });

  it('rolls back an accepted intent when renderer application fails before commit', async () => {
    const projectResult = { canceled: false, filePath: '/broken.sloom', document: projectDocumentStub };
    const { bridge } = createBridge([{
      status: 'offered',
      state: 'offered',
      intent: { id: 'broken-intent', kind: 'project', filePath: '/broken.sloom', result: projectResult },
    }]);
    const handlers = createHandlers();
    handlers.applyProject.mockRejectedValue(new Error('restore rolled back'));

    const dispose = registerNativeExternalOpenConsumer(bridge, handlers);
    await flushMicrotasks();
    dispose();

    expect(bridge.acceptExternalOpenIntent).toHaveBeenCalledTimes(1);
    expect(bridge.rejectExternalOpenIntent).toHaveBeenCalledWith(expect.objectContaining({ intentId: 'broken-intent' }));
    expect(bridge.commitExternalOpenIntent).not.toHaveBeenCalled();
    expect(handlers.onProjectCommitted).not.toHaveBeenCalled();
  });

  it('serializes wakeups and preserves project/Paper intent order', async () => {
    let releaseProject = () => {};
    const projectGate = new Promise<void>((resolve) => { releaseProject = resolve; });
    const { bridge, emitPending } = createBridge([
      {
        status: 'offered',
        state: 'offered',
        intent: {
          id: 'project',
          kind: 'project',
          filePath: '/a.sloom',
          result: { canceled: false, filePath: '/a.sloom', document: projectDocumentStub },
        },
      },
      { status: 'offered', state: 'offered', intent: { id: 'paper', kind: 'paper', filePath: '/b.slppr', bytes: new Uint8Array([7]) } },
    ]);
    const events: string[] = [];
    const handlers = createHandlers();
    handlers.applyProject.mockImplementation(async () => {
      events.push('project:start');
      await projectGate;
      events.push('project:end');
    });
    handlers.applyPaper.mockImplementation(async () => { events.push('paper'); });

    const dispose = registerNativeExternalOpenConsumer(bridge, handlers);
    await flushMicrotasks();
    emitPending();
    await flushMicrotasks();
    expect(events).toEqual(['project:start']);
    releaseProject();
    await flushMicrotasks(30);
    dispose();
    expect(events).toEqual(['project:start', 'project:end', 'paper']);
  });

  it('holds the shared project lifecycle across guard, apply, commit, and path publication', async () => {
    const projectResult = { canceled: false, filePath: '/sequence.sloom', document: projectDocumentStub };
    const { bridge } = createBridge([{
      status: 'offered',
      state: 'offered',
      intent: { id: 'sequence', kind: 'project', filePath: '/sequence.sloom', result: projectResult },
    }]);
    const events: string[] = [];
    const handlers = createHandlers();
    handlers.authorizeProject.mockImplementation(async () => { events.push('guard'); });
    handlers.applyProject.mockImplementation(async () => { events.push('apply'); });
    handlers.onProjectCommitted.mockImplementation(async () => { events.push('publish'); });
    let transitionCalls = 0;
    const runProjectTransition = async <T>(operation: () => Promise<T>): Promise<T> => {
      transitionCalls += 1;
      events.push('sequence:start');
      const result = await operation();
      events.push('sequence:end');
      return result;
    };

    const dispose = registerNativeExternalOpenConsumer(bridge, handlers, { runProjectTransition });
    await flushMicrotasks(30);
    dispose();

    expect(transitionCalls).toBe(1);
    expect(events).toEqual(['sequence:start', 'guard', 'apply', 'publish', 'sequence:end']);
  });

  it('does not let a non-designated renderer ask for an intent', async () => {
    const { bridge } = createBridge([], false);
    const handlers = createHandlers();
    const dispose = registerNativeExternalOpenConsumer(bridge, handlers);
    await flushMicrotasks();
    dispose();
    expect(bridge.nextExternalOpenIntent).not.toHaveBeenCalled();
    expect(handlers.onError).not.toHaveBeenCalled();
  });

  it('releases its epoch and listener on disposal', async () => {
    const { bridge, listenerCount } = createBridge([]);
    const dispose = registerNativeExternalOpenConsumer(bridge, createHandlers());
    await flushMicrotasks();
    expect(listenerCount()).toBe(1);
    dispose();
    await flushMicrotasks();
    expect(listenerCount()).toBe(0);
    expect(bridge.releaseExternalOpenRenderer).toHaveBeenCalledWith('epoch-1');
  });
});
