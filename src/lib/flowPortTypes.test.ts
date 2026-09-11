import { describe, expect, it } from 'vitest';
import {
  describeFlowDataType,
  flowDataTypeColor,
  flowDataTypeEquals,
  flowTypeLineStyle,
  isFlowTypeAccepted,
  runtimeTypeFromResultType,
  resultTypeFromRuntimeType,
  type FlowDataType,
} from './flowPortTypes';

const text = { kind: 'text' } as const;
const number = { kind: 'number' } as const;
const image = { kind: 'image' } as const;
const video = { kind: 'video' } as const;
const unknown = { kind: 'unknown' } as const;
const listOfImages = { kind: 'list', item: image } as const;
const listOfText = { kind: 'list', item: text } as const;

describe('flowDataTypeEquals', () => {
  it('compares nested container element types structurally', () => {
    expect(flowDataTypeEquals(listOfImages, { kind: 'list', item: { kind: 'image' } })).toBe(true);
    expect(flowDataTypeEquals(listOfImages, listOfText)).toBe(false);
  });

  it('distinguishes mixed containers from concretely typed containers', () => {
    expect(flowDataTypeEquals(
      { kind: 'envelope', item: { kind: 'mixed' } },
      { kind: 'envelope', item: { kind: 'json' } },
    )).toBe(false);
  });
});

describe('isFlowTypeAccepted', () => {
  it('accepts exact types and explicit target unions', () => {
    expect(isFlowTypeAccepted(text, [text])).toMatchObject({ compatible: true });
    expect(isFlowTypeAccepted(image, [text, image])).toMatchObject({ compatible: true });
  });

  it.each([
    [number, [text]],
    [text, [{ kind: 'json' } as const]],
    [image, [video]],
    [listOfImages, [listOfText]],
  ] satisfies Array<[FlowDataType, FlowDataType[]]>)('rejects incompatible %o values', (source, accepted) => {
    const result = isFlowTypeAccepted(source, accepted);

    expect(result.compatible).toBe(false);
    expect(result.reason).toContain(describeFlowDataType(source));
  });

  it('does not treat unknown as an implicit any type', () => {
    expect(isFlowTypeAccepted(unknown, [text])).toMatchObject({ compatible: false });
    expect(isFlowTypeAccepted(unknown, [unknown])).toMatchObject({ compatible: true });
  });

  it('suggests an explicit configurable transform for scalar conversion', () => {
    expect(isFlowTypeAccepted(number, [text]).converterNodeTypes).toContain('javascriptNode');
  });
});

describe('Flow type presentation', () => {
  it('uses the same payload color for a container and its item type', () => {
    expect(flowDataTypeColor(listOfImages)).toBe(flowDataTypeColor(image));
  });

  it('adds a non-color container line treatment', () => {
    expect(flowTypeLineStyle(listOfImages)).toMatchObject({ pattern: 'container', dashArray: '8 4 2 4' });
    expect(flowTypeLineStyle({ kind: 'control' })).toMatchObject({ pattern: 'control' });
    expect(flowTypeLineStyle(unknown)).toMatchObject({ pattern: 'unknown' });
  });

  it('describes nested types compactly', () => {
    expect(describeFlowDataType({ kind: 'envelope', item: listOfImages })).toBe('envelope<list<image>>');
  });
});

describe('persisted ResultType bridging', () => {
  it('preserves scalar and media result kinds', () => {
    expect(runtimeTypeFromResultType('audio')).toEqual({ kind: 'audio' });
    expect(resultTypeFromRuntimeType({ kind: 'boolean' })).toBe('boolean');
  });

  it('represents persisted containers as mixed until graph inference resolves an item type', () => {
    expect(runtimeTypeFromResultType('list')).toEqual({ kind: 'list', item: { kind: 'mixed' } });
    expect(runtimeTypeFromResultType('envelope')).toEqual({ kind: 'envelope', item: { kind: 'mixed' } });
    expect(resultTypeFromRuntimeType(listOfImages)).toBe('list');
  });
});
