import { describe, expect, it } from 'vitest';
import {
  createUnverifiedModelContract,
  defineProviderModelContracts,
  getModelUiControls,
  getProviderModelContract,
  validateModelRequest,
  type ProviderModelContract,
} from './providerModelContracts';

const VERIFIED_CONTRACT: ProviderModelContract = {
  providerId: 'example',
  providerName: 'Example AI',
  modelId: 'example-image-1',
  displayName: 'Example Image 1',
  apiFamily: 'openai-images',
  endpoint: '/v1/images/generations',
  auth: {
    type: 'api-key',
    credentialKey: 'example',
  },
  inputModalities: ['text', 'image'],
  outputModalities: ['image'],
  operations: ['text-to-image', 'image-edit'],
  parameters: [
    {
      id: 'prompt',
      apiName: 'prompt',
      label: 'Prompt',
      type: 'string',
      required: true,
    },
    {
      id: 'quality',
      apiName: 'quality',
      label: 'Quality',
      type: 'enum',
      options: [
        { value: 'standard', label: 'Standard' },
        { value: 'high', label: 'High' },
      ],
    },
    {
      id: 'references',
      apiName: 'references',
      label: 'Reference images',
      type: 'array',
      minItems: 1,
      maxItems: 4,
      conditions: { operations: ['image-edit'] },
    },
    {
      id: 'seed',
      apiName: 'seed',
      label: 'Seed',
      type: 'integer',
      min: 0,
      max: 4_294_967_295,
    },
  ],
  lifecycle: 'stable',
  availability: 'documented',
  evidence: [
    {
      title: 'Example model reference',
      url: 'https://example.com/models/example-image-1',
      verifiedAt: '2026-07-14',
    },
  ],
  limitations: ['Reference images are accepted only by image edit.'],
  recommendedUse: 'High-quality still-image generation and editing.',
  flowExample: {
    summary: 'Prompt -> Example Image -> Composition',
    inputs: ['Connect a Text node to Prompt.'],
    outputs: ['Connect the image output to Composition.'],
  },
  requestBuilder: 'openai-images',
};

describe('provider model contracts', () => {
  it('indexes verified contracts by exact provider and model identifiers', () => {
    const contracts = defineProviderModelContracts([VERIFIED_CONTRACT]);

    expect(getProviderModelContract(contracts, 'example', 'example-image-1')).toBe(
      VERIFIED_CONTRACT,
    );
    expect(getProviderModelContract(contracts, 'example', 'EXAMPLE-IMAGE-1')).toBeUndefined();
  });

  it('rejects duplicate keys and verified contracts without official evidence', () => {
    expect(() => defineProviderModelContracts([VERIFIED_CONTRACT, VERIFIED_CONTRACT])).toThrow(
      /duplicate/i,
    );
    expect(() =>
      defineProviderModelContracts([{ ...VERIFIED_CONTRACT, evidence: [] }]),
    ).toThrow(/evidence/i);
  });

  it('rejects malformed parameter contracts', () => {
    expect(() =>
      defineProviderModelContracts([
        {
          ...VERIFIED_CONTRACT,
          parameters: [
            {
              id: 'steps',
              apiName: 'steps',
              label: 'Steps',
              type: 'integer',
              min: 50,
              max: 10,
            },
          ],
        },
      ]),
    ).toThrow(/range/i);

    expect(() =>
      defineProviderModelContracts([
        {
          ...VERIFIED_CONTRACT,
          parameters: [
            {
              id: 'quality',
              apiName: 'quality',
              label: 'Quality',
              type: 'enum',
              options: [],
            },
          ],
        },
      ]),
    ).toThrow(/enum/i);
  });

  it('keeps requested unsupported controls visible but disabled with a reason', () => {
    const controls = getModelUiControls(VERIFIED_CONTRACT, 'text-to-image', [
      { id: 'quality', label: 'Quality' },
      { id: 'references', label: 'Reference images' },
      { id: 'cameraMotion', label: 'Camera motion' },
    ]);

    expect(controls).toEqual([
      expect.objectContaining({ id: 'quality', enabled: true }),
      expect.objectContaining({
        id: 'references',
        enabled: false,
        disabledReason: expect.stringMatching(/image edit/i),
      }),
      expect.objectContaining({
        id: 'cameraMotion',
        enabled: false,
        disabledReason: expect.stringMatching(/does not expose/i),
      }),
    ]);
  });

  it('validates operation, required fields, exact types, ranges, enums, and conditions', () => {
    expect(
      validateModelRequest(VERIFIED_CONTRACT, 'text-to-image', {
        prompt: 'A fox in snow',
        quality: 'high',
        seed: 7,
      }),
    ).toEqual({ valid: true, issues: [] });

    const invalid = validateModelRequest(VERIFIED_CONTRACT, 'text-to-image', {
      quality: 'ultra',
      seed: 4.2,
      references: ['image.png'],
      inventedControl: true,
    });

    expect(invalid.valid).toBe(false);
    expect(invalid.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        'required',
        'invalid-enum',
        'invalid-type',
        'unsupported-parameter',
        'inactive-parameter',
      ]),
    );

    expect(
      validateModelRequest(VERIFIED_CONTRACT, 'text-to-video', { prompt: 'A fox' }).issues,
    ).toEqual([
      expect.objectContaining({ code: 'unsupported-operation', field: 'operation' }),
    ]);
  });

  it('creates a selectable unverified fallback with safe controls and no invented claims', () => {
    const fallback = createUnverifiedModelContract({
      providerId: 'compatible-host',
      providerName: 'Compatible Host',
      modelId: 'new-live-model',
      displayName: 'New Live Model',
      apiFamily: 'openai-responses',
      endpoint: '/v1/responses',
      auth: { type: 'api-key', credentialKey: 'openai' },
      inputModalities: ['text'],
      outputModalities: ['text'],
      operation: 'text-generation',
      requestBuilder: 'openai-responses',
    });

    expect(fallback).toMatchObject({
      lifecycle: 'unverified',
      availability: 'live',
      evidence: [],
      operations: ['text-generation'],
      parameters: [expect.objectContaining({ id: 'prompt', apiName: 'input' })],
    });
    expect(fallback.limitations.join(' ')).toMatch(/only safe, endpoint-level controls/i);
    expect(defineProviderModelContracts([fallback])).toEqual([fallback]);
  });
});
