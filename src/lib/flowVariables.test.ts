import { describe, expect, it } from 'vitest';
import type { Edge } from '@xyflow/react';
import type { AppNode, FlowNodeType, NodeData } from '../types/flow';
import {
  assignVariableToResultAttempt,
  collectFlowVariableBindings,
  getFlowVariableAutocompleteState,
  normalizeFlowVariableName,
  resolveFlowVariablesInText,
} from './flowVariables';

function node(id: string, type: FlowNodeType, data: Partial<NodeData>): AppNode {
  return {
    id,
    type,
    position: { x: 0, y: 0 },
    data,
  } as AppNode;
}

describe('flowVariables', () => {
  it('normalizes variable names for prompt-safe template references', () => {
    expect(normalizeFlowVariableName(' Hero Pose 01! ')).toBe('hero_pose_01');
    expect(normalizeFlowVariableName('3 panels')).toBe('v_3_panels');
    expect(normalizeFlowVariableName('')).toBe('');
  });

  it('resolves a named generated attempt as a scalar variable', () => {
    const nodes = [
      node('image-1', 'imageGen', {
        resultHistory: [{
          id: 'attempt-1',
          result: 'data:image/png;base64,POSE',
          resultType: 'image',
          statusMessage: 'Generated image',
          createdAt: '2026-06-03T12:00:00.000Z',
          variableName: 'hero_pose',
        }],
      }),
    ];

    const resolved = resolveFlowVariablesInText('Use {{hero_pose}} as the reference.', nodes, []);

    expect(resolved.text).toBe('Use data:image/png;base64,POSE as the reference.');
    expect(resolved.diagnostics).toEqual([]);
  });

  it('resolves list and envelope variables with one-based numeric pointers and metadata', () => {
    const nodes = [
      node('envelope-1', 'envelope', {
        flowVariableName: 'panel_refs',
        envelopeItems: [
          { id: 'item-1', index: 0, kind: 'text', label: 'Wide shot', value: 'wide establishing shot' },
          { id: 'item-2', index: 1, kind: 'text', label: 'Close shot', value: 'close-up reaction' },
        ],
      }),
    ];

    expect(resolveFlowVariablesInText('{{panel_refs[2]}}', nodes, []).text).toBe('close-up reaction');
    expect(resolveFlowVariablesInText('{{panel_refs[2].label}}', nodes, []).text).toBe('Close shot');
    expect(resolveFlowVariablesInText('{{panel_refs[2].kind}}', nodes, []).text).toBe('text');
    expect(resolveFlowVariablesInText('{{panel_refs[2].position}}', nodes, []).text).toBe('2');
    expect(resolveFlowVariablesInText('{{panel_refs.length}}', nodes, []).text).toBe('2');
    expect(resolveFlowVariablesInText('{{panel_refs[*]}}', nodes, []).text).toBe('wide establishing shot\n\nclose-up reaction');
  });

  it('keeps missing variables visible and reports a blocking diagnostic', () => {
    const resolved = resolveFlowVariablesInText('Use {{missing_pose}}.', [], []);

    expect(resolved.text).toBe('Use {{missing_pose}}.');
    expect(resolved.diagnostics).toEqual([
      expect.objectContaining({
        blocksRun: true,
        severity: 'critical',
        message: expect.stringContaining('missing_pose'),
      }),
    ]);
  });

  it('offers autocomplete suggestions after a partial variable token', () => {
    const nodes = [
      node('envelope-1', 'envelope', {
        flowVariableName: 'panel_refs',
        envelopeItems: [
          { id: 'item-1', index: 0, kind: 'text', label: 'Wide shot', value: 'wide establishing shot' },
          { id: 'item-2', index: 1, kind: 'text', label: 'Close shot', value: 'close-up reaction' },
        ],
      }),
    ];
    const bindings = collectFlowVariableBindings(nodes, [] as Edge[]);
    const state = getFlowVariableAutocompleteState('Use {{pan', 'Use {{pan'.length, bindings);

    expect(state?.query).toBe('pan');
    expect(state?.replaceRange).toEqual({ start: 4, end: 9 });
    expect(state?.suggestions.map((suggestion) => suggestion.insertText)).toEqual([
      '{{panel_refs[*]}}',
      '{{panel_refs[1]}}',
      '{{panel_refs[2]}}',
    ]);
  });

  it('assigns normalized variable names to a specific result attempt', () => {
    const attempts = assignVariableToResultAttempt([
      {
        id: 'attempt-1',
        result: 'one',
        resultType: 'text',
        statusMessage: 'Generated',
        createdAt: '2026-06-03T12:00:00.000Z',
      },
      {
        id: 'attempt-2',
        result: 'two',
        resultType: 'text',
        statusMessage: 'Generated',
        createdAt: '2026-06-03T12:00:00.000Z',
      },
    ], 'attempt-2', 'Hero Prompt!');

    expect(attempts[0]?.variableName).toBeUndefined();
    expect(attempts[1]?.variableName).toBe('hero_prompt');
  });

  it.each([true, false])('keeps Boolean %s attempts assignable and renders them deterministically', (decision) => {
    const nodes = [node('verify', 'visionVerifyNode', {
      resultHistory: [{
        id: 'verify-attempt', result: decision, resultType: 'boolean', statusMessage: 'Verified',
        createdAt: '2026-07-16T00:00:00.000Z', variableName: 'verified',
      }],
    })];

    expect(collectFlowVariableBindings(nodes, []).find((binding) => binding.name === 'verified')).toMatchObject({
      kind: 'boolean', value: String(decision),
    });
    expect(resolveFlowVariablesInText('Decision: {{verified}}', nodes, []).text).toBe(`Decision: ${decision}`);
  });

  it.each([
    ['true', 'true'],
    ['false', 'false'],
  ])('restores exact legacy Boolean attempt values for variable presentation: %s', (result, expected) => {
    const nodes = [node('function', 'functionNode', {
      resultHistory: [{
        id: 'function-attempt', result: result as never, resultType: 'boolean', statusMessage: 'Completed',
        createdAt: '2026-07-16T00:00:00.000Z', variableName: 'decision',
      }],
    })];

    expect(resolveFlowVariablesInText('{{decision}}', nodes, []).text).toBe(expected);
  });

  it.each(['TRUE', ' false', 'false ', '0', 'yes'])('does not bind ambiguous Boolean attempt values: %s', (result) => {
    const nodes = [node('function', 'functionNode', {
      resultHistory: [{
        id: 'function-attempt', result: result as never, resultType: 'boolean', statusMessage: 'Completed',
        createdAt: '2026-07-16T00:00:00.000Z', variableName: 'decision',
      }],
    })];

    expect(collectFlowVariableBindings(nodes, [])).toEqual([]);
  });
});
