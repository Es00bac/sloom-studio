export type VideoPlanningProviderId = 'vertex' | 'atlas-cloud';
export type VideoPlanningExecutionState = 'planning-only';
export type VideoPlanningCredentialMode = 'unsupported-no-credential-execution';
export type VideoPlanningCostConfidence = 'placeholder';
export type VideoPlanningRiskLevel = 'unverified-provider-contract';
export type VideoCapabilityTag =
  | 'text-to-video'
  | 'image-to-video'
  | 'video-to-video'
  | 'reference-to-video'
  | 'first-frame'
  | 'last-frame'
  | 'native-audio'
  | 'multi-shot'
  | 'fast-lane'
  | '1080p'
  | '720p';

export interface VideoProviderDescriptor {
  id: VideoPlanningProviderId;
  displayName: string;
  executionState: VideoPlanningExecutionState;
  credentialMode: VideoPlanningCredentialMode;
  summary: string;
  caveats: string[];
}

export interface VideoNodeInputDescriptor {
  id: string;
  label: string;
  kind: 'text' | 'image' | 'video' | 'audio';
  required: boolean;
  description: string;
}

export interface VideoNodeOutputDescriptor {
  kind: 'video';
  mimeTypes: string[];
  description: string;
}

export interface VideoNodeCostDescriptor {
  billingType: 'provider-priced-placeholder';
  confidence: VideoPlanningCostConfidence;
  summary: string;
}

export interface VideoNodeRiskDescriptor {
  level: VideoPlanningRiskLevel;
  summary: string;
}

export interface VideoProviderModelNodeDescriptor {
  id: string;
  providerId: VideoPlanningProviderId;
  displayName: string;
  capabilityTags: VideoCapabilityTag[];
  executionState: VideoPlanningExecutionState;
  credentialMode: VideoPlanningCredentialMode;
  inputs: VideoNodeInputDescriptor[];
  output: VideoNodeOutputDescriptor;
  cost: VideoNodeCostDescriptor;
  risk: VideoNodeRiskDescriptor;
  caveats: string[];
}

const PLANNING_ONLY_CAVEATS = [
  'Planning descriptor only; Atlas Cloud video execution is not wired in this workspace.',
  'No browser-safe Atlas Cloud credential flow is attached here; execution remains unsupported until a separate provider bridge is implemented.',
] as const;

const VIDEO_PROVIDER_DESCRIPTORS: VideoProviderDescriptor[] = [
  {
    id: 'vertex',
    displayName: 'Vertex AI',
    executionState: 'planning-only',
    credentialMode: 'unsupported-no-credential-execution',
    summary: 'Vertex is cataloged here as a bounded planning target for future Veo-family node integration.',
    caveats: [
      'Provider descriptor only; no Vertex video node execution is exposed from this helper.',
      'Credential handling, job submission, polling, and asset hydration stay outside this planning catalog.',
    ],
  },
  {
    id: 'atlas-cloud',
    displayName: 'Atlas Cloud',
    executionState: 'planning-only',
    credentialMode: 'unsupported-no-credential-execution',
    summary: 'Atlas Cloud is cataloged as a bounded planning target for future multi-model video node integration.',
    caveats: [...PLANNING_ONLY_CAVEATS],
  },
];

