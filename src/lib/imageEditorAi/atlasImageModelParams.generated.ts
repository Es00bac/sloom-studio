// AUTO-GENERATED from the live Atlas Cloud model schemas (verified 2026-06-28). For each model, the
// documented input parameters NOT already covered by a dedicated node control/handle (prompt, source &
// reference images, mask, output size/aspect, seed, guidance, steps, negative prompt, LoRA, strength,
// output format, safety). These drive the node's generic "Model parameters" section so every documented
// feature of a model is reachable. Do not hand-edit; regenerate from the schemas.
export interface AtlasModelParam {
  name: string;
  type: 'boolean' | 'integer' | 'number' | 'enum' | 'string';
  label: string;
  description?: string;
  enum?: string[];
  default?: string | number | boolean;
  min?: number;
  max?: number;
  required?: boolean;
}

export const ATLAS_IMAGE_MODEL_PARAMS: Record<string, AtlasModelParam[]> = {
  "youchuan/v8.1/blend": [
    {
      "name": "hd",
      "type": "boolean",
      "label": "Hd",
      "description": "Enable native 2K HD generation. Costs 1.5x.",
      "default": false
    },
    {
      "name": "stylize",
      "type": "integer",
      "label": "Stylize",
      "description": "Controls how strongly the model's default aesthetic is applied (0-1000).",
      "default": 0,
      "min": 0,
      "max": 1000
    },
    {
      "name": "chaos",
      "type": "integer",
      "label": "Chaos",
      "description": "Higher values produce more unusual and varied results (0-100).",
      "default": 0,
      "min": 0,
      "max": 100
    },
    {
      "name": "weird",
      "type": "integer",
      "label": "Weird",
      "description": "Makes results quirky and unconventional (0-3000).",
      "default": 0,
      "min": 0,
      "max": 3000
    },
    {
      "name": "quality",
      "type": "enum",
      "label": "Quality",
      "description": "Controls image detail. 4 = higher detail at the same price (slower). v8.1 supports 1 or 4 only.",
      "enum": [
        "1",
        "4"
      ],
      "default": 1
    }
  ],
  "youchuan/v8.1/image-to-image": [
    {
      "name": "sref",
      "type": "string",
      "label": "Sref",
      "description": "Optional URL of a style-reference image. Must be a publicly reachable https image URL."
    },
    {
      "name": "hd",
      "type": "boolean",
      "label": "Hd",
      "description": "Enable native 2K HD generation. Costs 1.5x.",
      "default": false
    },
    {
      "name": "stylize",
      "type": "integer",
      "label": "Stylize",
      "description": "Controls how strongly the model's default aesthetic is applied (0-1000).",
      "default": 0,
      "min": 0,
      "max": 1000
    },
    {
      "name": "chaos",
      "type": "integer",
      "label": "Chaos",
      "description": "Higher values produce more unusual and varied results (0-100).",
      "default": 0,
      "min": 0,
      "max": 100
    },
    {
      "name": "weird",
      "type": "integer",
      "label": "Weird",
      "description": "Makes results quirky and unconventional (0-3000).",
      "default": 0,
      "min": 0,
      "max": 3000
    },
    {
      "name": "quality",
      "type": "enum",
      "label": "Quality",
      "description": "Controls image detail. 4 = higher detail at the same price (slower). v8.1 supports 1 or 4 only.",
      "enum": [
        "1",
        "4"
      ],
      "default": 1
    }
  ],
  "youchuan/v8.1/text-to-image": [
    {
      "name": "sref",
      "type": "string",
      "label": "Sref",
      "description": "Optional URL of a style-reference image. Must be a publicly reachable https image URL."
    },
    {
      "name": "hd",
      "type": "boolean",
      "label": "Hd",
      "description": "Enable native 2K HD generation. Costs 1.5x.",
      "default": false
    },
    {
      "name": "stylize",
      "type": "integer",
      "label": "Stylize",
      "description": "Controls how strongly the model's default aesthetic is applied (0-1000).",
      "default": 0,
      "min": 0,
      "max": 1000
    },
    {
      "name": "chaos",
      "type": "integer",
      "label": "Chaos",
      "description": "Higher values produce more unusual and varied results (0-100).",
      "default": 0,
      "min": 0,
      "max": 100
    },
    {
      "name": "weird",
      "type": "integer",
      "label": "Weird",
      "description": "Makes results quirky and unconventional (0-3000).",
      "default": 0,
      "min": 0,
      "max": 3000
    },
    {
      "name": "quality",
      "type": "enum",
      "label": "Quality",
      "description": "Controls image detail. 4 = higher detail at the same price (slower). v8.1 supports 1 or 4 only.",
      "enum": [
        "1",
        "4"
      ],
      "default": 1
    }
  ],
  "google/nano-banana-2/reference-to-image": [
    {
      "name": "enable_web_search",
      "type": "boolean",
      "label": "Enable Web Search",
      "description": "If enabled, the model will use web search to ground the generation with real-time information.",
      "default": false
    },
    {
      "name": "enable_image_search",
      "type": "boolean",
      "label": "Enable Image Search",
      "description": "If enabled, the model will use image search to ground the generation with real-time information.",
      "default": false
    },
    {
      "name": "resolution",
      "type": "enum",
      "label": "Resolution",
      "description": "The resolution of the output image.",
      "enum": [
        "1k",
        "2k",
        "4k"
      ],
      "default": "1k"
    },
    {
      "name": "media_resolution",
      "type": "enum",
      "label": "Media Resolution",
      "description": "Controls how input media is processed. LOW reduces tokens per image/video, possibly losing detail but allowing longer videos in context. Supported values: HIGH,",
      "enum": [
        "default",
        "low",
        "medium",
        "high"
      ],
      "default": "default"
    },
    {
      "name": "thinking_level",
      "type": "enum",
      "label": "Thinking Level",
      "description": "Controls the amount of internal reasoning the model performs before generating a response. Higher levels may improve quality on complex tasks but increase laten",
      "enum": [
        "default",
        "high",
        "minimal"
      ],
      "default": "default"
    },
    {
      "name": "video_clips",
      "type": "string",
      "label": "Video Clips",
      "description": "Source video clips to use as references for generation. Supports 1 video clip.",
      "required": true
    }
  ],
  "google/nano-banana-2/reference-to-image-developer": [
    {
      "name": "video_clips",
      "type": "string",
      "label": "Video Clips",
      "description": "Source video clips to use as references for generation. Supports 1 video clip.",
      "required": true
    },
    {
      "name": "enable_web_search",
      "type": "boolean",
      "label": "Enable Web Search",
      "description": "If enabled, the model will use web search to ground the generation with real-time information.",
      "default": false
    },
    {
      "name": "resolution",
      "type": "enum",
      "label": "Resolution",
      "description": "The resolution of the output image.",
      "enum": [
        "1k",
        "2k",
        "4k"
      ],
      "default": "1k"
    },
    {
      "name": "thinking_level",
      "type": "enum",
      "label": "Thinking Level",
      "description": "Controls the amount of internal reasoning the model performs before generating a response. Higher levels may improve quality on complex tasks but increase laten",
      "enum": [
        "default",
        "high",
        "minimal"
      ],
      "default": "default"
    }
  ],
  "xai/grok-imagine-image-quality/text-to-image": [
    {
      "name": "num_images",
      "type": "enum",
      "label": "Num Images",
      "description": "Number of images to generate. Each image is billed separately.",
      "enum": [
        "1",
        "2",
        "3",
        "4"
      ],
      "default": 1
    },
    {
      "name": "resolution",
      "type": "enum",
      "label": "Resolution",
      "description": "Output resolution. 1k = 1024x1024 ($0.05/image), 2k = 2048x2048 ($0.07/image).",
      "enum": [
        "1k",
        "2k"
      ],
      "default": "1k"
    }
  ],
  "xai/grok-imagine-image-quality/edit": [
    {
      "name": "num_images",
      "type": "enum",
      "label": "Num Images",
      "description": "Number of edited images to generate. Each output image is billed separately.",
      "enum": [
        "1",
        "2",
        "3",
        "4"
      ],
      "default": 1
    },
    {
      "name": "resolution",
      "type": "enum",
      "label": "Resolution",
      "description": "Output resolution. 1k = 1024x1024 ($0.05/image), 2k = 2048x2048 ($0.07/image).",
      "enum": [
        "1k",
        "2k"
      ],
      "default": "1k"
    }
  ],
  "openai/gpt-image-2/text-to-image": [
    {
      "name": "quality",
      "type": "enum",
      "label": "Quality",
      "description": "The quality of the generated image.",
      "enum": [
        "low",
        "medium",
        "high"
      ],
      "default": "medium"
    },
    {
      "name": "moderation",
      "type": "string",
      "label": "Moderation",
      "description": "Whether to enable content moderation. If enabled, the system will check the input prompt for potentially harmful content and reject requests that violate conten",
      "default": "low"
    }
  ],
  "openai/gpt-image-2/edit": [
    {
      "name": "quality",
      "type": "enum",
      "label": "Quality",
      "description": "The quality of the generated image.",
      "enum": [
        "low",
        "medium",
        "high"
      ],
      "default": "medium"
    },
    {
      "name": "moderation",
      "type": "string",
      "label": "Moderation",
      "description": "Whether to enable content moderation. If enabled, the system will check the input prompt for potentially harmful content and reject requests that violate conten",
      "default": "low"
    }
  ],
  "baidu/ERNIE-Image-Turbo/text-to-image": [
    {
      "name": "n",
      "type": "integer",
      "label": "N",
      "description": "Number of images to generate.",
      "default": 1,
      "min": 1,
      "max": 10
    },
    {
      "name": "use_pe",
      "type": "boolean",
      "label": "Use Pe",
      "description": "Use PE for generation.",
      "default": true
    }
  ],
  "alibaba/wan-2.7/text-to-image": [
    {
      "name": "size",
      "type": "enum",
      "label": "Resolution",
      "description": "Output image resolution.",
      "enum": [
        "1K",
        "2K"
      ],
      "default": "2K"
    },
    {
      "name": "n",
      "type": "integer",
      "label": "N",
      "description": "Number of images to generate.",
      "default": 1,
      "min": 1,
      "max": 4
    },
    {
      "name": "color_palette",
      "type": "string",
      "label": "Color Palette"
    },
    {
      "name": "thinking_mode",
      "type": "boolean",
      "label": "Thinking Mode",
      "description": "Whether to enable thinking mode for higher-quality image generation.",
      "default": true
    }
  ],
  "alibaba/wan-2.7/image-edit": [
    {
      "name": "size",
      "type": "enum",
      "label": "Resolution",
      "description": "Output image resolution.",
      "enum": [
        "1K",
        "2K"
      ],
      "default": "2K"
    },
    {
      "name": "n",
      "type": "integer",
      "label": "N",
      "description": "Number of images to generate.",
      "default": 1,
      "min": 1,
      "max": 4
    },
    {
      "name": "thinking_mode",
      "type": "boolean",
      "label": "Thinking Mode",
      "description": "Whether to enable thinking mode for higher-quality image generation.",
      "default": true
    }
  ],
  "alibaba/wan-2.7-pro/text-to-image": [
    {
      "name": "size",
      "type": "enum",
      "label": "Resolution",
      "description": "Output image resolution.",
      "enum": [
        "1K",
        "2K",
        "4K"
      ],
      "default": "2K"
    },
    {
      "name": "n",
      "type": "integer",
      "label": "N",
      "description": "Number of images to generate.",
      "default": 1,
      "min": 1,
      "max": 4
    },
    {
      "name": "color_palette",
      "type": "string",
      "label": "Color Palette"
    },
    {
      "name": "thinking_mode",
      "type": "boolean",
      "label": "Thinking Mode",
      "description": "Whether to enable thinking mode for higher-quality image generation.",
      "default": true
    }
  ],
  "alibaba/wan-2.7-pro/image-edit": [
    {
      "name": "size",
      "type": "enum",
      "label": "Resolution",
      "description": "Output image resolution.",
      "enum": [
        "1K",
        "2K"
      ],
      "default": "2K"
    },
    {
      "name": "n",
      "type": "integer",
      "label": "N",
      "description": "Number of images to generate.",
      "default": 1,
      "min": 1,
      "max": 4
    },
    {
      "name": "thinking_mode",
      "type": "boolean",
      "label": "Thinking Mode",
      "description": "Whether to enable thinking mode for higher-quality image generation.",
      "default": true
    }
  ],
  "google/nano-banana-2/text-to-image-developer": [
    {
      "name": "enable_web_search",
      "type": "boolean",
      "label": "Enable Web Search",
      "description": "If enabled, the model will use web search to ground the generation with real-time information.",
      "default": false
    },
    {
      "name": "resolution",
      "type": "enum",
      "label": "Resolution",
      "description": "The resolution of the output image.",
      "enum": [
        "1k",
        "2k",
        "4k"
      ],
      "default": "1k"
    },
    {
      "name": "thinking_level",
      "type": "enum",
      "label": "Thinking Level",
      "description": "Controls the amount of internal reasoning the model performs before generating a response. Higher levels may improve quality on complex tasks but increase laten",
      "enum": [
        "default",
        "high",
        "minimal"
      ],
      "default": "default"
    }
  ],
  "google/nano-banana-2/text-to-image": [
    {
      "name": "enable_web_search",
      "type": "boolean",
      "label": "Enable Web Search",
      "description": "If enabled, the model will use web search to ground the generation with real-time information.",
      "default": false
    },
    {
      "name": "enable_image_search",
      "type": "boolean",
      "label": "Enable Image Search",
      "description": "If enabled, the model will use image search to ground the generation with real-time information.",
      "default": false
    },
    {
      "name": "resolution",
      "type": "enum",
      "label": "Resolution",
      "description": "The resolution of the output image.",
      "enum": [
        "1k",
        "2k",
        "4k"
      ],
      "default": "1k"
    },
    {
      "name": "media_resolution",
      "type": "enum",
      "label": "Media Resolution",
      "description": "Controls how input media is processed. LOW reduces tokens per image/video, possibly losing detail but allowing longer videos in context. Supported values: HIGH,",
      "enum": [
        "default",
        "low",
        "medium",
        "high"
      ],
      "default": "default"
    },
    {
      "name": "thinking_level",
      "type": "enum",
      "label": "Thinking Level",
      "description": "Controls the amount of internal reasoning the model performs before generating a response. Higher levels may improve quality on complex tasks but increase laten",
      "enum": [
        "default",
        "high",
        "minimal"
      ],
      "default": "default"
    }
  ],
  "google/nano-banana-2/edit-developer": [
    {
      "name": "enable_web_search",
      "type": "boolean",
      "label": "Enable Web Search",
      "description": "If enabled, the model will use web search to ground the generation with real-time information.",
      "default": false
    },
    {
      "name": "resolution",
      "type": "enum",
      "label": "Resolution",
      "description": "The resolution of the output image.",
      "enum": [
        "1k",
        "2k",
        "4k"
      ],
      "default": "1k"
    },
    {
      "name": "thinking_level",
      "type": "enum",
      "label": "Thinking Level",
      "description": "Controls the amount of internal reasoning the model performs before generating a response. Higher levels may improve quality on complex tasks but increase laten",
      "enum": [
        "default",
        "high",
        "minimal"
      ],
      "default": "default"
    }
  ],
  "google/nano-banana-2/edit": [
    {
      "name": "enable_web_search",
      "type": "boolean",
      "label": "Enable Web Search",
      "description": "If enabled, the model will use web search to ground the generation with real-time information.",
      "default": false
    },
    {
      "name": "enable_image_search",
      "type": "boolean",
      "label": "Enable Image Search",
      "description": "If enabled, the model will use image search to ground the generation with real-time information.",
      "default": false
    },
    {
      "name": "resolution",
      "type": "enum",
      "label": "Resolution",
      "description": "The resolution of the output image.",
      "enum": [
        "1k",
        "2k",
        "4k"
      ],
      "default": "1k"
    },
    {
      "name": "media_resolution",
      "type": "enum",
      "label": "Media Resolution",
      "description": "Controls how input media is processed. LOW reduces tokens per image/video, possibly losing detail but allowing longer videos in context. Supported values: HIGH,",
      "enum": [
        "default",
        "low",
        "medium",
        "high"
      ],
      "default": "default"
    },
    {
      "name": "thinking_level",
      "type": "enum",
      "label": "Thinking Level",
      "description": "Controls the amount of internal reasoning the model performs before generating a response. Higher levels may improve quality on complex tasks but increase laten",
      "enum": [
        "default",
        "high",
        "minimal"
      ],
      "default": "default"
    }
  ],
  "bytedance/seedream-v5.0-lite/edit-sequential": [
    {
      "name": "max_images",
      "type": "integer",
      "label": "Max Images",
      "description": "The maximum number of images to generate (1-15). The total of input reference images plus generated images must not exceed 15.",
      "default": 1,
      "min": 1,
      "max": 15
    }
  ],
  "bytedance/seedream-v5.0-lite/sequential": [
    {
      "name": "max_images",
      "type": "integer",
      "label": "Max Images",
      "description": "The maximum number of images to generate (1-15). The total of input reference images plus generated images must not exceed 15.",
      "default": 1,
      "min": 1,
      "max": 15
    }
  ],
  "openai/gpt-image-1.5/text-to-image": [
    {
      "name": "quality",
      "type": "enum",
      "label": "Quality",
      "description": "The quality of the generated image.",
      "enum": [
        "low",
        "medium",
        "high"
      ],
      "default": "medium"
    }
  ],
  "openai/gpt-image-1.5/edit": [
    {
      "name": "input_fidelity",
      "type": "enum",
      "label": "Input Fidelity",
      "description": "input fidelity, which allows you to better preserve details from the input images in the output. This is especially useful when using images that contain elemen",
      "enum": [
        "low",
        "high"
      ],
      "default": "high"
    },
    {
      "name": "quality",
      "type": "enum",
      "label": "Quality",
      "description": "The quality of the generated image.",
      "enum": [
        "low",
        "medium",
        "high"
      ],
      "default": "medium"
    }
  ],
  "alibaba/qwen-image/edit-plus-20251215": [
    {
      "name": "num_images",
      "type": "integer",
      "label": "Num Images",
      "description": "Number of output images (1-6).",
      "default": 1,
      "min": 1,
      "max": 6
    },
    {
      "name": "prompt_extend",
      "type": "boolean",
      "label": "Prompt Extend",
      "description": "Supports intelligent prompt rewriting for better results.",
      "default": false
    }
  ],
  "alibaba/wan-2.6/image-edit": [
    {
      "name": "enable_prompt_expansion",
      "type": "boolean",
      "label": "Enable Prompt Expansion",
      "description": "If set to true, the prompt optimizer will be enabled.",
      "default": false
    }
  ],
  "z-image/turbo": [
    {
      "name": "prompt_extend",
      "type": "boolean",
      "label": "Prompt Extend",
      "description": "Supports intelligent prompt rewriting for better results.",
      "default": false
    }
  ],
  "openai/gpt-image-1/text-to-image": [
    {
      "name": "quality",
      "type": "enum",
      "label": "Quality",
      "description": "The quality of the generated image.",
      "enum": [
        "low",
        "medium",
        "high"
      ],
      "default": "medium"
    },
    {
      "name": "output_compression",
      "type": "integer",
      "label": "Output Compression",
      "description": "Compression level for output image.",
      "default": 100,
      "min": 0,
      "max": 100
    },
    {
      "name": "n",
      "type": "integer",
      "label": "N",
      "description": "Number of images to generate.",
      "default": 1,
      "min": 1,
      "max": 10
    }
  ],
  "openai/gpt-image-1/edit": [
    {
      "name": "quality",
      "type": "enum",
      "label": "Quality",
      "description": "The quality of the generated image.",
      "enum": [
        "high",
        "medium",
        "low"
      ],
      "default": "medium"
    }
  ],
  "openai/gpt-image-1-mini/text-to-image": [
    {
      "name": "quality",
      "type": "enum",
      "label": "Quality",
      "description": "The quality of the generated image.",
      "enum": [
        "low",
        "medium",
        "high"
      ],
      "default": "medium"
    },
    {
      "name": "output_compression",
      "type": "integer",
      "label": "Output Compression",
      "description": "Compression level for output image.",
      "default": 100,
      "min": 0,
      "max": 100
    },
    {
      "name": "n",
      "type": "integer",
      "label": "N",
      "description": "Number of images to generate.",
      "default": 1,
      "min": 1,
      "max": 10
    }
  ],
  "openai/gpt-image-1-mini/edit": [
    {
      "name": "quality",
      "type": "enum",
      "label": "Quality",
      "description": "The quality of the generated image.",
      "enum": [
        "high",
        "medium",
        "low"
      ],
      "default": "medium"
    }
  ],
  "bytedance/seedream-v4.5/sequential": [
    {
      "name": "max_images",
      "type": "integer",
      "label": "Max Images",
      "description": "The maximum number of images that can be generated (up to 15). This value must align with the number of images specified in the prompt above.",
      "default": 1,
      "min": 1,
      "max": 15
    }
  ],
  "bytedance/seedream-v4.5/edit-sequential": [
    {
      "name": "max_images",
      "type": "integer",
      "label": "Max Images",
      "description": "The maximum number of images that can be generated (up to 15). This value must align with the number of images specified in the prompt above.",
      "default": 1,
      "min": 1,
      "max": 15
    }
  ],
  "google/nano-banana-pro/text-to-image-ultra": [
    {
      "name": "resolution",
      "type": "enum",
      "label": "Resolution",
      "description": "The resolution of the output image.",
      "enum": [
        "4k",
        "8k"
      ],
      "default": "4k"
    }
  ],
  "google/nano-banana-pro/edit-ultra": [
    {
      "name": "resolution",
      "type": "enum",
      "label": "Resolution",
      "description": "The resolution of the output image.",
      "enum": [
        "4k",
        "8k"
      ],
      "default": "4k"
    }
  ],
  "google/nano-banana-pro/text-to-image": [
    {
      "name": "enable_web_search",
      "type": "boolean",
      "label": "Enable Web Search",
      "description": "If enabled, the model will use web search to ground the generation with real-time information.",
      "default": false
    },
    {
      "name": "resolution",
      "type": "enum",
      "label": "Resolution",
      "description": "The resolution of the output image.",
      "enum": [
        "1k",
        "2k",
        "4k"
      ],
      "default": "1k"
    },
    {
      "name": "media_resolution",
      "type": "enum",
      "label": "Media Resolution",
      "description": "Controls how input media is processed. LOW reduces tokens per image/video, possibly losing detail but allowing longer videos in context. Supported values: HIGH,",
      "enum": [
        "default",
        "low",
        "medium",
        "high"
      ],
      "default": "default"
    }
  ],
  "alibaba/qwen-image/text-to-image-max": [
    {
      "name": "enable_prompt_expansion",
      "type": "boolean",
      "label": "Enable Prompt Expansion",
      "description": "If set to true, the prompt optimizer will be enabled.",
      "default": false
    },
    {
      "name": "num_images",
      "type": "integer",
      "label": "Num Images",
      "description": "Number of images to generate.",
      "default": 1,
      "min": 1,
      "max": 1
    }
  ],
  "alibaba/qwen-image/text-to-image-plus": [
    {
      "name": "enable_prompt_expansion",
      "type": "boolean",
      "label": "Enable Prompt Expansion",
      "description": "If set to true, the prompt optimizer will be enabled.",
      "default": false
    },
    {
      "name": "num_images",
      "type": "integer",
      "label": "Num Images",
      "description": "Number of images to generate.",
      "default": 1,
      "min": 1,
      "max": 1
    }
  ],
  "google/nano-banana-pro/edit": [
    {
      "name": "enable_web_search",
      "type": "boolean",
      "label": "Enable Web Search",
      "description": "If enabled, the model will use web search to ground the generation with real-time information.",
      "default": false
    },
    {
      "name": "resolution",
      "type": "enum",
      "label": "Resolution",
      "description": "The resolution of the output image.",
      "enum": [
        "1k",
        "2k",
        "4k"
      ],
      "default": "1k"
    },
    {
      "name": "media_resolution",
      "type": "enum",
      "label": "Media Resolution",
      "description": "Controls how input media is processed. LOW reduces tokens per image/video, possibly losing detail but allowing longer videos in context. Supported values: HIGH,",
      "enum": [
        "default",
        "low",
        "medium",
        "high"
      ],
      "default": "default"
    }
  ],
  "xai/grok-imagine-image/edit": [
    {
      "name": "num_images",
      "type": "enum",
      "label": "Num Images",
      "description": "Number of edited images to generate. Each output image is billed separately.",
      "enum": [
        "1",
        "2",
        "3",
        "4"
      ],
      "default": 1
    },
    {
      "name": "resolution",
      "type": "enum",
      "label": "Resolution",
      "description": "Output resolution. 1k = 1024x1024, 2k = 2048x2048.",
      "enum": [
        "1k",
        "2k"
      ],
      "default": "1k"
    }
  ],
  "xai/grok-imagine-image/text-to-image": [
    {
      "name": "num_images",
      "type": "enum",
      "label": "Num Images",
      "description": "Number of images to generate. Each image is billed separately.",
      "enum": [
        "1",
        "2",
        "3",
        "4"
      ],
      "default": 1
    },
    {
      "name": "resolution",
      "type": "enum",
      "label": "Resolution",
      "description": "Output resolution. 1k = 1024x1024, 2k = 2048x2048.",
      "enum": [
        "1k",
        "2k"
      ],
      "default": "1k"
    }
  ],
  "openai/gpt-image-2-developer/edit": [
    {
      "name": "quality",
      "type": "enum",
      "label": "Quality",
      "description": "The quality of the generated image.",
      "enum": [
        "low",
        "medium",
        "high"
      ],
      "default": "medium"
    },
    {
      "name": "moderation",
      "type": "string",
      "label": "Moderation",
      "description": "Whether to enable content moderation. If enabled, the system will check the input prompt for potentially harmful content and reject requests that violate conten",
      "default": "low"
    }
  ],
  "alibaba/wan-2.5/image-edit": [
    {
      "name": "enable_prompt_expansion",
      "type": "boolean",
      "label": "Enable Prompt Expansion",
      "description": "If set to true, the prompt optimizer will be enabled.",
      "default": true
    }
  ],
  "openai/gpt-image-2-developer/text-to-image": [
    {
      "name": "quality",
      "type": "enum",
      "label": "Quality",
      "description": "The quality of the generated image.",
      "enum": [
        "low",
        "medium",
        "high"
      ],
      "default": "medium"
    },
    {
      "name": "moderation",
      "type": "string",
      "label": "Moderation",
      "description": "Whether to enable content moderation. If enabled, the system will check the input prompt for potentially harmful content and reject requests that violate conten",
      "default": "low"
    }
  ],
  "alibaba/wan-2.5/text-to-image": [
    {
      "name": "enable_prompt_expansion",
      "type": "boolean",
      "label": "Enable Prompt Expansion",
      "description": "If set to true, the prompt optimizer will be enabled.",
      "default": false
    }
  ],
  "bytedance/seedream-v4/sequential": [
    {
      "name": "max_images",
      "type": "integer",
      "label": "Max Images",
      "description": "The number of images to generate. max 14",
      "default": 1,
      "min": 1,
      "max": 14
    }
  ],
  "google/nano-banana-pro/text-to-image-developer": [
    {
      "name": "enable_web_search",
      "type": "boolean",
      "label": "Enable Web Search",
      "description": "If enabled, the model will use web search to ground the generation with real-time information.",
      "default": false
    },
    {
      "name": "resolution",
      "type": "enum",
      "label": "Resolution",
      "description": "The resolution of the output image.",
      "enum": [
        "1k",
        "2k",
        "4k"
      ],
      "default": "1k"
    }
  ],
  "alibaba/qwen-image/edit": [
    {
      "name": "num_images",
      "type": "integer",
      "label": "Num Images",
      "description": "Number of output images. Fixed at 1.",
      "default": 1,
      "min": 1,
      "max": 1
    }
  ],
  "alibaba/qwen-image/edit-plus": [
    {
      "name": "num_images",
      "type": "integer",
      "label": "Num Images",
      "description": "Number of output images (1-6).",
      "default": 1,
      "min": 1,
      "max": 6
    },
    {
      "name": "prompt_extend",
      "type": "boolean",
      "label": "Prompt Extend",
      "description": "Supports intelligent prompt rewriting for better results.",
      "default": false
    }
  ],
  "alibaba/wan-2.6/text-to-image": [
    {
      "name": "enable_prompt_expansion",
      "type": "boolean",
      "label": "Enable Prompt Expansion",
      "description": "If set to true, the prompt optimizer will be enabled.",
      "default": false
    }
  ],
  "google/nano-banana-pro/edit-developer": [
    {
      "name": "enable_web_search",
      "type": "boolean",
      "label": "Enable Web Search",
      "description": "If enabled, the model will use web search to ground the generation with real-time information.",
      "default": false
    },
    {
      "name": "resolution",
      "type": "enum",
      "label": "Resolution",
      "description": "The resolution of the output image.",
      "enum": [
        "1k",
        "2k",
        "4k"
      ],
      "default": "1k"
    }
  ],
  "bytedance/seedream-v4/edit-sequential": [
    {
      "name": "max_images",
      "type": "integer",
      "label": "Max Images",
      "description": "The number of images to generate. max 14",
      "default": 1,
      "min": 1,
      "max": 14
    }
  ],
  "google/nano-banana/text-to-image": [
    {
      "name": "media_resolution",
      "type": "enum",
      "label": "Media Resolution",
      "description": "Controls how input media is processed. LOW reduces tokens per image/video, possibly losing detail but allowing longer videos in context. Supported values: HIGH,",
      "enum": [
        "default",
        "low",
        "medium",
        "high"
      ],
      "default": "default"
    }
  ],
  "google/nano-banana/edit": [
    {
      "name": "media_resolution",
      "type": "enum",
      "label": "Media Resolution",
      "description": "Controls how input media is processed. LOW reduces tokens per image/video, possibly losing detail but allowing longer videos in context. Supported values: HIGH,",
      "enum": [
        "default",
        "low",
        "medium",
        "high"
      ],
      "default": "default"
    }
  ],
  "google/imagen3": [
    {
      "name": "num_images",
      "type": "integer",
      "label": "Num Images",
      "description": "The number of images to generate.",
      "default": 1,
      "min": 1,
      "max": 4
    },
    {
      "name": "enable_prompt_expansion",
      "type": "boolean",
      "label": "Enable Prompt Expansion",
      "description": "If set to true, the prompt optimizer will be enabled.",
      "default": false
    },
    {
      "name": "resolution",
      "type": "enum",
      "label": "Resolution",
      "description": "The resolution of the output image.",
      "enum": [
        "1k"
      ],
      "default": "1k"
    }
  ],
  "google/imagen3-fast": [
    {
      "name": "num_images",
      "type": "integer",
      "label": "Num Images",
      "description": "The number of images to generate.",
      "default": 1,
      "min": 1,
      "max": 4
    },
    {
      "name": "resolution",
      "type": "enum",
      "label": "Resolution",
      "description": "The resolution of the output image.",
      "enum": [
        "1k"
      ],
      "default": "1k"
    },
    {
      "name": "enable_prompt_expansion",
      "type": "boolean",
      "label": "Enable Prompt Expansion",
      "description": "If set to true, the prompt optimizer will be enabled.",
      "default": false
    }
  ],
  "google/imagen4-fast": [
    {
      "name": "enable_prompt_expansion",
      "type": "boolean",
      "label": "Enable Prompt Expansion",
      "description": "If set to true, the prompt optimizer will be enabled.",
      "default": false
    },
    {
      "name": "num_images",
      "type": "integer",
      "label": "Num Images",
      "description": "The number of images to generate.",
      "default": 1,
      "min": 1,
      "max": 4
    },
    {
      "name": "resolution",
      "type": "enum",
      "label": "Resolution",
      "description": "The resolution of the output image.",
      "enum": [
        "1k"
      ],
      "default": "1k"
    }
  ],
  "atlascloud/image-upscaler": [
    {
      "name": "outscale",
      "type": "number",
      "label": "Outscale",
      "description": "Output scale multiplier. Use 2.0 for standard upscaling and 4.0 for the maximum exposed scale.",
      "default": 1,
      "min": 1,
      "max": 4
    }
  ],
  "black-forest-labs/flux-dev": [
    {
      "name": "num_images",
      "type": "integer",
      "label": "Num Images",
      "description": "The number of images to generate.",
      "default": 1,
      "min": 1,
      "max": 4
    }
  ],
  "black-forest-labs/flux-kontext-dev": [
    {
      "name": "num_images",
      "type": "integer",
      "label": "Num Images",
      "description": "The number of images to generate.",
      "default": 1,
      "min": 1,
      "max": 4
    }
  ],
  "google/imagen4-ultra": [
    {
      "name": "num_images",
      "type": "integer",
      "label": "Num Images",
      "description": "The number of images to generate.",
      "default": 1,
      "min": 1,
      "max": 4
    },
    {
      "name": "resolution",
      "type": "enum",
      "label": "Resolution",
      "description": "The resolution of the output image.",
      "enum": [
        "1k",
        "2k"
      ],
      "default": "1k"
    },
    {
      "name": "enable_prompt_expansion",
      "type": "boolean",
      "label": "Enable Prompt Expansion",
      "description": "If set to true, the prompt optimizer will be enabled.",
      "default": false
    }
  ],
  "google/imagen4": [
    {
      "name": "num_images",
      "type": "integer",
      "label": "Num Images",
      "description": "The number of images to generate.",
      "default": 1,
      "min": 1,
      "max": 4
    },
    {
      "name": "resolution",
      "type": "enum",
      "label": "Resolution",
      "description": "The resolution of the output image.",
      "enum": [
        "1k",
        "2k"
      ],
      "default": "1k"
    },
    {
      "name": "enable_prompt_expansion",
      "type": "boolean",
      "label": "Enable Prompt Expansion",
      "description": "If set to true, the prompt optimizer will be enabled.",
      "default": false
    }
  ],
  "black-forest-labs/flux-kontext-dev-lora": [
    {
      "name": "num_images",
      "type": "integer",
      "label": "Num Images",
      "description": "The number of images to generate.",
      "default": 1,
      "min": 1,
      "max": 4
    }
  ],
  "black-forest-labs/flux-schnell": [
    {
      "name": "num_images",
      "type": "integer",
      "label": "Num Images",
      "description": "Number of images to generate",
      "default": 1,
      "min": 1,
      "max": 4
    }
  ],
  "black-forest-labs/flux-2-flex/edit": [
    {
      "name": "enable_prompt_expansion",
      "type": "boolean",
      "label": "Enable Prompt Expansion",
      "description": "Whether to use prompt upsampling to enhance the prompt before generation.",
      "default": true
    },
    {
      "name": "safety_tolerance",
      "type": "integer",
      "label": "Safety Tolerance",
      "description": "Tolerance level for input and output moderation. Between 0 and 5, 0 being most strict, 5 being least strict.",
      "default": 2,
      "min": 0,
      "max": 5
    }
  ],
  "black-forest-labs/flux-2-flex/text-to-image": [
    {
      "name": "enable_prompt_expansion",
      "type": "boolean",
      "label": "Enable Prompt Expansion",
      "description": "Whether to use prompt upsampling to enhance the prompt before generation.",
      "default": true
    },
    {
      "name": "safety_tolerance",
      "type": "integer",
      "label": "Safety Tolerance",
      "description": "Tolerance level for input and output moderation. Between 0 and 5, 0 being most strict, 5 being least strict.",
      "default": 2,
      "min": 0,
      "max": 5
    }
  ],
  "black-forest-labs/flux-2-pro/edit": [
    {
      "name": "safety_tolerance",
      "type": "integer",
      "label": "Safety Tolerance",
      "description": "Tolerance level for input and output moderation. Between 0 and 5, 0 being most strict, 5 being least strict.",
      "default": 2,
      "min": 0,
      "max": 5
    }
  ],
  "black-forest-labs/flux-2-pro/text-to-image": [
    {
      "name": "safety_tolerance",
      "type": "integer",
      "label": "Safety Tolerance",
      "description": "Tolerance level for input and output moderation. Between 0 and 5, 0 being most strict, 5 being least strict.",
      "default": 2,
      "min": 0,
      "max": 5
    }
  ],
  "black-forest-labs/flux-dev-lora": [
    {
      "name": "num_images",
      "type": "integer",
      "label": "Num Images",
      "description": "Number of images to generate",
      "default": 1,
      "min": 1,
      "max": 4
    }
  ]
};
