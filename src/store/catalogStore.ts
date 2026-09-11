import { create } from 'zustand';
import {
  buildEmptyModelCatalog,
  cloneModelCatalog,
  FALLBACK_MODEL_OPTIONS,
  FALLBACK_VOICE_OPTIONS,
  VESTIGIAL_MODEL_IDS,
} from '../lib/providerCatalog';
import { normalizeGeminiVideoModelId } from '../lib/videoModelSupport';
import { getProviderModelContract, type ProviderModelContract } from '../lib/providerModelContracts';
import { TEXT_MODEL_CONTRACTS } from '../lib/modelContracts/textModelContracts';
import { IMAGE_MODEL_CONTRACTS } from '../lib/modelContracts/imageModelContractAdapter';
import { VIDEO_MODEL_CONTRACTS } from '../lib/modelContracts/videoModelContracts';
import { AUDIO_MODEL_CONTRACTS } from '../lib/modelContracts/audioModelContracts';
import type {
  ModelCatalog,
  RuntimeSettingsSnapshot,
  SelectOption,
  VoiceOption,
} from '../types/flow';

interface CatalogState {
  modelCatalog: ModelCatalog;
  elevenLabsVoices: VoiceOption[];
  isRefreshing: boolean;
  refreshError?: string;
  lastRefreshedAt?: string;
  refreshCatalogs: (settings: RuntimeSettingsSnapshot) => Promise<void>;
}

export interface GeminiModelRecord {
  name?: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
}

export interface OpenAIModelRecord {
  id?: string;
}

interface ElevenLabsModelRecord {
  model_id?: string;
  modelId?: string;
  name?: string;
  description?: string;
  can_do_text_to_speech?: boolean;
  canDoTextToSpeech?: boolean;
  can_do_voice_conversion?: boolean;
  canDoVoiceConversion?: boolean;
  can_do_text_to_sound_effects?: boolean;
  canDoTextToSoundEffects?: boolean;
  can_do_music?: boolean;
  canDoMusic?: boolean;
}

interface ElevenLabsVoiceRecord {
  voice_id?: string;
  voiceId?: string;
  name?: string;
  category?: string;
  preview_url?: string;
  previewUrl?: string;
}

function dedupeOptions(options: SelectOption[]): SelectOption[] {
  const seen = new Set<string>();
  const deduped: SelectOption[] = [];

  for (const option of options) {
    if (seen.has(option.value)) {
      continue;
    }

    seen.add(option.value);
    deduped.push(option);
  }

  return deduped;
}

function dedupeVoices(options: VoiceOption[]): VoiceOption[] {
  const seen = new Set<string>();
  const deduped: VoiceOption[] = [];

  for (const option of options) {
    if (seen.has(option.value)) {
      continue;
    }

    seen.add(option.value);
    deduped.push(option);
  }

  return deduped;
}

