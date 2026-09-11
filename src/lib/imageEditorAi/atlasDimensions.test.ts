import { describe, expect, it } from 'vitest';
import { resolveAtlasDimensionBody, getAtlasDimensionSpec, applyAtlasModelParams, getAtlasModelParams, filterAtlasBodyToAcceptedFields, atlasModelAcceptsField } from './atlasNativeImage';

describe('filterAtlasBodyToAcceptedFields (only send fields the model documents)', () => {
  it('drops undocumented fields for flux-2-pro/edit (the cause of "no image data in response")', () => {
    const body = {
      model: 'black-forest-labs/flux-2-pro/edit', prompt: 'x', images: ['u'], size: '1376*768',
      num_inference_steps: 30, enable_safety_checker: false, guidance_scale: 3, safety_tolerance: 5, seed: 7,
    };
    expect(filterAtlasBodyToAcceptedFields(body, 'black-forest-labs/flux-2-pro/edit')).toEqual({
      model: 'black-forest-labs/flux-2-pro/edit', prompt: 'x', images: ['u'], size: '1376*768',
      safety_tolerance: 5, seed: 7,
    });
  });

  it('knows which models accept enable_safety_checker vs safety_tolerance', () => {
    expect(atlasModelAcceptsField('black-forest-labs/flux-schnell', 'enable_safety_checker')).toBe(true);
    expect(atlasModelAcceptsField('black-forest-labs/flux-2-pro/edit', 'enable_safety_checker')).toBe(false);
    expect(getAtlasModelParams('black-forest-labs/flux-2-pro/edit').some((p) => p.name === 'safety_tolerance')).toBe(true);
  });
});

describe('applyAtlasModelParams (documented per-model inputs reach the request body)', () => {
  it('sends documented params coerced to their schema type', () => {
    const body: Record<string, unknown> = {};
    applyAtlasModelParams(body, 'google/nano-banana-pro/edit', {
      resolution: '4k', enable_web_search: true, media_resolution: 'high',
    });
    expect(body).toEqual({ resolution: '4k', enable_web_search: true, media_resolution: 'high' });
  });

  it('coerces integer-typed params and ignores blank values', () => {
    const body: Record<string, unknown> = {};
    applyAtlasModelParams(body, 'alibaba/wan-2.7/image-edit', { n: '3', thinking_mode: '' });
    expect(body).toEqual({ n: 3 });
  });

  it('ignores fields the model does not document (nothing extraneous is sent)', () => {
    const body: Record<string, unknown> = {};
    applyAtlasModelParams(body, 'google/nano-banana-pro/edit', { input_fidelity: 'high', bogus: 'x' });
    // nano-banana-pro/edit has no input_fidelity (that's a gpt-image field) and no `bogus`.
    expect(body).toEqual({});
  });

  it('exposes gpt-image quality/input_fidelity as documented params', () => {
    const names = getAtlasModelParams('openai/gpt-image-1.5/edit').map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['quality', 'input_fidelity']));
  });
});

// 16:9 ≈ 1376×768 from the app's aspect→pixel mapping. The encoder sends ONLY the field the model's
// documented schema defines (sending undocumented width/height was ignored — wan-2.7 stayed portrait).
describe('resolveAtlasDimensionBody (documented size field only)', () => {
  it('FLUX.2 (free-range size): size "W*H", no width/height', () => {
    expect(resolveAtlasDimensionBody('black-forest-labs/flux-2-pro/edit', {
      width: 1376, height: 768, aspectRatio: '16:9',
    })).toEqual({ size: '1376*768' });
  });

  it('gpt-image (enum WxH): nearest 16:9 enum size only', () => {
    const body = resolveAtlasDimensionBody('openai/gpt-image-2/text-to-image', {
      width: 1376, height: 768, aspectRatio: '16:9',
    });
    expect(Object.keys(body)).toEqual(['size']);
    const [w, h] = String(body.size).split('x').map(Number);
    expect(w / h).toBeCloseTo(16 / 9, 1);
  });

  it('Wan 2.7 (resolution tier only): emits NOTHING (no aspect control; resolution is a model param)', () => {
    expect(resolveAtlasDimensionBody('alibaba/wan-2.7/image-edit', {
      width: 1376, height: 768, aspectRatio: '16:9',
    })).toEqual({});
  });

  it('Imagen (aspect_ratio enum): aspect_ratio only, exact when supported', () => {
    expect(resolveAtlasDimensionBody('google/imagen4', {
      width: 1376, height: 768, aspectRatio: '16:9',
    })).toEqual({ aspect_ratio: '16:9' });
  });

  it('snaps aspect_ratio to the nearest allowed ratio when the exact label is not offered', () => {
    const spec = getAtlasDimensionSpec('google/nano-banana-2/reference-to-image');
    expect(spec?.field).toBe('aspect_ratio');
    // 2:1 (2.0) not in enum; nearest is 16:9 (1.78) over 21:9 (2.33).
    const body = resolveAtlasDimensionBody('google/nano-banana-2/reference-to-image', { width: 2000, height: 1000 });
    expect(spec?.enum).toContain(String(body.aspect_ratio));
    expect(body.aspect_ratio).toBe('16:9');
  });

  it('models with no documented size field emit nothing (edit follows the source)', () => {
    expect(resolveAtlasDimensionBody('microsoft/mai-image-2.5/edit', { width: 1024, height: 1024 })).toEqual({});
  });

  it('respects custom (non-preset) dimensions for free-range size models', () => {
    expect(resolveAtlasDimensionBody('black-forest-labs/flux-2-flex/edit', { width: 1280, height: 720 }))
      .toEqual({ size: '1280*720' });
  });
});
