import type { NodeData } from '../../types/flow';

export type ImageAutomationNodeCategoryId =
  | 'file-system'
  | 'batch'
  | 'image-operations'
  | 'planning'
  | 'outputs';

export const IMAGE_AUTOMATION_NODE_TYPES = [
  'directoryInput',
  'directoryGlobInput',
  'imageBatchList',
  'extractImageMetadata',
  'resizeCanvas',
  'applyAdjustment',
  'applyImageMacro',
  'aiVariableFillPlan',
  'saveOutput',
  'packageOutput',
  'openImage',
] as const;

export type ImageAutomationNodeType = (typeof IMAGE_AUTOMATION_NODE_TYPES)[number];
export type ImageAutomationScope = 'image-editor';
export type ImageAutomationWorkspaceId = 'image-automation';
export type ImageAutomationNodeRole =
  | 'read-directory'
  | 'read-directory-glob'
  | 'batch-list'
  | 'batch-map'
  | 'resize'
  | 'apply-adjustment'
  | 'apply-image-action'
  | 'open-image'
  | 'save-image'
  | 'write-directory'
  | 'plan-ai-variables';
export type ImageAutomationPayloadKind =
  | 'directory'
  | 'directory-glob'
  | 'open-image'
  | 'image-batch'
  | 'image-metadata'
  | 'batch-item'
  | 'ai-variable-plan'
  | 'save-summary'
  | 'package-summary';
export type ImageAutomationAdjustmentKind = 'brightness-contrast';
export type ImageAutomationOutputFormat = 'png' | 'jpeg' | 'webp' | 'tiff';
export type ImageAutomationSafetySeverity = 'info' | 'warning';

export interface ImageAutomationWorkspaceTheme {
  themeId: 'image-automation-emerald-grid';
  cssClass: 'bg-[#031613]';
  dotColor: 'rgba(52,211,153,0.14)';
  dotGapPx: 28;
  dotSizePx: 1.4;
  pattern: 'radial-grid';
  dataAttribute: {
    workspace: 'data-image-automation-workspace';
    theme: 'data-image-automation-theme';
    canvas: 'data-image-automation-canvas';
  };
}

export type ImageAutomationFilesystemAction = 'read' | 'write';
export type ImageAutomationFilesystemTarget = 'directory' | 'image-file' | 'directory-metadata';
export interface ImageAutomationNodeCapabilityDescriptor {
  kind: 'filesystem';
  action: ImageAutomationFilesystemAction;
  target: ImageAutomationFilesystemTarget;
  required: boolean;
  executionMode: 'descriptor-only' | 'runtime';
  description: string;
}

export interface ImageAutomationNodePlannerDescriptor {
  kind: 'planner';
  action: 'open-image' | 'apply-image-action' | 'batch-map' | 'variable-fill-plan';
  required: boolean;
  executionMode: 'descriptor-only';
  description: string;
}

export type ImageAutomationCapabilityDescriptor =
  | ImageAutomationNodeCapabilityDescriptor
  | ImageAutomationNodePlannerDescriptor;

export interface ImageAutomationWorkspaceDescriptor {
  workspaceId: 'image-automation';
  label: 'Image Automation';
  philosophy: 'batch-image-workspace';
  flowRelationship: 'separate-from-main-flow';
  storageKey: 'signal-loom-image-automation-flow';
  nodeRegistry: 'bounded-image-automation-catalog';
  theme: ImageAutomationWorkspaceTheme;
  nativeExecution: {
    supported: false;
    state: 'unsupported-planning-only';
    reason: string;
    filesystemStates: ImageAutomationNativeFilesystemState[];
    signature: string;
  };
  dashboardSignatures: ImageAutomationDashboardSignatures;
  primaryPayloads: ImageAutomationPayloadKind[];
}

export interface ImageAutomationNativeFilesystemState {
  operation: 'read-directory' | 'write-image-file' | 'write-output-directory';
  supported: false;
  state: 'requires-user-confirmed-directory-handle' | 'unsupported-native-adapter-missing';
  reason: string;
}

