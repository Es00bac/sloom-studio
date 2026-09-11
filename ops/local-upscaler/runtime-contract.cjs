'use strict';

const VULKAN_UNAVAILABLE_MESSAGE =
  'The managed local AI upscaler requires a working Vulkan GPU and driver; this runtime has no CPU fallback.';

function buildManagedLocalUpscalerCapabilities(device, models = []) {
  return {
    ok: true,
    service: 'signal-loom-local-upscaler',
    backend: 'realesrgan-ncnn-vulkan',
    accelerator: 'vulkan',
    requiresVulkan: true,
    cpuFallback: false,
    device,
    models: [...models],
  };
}

function classifyLocalUpscalerProcessFailure(exitCode, stderr) {
  const detail = String(stderr ?? '').trim();
  if (/vulkan|\bvk(?:create|enumerate|get|instance|physical|device)[a-z0-9_]*\b|vk_error|no compatible gpu|no gpu device|invalid gpu device|find[^\n]*gpu/i.test(detail)) {
    return {
      code: 'vulkan-unavailable',
      statusCode: 503,
      message: VULKAN_UNAVAILABLE_MESSAGE,
    };
  }
  return {
    code: 'upscaler-process-failed',
    statusCode: 500,
    message: `realesrgan-ncnn-vulkan exited with code ${exitCode ?? 'unknown'}${detail ? `: ${detail.slice(-400)}` : '.'}`,
  };
}

module.exports = {
  VULKAN_UNAVAILABLE_MESSAGE,
  buildManagedLocalUpscalerCapabilities,
  classifyLocalUpscalerProcessFailure,
};