const VIDEO_PROVIDER_MODEL_NODE_DESCRIPTORS: VideoProviderModelNodeDescriptor[] = [
  {
    id: 'atlas-cloud-seedance-2-text-to-video',
    providerId: 'atlas-cloud',
    displayName: 'Atlas Seedance 2.0 Text-to-Video',
    capabilityTags: ['text-to-video', 'native-audio', 'multi-shot', '720p'],
    executionState: 'planning-only',
    credentialMode: 'unsupported-no-credential-execution',
    inputs: [
      input('prompt', 'Prompt', 'text', true, 'Primary text prompt for storyboard, motion, and audio direction.'),
    ],
    output: videoOutput('Planned MP4 handoff for Seedance text-driven generation.'),
    cost: providerCost('Atlas pricing varies by model family and runtime; verify current per-second billing before enabling execution.'),
    risk: providerRisk('API route shape, exact request payload, and response hydration remain unverified in this workspace.'),
    caveats: [...PLANNING_ONLY_CAVEATS],
  },
  {
    id: 'atlas-cloud-seedance-2-image-to-video',
    providerId: 'atlas-cloud',
    displayName: 'Atlas Seedance 2.0 Image-to-Video',
    capabilityTags: ['image-to-video', 'first-frame', 'last-frame', 'native-audio', '720p'],
    executionState: 'planning-only',
    credentialMode: 'unsupported-no-credential-execution',
    inputs: [
      input('prompt', 'Prompt', 'text', true, 'Primary text prompt that guides motion, camera, and scene behavior.'),
      input('start-image', 'Start Image', 'image', true, 'Required first-frame image used to anchor the generated clip.'),
      input('end-image', 'End Image', 'image', false, 'Optional last-frame image for bounded interpolation planning.'),
    ],
    output: videoOutput('Planned MP4 handoff for first-frame or first-last-frame animation.'),
    cost: providerCost('Atlas pricing varies by model family and runtime; verify current per-second billing before enabling execution.'),
    risk: providerRisk('Exact first-frame and optional last-frame request contracts are not yet validated in app code.'),
    caveats: [...PLANNING_ONLY_CAVEATS],
  },
  {
    id: 'atlas-cloud-seedance-2-fast-image-to-video',
    providerId: 'atlas-cloud',
    displayName: 'Atlas Seedance 2.0 Fast Image-to-Video',
    capabilityTags: ['image-to-video', 'first-frame', 'fast-lane', '720p'],
    executionState: 'planning-only',
    credentialMode: 'unsupported-no-credential-execution',
    inputs: [
      input('prompt', 'Prompt', 'text', true, 'Primary text prompt for fast-lane motion planning.'),
      input('start-image', 'Start Image', 'image', true, 'Required first-frame image used to anchor a faster animation path.'),
    ],
    output: videoOutput('Planned MP4 handoff for a faster image-to-video path.'),
    cost: providerCost('Atlas pricing varies by model family and runtime; verify current per-second billing before enabling execution.'),
    risk: providerRisk('Fast-lane capability is cataloged only; no runtime lane selection or polling behavior is wired.'),
    caveats: [...PLANNING_ONLY_CAVEATS],
  },
  {
    id: 'atlas-cloud-wan-2.6-text-to-video',
    providerId: 'atlas-cloud',
    displayName: 'Atlas Wan 2.6 Text-to-Video',
    capabilityTags: ['text-to-video', 'native-audio', 'multi-shot', '1080p'],
    executionState: 'planning-only',
    credentialMode: 'unsupported-no-credential-execution',
    inputs: [
      input('prompt', 'Prompt', 'text', true, 'Primary text prompt for long-form or multi-shot Wan generation.'),
    ],
    output: videoOutput('Planned MP4 handoff for Wan text-driven generation.'),
    cost: providerCost('Atlas pricing varies by model family and runtime; verify current per-second billing before enabling execution.'),
    risk: providerRisk('Long-duration, audio-sync, and resolution controls remain catalog metadata only until a dedicated executor exists.'),
    caveats: [...PLANNING_ONLY_CAVEATS],
  },
  {
    id: 'atlas-cloud-wan-2.6-image-to-video',
    providerId: 'atlas-cloud',
    displayName: 'Atlas Wan 2.6 Image-to-Video',
    capabilityTags: ['image-to-video', 'first-frame', 'native-audio', '1080p'],
    executionState: 'planning-only',
    credentialMode: 'unsupported-no-credential-execution',
    inputs: [
      input('prompt', 'Prompt', 'text', true, 'Primary text prompt for scene, motion, and pacing guidance.'),
      input('start-image', 'Start Image', 'image', true, 'Required start image for Wan image-to-video planning.'),
    ],
    output: videoOutput('Planned MP4 handoff for Wan image-driven generation.'),
    cost: providerCost('Atlas pricing varies by model family and runtime; verify current per-second billing before enabling execution.'),
    risk: providerRisk('Supported duration and resolution combinations are intentionally treated as placeholders until runtime validation is implemented.'),
    caveats: [...PLANNING_ONLY_CAVEATS],
  },
  {
    id: 'atlas-cloud-wan-2.6-reference-to-video',
    providerId: 'atlas-cloud',
    displayName: 'Atlas Wan 2.6 Reference-to-Video',
    capabilityTags: ['reference-to-video', 'video-to-video', 'native-audio', '1080p'],
    executionState: 'planning-only',
    credentialMode: 'unsupported-no-credential-execution',
    inputs: [
      input('prompt', 'Prompt', 'text', true, 'Primary text prompt that modifies or steers the reference clip.'),
      input('reference-video', 'Reference Video', 'video', true, 'Required source video used to anchor subject, motion, or style intent.'),
    ],
    output: videoOutput('Planned MP4 handoff for reference-video-guided generation or transformation.'),
    cost: providerCost('Atlas pricing varies by model family and runtime; verify current per-second billing before enabling execution.'),
    risk: providerRisk('Reference-video semantics, upload flow, and output hydration are still unverified for this workspace.'),
    caveats: [...PLANNING_ONLY_CAVEATS],
  },
];