export interface ImageAutomationDashboardSignatures {
  workspace: string;
  nodeCatalog: string;
  nativeFilesystem: string;
  checklist: string;
}

export interface ImageAutomationPortDefinition {
  id: string;
  label: string;
  payload: ImageAutomationPayloadKind;
  required: boolean;
  description?: string;
}

export interface ImageAutomationSafetyWarning {
  code: string;
  severity: ImageAutomationSafetySeverity;
  message: string;
}

export interface DirectoryInputConfig {
  directoryPath: string;
  includeSubfolders: boolean;
  extensions: string[];
}

export interface DirectoryGlobInputConfig {
  directoryPath: string;
  globPattern: string;
  includeSubfolders: boolean;
  excludeGlobs: string[];
}

export interface ImageBatchListConfig {
  sortBy: 'name' | 'modified';
  maxItems: number | null;
}

export interface ExtractImageMetadataConfig {
  readDimensions: boolean;
  readExif: boolean;
  createVariables: string[];
}

export interface ResizeCanvasConfig {
  sizingMode: 'fit-within' | 'fill-canvas' | 'exact-canvas';
  width: number;
  height: number;
  preserveAspectRatio: boolean;
  upscalePolicy: 'never-upscale' | 'allow-upscale';
  background: 'transparent' | 'white' | 'black';
}

export interface ApplyAdjustmentConfig {
  adjustmentKind: ImageAutomationAdjustmentKind;
  destructive: boolean;
  parameters: {
    brightness: number;
    contrast: number;
  };
}

export interface ApplyImageMacroStep {
  id: string;
  label: string;
  operation: 'adjustment-layer' | 'resize-canvas' | 'export-visible-copy';
  enabled: boolean;
}

export interface ApplyImageMacroConfig {
  macroName: string;
  destructive: boolean;
  steps: ApplyImageMacroStep[];
}

export interface AiVariableFillPlanConfig {
  planOnly: boolean;
  requireReview: boolean;
  conditionExpression: string;
  variables: Array<{
    name: string;
    fillFrom: 'metadata' | 'ai-description' | 'filename';
    fallback: string;
  }>;
}

export interface SaveOutputConfig {
  outputDirectory: string;
  format: ImageAutomationOutputFormat;
  namingTemplate: string;
  overwrite: boolean;
}

export interface PackageOutputConfig {
  packageDirectory: string;
  includeOriginals: boolean;
  includeManifest: boolean;
  includeRunLog: boolean;
  overwrite: boolean;
}

export interface OpenImageConfig {
  readMode: 'all' | 'selected';
  selectedLimit: number | null;
  preloadPixels: boolean;
}

export type ImageAutomationNodeConfig =
  | DirectoryInputConfig
  | DirectoryGlobInputConfig
  | ImageBatchListConfig
  | ExtractImageMetadataConfig
  | ResizeCanvasConfig
  | ApplyAdjustmentConfig
  | ApplyImageMacroConfig
  | AiVariableFillPlanConfig
  | SaveOutputConfig
  | PackageOutputConfig
  | OpenImageConfig;

export interface ImageAutomationNodeCategory {
  id: ImageAutomationNodeCategoryId;
  label: string;
  description: string;
}

export interface ImageAutomationNodeData extends NodeData {
  title: string;
  summary: string;
  categoryId: ImageAutomationNodeCategoryId;
  flowColumn: number;
  automationScope: ImageAutomationScope;
  automationWorkspaceId: ImageAutomationWorkspaceId;
  automationRole: ImageAutomationNodeType;
  automationFunction: ImageAutomationNodeRole;
  operation: string;
  config: ImageAutomationNodeConfig;
  safetyWarnings: ImageAutomationSafetyWarning[];
}

