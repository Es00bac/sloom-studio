import { describe, expect, it } from 'vitest';
import { useImageAutomationStore } from './imageAutomationStore';

describe('imageAutomationStore', () => {
  it('keeps Image Automation graph state in its own store', () => {
    useImageAutomationStore.getState().resetAutomationFlow();

    const nodeId = useImageAutomationStore.getState().addAutomationNode('directoryInput', { x: 120, y: 80 });

    const state = useImageAutomationStore.getState();
    expect(state.nodes).toHaveLength(1);
    expect(state.edges).toHaveLength(0);
    expect(state.nodes[0]).toMatchObject({
      id: nodeId,
      type: 'directoryInput',
      position: { x: 120, y: 80 },
      data: {
        title: 'Directory Input',
        automationScope: 'image-editor',
        categoryId: 'file-system',
      },
    });
  });

  it('seeds a readable left-to-right Image Automation starter flow with typed edge handles', () => {
    useImageAutomationStore.getState().resetAutomationFlow();
    useImageAutomationStore.getState().seedStarterFlow();

    const state = useImageAutomationStore.getState();
    expect(state.nodes.map((node) => node.type)).toEqual([
      'directoryInput',
      'imageBatchList',
      'applyAdjustment',
      'saveOutput',
    ]);
    expect(state.edges).toEqual([
      expect.objectContaining({
        source: 'image-automation-starter-directoryInput',
        sourceHandle: 'directory',
        target: 'image-automation-starter-imageBatchList',
        targetHandle: 'directory',
      }),
      expect.objectContaining({
        source: 'image-automation-starter-imageBatchList',
        sourceHandle: 'imageBatch',
        target: 'image-automation-starter-applyAdjustment',
        targetHandle: 'imageBatch',
      }),
      expect.objectContaining({
        source: 'image-automation-starter-applyAdjustment',
        sourceHandle: 'adjustedBatch',
        target: 'image-automation-starter-saveOutput',
        targetHandle: 'imageBatch',
      }),
    ]);
    expect(state.nodes.map((node) => node.position.x)).toEqual([60, 330, 600, 870]);
    expect(Math.max(...state.nodes.map((node) => node.position.x))).toBeLessThanOrEqual(900);
    expect(state.nodes[2].data.config).toMatchObject({
      adjustmentKind: 'brightness-contrast',
      destructive: false,
      parameters: {
        brightness: 0,
        contrast: 0,
      },
    });
  });
});
