import { describe, expect, it } from 'vitest';
import {
  createManualEnvelopeItem,
  isFlowPrimitiveKind,
  normalizeEnvelopeItemKind,
  parseManualEnvelopeValue,
} from './flowValueTypes';

describe('flow value types', () => {
  it('recognizes boolean and json as primitive signal kinds', () => {
    expect(isFlowPrimitiveKind('text')).toBe(true);
    expect(isFlowPrimitiveKind('number')).toBe(true);
    expect(isFlowPrimitiveKind('boolean')).toBe(true);
    expect(isFlowPrimitiveKind('json')).toBe(true);
    expect(isFlowPrimitiveKind('image')).toBe(false);
  });

  it('normalizes envelope item kinds with mixed fallback', () => {
    expect(normalizeEnvelopeItemKind('boolean')).toBe('boolean');
    expect(normalizeEnvelopeItemKind('json')).toBe('json');
    expect(normalizeEnvelopeItemKind('image')).toBe('image');
    expect(normalizeEnvelopeItemKind('weird')).toBe('mixed');
  });

  it('creates directly editable manual envelope items', () => {
    expect(createManualEnvelopeItem({
      kind: 'boolean',
      index: 2,
      label: 'Approved',
      value: true,
    })).toMatchObject({
      id: 'manual-envelope-item-2',
      index: 2,
      kind: 'boolean',
      label: 'Approved',
      value: 'true',
      mimeType: 'application/x.boolean',
    });
  });

  it('parses manual primitive envelope values for UI feedback', () => {
    expect(parseManualEnvelopeValue('number', '12.5')).toEqual({ ok: true, value: 12.5 });
    expect(parseManualEnvelopeValue('boolean', 'yes')).toEqual({ ok: true, value: true });
    expect(parseManualEnvelopeValue('json', '{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseManualEnvelopeValue('json', '{')).toMatchObject({ ok: false });
  });
});