export interface ImageAutomationNodeCatalogEntry {
  type: ImageAutomationNodeType;
  automationScope: ImageAutomationScope;
  automationWorkspaceId: ImageAutomationWorkspaceId;
  automationFunction: ImageAutomationNodeRole;
  label: string;
  description: string;
  categoryId: ImageAutomationNodeCategoryId;
  flowColumn: number;
  tags: string[];
  inputs: ImageAutomationPortDefinition[];
  outputs: ImageAutomationPortDefinition[];
  safetyWarnings: ImageAutomationSafetyWarning[];
  capabilities: ImageAutomationCapabilityDescriptor[];
  signature: string;
  initialData: ImageAutomationNodeData;
}

interface ImageAutomationNodeInitialData {
  operation: string;
  config: ImageAutomationNodeConfig;
}

export const IMAGE_AUTOMATION_NODE_CATALOG_CATEGORIES: ImageAutomationNodeCategory[] = [
  {
    id: 'file-system',
    label: 'File System',
    description: 'Select local folders for Image automation without adding file nodes to the main Flow canvas.',
  },
  {
    id: 'batch',
    label: 'Batch',
    description: 'Build deterministic image file batches from a directory input.',
  },
  {
    id: 'image-operations',
    label: 'Image Operations',
    description: 'Describe Image editor adjustments to apply over each item in a batch.',
  },
  {
    id: 'planning',
    label: 'Planning',
    description: 'Plan conditional variables and AI-assisted metadata fills before a batch run.',
  },
  {
    id: 'outputs',
    label: 'Outputs',
    description: 'Save the adjusted batch to an output folder with conservative overwrite defaults.',
  },
];

