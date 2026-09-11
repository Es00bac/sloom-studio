import {
  estimateImageModelCostUsd,
  getImageModelDefinition,
  type FirstClassImageProviderId,
  type ImageModelCostConfidence,
  type ImageModelOperation,
} from './imageProviderCapabilities';
import type { ImageOutputFormat, NodeData } from '../types/flow';
import type { AppLocale } from './i18n';

export interface ImageNodeTemplate {
  id: string;
  label: string;
  providerId: FirstClassImageProviderId;
  modelId: string;
  operation: ImageModelOperation;
  description: string;
  highlights: string[];
  dataPatch: Partial<NodeData>;
}

export interface ImageNodeOperationCostRow {
  operation: ImageModelOperation;
  label: string;
  estimateLabel: string;
  confidence: ImageModelCostConfidence;
  notes: string[];
}

const DEFAULT_OUTPUT_FORMAT: ImageOutputFormat = 'png';

const IMAGE_NODE_TEMPLATES: ImageNodeTemplate[] = [
  {
    id: 'gemini-reference-edit',
    label: 'Gemini Reference Edit',
    providerId: 'gemini',
    modelId: 'gemini-3-pro-image',
    operation: 'image-edit',
    description: 'Google image generation/editing with source and reference images.',
    highlights: ['source image', 'up to 14 references', 'Vertex/API key'],
    dataPatch: {
      mediaMode: 'generate',
      provider: 'gemini',
      modelId: 'gemini-3-pro-image',
      imageOutputFormat: DEFAULT_OUTPUT_FORMAT,
      customTitle: 'Gemini Reference Edit',
    },
  },
  {
    id: 'openai-mask-edit',
    label: 'OpenAI Mask Edit',
    providerId: 'openai',
    modelId: 'gpt-image-2',
    operation: 'mask-inpaint',
    description: 'OpenAI GPT Image edit node with source image and optional mask input.',
    highlights: ['source image', 'mask input', 'token estimate'],
    dataPatch: {
      mediaMode: 'generate',
      provider: 'openai',
      modelId: 'gpt-image-2',
      imageOperation: 'mask-inpaint',
      imageOutputFormat: DEFAULT_OUTPUT_FORMAT,
      customTitle: 'OpenAI Mask Edit',
    },
  },
  {
    id: 'huggingface-open-model',
    label: 'Hugging Face Open Image',
    providerId: 'huggingface',
    modelId: 'Qwen/Qwen-Image',
    operation: 'text-to-image',
    description: 'Open-model text-to-image through Hugging Face routing and monthly credits.',
    highlights: ['open model', 'provider routed', 'steps'],
    dataPatch: {
      mediaMode: 'generate',
      provider: 'huggingface',
      modelId: 'Qwen/Qwen-Image',
      steps: 30,
      imageOutputFormat: DEFAULT_OUTPUT_FORMAT,
      customTitle: 'HF Open Image',
    },
  },
  {
    id: 'bfl-flux2-reference',
    label: 'FLUX.2 Multi-Reference',
    providerId: 'bfl',
    modelId: 'flux-2-pro',
    operation: 'image-edit',
    description: 'BFL FLUX.2 Pro with up to eight reference images, exact color, and text-in-image controls.',
    highlights: ['8 references', 'exact color', 'text edits'],
    dataPatch: {
      mediaMode: 'generate',
      provider: 'bfl',
      modelId: 'flux-2-pro',
      imageOutputFormat: DEFAULT_OUTPUT_FORMAT,
      customTitle: 'FLUX.2 Multi-Reference',
    },
  },
  {
    id: 'stability-inpaint',
    label: 'Stability Inpaint',
    providerId: 'stability',
    modelId: 'stable-image-edit-inpaint',
    operation: 'mask-inpaint',
    description: 'True Stability AI mask-aware generative fill.',
    highlights: ['source image', 'mask required', 'fixed credits'],
    dataPatch: {
      mediaMode: 'generate',
      provider: 'stability',
      modelId: 'stable-image-edit-inpaint',
      imageOperation: 'mask-inpaint',
      imageOutputFormat: DEFAULT_OUTPUT_FORMAT,
      customTitle: 'Stability Inpaint',
    },
  },
  {
    id: 'stability-outpaint',
    label: 'Stability Outpaint',
    providerId: 'stability',
    modelId: 'stable-image-edit-outpaint',
    operation: 'outpaint',
    description: 'Expand canvas edges using Stability AI outpaint controls.',
    highlights: ['source image', 'margins', 'creativity'],
    dataPatch: {
      mediaMode: 'generate',
      provider: 'stability',
      modelId: 'stable-image-edit-outpaint',
      imageOperation: 'outpaint',
      imageOutpaintLeft: 256,
      imageOutpaintRight: 256,
      imageOutpaintUp: 0,
      imageOutpaintDown: 0,
      imageCreativity: 0.35,
      imageOutputFormat: DEFAULT_OUTPUT_FORMAT,
      customTitle: 'Stability Outpaint',
    },
  },
  {
    id: 'stability-erase',
    label: 'Stability Erase',
    providerId: 'stability',
    modelId: 'stable-image-edit-erase',
    operation: 'erase',
    description: 'Stability AI mask-aware erase for object cleanup and selective removal.',
    highlights: ['source image', 'mask required', 'fixed credits'],
    dataPatch: {
      mediaMode: 'generate',
      provider: 'stability',
      modelId: 'stable-image-edit-erase',
      imageOperation: 'erase',
      imageOutputFormat: DEFAULT_OUTPUT_FORMAT,
      customTitle: 'Stability Erase',
    },
  },
  {
    id: 'stability-search-replace',
    label: 'Stability Search Replace',
    providerId: 'stability',
    modelId: 'stable-image-edit-search-replace',
    operation: 'search-replace',
    description: 'Describe an object to find and replace it without painting a manual mask.',
    highlights: ['search prompt', 'source image', 'fixed credits'],
    dataPatch: {
      mediaMode: 'generate',
      provider: 'stability',
      modelId: 'stable-image-edit-search-replace',
      imageOperation: 'search-replace',
      imageOutputFormat: DEFAULT_OUTPUT_FORMAT,
      customTitle: 'Stability Search Replace',
    },
  },
  {
    id: 'stability-background-relight',
    label: 'Stability Background Relight',
    providerId: 'stability',
    modelId: 'stable-image-edit-replace-background-relight',
    operation: 'replace-background-relight',
    description: 'Replace a background and relight the foreground for product/composite work.',
    highlights: ['source image', 'background', 'relight'],
    dataPatch: {
      mediaMode: 'generate',
      provider: 'stability',
      modelId: 'stable-image-edit-replace-background-relight',
      imageOperation: 'replace-background-relight',
      imageOutputFormat: DEFAULT_OUTPUT_FORMAT,
      customTitle: 'Stability Background Relight',
    },
  },
  {
    id: 'local-open-qwen-edit',
    label: 'Local/Open Qwen Edit',
    providerId: 'localOpen',
    modelId: 'Qwen/Qwen-Image-Edit',
    operation: 'local-open-edit',
    description: 'Qwen-compatible local, LAN, or rented-GPU image edit endpoint.',
    highlights: ['local endpoint', 'source image', 'mask/reference'],
    dataPatch: {
      mediaMode: 'generate',
      provider: 'localOpen',
      modelId: 'Qwen/Qwen-Image-Edit',
      imageOperation: 'local-open-edit',
      imageOutputFormat: DEFAULT_OUTPUT_FORMAT,
      customTitle: 'Local/Open Qwen Edit',
    },
  },
];

