import { describe, expect, it } from 'vitest';
import {
  getVideoProviderDescriptor,
  getVideoProviderModelNodeDescriptor,
  listVideoProviderDescriptors,
  listVideoProviderModelNodeDescriptors,
} from './videoProviderCatalog';

describe('videoProviderCatalog', () => {
  it('defines bounded planning-only video provider descriptors for Vertex and Atlas Cloud', () => {
    expect(listVideoProviderDescriptors().map((provider) => provider.id)).toEqual([
      'vertex',
      'atlas-cloud',
    ]);

    expect(getVideoProviderDescriptor('vertex')).toMatchObject({
      id: 'vertex',
      displayName: 'Vertex AI',
      executionState: 'planning-only',
      credentialMode: 'unsupported-no-credential-execution',
    });

    expect(getVideoProviderDescriptor('atlas-cloud')).toMatchObject({
      id: 'atlas-cloud',
      displayName: 'Atlas Cloud',
      executionState: 'planning-only',
      credentialMode: 'unsupported-no-credential-execution',
    });
  });

  it('defines six Atlas Cloud video model node descriptors with stable ids and planning metadata', () => {
    const atlasNodes = listVideoProviderModelNodeDescriptors('atlas-cloud');

    expect(atlasNodes.map((node) => node.id)).toEqual([
      'atlas-cloud-seedance-2-text-to-video',
      'atlas-cloud-seedance-2-image-to-video',
      'atlas-cloud-seedance-2-fast-image-to-video',
      'atlas-cloud-wan-2.6-text-to-video',
      'atlas-cloud-wan-2.6-image-to-video',
      'atlas-cloud-wan-2.6-reference-to-video',
    ]);

    expect(atlasNodes.every((node) => node.executionState === 'planning-only')).toBe(true);
    expect(atlasNodes.every((node) => node.credentialMode === 'unsupported-no-credential-execution')).toBe(true);
    expect(atlasNodes.every((node) => node.output.kind === 'video')).toBe(true);
    expect(atlasNodes.map((node) => node.output.mimeTypes)).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(['video/mp4']),
      ]),
    );
  });

  it('captures display names, capability tags, I/O descriptors, cost placeholders, risk placeholders, and planning caveats', () => {
    expect(getVideoProviderModelNodeDescriptor('atlas-cloud-seedance-2-text-to-video')).toMatchObject({
      providerId: 'atlas-cloud',
      displayName: 'Atlas Seedance 2.0 Text-to-Video',
      capabilityTags: expect.arrayContaining(['text-to-video', 'native-audio', 'multi-shot']),
      inputs: [
        expect.objectContaining({ id: 'prompt', kind: 'text', required: true }),
      ],
      output: expect.objectContaining({ kind: 'video', mimeTypes: ['video/mp4'] }),
      cost: expect.objectContaining({
        billingType: 'provider-priced-placeholder',
        confidence: 'placeholder',
      }),
      risk: expect.objectContaining({
        level: 'unverified-provider-contract',
      }),
    });

    expect(getVideoProviderModelNodeDescriptor('atlas-cloud-seedance-2-image-to-video')).toMatchObject({
      capabilityTags: expect.arrayContaining(['image-to-video', 'native-audio', 'first-frame']),
      inputs: expect.arrayContaining([
        expect.objectContaining({ id: 'prompt', kind: 'text', required: true }),
        expect.objectContaining({ id: 'start-image', kind: 'image', required: true }),
      ]),
    });

    expect(getVideoProviderModelNodeDescriptor('atlas-cloud-seedance-2-fast-image-to-video')).toMatchObject({
      capabilityTags: expect.arrayContaining(['image-to-video', 'fast-lane', 'first-frame']),
    });

    expect(getVideoProviderModelNodeDescriptor('atlas-cloud-wan-2.6-text-to-video')).toMatchObject({
      capabilityTags: expect.arrayContaining(['text-to-video', 'native-audio', '1080p']),
    });

    expect(getVideoProviderModelNodeDescriptor('atlas-cloud-wan-2.6-image-to-video')).toMatchObject({
      capabilityTags: expect.arrayContaining(['image-to-video', 'native-audio', '1080p']),
      inputs: expect.arrayContaining([
        expect.objectContaining({ id: 'prompt', kind: 'text', required: true }),
        expect.objectContaining({ id: 'start-image', kind: 'image', required: true }),
      ]),
    });

    expect(getVideoProviderModelNodeDescriptor('atlas-cloud-wan-2.6-reference-to-video')).toMatchObject({
      capabilityTags: expect.arrayContaining(['reference-to-video', 'video-to-video', 'native-audio']),
      inputs: expect.arrayContaining([
        expect.objectContaining({ id: 'prompt', kind: 'text', required: true }),
        expect.objectContaining({ id: 'reference-video', kind: 'video', required: true }),
      ]),
    });

    expect(getVideoProviderModelNodeDescriptor('atlas-cloud-wan-2.6-reference-to-video')?.caveats).toEqual(
      expect.arrayContaining([
        'Planning descriptor only; Atlas Cloud video execution is not wired in this workspace.',
        'No browser-safe Atlas Cloud credential flow is attached here; execution remains unsupported until a separate provider bridge is implemented.',
      ]),
    );
  });
});