export const IMAGE_AUTOMATION_NODE_CATALOG_ENTRIES: ImageAutomationNodeCatalogEntry[] = [
  entry({
    type: 'directoryInput',
    role: 'read-directory',
    label: 'Directory Input',
    description: 'Select a local input directory and expose image file candidates for batch editing.',
    categoryId: 'file-system',
    flowColumn: 0,
    tags: ['folder', 'read', 'directory'],
    inputs: [],
    outputs: [
      {
        id: 'directory',
        label: 'Directory',
        payload: 'directory',
        required: true,
        description: 'Selected folder plus extension and recursion rules.',
      },
    ],
    capabilities: [
      {
        kind: 'filesystem',
        action: 'read',
        target: 'directory',
        required: true,
        executionMode: 'descriptor-only',
        description: 'Read directory paths for deterministic batch discovery.',
      },
    ],
    initialData: {
      operation: 'read-directory',
      config: {
        directoryPath: '',
        includeSubfolders: false,
        extensions: ['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff'],
      },
    },
    safetyWarnings: [
      warning('local-directory-read-only', 'Reads local folder references only; it does not write files.'),
    ],
  }),
  entry({
    type: 'directoryGlobInput',
    role: 'read-directory-glob',
    label: 'Directory / Glob Input',
    description: 'Select a local folder with a glob pattern for repeatable image batch discovery.',
    categoryId: 'file-system',
    flowColumn: 0,
    tags: ['folder', 'glob', 'batch', 'read'],
    inputs: [],
    outputs: [
      {
        id: 'directoryGlob',
        label: 'Directory Glob',
        payload: 'directory-glob',
        required: true,
        description: 'Folder path, glob pattern, and exclusion rules for candidate image files.',
      },
    ],
    capabilities: [
      {
        kind: 'filesystem',
        action: 'read',
        target: 'directory',
        required: true,
        executionMode: 'descriptor-only',
        description: 'Read directory paths using glob constraints for deterministic batch previews.',
      },
    ],
    initialData: {
      operation: 'read-directory-glob',
      config: {
        directoryPath: '',
        globPattern: '**/*.{png,jpg,jpeg,webp,tif,tiff}',
        includeSubfolders: true,
        excludeGlobs: ['**/.DS_Store', '**/node_modules/**'],
      },
    },
    safetyWarnings: [
      warning('local-directory-read-only', 'Reads local folder references only; it does not write files.'),
      warning('glob-preview-required', 'Preview matches before running large recursive batches.'),
    ],
  }),
  entry({
    type: 'imageBatchList',
    role: 'batch-list',
    label: 'Image Batch List',
    description: 'Turn a directory input into a stable list of editable image work items.',
    categoryId: 'batch',
    flowColumn: 1,
    tags: ['batch', 'images', 'list'],
    inputs: [
      {
        id: 'directory',
        label: 'Directory',
        payload: 'directory',
        required: true,
        description: 'Directory input to scan for image files.',
      },
    ],
    outputs: [
      {
        id: 'imageBatch',
        label: 'Image Batch',
        payload: 'image-batch',
        required: true,
        description: 'Ordered image work items with source paths and metadata.',
      },
    ],
    capabilities: [
      {
        kind: 'planner',
        action: 'batch-map',
        required: true,
        executionMode: 'descriptor-only',
        description: 'Builds deterministic batch item lists before any image operations.',
      },
    ],
    initialData: {
      operation: 'batch-list',
      config: {
        sortBy: 'name',
        maxItems: null,
      },
    },
    safetyWarnings: [
      warning('batch-list-planning-only', 'Builds a list of candidates before any Image editor operation runs.'),
    ],
  }),
  entry({
    type: 'extractImageMetadata',
    role: 'batch-map',
    label: 'Extract Image Metadata',
    description: 'Read dimensions, orientation, and color profile hints for conditional batch decisions.',
    categoryId: 'batch',
    flowColumn: 2,
    tags: ['metadata', 'dimensions', 'exif', 'variables'],
    inputs: [
      {
        id: 'imageBatch',
        label: 'Image Batch',
        payload: 'image-batch',
        required: true,
        description: 'Image work items whose metadata should be inspected.',
      },
    ],
    outputs: [
      {
        id: 'metadata',
        label: 'Metadata',
        payload: 'image-metadata',
        required: true,
        description: 'Dimensions, orientation, and color profile variables for the batch.',
      },
      {
        id: 'imageBatch',
        label: 'Image Batch',
        payload: 'image-batch',
        required: true,
        description: 'The original work items passed through for downstream operations.',
      },
    ],
    capabilities: [
      {
        kind: 'planner',
        action: 'batch-map',
        required: true,
        executionMode: 'descriptor-only',
        description: 'Maps deterministic per-file metadata for planning conditions.',
      },
    ],
    initialData: {
      operation: 'batch-map',
      config: {
        readDimensions: true,
        readExif: false,
        createVariables: ['width', 'height', 'orientation', 'colorProfile'],
      },
    },
    safetyWarnings: [
      warning('metadata-read-limited', 'EXIF reading is disabled by default to avoid exposing private camera/location metadata.'),
    ],
  }),
  entry({
    type: 'openImage',
    role: 'open-image',
    label: 'Open Image',
    description: 'Resolve batch file paths into editable image items for planner handoff.',
    categoryId: 'image-operations',
    flowColumn: 3,
    tags: ['open', 'image', 'batch'],
    inputs: [
      {
        id: 'imageBatch',
        label: 'Image Batch',
        payload: 'image-batch',
        required: true,
        description: 'Image file batch items to open in an image editor execution plan.',
      },
    ],
    outputs: [
      {
        id: 'openImageBatch',
        label: 'Open Image Batch',
        payload: 'open-image',
        required: true,
        description: 'Editable image descriptors for each opened batch item.',
      },
    ],
    capabilities: [
      {
        kind: 'planner',
        action: 'open-image',
        required: true,
        executionMode: 'descriptor-only',
        description: 'Open-image operations remain handoff descriptors until an image runtime executes them.',
      },
    ],
    initialData: {
      operation: 'open-image',
      config: {
        readMode: 'all',
        selectedLimit: null,
        preloadPixels: false,
      },
    },
    safetyWarnings: [
      warning('open-image-descriptor-only', 'Open image is descriptor-only and does not load or mutate real pixels in this workspace.'),
    ],
  }),
  entry({
    type: 'resizeCanvas',
    role: 'resize',
    label: 'Resize / Canvas Size',
    description: 'Plan bounded resize or canvas sizing operations before macro or save steps.',
    categoryId: 'image-operations',
    flowColumn: 4,
    tags: ['resize', 'canvas', 'dimensions'],
    inputs: [
      {
        id: 'imageBatch',
        label: 'Image Batch',
        payload: 'image-batch',
        required: true,
        description: 'Image work items to resize or place on a canvas.',
      },
      {
        id: 'metadata',
        label: 'Metadata',
        payload: 'image-metadata',
        required: false,
        description: 'Optional dimension variables for conditional sizing.',
      },
    ],
    outputs: [
      {
        id: 'resizedBatch',
        label: 'Resized Batch',
        payload: 'image-batch',
        required: true,
        description: 'Image work items with resize/canvas sizing instructions attached.',
      },
    ],
    capabilities: [
      {
        kind: 'planner',
        action: 'batch-map',
        required: false,
        executionMode: 'descriptor-only',
        description: 'Resize planning stage only; execution is handled outside this catalog.',
      },
    ],
    initialData: {
      operation: 'resize',
      config: {
        sizingMode: 'fit-within',
        width: 2048,
        height: 2048,
        preserveAspectRatio: true,
        upscalePolicy: 'never-upscale',
        background: 'transparent',
      },
    },
    safetyWarnings: [
      warning('resize-non-upscale-default', 'Upscaling is disabled by default to avoid accidental quality loss.'),
    ],
  }),
  entry({
    type: 'applyAdjustment',
    role: 'apply-adjustment',
    label: 'Apply Adjustment',
    description: 'Apply a non-destructive brightness/contrast adjustment to each image in a batch.',
    categoryId: 'image-operations',
    flowColumn: 5,
    tags: ['adjustment', 'brightness', 'contrast', 'image'],
    inputs: [
      {
        id: 'imageBatch',
        label: 'Image Batch',
        payload: 'image-batch',
        required: true,
        description: 'Image work items to adjust.',
      },
    ],
    outputs: [
      {
        id: 'adjustedBatch',
        label: 'Adjusted Batch',
        payload: 'image-batch',
        required: true,
        description: 'Image work items with the adjustment step attached.',
      },
    ],
    capabilities: [
      {
        kind: 'planner',
        action: 'apply-image-action',
        required: false,
        executionMode: 'descriptor-only',
        description: 'Non-destructive adjustment descriptors are produced, not applied.',
      },
    ],
    initialData: {
      operation: 'apply-adjustment',
      config: {
        adjustmentKind: 'brightness-contrast',
        destructive: false,
        parameters: {
          brightness: 0,
          contrast: 0,
        },
      },
    },
    safetyWarnings: [
      warning('non-destructive-adjustment-default', 'Adds adjustment instructions without replacing original pixels.'),
    ],
  }),
  entry({
    type: 'applyImageMacro',
    role: 'apply-image-action',
    label: 'Apply Image Macro',
    description: 'Apply a named Image editor macro plan across each batch item with optional variables.',
    categoryId: 'image-operations',
    flowColumn: 6,
    tags: ['macro', 'actions', 'batch', 'image'],
    inputs: [
      {
        id: 'imageBatch',
        label: 'Image Batch',
        payload: 'image-batch',
        required: true,
        description: 'Image work items to process with macro steps.',
      },
      {
        id: 'metadata',
        label: 'Metadata',
        payload: 'image-metadata',
        required: false,
        description: 'Optional metadata variables available to macro steps.',
      },
      {
        id: 'variables',
        label: 'AI Variables',
        payload: 'ai-variable-plan',
        required: false,
        description: 'Optional reviewed variables for macro placeholders.',
      },
    ],
    outputs: [
      {
        id: 'macroBatch',
        label: 'Macro Batch',
        payload: 'image-batch',
        required: true,
        description: 'Image work items with macro steps attached.',
      },
    ],
    capabilities: [
      {
        kind: 'planner',
        action: 'apply-image-action',
        required: true,
        executionMode: 'descriptor-only',
        description: 'Executes through an external Image action runner, not from this workflow.',
      },
    ],
    initialData: {
      operation: 'apply-image-action',
      config: {
        macroName: 'Non-destructive batch polish',
        destructive: false,
        steps: [
          {
            id: 'adjustment-layer',
            label: 'Add adjustment layer',
            operation: 'adjustment-layer',
            enabled: true,
          },
          {
            id: 'export-visible-copy',
            label: 'Export visible copy',
            operation: 'export-visible-copy',
            enabled: true,
          },
        ],
      },
    },
    safetyWarnings: [
      warning('macro-descriptor-only', 'Uses Image macro descriptors only; no destructive pixel writes are enabled by default.'),
    ],
  }),
  entry({
    type: 'aiVariableFillPlan',
    role: 'plan-ai-variables',
    label: 'AI Variable Fill Plan',
    description: 'Plan conditional variable fills from metadata before a future AI-assisted batch runner executes.',
    categoryId: 'planning',
    flowColumn: 7,
    tags: ['ai', 'variables', 'conditional', 'planning'],
    inputs: [
      {
        id: 'metadata',
        label: 'Metadata',
        payload: 'image-metadata',
        required: true,
        description: 'Metadata variables used to decide which fields need fills.',
      },
      {
        id: 'imageBatch',
        label: 'Image Batch',
        payload: 'image-batch',
        required: false,
        description: 'Optional image work items available for future AI-assisted descriptions.',
      },
    ],
    outputs: [
      {
        id: 'variables',
        label: 'AI Variables',
        payload: 'ai-variable-plan',
        required: true,
        description: 'Reviewed variable-fill plan for macro placeholders.',
      },
    ],
    capabilities: [
      {
        kind: 'planner',
        action: 'variable-fill-plan',
        required: true,
        executionMode: 'descriptor-only',
        description: 'Planning step only; AI providers are not called in this workspace.',
      },
    ],
    initialData: {
      operation: 'plan-ai-variables',
      config: {
        planOnly: true,
        requireReview: true,
        conditionExpression: 'metadata.width > metadata.height',
        variables: [
          {
            name: 'orientationLabel',
            fillFrom: 'metadata',
            fallback: 'landscape',
          },
        ],
      },
    },
    safetyWarnings: [
      warning('ai-plan-only', 'Plan only; does not call an AI provider until a runner implements execution.'),
      warning('ai-review-required', 'Human review is required before AI-filled variables can drive batch writes.'),
    ],
  }),
  entry({
    type: 'saveOutput',
    role: 'save-image',
    label: 'Save Output',
    description: 'Save the adjusted image batch to an output folder with format and naming rules.',
    categoryId: 'outputs',
    flowColumn: 8,
    tags: ['save', 'write', 'output'],
    inputs: [
      {
        id: 'imageBatch',
        label: 'Image Batch',
        payload: 'image-batch',
        required: true,
        description: 'Adjusted image work items to write to disk.',
      },
    ],
    outputs: [
      {
        id: 'saveSummary',
        label: 'Save Summary',
        payload: 'save-summary',
        required: true,
        description: 'Save result metadata for the batch run.',
      },
    ],
    capabilities: [
      {
        kind: 'filesystem',
        action: 'write',
        target: 'image-file',
        required: true,
        executionMode: 'descriptor-only',
        description: 'Writing is planned and delegated; no writes occur in this catalog.',
      },
    ],
    initialData: {
      operation: 'save-image',
      config: {
        outputDirectory: '',
        format: 'png',
        namingTemplate: '{name}-edited',
        overwrite: false,
      },
    },
    safetyWarnings: [
      warning('overwrite-disabled-by-default', 'Overwrite is disabled by default; confirm output folders before enabling replacement writes.'),
    ],
  }),
  entry({
    type: 'packageOutput',
    role: 'write-directory',
    label: 'Package Outputs',
    description: 'Package saved batch results with a manifest and run log for review or handoff.',
    categoryId: 'outputs',
    flowColumn: 9,
    tags: ['package', 'manifest', 'handoff', 'output'],
    inputs: [
      {
        id: 'saveSummary',
        label: 'Save Summary',
        payload: 'save-summary',
        required: true,
        description: 'Summary of files written by the save step.',
      },
      {
        id: 'metadata',
        label: 'Metadata',
        payload: 'image-metadata',
        required: false,
        description: 'Optional metadata to include in the package manifest.',
      },
    ],
    outputs: [
      {
        id: 'packageSummary',
        label: 'Package Summary',
        payload: 'package-summary',
        required: true,
        description: 'Package manifest, run log, and handoff summary.',
      },
    ],
    capabilities: [
      {
        kind: 'filesystem',
        action: 'write',
        target: 'directory',
        required: true,
        executionMode: 'descriptor-only',
        description: 'Writes batch package assets and manifests to an output directory during execution runtime.',
      },
    ],
    initialData: {
      operation: 'write-directory',
      config: {
        packageDirectory: '',
        includeOriginals: false,
        includeManifest: true,
        includeRunLog: true,
        overwrite: false,
      },
    },
    safetyWarnings: [
      warning('package-originals-opt-in', 'Original source files are not copied into packages unless explicitly enabled.'),
      warning('package-overwrite-disabled', 'Package overwrite is disabled by default to preserve previous batch results.'),
    ],
  }),
];

