import { describe, expect, it } from 'vitest';
import { maskEncodingForProvider, transformMaskPixels } from './maskConventions';

describe('maskEncodingForProvider', () => {
  it('uses OpenAI alpha-cutout for openai', () => {
    expect(maskEncodingForProvider('openai', 'gpt-image-2')).toBe('openai-alpha-cutout');
  });
  it('uses alpha-cutout for Atlas GPT-image routes (OpenAI-compatible)', () => {
    expect(maskEncodingForProvider('atlas', 'gpt-image-2')).toBe('openai-alpha-cutout');
    expect(maskEncodingForProvider('atlas', 'openai/gpt-image-2/edit')).toBe('openai-alpha-cutout');
  });
  it('uses white-on-black for Atlas native slugs', () => {
    expect(maskEncodingForProvider('atlas', 'atlascloud/qwen-image/edit')).toBe('white-on-black');
  });
  it('uses white-on-black for stability and localOpen', () => {
    expect(maskEncodingForProvider('stability', 'stable-image-edit-inpaint')).toBe('white-on-black');
    expect(maskEncodingForProvider('localOpen', 'Qwen/Qwen-Image-Edit')).toBe('white-on-black');
  });
});

// one painted pixel (edit) + one unpainted pixel (keep), canonical = opaque white where edit
const canonical = () => new Uint8ClampedArray([
  255, 255, 255, 255, // painted -> edit
  255, 255, 255, 0,   // unpainted -> keep
]);

describe('transformMaskPixels', () => {
  it('openai-alpha-cutout makes the edit region transparent and the rest opaque', () => {
    const out = transformMaskPixels(canonical(), 'openai-alpha-cutout');
    expect(out[3]).toBe(0);    // edit pixel -> transparent
    expect(out[7]).toBe(255);  // keep pixel -> opaque
  });
  it('white-on-black makes the edit region white-opaque and the rest black-opaque', () => {
    const out = transformMaskPixels(canonical(), 'white-on-black');
    expect([out[0], out[1], out[2], out[3]]).toEqual([255, 255, 255, 255]); // edit -> white
    expect([out[4], out[5], out[6], out[7]]).toEqual([0, 0, 0, 255]);       // keep -> black
  });
  it('does not mutate the input', () => {
    const input = canonical();
    transformMaskPixels(input, 'white-on-black');
    expect(input[3]).toBe(255);
  });
});
