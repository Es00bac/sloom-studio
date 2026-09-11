import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowProjectFlowSnapshot, FlowWorkspaceProjectSnapshot } from './flowProjectWorkspaces';
import { createFlowWorkspaceSwitchQueue } from './flowWorkspaceSwitchQueue';
import { useFlowWorkspaceStore } from '../store/flowWorkspaceStore';

function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function snapshot(id: string): FlowProjectFlowSnapshot {
  return {
    version: 3,
    nodes: [{
      id: `node-${id}`,
      type: 'textNode',
      position: { x: 0, y: 0 },
      data: { sourceAssetId: `asset-${id}` },
    }],
    edges: [],
  };
}

function workspace(id: string): FlowWorkspaceProjectSnapshot {
  return {
    id,
    name: `Workspace ${id}`,
    createdAt: 1,
    updatedAt: 1,
    flow: snapshot(id),
  };
}

function setThreeWorkspaces() {
  useFlowWorkspaceStore.getState().hydrateProjectSnapshot({
    activeWorkspaceId: 'A',
    workspaces: [workspace('A'), workspace('B'), workspace('C')],
  });
}

function createHarness(initialCanvas = snapshot('A')) {
  let canvas = clone(initialCanvas);
  const gates = new Map<string, ReturnType<typeof deferred>>();
  const restoreOrder: string[] = [];
  const errors: unknown[] = [];
  const gateFor = (id: string) => {
    const existing = gates.get(id);
    if (existing) return existing;
    const gate = deferred();
    gates.set(id, gate);
    return gate;
  };
  const queue = createFlowWorkspaceSwitchQueue({
    exportHydratedSnapshot: () => clone(canvas),
    replaceHydratedSnapshot: (next) => { canvas = clone(next); },
    restoreImportedAssets: async () => {
      const ownerId = useFlowWorkspaceStore.getState().hydratedWorkspaceId;
      restoreOrder.push(ownerId);
      await gateFor(ownerId).promise;
      canvas = {
        ...canvas,
        nodes: canvas.nodes.map((node) => ({
          ...node,
          data: { ...node.data, sourceAssetUrl: `hydrated:${ownerId}` },
        })),
      };
    },
    onRestoreError: (error) => errors.push(error),
  });
  return {
    queue,
    gateFor,
    restoreOrder,
    errors,
    canvas: () => canvas,
  };
}

async function waitForRestore(order: string[], expected: string[]) {
  await vi.waitFor(() => expect(order).toEqual(expected));
}

afterEach(() => {
  useFlowWorkspaceStore.getState().reset();
});

