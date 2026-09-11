// AUTO-GENERATED from live Atlas Cloud model schemas (verified 2026-06-28). Per-model OUTPUT-dimension
// contract: how each model accepts its output size. Do not hand-edit; regenerate from the schemas.
//  - { field: 'aspect_ratio', enum }           -> send aspect_ratio (snap to the nearest allowed ratio)
//  - { field: 'size', format: 'star'|'x', enum} -> send size as the nearest-ratio allowed "WxH"/"W*H"
//  - { field: 'size', format, free, min, max }  -> send size as a clamped "W*H"/"WxH"
//  - { field: 'size', format: 'tier', enum }    -> send a resolution tier ("1K"/"2K"/"4K"); aspect not settable
//  - { field: 'wh', min, max }                  -> send width + height integers
//  - { field: null }                            -> model has no output-size control (edit follows the source)
export interface AtlasDimensionSpec {
  field: 'aspect_ratio' | 'size' | 'image_size' | 'wh' | null;
  format?: 'star' | 'x' | 'tier';
  enum?: string[];
  free?: boolean;
  min?: number;
  max?: number;
}

export const ATLAS_IMAGE_DIMENSION_SPECS: Record<string, AtlasDimensionSpec> = {
  "microsoft/mai-image-2.5-flash/text-to-image": {
    "field": "size",
    "format": "star",
    "free": true,
    "min": 768,
    "max": 1360
  },
  "microsoft/mai-image-2.5/edit": {
    "field": null
  },
  "microsoft/mai-image-2.5/text-to-image": {
    "field": "size",
    "format": "star",
    "free": true,
    "min": 768,
    "max": 1360
  },
  "youchuan/v8.1/remove-background": {
    "field": null
  },
  "youchuan/v8.1/style-transfer": {
    "field": null
  },
  "youchuan/v8.1/blend": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "9:16",
      "16:9",
      "4:3",
      "3:4",
      "2:3",
      "3:2",
      "9:21",
      "21:9"
    ]
  },
  "youchuan/v8.1/image-to-image": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "9:16",
      "16:9",
      "4:3",
      "3:4",
      "2:3",
      "3:2",
      "9:21",
      "21:9"
    ]
  },
  "youchuan/v8.1/text-to-image": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "9:16",
      "16:9",
      "4:3",
      "3:4",
      "2:3",
      "3:2",
      "9:21",
      "21:9"
    ]
  },
  "google/nano-banana-2/reference-to-image": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "3:2",
      "2:3",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9"
    ]
  },
  "google/nano-banana-2/reference-to-image-developer": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "3:2",
      "2:3",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9"
    ]
  },
  "xai/grok-imagine-image-quality/text-to-image": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "3:4",
      "4:3",
      "9:16",
      "16:9",
      "2:3",
      "3:2",
      "9:19.5",
      "19.5:9",
      "9:20",
      "20:9",
      "1:2",
      "2:1"
    ]
  },
  "xai/grok-imagine-image-quality/edit": {
    "field": "aspect_ratio",
    "enum": [
      "auto",
      "1:1",
      "3:4",
      "4:3",
      "9:16",
      "16:9",
      "2:3",
      "3:2",
      "9:19.5",
      "19.5:9",
      "9:20",
      "20:9",
      "1:2",
      "2:1"
    ]
  },
  "openai/gpt-image-2/text-to-image": {
    "field": "size",
    "format": "x",
    "enum": [
      "1024x768",
      "768x1024",
      "1024x1024",
      "1024x1536",
      "1536x1024",
      "2560x1440",
      "1440x2560",
      "3840x2160",
      "2160x3840"
    ]
  },
  "openai/gpt-image-2/edit": {
    "field": "size",
    "format": "x",
    "enum": [
      "1024x1024",
      "1024x1536",
      "1536x1024",
      "2048x2048",
      "2048x1152",
      "3840x2160",
      "2160x3840"
    ]
  },
  "baidu/ERNIE-Image-Turbo/text-to-image": {
    "field": "size",
    "format": "x",
    "enum": [
      "1024x1024",
      "1376x768",
      "1264x848",
      "1200x896",
      "896x1200",
      "848x1264",
      "768x1376"
    ]
  },
  "alibaba/wan-2.7/text-to-image": {
    "field": "size",
    "format": "tier",
    "enum": [
      "1K",
      "2K"
    ]
  },
  "alibaba/wan-2.7/image-edit": {
    "field": "size",
    "format": "tier",
    "enum": [
      "1K",
      "2K"
    ]
  },
  "alibaba/wan-2.7-pro/text-to-image": {
    "field": "size",
    "format": "tier",
    "enum": [
      "1K",
      "2K",
      "4K"
    ]
  },
  "alibaba/wan-2.7-pro/image-edit": {
    "field": "size",
    "format": "tier",
    "enum": [
      "1K",
      "2K"
    ]
  },
  "google/nano-banana-2/text-to-image-developer": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "3:2",
      "2:3",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9"
    ]
  },
  "google/nano-banana-2/text-to-image": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "3:2",
      "2:3",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9"
    ]
  },
  "google/nano-banana-2/edit-developer": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "3:2",
      "2:3",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9"
    ]
  },
  "google/nano-banana-2/edit": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "3:2",
      "2:3",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9"
    ]
  },
  "qwen/qwen-image-2.0/text-to-image": {
    "field": "size",
    "format": "star",
    "free": true,
    "min": 512,
    "max": 2048
  },
  "qwen/qwen-image-2.0/edit": {
    "field": "size",
    "format": "star",
    "free": true,
    "min": 512,
    "max": 2048
  },
  "qwen/qwen-image-2.0-pro/edit": {
    "field": "size",
    "format": "star",
    "free": true,
    "min": 512,
    "max": 2048
  },
  "qwen/qwen-image-2.0-pro/text-to-image": {
    "field": "size",
    "format": "star",
    "free": true,
    "min": 512,
    "max": 2048
  },
  "bytedance/seedream-v5.0-lite/edit-sequential": {
    "field": "size",
    "format": "star",
    "enum": [
      "2048*2048",
      "2304*1728",
      "1728*2304",
      "2848*1600",
      "1600*2848",
      "2496*1664",
      "1664*2496",
      "3136*1344",
      "3072*3072",
      "3456*2592",
      "2592*3456",
      "4096*2304",
      "2304*4096",
      "2496*3744",
      "3744*2496",
      "4704*2016"
    ]
  },
  "bytedance/seedream-v5.0-lite/sequential": {
    "field": "size",
    "format": "star",
    "enum": [
      "2048*2048",
      "2304*1728",
      "1728*2304",
      "2848*1600",
      "1600*2848",
      "2496*1664",
      "1664*2496",
      "3136*1344",
      "3072*3072",
      "3456*2592",
      "2592*3456",
      "4096*2304",
      "2304*4096",
      "2496*3744",
      "3744*2496",
      "4704*2016"
    ]
  },
  "bytedance/seedream-v5.0-lite/edit": {
    "field": "size",
    "format": "star",
    "enum": [
      "2048*2048",
      "2304*1728",
      "1728*2304",
      "2848*1600",
      "1600*2848",
      "2496*1664",
      "1664*2496",
      "3136*1344",
      "3072*3072",
      "3456*2592",
      "2592*3456",
      "4096*2304",
      "2304*4096",
      "2496*3744",
      "3744*2496",
      "4704*2016"
    ]
  },
  "bytedance/seedream-v5.0-lite": {
    "field": "size",
    "format": "star",
    "enum": [
      "2048*2048",
      "2304*1728",
      "1728*2304",
      "2848*1600",
      "1600*2848",
      "2496*1664",
      "1664*2496",
      "3136*1344",
      "3072*3072",
      "3456*2592",
      "2592*3456",
      "4096*2304",
      "2304*4096",
      "2496*3744",
      "3744*2496",
      "4704*2016"
    ]
  },
  "openai/gpt-image-1.5/text-to-image": {
    "field": "size",
    "format": "x",
    "enum": [
      "1024x1024",
      "1024x1536",
      "1536x1024"
    ]
  },
  "openai/gpt-image-1.5/edit": {
    "field": "size",
    "format": "x",
    "enum": [
      "1024x1024",
      "1024x1536",
      "1536x1024"
    ]
  },
  "alibaba/qwen-image/edit-plus-20251215": {
    "field": "size",
    "format": "star",
    "free": true,
    "min": 512,
    "max": 2048
  },
  "alibaba/wan-2.6/image-edit": {
    "field": "size",
    "format": "star",
    "enum": [
      "576*1344",
      "720*1280",
      "720*1680",
      "768*1024",
      "800*1200",
      "816*1904",
      "936*1664",
      "960*1280",
      "960*1440",
      "1024*768",
      "1024*1024",
      "1040*1560",
      "1104*1472",
      "1200*800",
      "1280*720",
      "1280*960",
      "1280*1280",
      "1344*576",
      "1440*960",
      "1472*1104",
      "1560*1040",
      "1664*936",
      "1680*720",
      "1904*816"
    ]
  },
  "z-image/turbo": {
    "field": "size",
    "format": "star",
    "free": true,
    "min": 512,
    "max": 2048
  },
  "openai/gpt-image-1/text-to-image": {
    "field": "size",
    "format": "x",
    "enum": [
      "1024x1024",
      "1024x1536",
      "1536x1024"
    ]
  },
  "openai/gpt-image-1/edit": {
    "field": "size",
    "format": "x",
    "enum": [
      "1024x1024",
      "1024x1536",
      "1536x1024"
    ]
  },
  "openai/gpt-image-1-mini/text-to-image": {
    "field": "size",
    "format": "x",
    "enum": [
      "1024x1024",
      "1024x1536",
      "1536x1024"
    ]
  },
  "openai/gpt-image-1-mini/edit": {
    "field": "size",
    "format": "x",
    "enum": [
      "1024x1024",
      "1024x1536",
      "1536x1024"
    ]
  },
  "bytedance/seedream-v4.5": {
    "field": "size",
    "format": "star",
    "enum": [
      "2048*2048",
      "2304*1728",
      "1728*2304",
      "2848*1600",
      "1600*2848",
      "2496*1664",
      "1664*2496",
      "3136*1344",
      "4096*4096",
      "4704*3520",
      "3520*4704",
      "5504*3040",
      "3040*5504",
      "4992*3328",
      "3328*4992",
      "6240*2656"
    ]
  },
  "bytedance/seedream-v4.5/edit": {
    "field": "size",
    "format": "star",
    "enum": [
      "2048*2048",
      "2304*1728",
      "1728*2304",
      "2848*1600",
      "1600*2848",
      "2496*1664",
      "1664*2496",
      "3136*1344",
      "4096*4096",
      "4704*3520",
      "3520*4704",
      "5504*3040",
      "3040*5504",
      "4992*3328",
      "3328*4992",
      "6240*2656"
    ]
  },
  "bytedance/seedream-v4.5/sequential": {
    "field": "size",
    "format": "star",
    "enum": [
      "2048*2048",
      "2304*1728",
      "1728*2304",
      "2848*1600",
      "1600*2848",
      "2496*1664",
      "1664*2496",
      "3136*1344",
      "4096*4096",
      "4704*3520",
      "3520*4704",
      "5504*3040",
      "3040*5504",
      "4992*3328",
      "3328*4992",
      "6240*2656"
    ]
  },
  "bytedance/seedream-v4.5/edit-sequential": {
    "field": "size",
    "format": "star",
    "enum": [
      "2048*2048",
      "2304*1728",
      "1728*2304",
      "2848*1600",
      "1600*2848",
      "2496*1664",
      "1664*2496",
      "3136*1344",
      "4096*4096",
      "4704*3520",
      "3520*4704",
      "5504*3040",
      "3040*5504",
      "4992*3328",
      "3328*4992",
      "6240*2656"
    ]
  },
  "atlascloud/qwen-image/edit": {
    "field": null
  },
  "google/nano-banana-pro/text-to-image-ultra": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "3:2",
      "2:3",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9"
    ]
  },
  "google/nano-banana-pro/edit-ultra": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "3:2",
      "2:3",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9"
    ]
  },
  "google/nano-banana-pro/text-to-image": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "3:2",
      "2:3",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9"
    ]
  },
  "alibaba/qwen-image/text-to-image-max": {
    "field": "size",
    "format": "star",
    "enum": [
      "1664*928",
      "1472*1104",
      "1328*1328",
      "1104*1472",
      "928*1664"
    ]
  },
  "alibaba/qwen-image/text-to-image-plus": {
    "field": "size",
    "format": "star",
    "enum": [
      "1664*928",
      "1472*1104",
      "1328*1328",
      "1104*1472",
      "928*1664"
    ]
  },
  "google/nano-banana-pro/edit": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "3:2",
      "2:3",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9"
    ]
  },
  "xai/grok-imagine-image/edit": {
    "field": "aspect_ratio",
    "enum": [
      "auto",
      "1:1",
      "3:4",
      "4:3",
      "9:16",
      "16:9",
      "2:3",
      "3:2",
      "9:19.5",
      "19.5:9",
      "9:20",
      "20:9",
      "1:2",
      "2:1"
    ]
  },
  "xai/grok-imagine-image/text-to-image": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "3:4",
      "4:3",
      "9:16",
      "16:9",
      "2:3",
      "3:2",
      "9:19.5",
      "19.5:9",
      "9:20",
      "20:9",
      "1:2",
      "2:1"
    ]
  },
  "openai/gpt-image-2-developer/edit": {
    "field": "size",
    "format": "x",
    "enum": [
      "1024x1024",
      "1024x1536",
      "1536x1024",
      "2048x2048",
      "2048x1152",
      "3840x2160",
      "2160x3840"
    ]
  },
  "alibaba/wan-2.5/image-edit": {
    "field": "size",
    "format": "star",
    "enum": [
      "576*1344",
      "720*1280",
      "720*1680",
      "768*1024",
      "800*1200",
      "816*1904",
      "936*1664",
      "960*1280",
      "960*1440",
      "1024*768",
      "1024*1024",
      "1040*1560",
      "1104*1472",
      "1200*800",
      "1280*720",
      "1280*960",
      "1280*1280",
      "1344*576",
      "1440*960",
      "1472*1104",
      "1560*1040",
      "1664*936",
      "1680*720",
      "1904*816"
    ]
  },
  "openai/gpt-image-2-developer/text-to-image": {
    "field": "size",
    "format": "x",
    "enum": [
      "1024x768",
      "768x1024",
      "1024x1024",
      "1024x1536",
      "1536x1024",
      "2560x1440",
      "1440x2560",
      "3840x2160",
      "2160x3840"
    ]
  },
  "alibaba/wan-2.5/text-to-image": {
    "field": "size",
    "format": "star",
    "enum": [
      "576*1344",
      "720*1280",
      "720*1680",
      "768*1024",
      "800*1200",
      "936*2184",
      "960*1280",
      "960*1440",
      "1024*768",
      "1024*1024",
      "1080*1920",
      "1168*1752",
      "1200*800",
      "1200*1600",
      "1224*1632",
      "1280*720",
      "1280*960",
      "1280*1280",
      "1344*576",
      "1440*960",
      "1440*1440",
      "1600*1200",
      "1632*1224",
      "1680*720",
      "1752*1168",
      "1920*1080",
      "2184*936"
    ]
  },
  "bytedance/seedream-v4": {
    "field": "size",
    "format": "star",
    "free": true,
    "min": 1024,
    "max": 4096
  },
  "bytedance/seedream-v4/sequential": {
    "field": "size",
    "format": "star",
    "free": true,
    "min": 1024,
    "max": 4096
  },
  "google/nano-banana-pro/text-to-image-developer": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "3:2",
      "2:3",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9"
    ]
  },
  "google/nano-banana/text-to-image-developer": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "3:2",
      "2:3",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9"
    ]
  },
  "bytedance/seedream-v4/edit": {
    "field": "size",
    "format": "star",
    "free": true,
    "min": 1024,
    "max": 4096
  },
  "alibaba/qwen-image/edit": {
    "field": null
  },
  "alibaba/qwen-image/edit-plus": {
    "field": "size",
    "format": "star",
    "free": true,
    "min": 512,
    "max": 2048
  },
  "alibaba/wan-2.6/text-to-image": {
    "field": "size",
    "format": "star",
    "enum": [
      "576*1344",
      "720*1280",
      "720*1680",
      "768*1024",
      "800*1200",
      "936*2184",
      "960*1280",
      "960*1440",
      "1024*768",
      "1024*1024",
      "1080*1920",
      "1168*1752",
      "1200*800",
      "1200*1600",
      "1224*1632",
      "1280*720",
      "1280*960",
      "1280*1280",
      "1344*576",
      "1440*960",
      "1440*1440",
      "1600*1200",
      "1632*1224",
      "1680*720",
      "1752*1168",
      "1920*1080",
      "2184*936"
    ]
  },
  "google/nano-banana-pro/edit-developer": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "3:2",
      "2:3",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9"
    ]
  },
  "google/nano-banana/edit-developer": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "3:2",
      "2:3",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9"
    ]
  },
  "bytedance/seedream-v4/edit-sequential": {
    "field": "size",
    "format": "star",
    "free": true,
    "min": 1024,
    "max": 4096
  },
  "google/nano-banana/text-to-image": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "3:2",
      "2:3",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9"
    ]
  },
  "google/nano-banana/edit": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "3:2",
      "2:3",
      "3:4",
      "4:3",
      "4:5",
      "5:4",
      "9:16",
      "16:9",
      "21:9"
    ]
  },
  "google/imagen3": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4"
    ]
  },
  "google/imagen3-fast": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4"
    ]
  },
  "atlascloud/qwen-image/text-to-image": {
    "field": "size",
    "format": "star",
    "free": true,
    "min": 512,
    "max": 2048
  },
  "google/imagen4-fast": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4"
    ]
  },
  "atlascloud/image-upscaler": {
    "field": null
  },
  "black-forest-labs/flux-dev": {
    "field": "size",
    "format": "star",
    "free": true,
    "min": 256,
    "max": 2048
  },
  "black-forest-labs/flux-kontext-dev": {
    "field": "size",
    "format": "star",
    "free": true,
    "min": 256,
    "max": 2048
  },
  "google/imagen4-ultra": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4"
    ]
  },
  "google/imagen4": {
    "field": "aspect_ratio",
    "enum": [
      "1:1",
      "16:9",
      "9:16",
      "4:3",
      "3:4"
    ]
  },
  "black-forest-labs/flux-kontext-dev-lora": {
    "field": "size",
    "format": "star",
    "free": true,
    "min": 256,
    "max": 1536
  },
  "black-forest-labs/flux-schnell": {
    "field": "size",
    "format": "star",
    "free": true,
    "min": 256,
    "max": 2048
  },
  "microsoft/mai-image-2.5-flash/edit": {
    "field": null
  },
  "black-forest-labs/flux-2-flex/edit": {
    "field": "size",
    "format": "star",
    "free": true,
    "min": 256,
    "max": 2048
  },
  "black-forest-labs/flux-2-flex/text-to-image": {
    "field": "size",
    "format": "star",
    "free": true,
    "min": 256,
    "max": 2048
  },
  "black-forest-labs/flux-2-pro/edit": {
    "field": "size",
    "format": "star",
    "free": true,
    "min": 256,
    "max": 2048
  },
  "black-forest-labs/flux-2-pro/text-to-image": {
    "field": "size",
    "format": "star",
    "free": true,
    "min": 256,
    "max": 2048
  },
  "black-forest-labs/flux-dev-lora": {
    "field": "size",
    "format": "star",
    "free": true,
    "min": 256,
    "max": 2048
  }
};