const PROVIDER_BY_ID = new Map(VIDEO_PROVIDER_DESCRIPTORS.map((provider) => [provider.id, provider] as const));
const MODEL_NODE_BY_ID = new Map(VIDEO_PROVIDER_MODEL_NODE_DESCRIPTORS.map((node) => [node.id, node] as const));

export function listVideoProviderDescriptors(): VideoProviderDescriptor[] {
  return VIDEO_PROVIDER_DESCRIPTORS.map((provider) => ({
    ...provider,
    caveats: [...provider.caveats],
  }));
}

export function getVideoProviderDescriptor(id: VideoPlanningProviderId): VideoProviderDescriptor | undefined {
  const provider = PROVIDER_BY_ID.get(id);
  return provider
    ? {
      ...provider,
      caveats: [...provider.caveats],
    }
    : undefined;
}

export function listVideoProviderModelNodeDescriptors(
  providerId?: VideoPlanningProviderId,
): VideoProviderModelNodeDescriptor[] {
  return VIDEO_PROVIDER_MODEL_NODE_DESCRIPTORS
    .filter((node) => providerId === undefined || node.providerId === providerId)
    .map(cloneModelNodeDescriptor);
}

export function getVideoProviderModelNodeDescriptor(id: string): VideoProviderModelNodeDescriptor | undefined {
  const descriptor = MODEL_NODE_BY_ID.get(id);
  return descriptor ? cloneModelNodeDescriptor(descriptor) : undefined;
}

function cloneModelNodeDescriptor(descriptor: VideoProviderModelNodeDescriptor): VideoProviderModelNodeDescriptor {
  return {
    ...descriptor,
    capabilityTags: [...descriptor.capabilityTags],
    inputs: descriptor.inputs.map((inputDescriptor) => ({ ...inputDescriptor })),
    output: {
      ...descriptor.output,
      mimeTypes: [...descriptor.output.mimeTypes],
    },
    cost: { ...descriptor.cost },
    risk: { ...descriptor.risk },
    caveats: [...descriptor.caveats],
  };
}

function input(
  id: string,
  label: string,
  kind: VideoNodeInputDescriptor['kind'],
  required: boolean,
  description: string,
): VideoNodeInputDescriptor {
  return { id, label, kind, required, description };
}

function videoOutput(description: string): VideoNodeOutputDescriptor {
  return {
    kind: 'video',
    mimeTypes: ['video/mp4'],
    description,
  };
}

function providerCost(summary: string): VideoNodeCostDescriptor {
  return {
    billingType: 'provider-priced-placeholder',
    confidence: 'placeholder',
    summary,
  };
}

function providerRisk(summary: string): VideoNodeRiskDescriptor {
  return {
    level: 'unverified-provider-contract',
    summary,
  };
}
