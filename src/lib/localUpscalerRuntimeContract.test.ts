import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const runtimeContract = require('../../ops/local-upscaler/runtime-contract.cjs') as {
  buildManagedLocalUpscalerCapabilities: (device: string) => Record<string, unknown>;
  classifyLocalUpscalerProcessFailure: (exitCode: number | null, stderr: string) => {
    code: string;
    statusCode: number;
    message: string;
  };
};

describe('managed local upscaler runtime truth', () => {
  it('publishes Vulkan as required and never advertises a CPU fallback', () => {
    expect(runtimeContract.buildManagedLocalUpscalerCapabilities('auto')).toMatchObject({
      ok: true,
      backend: 'realesrgan-ncnn-vulkan',
      accelerator: 'vulkan',
      requiresVulkan: true,
      cpuFallback: false,
      device: 'auto',
    });
  });

  it.each([
    'vkCreateInstance failed: VK_ERROR_INCOMPATIBLE_DRIVER',
    'vkEnumeratePhysicalDevices failed -3',
    'no Vulkan-capable GPU found',
    'failed to find a Vulkan device',
    'invalid gpu device',
  ])('classifies a no-Vulkan environment as actionable and non-CPU (%s)', (stderr) => {
    expect(runtimeContract.classifyLocalUpscalerProcessFailure(1, stderr)).toEqual({
      code: 'vulkan-unavailable',
      statusCode: 503,
      message: 'The managed local AI upscaler requires a working Vulkan GPU and driver; this runtime has no CPU fallback.',
    });
  });
});