const OPERATION_LABELS: Record<ImageModelOperation, string> = {
  'text-to-image': 'Generate',
  'image-edit': 'Edit',
  'mask-inpaint': 'Inpaint',
  outpaint: 'Outpaint',
  erase: 'Erase',
  'search-replace': 'Search replace',
  'search-recolor': 'Search recolor',
  'remove-background': 'Remove background',
  'replace-background-relight': 'Replace/relight',
  upscale: 'Upscale',
  'local-open-edit': 'Local/open edit',
};

const IMAGE_TEMPLATE_DESC_JA: Record<string, string> = {
  'gemini-reference-edit': 'ソース画像と参照画像を使った Google の画像生成／編集。',
  'openai-mask-edit': 'ソース画像と任意のマスク入力を使う OpenAI GPT Image 編集ノード。',
  'huggingface-open-model': 'Hugging Face のルーティングと月間クレジットによるオープンモデルのテキスト→画像。',
  'bfl-flux2-reference': '最大 8 枚の参照画像・正確な色・画像内テキスト制御に対応した BFL FLUX.2 Pro。',
  'stability-inpaint': '本物の Stability AI によるマスク対応の生成塗りつぶし。',
  'stability-outpaint': 'Stability AI のアウトペイント制御でキャンバスの端を拡張。',
  'stability-erase': 'オブジェクト除去や選択的削除のための Stability AI マスク対応消去。',
  'stability-search-replace': '手動でマスクを描かずに、対象を説明して検索・置換します。',
  'stability-background-relight': '背景を置き換え、前景をリライトして商品・合成向けに仕上げます。',
  'local-open-qwen-edit': 'Qwen 互換のローカル／LAN／レンタル GPU 画像編集エンドポイント。',
};

