import { describe, expect, it } from 'vitest';
import {
  createLibraryFunctionFromFunctionNode,
  createFunctionNodeDataFromLibraryFunction,
  getFunctionLibraryEntries,
  SEQUENTIAL_ART_LIBRARY_FUNCTIONS,
} from './standardLibrary';
import { createDefaultFunctionNodeConfig } from './functionNodes';
import type { AppNode } from '../types/flow';

describe('function library metadata', () => {
  it('includes sequential-art functions with usage and port contracts', () => {
    const entries = getFunctionLibraryEntries([]);
    const expressionBatch = entries.find((entry) => entry.id === 'expression-batch-prompter');

    expect(expressionBatch).toMatchObject({
      name: 'Expression Batch Prompter',
      source: 'built-in',
    });
    expect(expressionBatch?.usage).toContain('{A}');
    expect(expressionBatch?.inputPorts?.map((port) => port.key)).toContain('emotions');
    expect(expressionBatch?.outputPorts?.map((port) => port.resultType)).toContain('list');
  });

  it('wraps a library function as a collapsed function-node config', () => {
    const nodeData = createFunctionNodeDataFromLibraryFunction(SEQUENTIAL_ART_LIBRARY_FUNCTIONS[0]);

    expect(nodeData.customTitle).toBe(SEQUENTIAL_ART_LIBRARY_FUNCTIONS[0].name);
    expect(nodeData.functionNode?.contract.inputPorts.length).toBeGreaterThan(0);
    expect(nodeData.functionNode?.contract.outputPorts.length).toBeGreaterThan(0);
    expect(nodeData.functionNode?.graph.nodes.length).toBe(SEQUENTIAL_ART_LIBRARY_FUNCTIONS[0].nodes.length);
  });

  it('preserves custom function config when custom functions are inserted from the drawer', () => {
    const config = createDefaultFunctionNodeConfig('Custom verifier');
    config.outputBindings[0].sourceNodeId = 'internal-output';
    const node = {
      id: 'fn-1',
      type: 'functionNode',
      position: { x: 0, y: 0 },
      data: { functionNode: config },
    } as AppNode;

    const entry = createLibraryFunctionFromFunctionNode(node);
    const clonedData = entry ? createFunctionNodeDataFromLibraryFunction(entry) : undefined;

    expect(clonedData?.functionNode?.outputBindings[0].sourceNodeId).toBe('internal-output');
  });
});
