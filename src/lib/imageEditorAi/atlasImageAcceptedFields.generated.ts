// AUTO-GENERATED from the live Atlas Cloud model schemas (verified 2026-06-28). The complete set of input
// field names each model documents. The request builder filters its body to these so NO undocumented field
// is ever sent (which some models reject — e.g. flux-2-pro/edit has no num_inference_steps/enable_safety_checker).
export const ATLAS_IMAGE_ACCEPTED_FIELDS: Record<string, string[]> = {
  "microsoft/mai-image-2.5-flash/text-to-image": [
    "model",
    "prompt",
    "size",
    "enable_base64_output",
    "enable_sync_mode"
  ],
  "microsoft/mai-image-2.5/edit": [
    "model",
    "prompt",
    "image",
    "enable_base64_output",
    "enable_sync_mode"
  ],
  "microsoft/mai-image-2.5/text-to-image": [
    "model",
    "prompt",
    "size",
    "enable_base64_output",
    "enable_sync_mode"
  ],
  "youchuan/v8.1/remove-background": [
    "model",
    "image",
    "enable_base64_output"
  ],
  "youchuan/v8.1/style-transfer": [
    "model",
    "image",
    "prompt",
    "enable_base64_output"
  ],
  "youchuan/v8.1/blend": [
    "model",
    "images",
    "prompt",
    "aspect_ratio",
    "hd",
    "stylize",
    "chaos",
    "weird",
    "quality",
    "seed",
    "enable_base64_output"
  ],
  "youchuan/v8.1/image-to-image": [
    "model",
    "image",
    "prompt",
    "sref",
    "aspect_ratio",
    "hd",
    "stylize",
    "chaos",
    "weird",
    "quality",
    "seed",
    "enable_base64_output"
  ],
  "youchuan/v8.1/text-to-image": [
    "model",
    "prompt",
    "sref",
    "aspect_ratio",
    "hd",
    "stylize",
    "chaos",
    "weird",
    "quality",
    "seed",
    "enable_base64_output"
  ],
  "google/nano-banana-2/reference-to-image": [
    "model",
    "aspect_ratio",
    "enable_base64_output",
    "enable_sync_mode",
    "enable_web_search",
    "enable_image_search",
    "images",
    "output_format",
    "prompt",
    "resolution",
    "media_resolution",
    "thinking_level",
    "video_clips"
  ],
  "google/nano-banana-2/reference-to-image-developer": [
    "model",
    "aspect_ratio",
    "video_clips",
    "enable_base64_output",
    "enable_sync_mode",
    "enable_web_search",
    "images",
    "prompt",
    "resolution",
    "thinking_level"
  ],
  "xai/grok-imagine-image-quality/text-to-image": [
    "model",
    "prompt",
    "num_images",
    "aspect_ratio",
    "resolution",
    "enable_base64_output"
  ],
  "xai/grok-imagine-image-quality/edit": [
    "model",
    "prompt",
    "image_urls",
    "num_images",
    "aspect_ratio",
    "resolution",
    "enable_base64_output"
  ],
  "openai/gpt-image-2/text-to-image": [
    "enable_base64_output",
    "enable_sync_mode",
    "output_format",
    "prompt",
    "quality",
    "size",
    "moderation"
  ],
  "openai/gpt-image-2/edit": [
    "enable_base64_output",
    "enable_sync_mode",
    "images",
    "output_format",
    "prompt",
    "quality",
    "size",
    "moderation"
  ],
  "baidu/ERNIE-Image-Turbo/text-to-image": [
    "model",
    "prompt",
    "size",
    "n",
    "seed",
    "use_pe",
    "num_inference_steps",
    "guidance_scale",
    "enable_sync_mode",
    "enable_base64_output"
  ],
  "alibaba/wan-2.7/text-to-image": [
    "model",
    "prompt",
    "size",
    "n",
    "color_palette",
    "thinking_mode",
    "seed",
    "enable_sync_mode",
    "enable_base64_output"
  ],
  "alibaba/wan-2.7/image-edit": [
    "model",
    "prompt",
    "images",
    "size",
    "n",
    "thinking_mode",
    "seed",
    "enable_sync_mode",
    "enable_base64_output"
  ],
  "alibaba/wan-2.7-pro/text-to-image": [
    "model",
    "prompt",
    "size",
    "n",
    "color_palette",
    "thinking_mode",
    "seed",
    "enable_sync_mode",
    "enable_base64_output"
  ],
  "alibaba/wan-2.7-pro/image-edit": [
    "model",
    "prompt",
    "images",
    "size",
    "n",
    "thinking_mode",
    "seed",
    "enable_sync_mode",
    "enable_base64_output"
  ],
  "google/nano-banana-2/text-to-image-developer": [
    "model",
    "aspect_ratio",
    "enable_base64_output",
    "enable_sync_mode",
    "enable_web_search",
    "prompt",
    "resolution",
    "thinking_level"
  ],
  "google/nano-banana-2/text-to-image": [
    "model",
    "aspect_ratio",
    "enable_base64_output",
    "enable_sync_mode",
    "enable_web_search",
    "enable_image_search",
    "output_format",
    "prompt",
    "resolution",
    "media_resolution",
    "thinking_level"
  ],
  "google/nano-banana-2/edit-developer": [
    "model",
    "aspect_ratio",
    "enable_base64_output",
    "enable_sync_mode",
    "enable_web_search",
    "images",
    "prompt",
    "resolution",
    "thinking_level"
  ],
  "google/nano-banana-2/edit": [
    "model",
    "aspect_ratio",
    "enable_base64_output",
    "enable_sync_mode",
    "enable_web_search",
    "enable_image_search",
    "images",
    "output_format",
    "prompt",
    "resolution",
    "media_resolution",
    "thinking_level"
  ],
  "qwen/qwen-image-2.0/text-to-image": [
    "prompt",
    "seed",
    "size"
  ],
  "qwen/qwen-image-2.0/edit": [
    "images",
    "prompt",
    "seed",
    "size"
  ],
  "qwen/qwen-image-2.0-pro/edit": [
    "images",
    "prompt",
    "seed",
    "size"
  ],
  "qwen/qwen-image-2.0-pro/text-to-image": [
    "prompt",
    "seed",
    "size"
  ],
  "bytedance/seedream-v5.0-lite/edit-sequential": [
    "model",
    "enable_base64_output",
    "images",
    "max_images",
    "prompt",
    "size",
    "output_format"
  ],
  "bytedance/seedream-v5.0-lite/sequential": [
    "model",
    "enable_base64_output",
    "max_images",
    "prompt",
    "size",
    "output_format"
  ],
  "bytedance/seedream-v5.0-lite/edit": [
    "model",
    "enable_base64_output",
    "images",
    "prompt",
    "size",
    "output_format"
  ],
  "bytedance/seedream-v5.0-lite": [
    "model",
    "enable_base64_output",
    "prompt",
    "size",
    "output_format"
  ],
  "openai/gpt-image-1.5/text-to-image": [
    "enable_base64_output",
    "enable_sync_mode",
    "output_format",
    "prompt",
    "quality",
    "size"
  ],
  "openai/gpt-image-1.5/edit": [
    "enable_base64_output",
    "enable_sync_mode",
    "images",
    "input_fidelity",
    "output_format",
    "prompt",
    "quality",
    "size"
  ],
  "alibaba/qwen-image/edit-plus-20251215": [
    "model",
    "images",
    "prompt",
    "negative_prompt",
    "num_images",
    "size",
    "prompt_extend",
    "seed",
    "enable_sync_mode",
    "enable_base64_output"
  ],
  "alibaba/wan-2.6/image-edit": [
    "model",
    "enable_prompt_expansion",
    "enable_base64_output",
    "enable_sync_mode",
    "images",
    "prompt",
    "negative_prompt",
    "seed",
    "size"
  ],
  "z-image/turbo": [
    "model",
    "prompt",
    "prompt_extend",
    "seed",
    "size",
    "enable_base64_output",
    "enable_sync_mode"
  ],
  "openai/gpt-image-1/text-to-image": [
    "model",
    "prompt",
    "quality",
    "size",
    "output_format",
    "output_compression",
    "n",
    "enable_sync_mode",
    "enable_base64_output"
  ],
  "openai/gpt-image-1/edit": [
    "model",
    "enable_base64_output",
    "enable_sync_mode",
    "image",
    "mask_image",
    "prompt",
    "quality",
    "size"
  ],
  "openai/gpt-image-1-mini/text-to-image": [
    "model",
    "quality",
    "size",
    "output_format",
    "output_compression",
    "n",
    "enable_base64_output",
    "enable_sync_mode",
    "prompt"
  ],
  "openai/gpt-image-1-mini/edit": [
    "enable_base64_output",
    "enable_sync_mode",
    "images",
    "prompt",
    "quality",
    "size"
  ],
  "bytedance/seedream-v4.5": [
    "model",
    "enable_base64_output",
    "prompt",
    "size"
  ],
  "bytedance/seedream-v4.5/edit": [
    "model",
    "enable_base64_output",
    "images",
    "prompt",
    "size"
  ],
  "bytedance/seedream-v4.5/sequential": [
    "model",
    "enable_base64_output",
    "max_images",
    "prompt",
    "size"
  ],
  "bytedance/seedream-v4.5/edit-sequential": [
    "model",
    "enable_base64_output",
    "images",
    "max_images",
    "prompt",
    "size"
  ],
  "atlascloud/qwen-image/edit": [
    "model",
    "enable_base64_output",
    "enable_sync_mode",
    "image",
    "prompt",
    "seed"
  ],
  "google/nano-banana-pro/text-to-image-ultra": [
    "model",
    "aspect_ratio",
    "enable_base64_output",
    "enable_sync_mode",
    "output_format",
    "prompt",
    "resolution"
  ],
  "google/nano-banana-pro/edit-ultra": [
    "model",
    "aspect_ratio",
    "enable_base64_output",
    "enable_sync_mode",
    "images",
    "output_format",
    "prompt",
    "resolution"
  ],
  "google/nano-banana-pro/text-to-image": [
    "model",
    "aspect_ratio",
    "enable_base64_output",
    "enable_sync_mode",
    "enable_web_search",
    "prompt",
    "resolution",
    "output_format",
    "media_resolution"
  ],
  "alibaba/qwen-image/text-to-image-max": [
    "model",
    "prompt",
    "negative_prompt",
    "enable_prompt_expansion",
    "num_images",
    "size",
    "seed",
    "enable_base64_output",
    "enable_sync_mode"
  ],
  "alibaba/qwen-image/text-to-image-plus": [
    "model",
    "prompt",
    "negative_prompt",
    "enable_prompt_expansion",
    "num_images",
    "size",
    "seed",
    "enable_base64_output",
    "enable_sync_mode"
  ],
  "google/nano-banana-pro/edit": [
    "model",
    "aspect_ratio",
    "enable_base64_output",
    "enable_sync_mode",
    "enable_web_search",
    "images",
    "output_format",
    "prompt",
    "resolution",
    "media_resolution"
  ],
  "xai/grok-imagine-image/edit": [
    "model",
    "prompt",
    "image_urls",
    "num_images",
    "aspect_ratio",
    "resolution",
    "enable_base64_output"
  ],
  "xai/grok-imagine-image/text-to-image": [
    "model",
    "prompt",
    "num_images",
    "aspect_ratio",
    "resolution",
    "enable_base64_output"
  ],
  "openai/gpt-image-2-developer/edit": [
    "enable_base64_output",
    "enable_sync_mode",
    "images",
    "output_format",
    "prompt",
    "quality",
    "size",
    "moderation"
  ],
  "alibaba/wan-2.5/image-edit": [
    "model",
    "images",
    "prompt",
    "negative_prompt",
    "seed",
    "size",
    "enable_prompt_expansion"
  ],
  "openai/gpt-image-2-developer/text-to-image": [
    "enable_base64_output",
    "enable_sync_mode",
    "output_format",
    "prompt",
    "quality",
    "size",
    "moderation"
  ],
  "alibaba/wan-2.5/text-to-image": [
    "model",
    "enable_prompt_expansion",
    "negative_prompt",
    "prompt",
    "seed",
    "size"
  ],
  "bytedance/seedream-v4": [
    "model",
    "enable_base64_output",
    "prompt",
    "size"
  ],
  "bytedance/seedream-v4/sequential": [
    "model",
    "enable_base64_output",
    "max_images",
    "prompt",
    "size"
  ],
  "google/nano-banana-pro/text-to-image-developer": [
    "model",
    "aspect_ratio",
    "enable_base64_output",
    "enable_sync_mode",
    "enable_web_search",
    "prompt",
    "resolution"
  ],
  "google/nano-banana/text-to-image-developer": [
    "model",
    "aspect_ratio",
    "prompt",
    "enable_base64_output",
    "enable_sync_mode"
  ],
  "bytedance/seedream-v4/edit": [
    "model",
    "enable_base64_output",
    "images",
    "prompt",
    "size"
  ],
  "alibaba/qwen-image/edit": [
    "model",
    "images",
    "prompt",
    "negative_prompt",
    "num_images",
    "seed",
    "enable_sync_mode",
    "enable_base64_output"
  ],
  "alibaba/qwen-image/edit-plus": [
    "model",
    "images",
    "prompt",
    "negative_prompt",
    "num_images",
    "size",
    "prompt_extend",
    "seed",
    "enable_sync_mode",
    "enable_base64_output"
  ],
  "alibaba/wan-2.6/text-to-image": [
    "model",
    "enable_prompt_expansion",
    "enable_base64_output",
    "enable_sync_mode",
    "negative_prompt",
    "prompt",
    "seed",
    "size"
  ],
  "google/nano-banana-pro/edit-developer": [
    "model",
    "aspect_ratio",
    "enable_base64_output",
    "enable_sync_mode",
    "enable_web_search",
    "images",
    "prompt",
    "resolution"
  ],
  "google/nano-banana/edit-developer": [
    "model",
    "aspect_ratio",
    "images",
    "prompt",
    "enable_base64_output",
    "enable_sync_mode"
  ],
  "bytedance/seedream-v4/edit-sequential": [
    "model",
    "enable_base64_output",
    "images",
    "max_images",
    "prompt",
    "size"
  ],
  "google/nano-banana/text-to-image": [
    "model",
    "aspect_ratio",
    "prompt",
    "enable_base64_output",
    "enable_sync_mode",
    "output_format",
    "media_resolution"
  ],
  "google/nano-banana/edit": [
    "model",
    "aspect_ratio",
    "images",
    "prompt",
    "enable_base64_output",
    "enable_sync_mode",
    "output_format",
    "media_resolution"
  ],
  "google/imagen3": [
    "model",
    "seed",
    "prompt",
    "num_images",
    "aspect_ratio",
    "negative_prompt",
    "enable_base64_output",
    "enable_prompt_expansion",
    "resolution",
    "enable_sync_mode"
  ],
  "google/imagen3-fast": [
    "seed",
    "model",
    "prompt",
    "num_images",
    "aspect_ratio",
    "resolution",
    "negative_prompt",
    "enable_prompt_expansion",
    "enable_base64_output",
    "enable_sync_mode"
  ],
  "atlascloud/qwen-image/text-to-image": [
    "seed",
    "size",
    "model",
    "prompt",
    "enable_sync_mode",
    "enable_base64_output"
  ],
  "google/imagen4-fast": [
    "model",
    "seed",
    "prompt",
    "enable_prompt_expansion",
    "num_images",
    "aspect_ratio",
    "resolution",
    "negative_prompt",
    "enable_base64_output",
    "enable_sync_mode"
  ],
  "atlascloud/image-upscaler": [
    "model",
    "image",
    "outscale",
    "output_format"
  ],
  "black-forest-labs/flux-dev": [
    "model",
    "seed",
    "size",
    "image",
    "prompt",
    "strength",
    "mask_image",
    "num_images",
    "guidance_scale",
    "num_inference_steps",
    "enable_base64_output",
    "enable_safety_checker"
  ],
  "black-forest-labs/flux-kontext-dev": [
    "model",
    "seed",
    "size",
    "image",
    "prompt",
    "num_images",
    "guidance_scale",
    "num_inference_steps",
    "enable_base64_output",
    "enable_safety_checker"
  ],
  "google/imagen4-ultra": [
    "model",
    "seed",
    "prompt",
    "num_images",
    "aspect_ratio",
    "resolution",
    "negative_prompt",
    "enable_prompt_expansion",
    "enable_base64_output",
    "enable_sync_mode"
  ],
  "google/imagen4": [
    "model",
    "seed",
    "prompt",
    "num_images",
    "aspect_ratio",
    "resolution",
    "negative_prompt",
    "enable_prompt_expansion",
    "enable_base64_output",
    "enable_sync_mode"
  ],
  "black-forest-labs/flux-kontext-dev-lora": [
    "model",
    "enable_base64_output",
    "enable_sync_mode",
    "guidance_scale",
    "image",
    "loras",
    "num_images",
    "num_inference_steps",
    "output_format",
    "prompt",
    "seed",
    "size"
  ],
  "black-forest-labs/flux-schnell": [
    "model",
    "seed",
    "size",
    "image",
    "prompt",
    "strength",
    "mask_image",
    "num_images",
    "enable_sync_mode",
    "enable_base64_output",
    "enable_safety_checker"
  ],
  "microsoft/mai-image-2.5-flash/edit": [
    "model",
    "prompt",
    "image",
    "enable_base64_output",
    "enable_sync_mode"
  ],
  "black-forest-labs/flux-2-flex/edit": [
    "model",
    "prompt",
    "images",
    "enable_prompt_expansion",
    "size",
    "guidance_scale",
    "num_inference_steps",
    "output_format",
    "safety_tolerance",
    "seed",
    "enable_base64_output",
    "enable_sync_mode"
  ],
  "black-forest-labs/flux-2-flex/text-to-image": [
    "model",
    "prompt",
    "enable_prompt_expansion",
    "size",
    "guidance_scale",
    "num_inference_steps",
    "output_format",
    "safety_tolerance",
    "seed",
    "enable_base64_output",
    "enable_sync_mode"
  ],
  "black-forest-labs/flux-2-pro/edit": [
    "model",
    "prompt",
    "images",
    "size",
    "output_format",
    "safety_tolerance",
    "seed",
    "enable_base64_output",
    "enable_sync_mode"
  ],
  "black-forest-labs/flux-2-pro/text-to-image": [
    "model",
    "prompt",
    "size",
    "output_format",
    "safety_tolerance",
    "seed",
    "enable_base64_output",
    "enable_sync_mode"
  ],
  "black-forest-labs/flux-dev-lora": [
    "model",
    "seed",
    "size",
    "image",
    "loras",
    "prompt",
    "strength",
    "mask_image",
    "num_images",
    "guidance_scale"
  ]
};