describe('Flow workspace switch queue (AUD-027)', () => {
  it('drains rapid A -> B -> C selection after delayed B assets and preserves each owner snapshot', async () => {
    setThreeWorkspaces();
    const harness = createHarness();

    useFlowWorkspaceStore.getState().setActiveWorkspaceId('B');
    harness.queue.requestDrain();
    await waitForRestore(harness.restoreOrder, ['B']);
    useFlowWorkspaceStore.getState().setActiveWorkspaceId('C');
    const cHydrated = harness.queue.ensureWorkspaceHydrated('C');

    expect(useFlowWorkspaceStore.getState().activeWorkspaceId).toBe('C');
    expect(useFlowWorkspaceStore.getState().hydratedWorkspaceId).toBe('B');
    expect(harness.canvas().nodes[0]?.id).toBe('node-B');

    harness.gateFor('B').resolve();
    await waitForRestore(harness.restoreOrder, ['B', 'C']);
    expect(harness.canvas().nodes[0]?.id).toBe('node-C');
    expect(useFlowWorkspaceStore.getState().getWorkspace('B')?.flow.nodes[0]?.data.sourceAssetUrl)
      .toBe('hydrated:B');

    harness.gateFor('C').resolve();
    await expect(cHydrated).resolves.toBe(true);
    expect(useFlowWorkspaceStore.getState().activeWorkspaceId).toBe('C');
    expect(useFlowWorkspaceStore.getState().hydratedWorkspaceId).toBe('C');
    expect(harness.canvas().nodes[0]?.data.sourceAssetUrl).toBe('hydrated:C');
    harness.queue.dispose();
  });

  it('coalesces to the newest requested workspace without restoring an intermediate target', async () => {
    setThreeWorkspaces();
    const harness = createHarness();
    useFlowWorkspaceStore.getState().setActiveWorkspaceId('B');
    harness.queue.requestDrain();
    await waitForRestore(harness.restoreOrder, ['B']);

    useFlowWorkspaceStore.getState().setActiveWorkspaceId('C');
    harness.queue.requestDrain();
    useFlowWorkspaceStore.getState().setActiveWorkspaceId('A');
    const aHydrated = harness.queue.ensureWorkspaceHydrated('A');
    harness.gateFor('B').resolve();

    await waitForRestore(harness.restoreOrder, ['B', 'A']);
    expect(harness.restoreOrder).not.toContain('C');
    harness.gateFor('A').resolve();
    await expect(aHydrated).resolves.toBe(true);
    expect(harness.canvas().nodes[0]?.id).toBe('node-A');
    harness.queue.dispose();
  });

  it('drains the newest request after restore failure without an unhandled rejection', async () => {
    setThreeWorkspaces();
    const harness = createHarness();
    useFlowWorkspaceStore.getState().setActiveWorkspaceId('B');
    harness.queue.requestDrain();
    await waitForRestore(harness.restoreOrder, ['B']);
    const cHydrated = harness.queue.ensureWorkspaceHydrated('C');

    harness.gateFor('B').reject(new Error('B assets unavailable'));
    await waitForRestore(harness.restoreOrder, ['B', 'C']);
    expect(harness.errors).toEqual([expect.objectContaining({ message: 'B assets unavailable' })]);
    harness.gateFor('C').resolve();
    await expect(cHydrated).resolves.toBe(true);
    expect(harness.canvas().nodes[0]?.id).toBe('node-C');
    harness.queue.dispose();
  });

  it('keeps B when C is closed and B is reselected before its restore completes', async () => {
    setThreeWorkspaces();
    const harness = createHarness();
    useFlowWorkspaceStore.getState().setActiveWorkspaceId('B');
    harness.queue.requestDrain();
    await waitForRestore(harness.restoreOrder, ['B']);

    const canceledC = harness.queue.ensureWorkspaceHydrated('C');
    useFlowWorkspaceStore.getState().setActiveWorkspaceId('B');
    harness.queue.requestDrain();
    await expect(canceledC).resolves.toBe(false);
    useFlowWorkspaceStore.getState().setActiveWorkspaceId('C');
    useFlowWorkspaceStore.getState().deleteWorkspace('C');
    harness.queue.requestDrain();
    harness.gateFor('B').resolve();

    await vi.waitFor(() => expect(harness.canvas().nodes[0]?.data.sourceAssetUrl).toBe('hydrated:B'));
    expect(harness.restoreOrder).toEqual(['B']);
    expect(useFlowWorkspaceStore.getState().activeWorkspaceId).toBe('B');
    expect(useFlowWorkspaceStore.getState().hydratedWorkspaceId).toBe('B');
    harness.queue.dispose();
  });

  it('loads C after the restoring B workspace is closed instead of declaring the B canvas hydrated as C', async () => {
    setThreeWorkspaces();
    const harness = createHarness();
    useFlowWorkspaceStore.getState().setActiveWorkspaceId('B');
    harness.queue.requestDrain();
    await waitForRestore(harness.restoreOrder, ['B']);
    const cHydrated = harness.queue.ensureWorkspaceHydrated('C');

    useFlowWorkspaceStore.getState().deleteWorkspace('B');
    expect(useFlowWorkspaceStore.getState().getWorkspace('B')).toBeUndefined();
    harness.gateFor('B').resolve();

    await waitForRestore(harness.restoreOrder, ['B', 'C']);
    harness.gateFor('C').resolve();
    await expect(cHydrated).resolves.toBe(true);
    expect(harness.canvas().nodes[0]?.id).toBe('node-C');
    expect(useFlowWorkspaceStore.getState().hydratedWorkspaceId).toBe('C');
    harness.queue.dispose();
  });

  it('cancels queued publication on dispose and lets a replacement coordinator drain the latest target', async () => {
    setThreeWorkspaces();
    const first = createHarness();
    useFlowWorkspaceStore.getState().setActiveWorkspaceId('B');
    first.queue.requestDrain();
    await waitForRestore(first.restoreOrder, ['B']);
    const canceled = first.queue.ensureWorkspaceHydrated('C');
    first.queue.dispose();
    first.gateFor('B').resolve();

    await expect(canceled).resolves.toBe(false);
    await vi.waitFor(() => expect(first.canvas().nodes[0]?.data.sourceAssetUrl).toBe('hydrated:B'));
    expect(first.restoreOrder).toEqual(['B']);
    expect(first.canvas().nodes[0]?.id).toBe('node-B');

    const replacement = createHarness(first.canvas());
    const cHydrated = replacement.queue.ensureWorkspaceHydrated('C');
    await waitForRestore(replacement.restoreOrder, ['C']);
    replacement.gateFor('C').resolve();
    await expect(cHydrated).resolves.toBe(true);
    expect(replacement.canvas().nodes[0]?.id).toBe('node-C');
    replacement.queue.dispose();
  });
});