const IMAGE_TEMPLATE_HIGHLIGHT_JA: Record<string, string> = {
  'source image': 'ソース画像',
  'up to 14 references': '参照 最大 14 枚',
  'Vertex/API key': 'Vertex／API キー',
  'mask input': 'マスク入力',
  'token estimate': 'トークン見積り',
  'open model': 'オープンモデル',
  'provider routed': 'プロバイダー経由',
  steps: 'ステップ',
  '8 references': '参照 8 枚',
  'exact color': '正確な色',
  'text edits': 'テキスト編集',
  'mask required': 'マスク必須',
  'fixed credits': '固定クレジット',
  margins: '余白',
  creativity: '創造性',
  'search prompt': '検索プロンプト',
  background: '背景',
  relight: 'リライト',
  'mask/reference': 'マスク／参照',
  'local endpoint': 'ローカルエンドポイント',
};

export function imageNodeTemplateDescription(template: ImageNodeTemplate, locale: AppLocale = 'en'): string {
  return locale === 'ja' ? IMAGE_TEMPLATE_DESC_JA[template.id] ?? template.description : template.description;
}

export function imageNodeTemplateHighlight(tag: string, locale: AppLocale = 'en'): string {
  return locale === 'ja' ? IMAGE_TEMPLATE_HIGHLIGHT_JA[tag] ?? tag : tag;
}

export function listImageNodeTemplates(): ImageNodeTemplate[] {
  return IMAGE_NODE_TEMPLATES.map(cloneImageNodeTemplate);
}

export function getImageNodeTemplate(templateId: string): ImageNodeTemplate | undefined {
  const template = IMAGE_NODE_TEMPLATES.find((candidate) => candidate.id === templateId);
  return template ? cloneImageNodeTemplate(template) : undefined;
}

export function createImageNodeTemplateDataPatch(templateId: string): Partial<NodeData> {
  const template = getImageNodeTemplate(templateId);

  if (!template) {
    throw new Error(`Unknown image node template: ${templateId}`);
  }

  return {
    ...template.dataPatch,
    imageNodeTemplateId: template.id,
  };
}

export function getImageNodeOperationCostRows(
  providerId: FirstClassImageProviderId,
  modelId: string | undefined,
): ImageNodeOperationCostRow[] {
  const definition = getImageModelDefinition(providerId, modelId);

  return definition.supportedOperations.map((operation) => {
    const estimate = estimateImageModelCostUsd({
      providerId,
      modelId: definition.modelId,
      operation,
      imageCount: 1,
    });

    return {
      operation,
      label: OPERATION_LABELS[operation],
      estimateLabel: formatImageCostEstimate(estimate.costUsd, estimate.unitLabel),
      confidence: estimate.confidence,
      notes: estimate.notes,
    };
  });
}

export function getImageNodeCapabilityBadges(
  providerId: FirstClassImageProviderId,
  modelId: string | undefined,
): string[] {
  const definition = getImageModelDefinition(providerId, modelId);
  const { capabilities } = definition;
  const badges: string[] = [];

  if (capabilities.textToImage) badges.push('generate');
  if (capabilities.promptEdit) badges.push('prompt edit');
  if (capabilities.maskInpaint) badges.push('mask');
  if (capabilities.outpaint) badges.push('outpaint');
  if (capabilities.searchReplace) badges.push('search replace');
  if (capabilities.searchRecolor) badges.push('search recolor');
  if (capabilities.removeBackground) badges.push('background');
  if (capabilities.replaceBackgroundRelight) badges.push('relight');
  if (capabilities.referenceImages) badges.push(`${capabilities.maxReferenceImages} refs`);
  if (capabilities.exactColorControl) badges.push('exact color');
  if (capabilities.textInImageEditing) badges.push('text edits');
  if (capabilities.localEndpoint) badges.push('endpoint');

  return badges;
}

function cloneImageNodeTemplate(template: ImageNodeTemplate): ImageNodeTemplate {
  return {
    ...template,
    highlights: [...template.highlights],
    dataPatch: { ...template.dataPatch },
  };
}

function formatImageCostEstimate(costUsd: number | undefined, unitLabel: string): string {
  if (costUsd === undefined) {
    return unitLabel;
  }

  return `${formatUsd(costUsd)} (${unitLabel})`;
}

function formatUsd(value: number): string {
  if (value < 0.01) {
    return `$${value.toFixed(4)}`;
  }

  return `$${value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}`;
}