export function getImageAutomationNodeEntry(type: ImageAutomationNodeType): ImageAutomationNodeCatalogEntry {
  const entry = IMAGE_AUTOMATION_NODE_CATALOG_ENTRIES.find((candidate) => candidate.type === type);
  if (!entry) {
    throw new Error(`Unknown Image Automation node type: ${type}`);
  }
  return entry;
}

export function getImageAutomationNodeEntriesForCategory(
  categoryId: ImageAutomationNodeCategoryId,
): ImageAutomationNodeCatalogEntry[] {
  return IMAGE_AUTOMATION_NODE_CATALOG_ENTRIES.filter((entry) => entry.categoryId === categoryId);
}

export function getImageAutomationWorkspaceDescriptor(): ImageAutomationWorkspaceDescriptor {
  const nativeFilesystemStates: ImageAutomationNativeFilesystemState[] = [
    {
      operation: 'read-directory',
      supported: false,
      state: 'requires-user-confirmed-directory-handle',
      reason: 'Directory reads are planned from user-selected handles and are not crawled by the catalog.',
    },
    {
      operation: 'write-image-file',
      supported: false,
      state: 'unsupported-native-adapter-missing',
      reason: 'Image file writes are output descriptors until a browser or native filesystem adapter runs them.',
    },
    {
      operation: 'write-output-directory',
      supported: false,
      state: 'unsupported-native-adapter-missing',
      reason: 'Package/output directory creation is not performed by the Image Automation catalog.',
    },
  ];
  const nativeFilesystemSignature = `image-automation-native-filesystem:v1:${JSON.stringify({
    supported: false,
    states: nativeFilesystemStates.map((state) => `${state.operation}:${state.state}`),
  })}`;
  const workspaceSignature = `image-automation-workspace:v1:${JSON.stringify({
    workspaceId: 'image-automation',
    flowRelationship: 'separate-from-main-flow',
    nodeRegistry: 'bounded-image-automation-catalog',
  })}`;
  const nodeCatalogSignature = `image-automation-node-catalog:v1:${JSON.stringify({
    types: IMAGE_AUTOMATION_NODE_CATALOG_ENTRIES.map((entry) => entry.type),
    scope: 'image-editor',
  })}`;
  const dashboardSignatures: ImageAutomationDashboardSignatures = {
    workspace: workspaceSignature,
    nodeCatalog: nodeCatalogSignature,
    nativeFilesystem: nativeFilesystemSignature,
    checklist: `image-automation-dashboard-checklist:v1:${JSON.stringify({
      workspace: workspaceSignature,
      nodeCatalog: nodeCatalogSignature,
      nativeFilesystem: nativeFilesystemSignature,
    })}`,
  };

  return {
    workspaceId: 'image-automation',
    label: 'Image Automation',
    philosophy: 'batch-image-workspace',
    flowRelationship: 'separate-from-main-flow',
    storageKey: 'signal-loom-image-automation-flow',
    nodeRegistry: 'bounded-image-automation-catalog',
    theme: {
      themeId: 'image-automation-emerald-grid',
      cssClass: 'bg-[#031613]',
      dotColor: 'rgba(52,211,153,0.14)',
      dotGapPx: 28,
      dotSizePx: 1.4,
      pattern: 'radial-grid',
      dataAttribute: {
        workspace: 'data-image-automation-workspace',
        theme: 'data-image-automation-theme',
        canvas: 'data-image-automation-canvas',
      },
    },
    nativeExecution: {
      supported: false,
      state: 'unsupported-planning-only',
      reason: 'Image Automation currently produces typed plans and handoff descriptors; native unattended execution is not wired.',
      filesystemStates: nativeFilesystemStates,
      signature: nativeFilesystemSignature,
    },
    dashboardSignatures,
    primaryPayloads: [
      'directory',
      'directory-glob',
      'image-batch',
      'image-metadata',
      'open-image',
      'batch-item',
      'ai-variable-plan',
      'save-summary',
      'package-summary',
    ],
  };
}