async function fetchGeminiModels(apiKey: string): Promise<ModelCatalog> {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
    headers: {
      'x-goog-api-key': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Gemini model discovery failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as { models?: GeminiModelRecord[] };
  const catalog = buildEmptyModelCatalog();

  for (const model of payload.models ?? []) {
    addGeminiModelRecordToCatalog(catalog, model);
  }

  catalog.text.gemini = dedupeOptions(catalog.text.gemini);
  catalog.image.gemini = dedupeOptions(catalog.image.gemini);
  catalog.video.gemini = dedupeOptions(catalog.video.gemini);
  catalog.audio.gemini = dedupeOptions(catalog.audio.gemini);

  return catalog;
}

export function addGeminiModelRecordToCatalog(catalog: ModelCatalog, model: GeminiModelRecord): void {
  const modelName = model.name?.replace(/^models\//, '').trim();

  if (!modelName) {
    return;
  }

  const lowerName = modelName.toLowerCase();
  const normalizedModelName = lowerName.startsWith('veo-')
    ? normalizeGeminiVideoModelId(modelName)
    : modelName;
  const option: SelectOption = {
    value: normalizedModelName,
    label: model.displayName?.trim() || normalizedModelName,
    description: model.description?.trim(),
  };

  if (lowerName.includes('omni') && lowerName.startsWith('gemini-')) {
    catalog.video.gemini.push(option);
    return;
  }

  if (lowerName.startsWith('veo-')) {
    catalog.video.gemini.push(option);
    return;
  }

  if (lowerName.includes('image') || lowerName.startsWith('imagen-')) {
    catalog.image.gemini.push(option);
    return;
  }

  if (lowerName.startsWith('gemini-')) {
    if (lowerName.includes('tts')) {
      catalog.audio.gemini.push(option);
      return;
    }

    catalog.text.gemini.push(option);
  }
}

type OpenAICompatibleCatalogProvider = 'openai' | 'atlas';

async function fetchOpenAIModels(
  apiKey: string,
  baseUrl: string,
  provider: OpenAICompatibleCatalogProvider = 'openai',
): Promise<ModelCatalog> {
  const normalizedBaseUrl = baseUrl.trim() || 'https://api.openai.com/v1';
  const response = await fetch(`${normalizedBaseUrl.replace(/\/$/, '')}/models`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    throw new Error(`${provider === 'atlas' ? 'Atlas' : 'OpenAI'} model discovery failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as { data?: OpenAIModelRecord[] };
  const catalog = buildEmptyModelCatalog();

  for (const model of payload.data ?? []) {
    addOpenAICompatibleModelRecordToCatalog(catalog, model, provider);
  }

  catalog.text.openai = dedupeOptions(catalog.text.openai);
  catalog.image.openai = dedupeOptions(catalog.image.openai);
  catalog.image.atlas = dedupeOptions(catalog.image.atlas);
  catalog.video.atlas = dedupeOptions(catalog.video.atlas);

  return catalog;
}

export function addOpenAICompatibleModelRecordToCatalog(
  catalog: ModelCatalog,
  model: OpenAIModelRecord,
  provider: OpenAICompatibleCatalogProvider = 'openai',
): void {
  const modelId = model.id?.trim();

  if (!modelId) {
    return;
  }

  const option: SelectOption = {
    value: modelId,
    label: modelId,
  };
  const lowerId = modelId.toLowerCase();

  if (provider === 'atlas') {
    if (isAtlasDiscoverableVideoModelId(lowerId)) {
      catalog.video.atlas.push(option);
      return;
    }
    if (isAtlasDiscoverableImageModelId(lowerId)) {
      catalog.image.atlas.push(option);
    }
    return;
  }

  if (lowerId.includes('image')) {
    catalog.image.openai.push(option);
    return;
  }

  if (
    lowerId.includes('embedding') ||
    lowerId.includes('moderation') ||
    lowerId.includes('transcribe') ||
    lowerId.includes('whisper') ||
    lowerId.includes('tts')
  ) {
    return;
  }

  catalog.text.openai.push(option);
}

function isAtlasDiscoverableVideoModelId(lowerId: string): boolean {
  return lowerId.includes('video') || lowerId.includes('veo') || lowerId.includes('seedance');
}

function isAtlasDiscoverableImageModelId(lowerId: string): boolean {
  return (
    lowerId.includes('image') ||
    lowerId.includes('flux') ||
    lowerId.includes('kontext') ||
    lowerId.includes('seedream') ||
    lowerId.includes('banana') ||
    lowerId.includes('qwen') ||
    lowerId.includes('firered') ||
    lowerId.includes('z-image') ||
    lowerId.includes('stable-diffusion')
  );
}

function isAtlasNativeDiscoveryBaseUrl(baseUrl: string | undefined): boolean {
  const normalized = (baseUrl ?? '').trim().replace(/\/$/, '').toLowerCase();
  return !normalized || normalized === 'https://api.atlascloud.ai/api/v1';
}

async function fetchElevenLabsModels(apiKey: string): Promise<SelectOption[]> {
  const response = await fetch('https://api.elevenlabs.io/v1/models', {
    headers: {
      'xi-api-key': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs model discovery failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as ElevenLabsModelRecord[] | { models?: ElevenLabsModelRecord[] };
  const models = Array.isArray(payload) ? payload : payload.models ?? [];

  return dedupeOptions(
    models
      .filter((model) => {
        const supportsTts = model.can_do_text_to_speech ?? model.canDoTextToSpeech;
        const supportsVoiceConversion = model.can_do_voice_conversion ?? model.canDoVoiceConversion;
        const supportsSoundEffects = model.can_do_text_to_sound_effects ?? model.canDoTextToSoundEffects;
        const supportsMusic = model.can_do_music ?? model.canDoMusic;
        const modelId = (model.model_id ?? model.modelId ?? '').trim();

        if (VESTIGIAL_MODEL_ID_SET.has(modelId)) return false;
        if (modelId === 'music_v2') return true;

        if (typeof supportsTts === 'boolean') {
          return supportsTts || Boolean(supportsVoiceConversion) || Boolean(supportsSoundEffects) || Boolean(supportsMusic);
        }

        return modelId.startsWith('eleven_');
      })
      .map((model) => ({
        value: (model.model_id ?? model.modelId ?? '').trim(),
        label: model.name?.trim() || (model.model_id ?? model.modelId ?? '').trim(),
        description: model.description?.trim(),
      }))
      .filter((option) => option.value),
  );
}

async function fetchElevenLabsVoices(apiKey: string): Promise<VoiceOption[]> {
  const response = await fetch('https://api.elevenlabs.io/v1/voices', {
    headers: {
      'xi-api-key': apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`ElevenLabs voice discovery failed with status ${response.status}.`);
  }

  const payload = (await response.json()) as { voices?: ElevenLabsVoiceRecord[] };

  return dedupeVoices(
    (payload.voices ?? [])
      .map((voice) => ({
        value: (voice.voice_id ?? voice.voiceId ?? '').trim(),
        label: voice.name?.trim() || (voice.voice_id ?? voice.voiceId ?? '').trim(),
        category: voice.category?.trim(),
        previewUrl: voice.preview_url ?? voice.previewUrl,
      }))
      .filter((option) => option.value)
      .sort((left, right) => left.label.localeCompare(right.label)),
  );
}

const MODEL_CONTRACTS_BY_CAPABILITY: Record<keyof ModelCatalog, readonly ProviderModelContract[]> = {
  text: TEXT_MODEL_CONTRACTS,
  image: IMAGE_MODEL_CONTRACTS,
  video: VIDEO_MODEL_CONTRACTS,
  audio: AUDIO_MODEL_CONTRACTS,
};

const VESTIGIAL_MODEL_ID_SET = new Set<string>(VESTIGIAL_MODEL_IDS);

function mergeDiscoveredOptions(
  curated: SelectOption[],
  discovered: SelectOption[] | undefined,
  capability: keyof ModelCatalog,
  providerId: string,
): SelectOption[] {
  const allowed = (discovered ?? []).filter((option) => {
    if (VESTIGIAL_MODEL_ID_SET.has(option.value)) return false;
    const contract = getProviderModelContract(
      MODEL_CONTRACTS_BY_CAPABILITY[capability],
      providerId,
      option.value,
    );
    return !contract || (
      contract.lifecycle !== 'deprecated'
      && contract.lifecycle !== 'shutdown'
      && contract.availability !== 'unavailable'
    );
  });
  return dedupeOptions([...curated, ...allowed]);
}

export function mergeCatalog(target: ModelCatalog, partial: Partial<ModelCatalog>): ModelCatalog {
  const merged = cloneModelCatalog(target);

  merged.text.gemini = mergeDiscoveredOptions(target.text.gemini, partial.text?.gemini, 'text', 'gemini');
  merged.text.openai = mergeDiscoveredOptions(target.text.openai, partial.text?.openai, 'text', 'openai');
  merged.text.huggingface = mergeDiscoveredOptions(target.text.huggingface, partial.text?.huggingface, 'text', 'huggingface');
  merged.image.gemini = mergeDiscoveredOptions(target.image.gemini, partial.image?.gemini, 'image', 'gemini');
  merged.image.openai = mergeDiscoveredOptions(target.image.openai, partial.image?.openai, 'image', 'openai');
  merged.image.atlas = mergeDiscoveredOptions(target.image.atlas, partial.image?.atlas, 'image', 'atlas');
  merged.image.huggingface = mergeDiscoveredOptions(target.image.huggingface, partial.image?.huggingface, 'image', 'huggingface');
  merged.video.gemini = mergeDiscoveredOptions(target.video.gemini, partial.video?.gemini, 'video', 'gemini');
  merged.video.huggingface = mergeDiscoveredOptions(target.video.huggingface, partial.video?.huggingface, 'video', 'huggingface');
  merged.video.atlas = mergeDiscoveredOptions(target.video.atlas, partial.video?.atlas, 'video', 'atlas');
  merged.audio.gemini = mergeDiscoveredOptions(target.audio.gemini, partial.audio?.gemini, 'audio', 'gemini');
  merged.audio.elevenlabs = mergeDiscoveredOptions(target.audio.elevenlabs, partial.audio?.elevenlabs, 'audio', 'elevenlabs');
  merged.audio.huggingface = mergeDiscoveredOptions(target.audio.huggingface, partial.audio?.huggingface, 'audio', 'huggingface');

  return merged;
}

export const useCatalogStore = create<CatalogState>()((set) => ({
  modelCatalog: cloneModelCatalog(FALLBACK_MODEL_OPTIONS),
  elevenLabsVoices: [...FALLBACK_VOICE_OPTIONS],
  isRefreshing: false,
  refreshError: undefined,
  lastRefreshedAt: undefined,
  refreshCatalogs: async (settings) => {
    const nextCatalog = cloneModelCatalog(FALLBACK_MODEL_OPTIONS);
    let nextVoices = [...FALLBACK_VOICE_OPTIONS];
    const errors: string[] = [];

    set({ isRefreshing: true, refreshError: undefined });

    if (settings.apiKeys.gemini.trim()) {
      try {
        const partial = await fetchGeminiModels(settings.apiKeys.gemini.trim());
        Object.assign(nextCatalog, mergeCatalog(nextCatalog, partial));
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'Gemini catalog refresh failed.');
      }
    }

    if (settings.apiKeys.openai.trim()) {
      try {
        const partial = await fetchOpenAIModels(
          settings.apiKeys.openai.trim(),
          settings.providerSettings.openaiBaseUrl,
        );
        Object.assign(nextCatalog, mergeCatalog(nextCatalog, partial));
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'OpenAI catalog refresh failed.');
      }
    }

    if (settings.apiKeys.atlas?.trim()) {
      // Attempt discovery against the native Atlas API (or a custom OpenAI-compatible base);
      // failures are non-fatal because the curated seed already covers the defaults.
      const atlasBase = isAtlasNativeDiscoveryBaseUrl(settings.providerSettings.atlasBaseUrl)
        ? 'https://api.atlascloud.ai/api/v1'
        : settings.providerSettings.atlasBaseUrl ?? '';
      try {
        const partial = await fetchOpenAIModels(settings.apiKeys.atlas.trim(), atlasBase, 'atlas');
        Object.assign(nextCatalog, mergeCatalog(nextCatalog, partial));
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'Atlas catalog refresh failed.');
      }
    }

    if (settings.apiKeys.elevenlabs.trim()) {
      try {
        nextCatalog.audio.elevenlabs = mergeDiscoveredOptions(
          nextCatalog.audio.elevenlabs,
          await fetchElevenLabsModels(settings.apiKeys.elevenlabs.trim()),
          'audio',
          'elevenlabs',
        );
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'ElevenLabs model catalog refresh failed.');
      }

      try {
        nextVoices = await fetchElevenLabsVoices(settings.apiKeys.elevenlabs.trim());
      } catch (error) {
        errors.push(error instanceof Error ? error.message : 'ElevenLabs voice catalog refresh failed.');
      }
    }

    set({
      modelCatalog: nextCatalog,
      elevenLabsVoices: nextVoices,
      isRefreshing: false,
      refreshError: errors.length > 0 ? errors.join(' ') : undefined,
      lastRefreshedAt: new Date().toISOString(),
    });
  },
}));