export function getImageAutomationNodeEntriesForRole(
  role: ImageAutomationNodeRole,
): ImageAutomationNodeCatalogEntry[] {
  return IMAGE_AUTOMATION_NODE_CATALOG_ENTRIES.filter((entry) => entry.automationFunction === role);
}

export function getImageAutomationCapabilitiesForNode(type: ImageAutomationNodeType): ImageAutomationCapabilityDescriptor[] {
  return getImageAutomationNodeEntry(type).capabilities;
}

function entry(definition: {
  type: ImageAutomationNodeType;
  role: ImageAutomationNodeRole;
  label: string;
  description: string;
  categoryId: ImageAutomationNodeCategoryId;
  flowColumn: number;
  tags: string[];
  inputs: ImageAutomationPortDefinition[];
  outputs: ImageAutomationPortDefinition[];
  capabilities: ImageAutomationCapabilityDescriptor[];
  safetyWarnings: ImageAutomationSafetyWarning[];
  initialData: ImageAutomationNodeInitialData;
}): ImageAutomationNodeCatalogEntry {
  const signature = `image-automation-node:v1:${JSON.stringify({
    type: definition.type,
    workspaceId: 'image-automation',
    scope: 'image-editor',
    role: definition.role,
    categoryId: definition.categoryId,
    inputs: definition.inputs.map((input) => `${input.id}:${input.payload}:${input.required ? 'required' : 'optional'}`),
    outputs: definition.outputs.map((output) => `${output.id}:${output.payload}:${output.required ? 'required' : 'optional'}`),
    capabilities: definition.capabilities.map((capability) => (
      capability.kind === 'filesystem'
        ? `${capability.kind}:${capability.action}:${capability.target}`
        : `${capability.kind}:${capability.action}`
    )),
  })}`;

  return {
    type: definition.type,
    automationScope: 'image-editor',
    automationWorkspaceId: 'image-automation',
    automationFunction: definition.role,
    label: definition.label,
    description: definition.description,
    categoryId: definition.categoryId,
    flowColumn: definition.flowColumn,
    tags: definition.tags,
    inputs: definition.inputs,
    outputs: definition.outputs,
    capabilities: definition.capabilities,
    safetyWarnings: definition.safetyWarnings,
    signature,
    initialData: {
      ...definition.initialData,
      title: definition.label,
      summary: definition.description,
      categoryId: definition.categoryId,
      flowColumn: definition.flowColumn,
      automationWorkspaceId: 'image-automation',
      automationScope: 'image-editor',
      automationRole: definition.type,
      automationFunction: definition.role,
      safetyWarnings: definition.safetyWarnings,
    },
  };
}

function warning(code: string, message: string, severity: ImageAutomationSafetySeverity = 'warning'): ImageAutomationSafetyWarning {
  return { code, severity, message };
}
