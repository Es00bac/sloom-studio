import type { Edge } from '@xyflow/react';
import type {
  AppNode,
  FlowNodeType,
  FunctionValueKind,
  ImageProvider,
  NodeData,
  TextProvider,
  VideoProvider,
} from '../types/flow';
import { FLOW_NODE_TYPES } from '../types/flow';
import { IMAGE_REFERENCE_HANDLES } from './imageModelSupport';
import { LOOP_BREAK_TARGET_HANDLE } from './flowControlHandles';
import { getImageModelDefinition, getImageNodeControlModel } from './imageProviderCapabilities';
import { isFlowResultKind } from './flowValueTypes';
import { getTextModelContract } from './modelContracts/textModelContracts';
import { getVideoModelSupport } from './modelContracts/videoModelContracts';
import { DEFAULT_MODELS } from './providerCatalog';
import { getConnectedCompositionAudioHandles, resolveCompositionAudioTrackModel } from './compositionTracks';
import {
  runtimeTypeFromResultType,
  type FlowDataType,
} from './flowPortTypes';
import { resolveModelCardPorts } from './providerCardFlow';
import { getEditorStageObjects } from './editorStageObjects';
import { getEditorVisualClips } from './manualEditorState';

export type FlowNodeExecutionRole =
  | 'source'
  | 'transform'
  | 'control'
  | 'sink'
  | 'container'
  | 'boundary'
  | 'ui-only';

export interface FlowPortContract {
  /** `null` is React Flow's stable default (unnamed) handle. */
  id: string | null;
  direction: 'input' | 'output';
  label: string;
  help: string;
  types: readonly FlowDataType[];
  required: boolean;
  minConnections: number;
  maxConnections: number | null;
  ordered: boolean;
  side: 'left' | 'right' | 'top' | 'bottom';
  connectionGroups?: readonly {
    id: string;
    types: readonly FlowDataType[];
    maxConnections: number;
  }[];
  disabledReason?: string;
}

export interface FlowNodeContractExample {
  title: string;
  upstream: readonly FlowNodeType[];
  downstream: readonly FlowNodeType[];
  description: string;
}

export interface FlowNodeContractContext {
  node: AppNode;
  nodes: readonly AppNode[];
  edges: readonly Edge[];
}

export interface FlowNodeContract {
  type: FlowNodeType;
  role: FlowNodeExecutionRole;
  purpose: string;
  help: string;
  failureModes: readonly string[];
  examples: readonly FlowNodeContractExample[];
  resolvePorts(context: FlowNodeContractContext): readonly FlowPortContract[];
  implementation: {
    status: 'implemented' | 'structural';
    path: string;
    apiCapability?: 'text' | 'image' | 'video' | 'audio';
  };
}

type PortResolver = (context: FlowNodeContractContext) => readonly FlowPortContract[];

const textType = type('text');
const numberType = type('number');
const booleanType = type('boolean');
const jsonType = type('json');
const imageType = type('image');
const videoType = type('video');
const audioType = type('audio');
const packageType = type('package');
const controlType = type('control');
const unknownType = type('unknown');
const listMixedType = containerType('list', { kind: 'mixed' });
const envelopeMixedType = containerType('envelope', { kind: 'mixed' });
const envelopeImageType = containerType('envelope', imageType);
const envelopePackageType = containerType('envelope', packageType);

const textualAtomicTypes: readonly FlowDataType[] = [
  textType,
  numberType,
  booleanType,
  jsonType,
  packageType,
];
const textualEnvelopeTypes: readonly FlowDataType[] = textualAtomicTypes.map((item) => containerType('envelope', item));
const textualListTypes: readonly FlowDataType[] = textualAtomicTypes.map((item) => containerType('list', item));
const textualPromptInputTypes: readonly FlowDataType[] = [
  ...textualAtomicTypes,
  ...textualListTypes,
  ...textualEnvelopeTypes,
];

const knownAtomicValueTypes: readonly FlowDataType[] = [
  textType,
  numberType,
  booleanType,
  jsonType,
  imageType,
  videoType,
  audioType,
  packageType,
];

const allListTypes: readonly FlowDataType[] = [
  listMixedType,
  ...knownAtomicValueTypes.map((item) => containerType('list', item)),
  containerType('list', listMixedType),
  containerType('list', envelopeMixedType),
];

const allEnvelopeTypes: readonly FlowDataType[] = [
  envelopeMixedType,
  ...knownAtomicValueTypes.map((item) => containerType('envelope', item)),
  containerType('envelope', listMixedType),
  containerType('envelope', envelopeMixedType),
];

const sourceBinItemTypes: readonly FlowDataType[] = [textType, imageType, videoType, audioType, packageType];
const sourceBinInputTypes: readonly FlowDataType[] = [
  ...sourceBinItemTypes,
  listMixedType,
  envelopeMixedType,
  ...sourceBinItemTypes.map((item) => containerType('list', item)),
  ...sourceBinItemTypes.map((item) => containerType('envelope', item)),
];

const imageCompositeInputTypes: readonly FlowDataType[] = [
  imageType,
  packageType,
  envelopeImageType,
  envelopePackageType,
  envelopeMixedType,
];

const imageReferenceInputTypes: readonly FlowDataType[] = [
  ...imageCompositeInputTypes,
  textType,
  jsonType,
];

const imagePromptInputTypes: readonly FlowDataType[] = [
  ...textualPromptInputTypes,
  videoType,
];

const allKnownValueTypes: readonly FlowDataType[] = [
  ...knownAtomicValueTypes,
  ...allListTypes,
  ...allEnvelopeTypes,
];

const allInspectableTypes: readonly FlowDataType[] = [...allKnownValueTypes, unknownType, controlType];

const LOOP_BREAK_TARGET_TYPES = new Set<FlowNodeType>([
  'textNode',
  'imageGen',
  'cropImageNode',
  'videoGen',
  'audioGen',
  'transcriptionNode',
  'composition',
  'visionVerifyNode',
  'functionNode',
]);

const IMPLEMENTATION_PATHS = {
  textNode: 'src/components/Nodes/TextNode.tsx',
  imageGen: 'src/components/Nodes/ImageNode.tsx',
  cropImageNode: 'src/components/Nodes/CropImageNode.tsx',
  videoGen: 'src/components/Nodes/VideoNode.tsx',
  audioGen: 'src/components/Nodes/AudioNode.tsx',
  transcriptionNode: 'src/components/Nodes/TranscriptionNode.tsx',
  audioProcessNode: 'src/components/Nodes/AudioProcessNode.tsx',
  settings: 'src/components/Nodes/ConfigNode.tsx',
  composition: 'src/components/Nodes/CompositionNode.tsx',
  sourceBin: 'src/components/Nodes/SourceBinNode.tsx',
  valueNode: 'src/components/Nodes/ValueNode.tsx',
  list: 'src/components/Nodes/ListNode.tsx',
  expander: 'src/components/Nodes/ExpanderNode.tsx',
  envelope: 'src/components/Nodes/EnvelopeNode.tsx',
  virtual: 'src/components/Nodes/VirtualNode.tsx',
  portal: 'src/components/Nodes/PortalNode.tsx',
  advancedImageEditor: 'src/components/Nodes/AdvancedImageEditorNode.tsx',
  switchNode: 'src/components/Nodes/SwitchNode.tsx',
  forkSwitchNode: 'src/components/Nodes/ForkSwitchNode.tsx',
  runMeNode: 'src/components/Nodes/RunMeNode.tsx',
  packageNode: 'src/components/Nodes/PackageNode.tsx',
  loopNode: 'src/components/Nodes/LoopNode.tsx',
  visionVerifyNode: 'src/components/Nodes/VisionVerifyNode.tsx',
  logicNode: 'src/components/Nodes/LogicNode.tsx',
  conditionalNode: 'src/components/Nodes/ConditionalNode.tsx',
  comparisonNode: 'src/components/Nodes/ComparisonNode.tsx',
  loopGateNode: 'src/components/Nodes/LoopGateNode.tsx',
  loopBreakNode: 'src/components/Nodes/LoopBreakNode.tsx',
  listLengthNode: 'src/components/Nodes/ListLengthNode.tsx',
  mathNode: 'src/components/Nodes/MathNode.tsx',
  valueMonitorNode: 'src/components/Nodes/ValueMonitorNode.tsx',
  stringTemplateNode: 'src/components/Nodes/StringTemplateNode.tsx',
  regexReplaceNode: 'src/components/Nodes/RegexReplaceNode.tsx',
  switchCaseNode: 'src/components/Nodes/SwitchCaseNode.tsx',
  promptsJoinerNode: 'src/components/Nodes/PromptsJoinerNode.tsx',
  negativePromptNode: 'src/components/Nodes/NegativePromptNode.tsx',
  seedSequencerNode: 'src/components/Nodes/SeedSequencerNode.tsx',
  promptMixerNode: 'src/components/Nodes/PromptMixerNode.tsx',
  storyStateNode: 'src/components/Nodes/StoryStateNode.tsx',
  arrayFlatNode: 'src/components/Nodes/ArrayFlatNode.tsx',
  textSentimentAnalysisNode: 'src/components/Nodes/TextSentimentAnalysisNode.tsx',
  imageFeatureExtractorNode: 'src/components/Nodes/ImageFeatureExtractorNode.tsx',
  fallbackSelectorNode: 'src/components/Nodes/FallbackSelectorNode.tsx',
  dialogueScriptSplitterNode: 'src/components/Nodes/DialogueScriptSplitterNode.tsx',
  numberNode: 'src/components/Nodes/NumberNode.tsx',
  colorSwatchNode: 'src/components/Nodes/ColorSwatchNode.tsx',
  colorSwatchListNode: 'src/components/Nodes/ColorSwatchListNode.tsx',
  loraSpecNode: 'src/components/Nodes/LoraSpecNode.tsx',
  slimgNode: 'src/components/Nodes/SlimgNode.tsx',
  doodleNode: 'src/components/Nodes/DoodleNode.tsx',
  groupNode: 'src/components/Nodes/GroupNode.tsx',
  functionNode: 'src/components/Nodes/FunctionNode.tsx',
  functionInputNode: 'src/components/Nodes/FunctionInputNode.tsx',
  functionOutputNode: 'src/components/Nodes/FunctionOutputNode.tsx',
  javascriptNode: 'src/components/Nodes/JavaScriptNode.tsx',
  jsonQueryNode: 'src/components/Nodes/JsonQueryNode.tsx',
  regexParseNode: 'src/components/Nodes/RegexParseNode.tsx',
  pythonNode: 'src/components/Nodes/PythonNode.tsx',
  jsonBuilderNode: 'src/components/Nodes/JsonBuilderNode.tsx',
  htmlSandboxNode: 'src/components/Nodes/HtmlSandboxNode.tsx',
  apiFetchNode: 'src/components/Nodes/ApiFetchNode.tsx',
  sqlQueryNode: 'src/components/Nodes/SqlQueryNode.tsx',
  csvParserNode: 'src/components/Nodes/CsvParserNode.tsx',
  mathExpressionNode: 'src/components/Nodes/MathExpressionNode.tsx',
  xmlYamlNode: 'src/components/Nodes/XmlYamlNode.tsx',
} satisfies Record<FlowNodeType, string>;

const resolvers = {
  textNode: (context) => {
    const modelCardPorts = resolveModelCardPorts(context.node);
    if (modelCardPorts) return modelCardPorts;
    const provider = (context.node.data.provider as TextProvider | undefined) ?? 'gemini';
    const modelId = context.node.data.modelId ?? DEFAULT_MODELS.text[provider];
    const modalities = getTextModelContract(provider, modelId).inputModalities;
    const inputTypes = [
      ...(modalities.includes('text') ? [textType] : []),
      ...(modalities.includes('image') ? [imageType] : []),
      ...(modalities.includes('video') ? [videoType] : []),
      ...(modalities.includes('audio') ? [audioType] : []),
      ...textualPromptInputTypes.filter((type) => type.kind !== 'text'),
    ];

    return [
      ...(context.node.data.mode === 'generate'
        ? [input(null, 'Prompt / media context', inputTypes, { maxConnections: null })]
        : []),
      output(null, 'Text', [textType]),
    ];
  },
  imageGen: resolveImagePorts,
  cropImageNode: () => [input('image', 'Image', imageCompositeInputTypes, { required: true }), output(null, 'Cropped image', [imageType])],
  videoGen: resolveVideoPorts,
  audioGen: (context) => {
    const modelCardPorts = resolveModelCardPorts(context.node);
    if (modelCardPorts) return modelCardPorts;
    return [
      input(
        null,
        context.node.data.audioGenerationMode === 'voiceChange' ? 'Voice source / config' : 'Prompt / config',
        context.node.data.audioGenerationMode === 'voiceChange' ? [audioType, jsonType] : textualPromptInputTypes,
        { maxConnections: null },
      ),
      output(null, 'Audio', [audioType]),
    ];
  },
  transcriptionNode: (context) => [
    input('media', 'Audio or video', [audioType, videoType], { required: true }),
    ...(context.node.data.transcriptionOperation === 'align'
      ? [input('transcript', 'Known transcript', [textType], { maxConnections: 1 })]
      : []),
    output('transcript-text', 'Transcript text', [textType]),
    output('timed-transcript', 'Timed transcript JSON', [jsonType]),
    output('captions-vtt', 'WebVTT captions', [textType]),
    output('captions-srt', 'SRT captions', [textType]),
  ],
  audioProcessNode: () => [
    input('media', 'Audio or video', [audioType, videoType], { required: true }),
    output('isolated-audio', 'Isolated dialogue', [audioType]),
  ],
  settings: () => [output(null, 'Generation defaults', [jsonType])],
  composition: (context) => resolveCompositionPorts(context),
  sourceBin: () => [input(null, 'Asset to ingest', sourceBinInputTypes, { maxConnections: null })],
  valueNode: (context) => [output(null, 'Value', [primitiveType(context.node.data.valueKind)])],
  list: (context) => resolveListPorts(context),
  expander: () => [
    input(null, 'List or envelope', [...allListTypes, ...allEnvelopeTypes], { required: true }),
    input('index', 'Item index', [numberType]),
    output(null, 'Selected item', [unknownType]),
  ],
  envelope: (context) => {
    const item = itemTypeFromData(context.node.data.envelopeItemKind);
    return [
      input(null, 'Envelope item', item.kind === 'mixed' ? allKnownValueTypes : [item], { maxConnections: null }),
      output(null, 'Envelope', [containerType('envelope', item)]),
    ];
  },
  virtual: () => [input(null, 'Aliased value', allInspectableTypes, { required: true }), output(null, 'Aliased value', [unknownType])],
  portal: (context) => context.node.data.portalRole === 'exit'
    ? [output(null, 'Portal value', [unknownType])]
    : [input(null, 'Portal value', allInspectableTypes, { required: true })],
  advancedImageEditor: () => [
    input('sourceImage', 'Source image', [imageType], { required: true }),
    input('mask', 'Mask', [imageType]),
    input('reference', 'Reference', [imageType]),
    output('editedImage', 'Edited image', [imageType]),
    output('maskOutput', 'Mask output', [imageType]),
  ],
  switchNode: () => [
    input('condition', 'Condition', [booleanType]),
    input('input', 'Value', allKnownValueTypes, { required: true }),
    output(null, 'Value when on', [unknownType]),
  ],
  forkSwitchNode: () => [
    input('condition', 'Branch condition', [booleanType]),
    input('input', 'Value', allKnownValueTypes, { required: true }),
    output('A', 'Branch A', [unknownType]),
    output('B', 'Branch B', [unknownType]),
  ],
  runMeNode: () => [input(null, 'Run target', allKnownValueTypes, { required: true, maxConnections: null })],
  packageNode: () => [
    input('image', 'Image asset', [imageType]),
    input('text', 'Description', [textType]),
    output(null, 'Asset package', [packageType]),
  ],
  loopNode: () => [input(null, 'Repeated value', allKnownValueTypes, { required: true }), output(null, 'Repeated list', [containerType('list', unknownType)])],
  visionVerifyNode: () => [
    input('image', 'Generated image', imageCompositeInputTypes, { required: true }),
    input('refImage', 'Reference image', imageCompositeInputTypes),
    input('prompt', 'Verification prompt', [textType]),
    output(null, 'Verified', [booleanType]),
  ],
  logicNode: (context) => [
    input('A', 'Boolean A', [booleanType], { required: true }),
    ...(String(context.node.data.operation ?? 'AND').toUpperCase() === 'NOT' ? [] : [input('B', 'Boolean B', [booleanType], { required: true })]),
    output(null, 'Boolean result', [booleanType]),
  ],
  conditionalNode: () => [
    input('condition', 'Condition', [booleanType], { required: true }),
    input('valueIfTrue', 'Value if true', allKnownValueTypes, { required: true }),
    input('valueIfFalse', 'Value if false', allKnownValueTypes, { required: true }),
    output(null, 'Selected value', [unknownType]),
  ],
  comparisonNode: () => [input('A', 'Left value', [textType, numberType], { required: true }), input('B', 'Right value', [textType, numberType], { required: true }), output(null, 'Comparison result', [booleanType])],
  loopGateNode: () => [input('input', 'Loop value', allKnownValueTypes, { required: true }), input('condition', 'Continue condition', [booleanType], { required: true }), output(null, 'Gated value', [unknownType])],
  loopBreakNode: () => [input('condition', 'Stop condition', [booleanType], { required: true }), output(null, 'Stop control', [controlType])],
  listLengthNode: () => [input(null, 'List or envelope', [...allListTypes, ...allEnvelopeTypes], { required: true }), output(null, 'Length', [numberType])],
  mathNode: () => [input('A', 'Number A', [numberType], { required: true }), input('B', 'Number B', [numberType], { required: true }), output(null, 'Number result', [numberType])],
  valueMonitorNode: () => [input(null, 'Observed value', allInspectableTypes, { required: true }), output(null, 'Observed value', [unknownType])],
  stringTemplateNode: () => [...letterInputs(['A', 'B', 'C'], [textType]), output(null, 'Rendered text', [textType])],
  regexReplaceNode: () => [input(null, 'Text', [textType], { required: true }), output(null, 'Replaced text', [textType])],
  switchCaseNode: () => [input('key', 'Case key', allKnownValueTypes, { required: true }), output('case1', 'Case 1', [unknownType]), output('case2', 'Case 2', [unknownType]), output('case3', 'Case 3', [unknownType])],
  promptsJoinerNode: () => [...letterInputs(['A', 'B', 'C'], [textType]), output(null, 'Joined prompt', [textType])],
  negativePromptNode: () => [input('text', 'Prompt', [textType]), input('exclude', 'Exclusions', [textType]), output(null, 'Negative prompt', [textType])],
  seedSequencerNode: () => [input(null, 'Sequence index', [numberType]), output(null, 'Seed', [numberType])],
  promptMixerNode: () => [...letterInputs(['A', 'B'], [textType]), output(null, 'Mixed prompt', [textType])],
  storyStateNode: () => [input(null, 'State value override', [textType, numberType, booleanType, jsonType]), output(null, 'Story state', [jsonType])],
  arrayFlatNode: () => [...letterInputs(['L1', 'L2', 'L3'], allListTypes), output(null, 'Flat list', [listMixedType])],
  textSentimentAnalysisNode: () => [input(null, 'Dialogue text', [textType], { required: true }), output(null, 'Sentiment', [jsonType])],
  imageFeatureExtractorNode: () => [input(null, 'Image', imageCompositeInputTypes, { required: true }), output(null, 'Image features', [jsonType])],
  fallbackSelectorNode: () => [input('primary', 'Primary value', allKnownValueTypes), input('fallback', 'Fallback value', allKnownValueTypes, { required: true }), output(null, 'Selected value', [unknownType])],
  dialogueScriptSplitterNode: () => [input(null, 'Script', [textType], { required: true }), output(null, 'Dialogue lines', [containerType('list', textType)])],
  numberNode: () => [output(null, 'Number', [numberType])],
  colorSwatchNode: (context) => [
    output(null, 'Palette prompt', [textType]),
    ...normalizeStringArray(context.node.data.colorSwatchColors).map((_, index) => output(`palette-color-${index}`, `Palette color ${index + 1}`, [textType])),
  ],
  colorSwatchListNode: () => [input(null, 'Palette color', [textType], { maxConnections: null, ordered: true }), output(null, 'Swatch prompt', [textType])],
  loraSpecNode: () => [output(null, 'LoRA weights', [jsonType])],
  slimgNode: () => [input('image', 'Image', imageCompositeInputTypes, { required: true }), output(null, 'Flattened image', [imageType])],
  doodleNode: () => [input(null, 'Description override', [textType]), output(null, 'Doodle package', [packageType])],
  groupNode: () => [],
  functionNode: resolveFunctionPorts,
  functionInputNode: (context) => [output(null, 'Function input value', [functionValueType(context.node.data.functionPortType)])],
  functionOutputNode: (context) => [input(null, 'Function output value', functionInputTypes(context.node.data.functionPortType), { required: true })],
  javascriptNode: (context) => [...letterInputs(['A', 'B', 'C'], allInspectableTypes), output(null, 'Script result', [declaredOutputType(context.node.data)])],
  jsonQueryNode: (context) => [input('json', 'JSON value', [jsonType], { required: true }), input('query', 'Query', [textType]), output(null, 'Query result', [declaredOutputType(context.node.data)])],
  regexParseNode: () => [input('text', 'Text', [textType], { required: true }), input('regex', 'Regular expression', [textType]), output(null, 'Matches', [containerType('list', jsonType)])],
  pythonNode: (context) => [...letterInputs(['A', 'B', 'C'], allInspectableTypes), output(null, 'Script result', [declaredOutputType(context.node.data)])],
  jsonBuilderNode: () => [...letterInputs(['A', 'B', 'C', 'D', 'E'], allInspectableTypes), output(null, 'JSON object', [jsonType])],
  htmlSandboxNode: () => [input('html', 'HTML', [textType]), input('css', 'CSS', [textType]), input('js', 'JavaScript', [textType]), output(null, 'HTML document', [textType])],
  apiFetchNode: (context) => [input(null, 'URL override', [textType]), output(null, 'HTTP response', [declaredOutputType(context.node.data)])],
  sqlQueryNode: () => [input('A', 'Rows A', [containerType('list', jsonType)], { required: true }), input('B', 'Rows B', [containerType('list', jsonType)]), input('query', 'SQL query', [textType]), output(null, 'Query rows', [containerType('list', jsonType)])],
  csvParserNode: (context) => [input('csv', context.node.data.mode === 'format' ? 'JSON rows' : 'CSV text', context.node.data.mode === 'format' ? [containerType('list', jsonType)] : [textType], { required: true }), input('mode', 'Mode', [textType]), input('delimiter', 'Delimiter', [textType]), output(null, context.node.data.mode === 'format' ? 'CSV text' : 'JSON rows', context.node.data.mode === 'format' ? [textType] : [containerType('list', jsonType)])],
  mathExpressionNode: () => [...letterInputs(['A', 'B', 'C'], [numberType]), input('expression', 'Expression', [textType]), output(null, 'Number result', [numberType])],
  xmlYamlNode: (context) => [input('text', 'Source data', context.node.data.mode === 'json-to-xml' || context.node.data.mode === 'json-to-yaml' ? [jsonType] : [textType], { required: true }), input('mode', 'Conversion mode', [textType]), output(null, 'Converted data', context.node.data.mode === 'json-to-xml' || context.node.data.mode === 'json-to-yaml' ? [textType] : [jsonType])],
} satisfies Record<FlowNodeType, PortResolver>;

export const FLOW_NODE_CONTRACTS = {
  textNode: define('textNode', 'source', 'Write a prompt or generate text for downstream nodes.', resolvers.textNode, [], ['imageGen'], 'text'),
  imageGen: define('imageGen', 'transform', 'Generate, edit, or extract an image using the selected provider and model.', resolvers.imageGen, ['textNode'], ['videoGen'], 'image'),
  cropImageNode: define('cropImageNode', 'transform', 'Crop one connected image locally and emit the cropped pixels.', resolvers.cropImageNode, ['imageGen'], ['imageGen']),
  videoGen: define('videoGen', 'transform', 'Generate or import video with prompt, frame, reference, and extension inputs.', resolvers.videoGen, ['textNode', 'imageGen'], ['composition'], 'video'),
  audioGen: define('audioGen', 'transform', 'Generate speech, sound effects, or voice-changed audio, or import an audio asset.', resolvers.audioGen, ['textNode'], ['composition'], 'audio'),
  transcriptionNode: define('transcriptionNode', 'transform', 'Transcribe connected media with ElevenLabs Scribe v2 or align a known transcript without changing its text.', resolvers.transcriptionNode, ['audioGen', 'videoGen'], ['sourceBin'], 'audio'),
  audioProcessNode: define('audioProcessNode', 'transform', 'Isolate dialogue from connected audio or video with ElevenLabs Voice Isolator.', resolvers.audioProcessNode, ['audioGen', 'videoGen'], ['audioGen', 'composition', 'sourceBin'], 'audio'),
  settings: define('settings', 'source', 'Provide reusable generation defaults for connected media nodes.', resolvers.settings, [], ['imageGen']),
  composition: define('composition', 'sink', 'Combine a video track and ordered audio tracks into a rendered composition.', resolvers.composition, ['videoGen', 'audioGen'], ['sourceBin']),
  sourceBin: define('sourceBin', 'sink', 'Ingest connected media and package outputs into a selected project source bin.', resolvers.sourceBin, ['composition'], []),
  valueNode: define('valueNode', 'source', 'Create an explicitly typed text, number, boolean, or JSON primitive.', resolvers.valueNode, [], ['comparisonNode']),
  list: define('list', 'container', 'Collect ordered compatible values into a typed list.', resolvers.list, ['imageGen'], ['expander']),
  expander: define('expander', 'transform', 'Select one indexed item from a list or envelope.', resolvers.expander, ['list'], ['valueMonitorNode']),
  envelope: define('envelope', 'container', 'Collect manual and connected items into a typed execution envelope.', resolvers.envelope, ['textNode'], ['runMeNode']),
  virtual: define('virtual', 'boundary', 'Alias an upstream output at another canvas location without copying it.', resolvers.virtual, ['imageGen'], ['videoGen']),
  portal: define('portal', 'boundary', 'Transport one typed value between a paired entrance and exit.', resolvers.portal, ['textNode'], ['imageGen']),
  advancedImageEditor: define('advancedImageEditor', 'transform', 'Route source, mask, and reference images through the advanced image editor bridge.', resolvers.advancedImageEditor, ['imageGen'], ['imageGen']),
  switchNode: define('switchNode', 'control', 'Pass or block one value using a manual or connected boolean condition.', resolvers.switchNode, ['logicNode'], ['imageGen']),
  forkSwitchNode: define('forkSwitchNode', 'control', 'Route one value to exactly one of two typed branches.', resolvers.forkSwitchNode, ['logicNode'], ['imageGen', 'videoGen']),
  runMeNode: define('runMeNode', 'sink', 'Provide an explicit button that executes its complete upstream dependency graph.', resolvers.runMeNode, ['envelope'], []),
  packageNode: define('packageNode', 'container', 'Bundle an image asset and descriptive text as one package value.', resolvers.packageNode, ['imageGen', 'textNode'], ['sourceBin']),
  loopNode: define('loopNode', 'control', 'Repeat one connected value a fixed number of times as a list.', resolvers.loopNode, ['textNode'], ['imageGen']),
  visionVerifyNode: define('visionVerifyNode', 'transform', 'Verify a generated image against a prompt and optional reference image.', resolvers.visionVerifyNode, ['imageGen', 'textNode'], ['conditionalNode'], 'text'),
  logicNode: define('logicNode', 'transform', 'Apply AND, OR, XOR, or NOT to explicit boolean inputs.', resolvers.logicNode, ['comparisonNode'], ['conditionalNode']),
  conditionalNode: define('conditionalNode', 'control', 'Select one of two compatible values from a boolean condition.', resolvers.conditionalNode, ['logicNode'], ['valueMonitorNode']),
  comparisonNode: define('comparisonNode', 'transform', 'Compare two text or number values and emit a boolean.', resolvers.comparisonNode, ['valueNode'], ['logicNode']),
  loopGateNode: define('loopGateNode', 'control', 'Pass a loop value only while an explicit boolean condition remains true.', resolvers.loopGateNode, ['loopNode', 'comparisonNode'], ['imageGen']),
  loopBreakNode: define('loopBreakNode', 'control', 'Emit a stop control when its boolean condition is true.', resolvers.loopBreakNode, ['visionVerifyNode'], ['imageGen']),
  listLengthNode: define('listLengthNode', 'transform', 'Count the items in a list or envelope and emit a number.', resolvers.listLengthNode, ['list'], ['comparisonNode']),
  mathNode: define('mathNode', 'transform', 'Perform the selected arithmetic operation on two numbers.', resolvers.mathNode, ['numberNode'], ['comparisonNode']),
  valueMonitorNode: define('valueMonitorNode', 'transform', 'Inspect and pass through any explicitly supported Flow value.', resolvers.valueMonitorNode, ['conditionalNode'], ['runMeNode']),
  stringTemplateNode: define('stringTemplateNode', 'transform', 'Render text by replacing A, B, and C placeholders.', resolvers.stringTemplateNode, ['textNode'], ['imageGen']),
  regexReplaceNode: define('regexReplaceNode', 'transform', 'Replace text that matches a configured regular expression.', resolvers.regexReplaceNode, ['textNode'], ['stringTemplateNode']),
  switchCaseNode: define('switchCaseNode', 'control', 'Activate one of three named branch outputs from a matching key.', resolvers.switchCaseNode, ['valueNode'], ['textNode']),
  promptsJoinerNode: define('promptsJoinerNode', 'transform', 'Join up to three prompt fragments with a configured delimiter.', resolvers.promptsJoinerNode, ['textNode'], ['imageGen']),
  negativePromptNode: define('negativePromptNode', 'transform', 'Combine prompt and exclusion text into a negative prompt.', resolvers.negativePromptNode, ['textNode'], ['imageGen']),
  seedSequencerNode: define('seedSequencerNode', 'transform', 'Generate a deterministic numeric seed from a base, increment, and sequence index.', resolvers.seedSequencerNode, ['numberNode'], ['imageGen']),
  promptMixerNode: define('promptMixerNode', 'transform', 'Blend two prompt fragments using a configured weight.', resolvers.promptMixerNode, ['textNode'], ['imageGen']),
  storyStateNode: define('storyStateNode', 'transform', 'Store and propagate one named story-continuity value.', resolvers.storyStateNode, ['valueNode'], ['stringTemplateNode']),
  arrayFlatNode: define('arrayFlatNode', 'container', 'Flatten up to three nested or adjacent lists into one list.', resolvers.arrayFlatNode, ['list'], ['expander']),
  textSentimentAnalysisNode: define('textSentimentAnalysisNode', 'transform', 'Score dialogue polarity with a deterministic local keyword heuristic.', resolvers.textSentimentAnalysisNode, ['textNode'], ['conditionalNode']),
  imageFeatureExtractorNode: define('imageFeatureExtractorNode', 'transform', 'Extract dimensions, orientation, aspect ratio, and average color from an image locally.', resolvers.imageFeatureExtractorNode, ['imageGen'], ['jsonQueryNode']),
  fallbackSelectorNode: define('fallbackSelectorNode', 'control', 'Use the primary value when usable, otherwise use the fallback value.', resolvers.fallbackSelectorNode, ['apiFetchNode', 'valueNode'], ['valueMonitorNode']),
  dialogueScriptSplitterNode: define('dialogueScriptSplitterNode', 'transform', 'Select dialogue lines for one character prefix from a script.', resolvers.dialogueScriptSplitterNode, ['textNode'], ['list']),
  numberNode: define('numberNode', 'source', 'Create one numeric value for math, indexing, seeds, or conditions.', resolvers.numberNode, [], ['mathNode']),
  colorSwatchNode: define('colorSwatchNode', 'source', 'Create a reusable palette prompt and individually connectable colors.', resolvers.colorSwatchNode, [], ['colorSwatchListNode']),
  colorSwatchListNode: define('colorSwatchListNode', 'transform', 'Label a connected subset of palette colors as scene guidance.', resolvers.colorSwatchListNode, ['colorSwatchNode'], ['imageGen']),
  loraSpecNode: define('loraSpecNode', 'source', 'Build validated JSON LoRA path and scale entries for compatible image models.', resolvers.loraSpecNode, [], ['imageGen']),
  slimgNode: define('slimgNode', 'transform', 'Save a connected image as editable .slimg data and emit its live flattened image.', resolvers.slimgNode, ['imageGen'], ['imageGen']),
  doodleNode: define('doodleNode', 'source', 'Package a sketch image and description as reference guidance.', resolvers.doodleNode, ['textNode'], ['imageGen']),
  groupNode: define('groupNode', 'ui-only', 'Organize related nodes visually without carrying or transforming data.', resolvers.groupNode, [], []),
  functionNode: define('functionNode', 'boundary', 'Expose a saved reusable subgraph through its declared typed function ports.', resolvers.functionNode, ['functionInputNode'], ['functionOutputNode']),
  functionInputNode: define('functionInputNode', 'boundary', 'Mark one typed entry value inside a reusable function graph.', resolvers.functionInputNode, [], ['functionNode']),
  functionOutputNode: define('functionOutputNode', 'boundary', 'Mark one typed exit value inside a reusable function graph.', resolvers.functionOutputNode, ['functionNode'], []),
  javascriptNode: define('javascriptNode', 'transform', 'Run JavaScript over A, B, and C with an explicitly declared result type.', resolvers.javascriptNode, ['valueNode'], ['valueMonitorNode']),
  jsonQueryNode: define('jsonQueryNode', 'transform', 'Extract a value from JSON using a configured query expression.', resolvers.jsonQueryNode, ['jsonBuilderNode'], ['valueMonitorNode']),
  regexParseNode: define('regexParseNode', 'transform', 'Parse text into structured regular-expression matches and groups.', resolvers.regexParseNode, ['textNode'], ['jsonQueryNode']),
  pythonNode: define('pythonNode', 'transform', 'Run the supported Python-like expression runtime over A, B, and C.', resolvers.pythonNode, ['valueNode'], ['valueMonitorNode']),
  jsonBuilderNode: define('jsonBuilderNode', 'transform', 'Construct a JSON object from up to five connected values.', resolvers.jsonBuilderNode, ['valueNode'], ['apiFetchNode']),
  htmlSandboxNode: define('htmlSandboxNode', 'transform', 'Render connected HTML, CSS, and JavaScript in an isolated preview.', resolvers.htmlSandboxNode, ['textNode'], ['valueMonitorNode']),
  apiFetchNode: define('apiFetchNode', 'transform', 'Perform a configured HTTP request and emit a declared response type.', resolvers.apiFetchNode, ['textNode'], ['jsonQueryNode']),
  sqlQueryNode: define('sqlQueryNode', 'transform', 'Run the supported SELECT and JOIN subset over JSON row lists.', resolvers.sqlQueryNode, ['csvParserNode'], ['jsonQueryNode']),
  csvParserNode: define('csvParserNode', 'transform', 'Convert CSV text to JSON rows or JSON rows to CSV text.', resolvers.csvParserNode, ['textNode'], ['sqlQueryNode']),
  mathExpressionNode: define('mathExpressionNode', 'transform', 'Evaluate a configured numeric expression over A, B, and C.', resolvers.mathExpressionNode, ['numberNode'], ['comparisonNode']),
  xmlYamlNode: define('xmlYamlNode', 'transform', 'Convert between JSON and supported XML or YAML text structures.', resolvers.xmlYamlNode, ['jsonBuilderNode'], ['apiFetchNode']),
} satisfies Record<FlowNodeType, FlowNodeContract>;

export function getFlowNodeContract(type: FlowNodeType): FlowNodeContract {
  return FLOW_NODE_CONTRACTS[type];
}

export function resolveFlowNodePorts(context: FlowNodeContractContext): readonly FlowPortContract[] {
  const ports = FLOW_NODE_CONTRACTS[context.node.type].resolvePorts(context);
  if (!LOOP_BREAK_TARGET_TYPES.has(context.node.type)
    || ports.some((port) => port.direction === 'input' && port.id === LOOP_BREAK_TARGET_HANDLE)) {
    return ports;
  }
  return [
    ...ports,
    input(LOOP_BREAK_TARGET_HANDLE, 'Stop control', [controlType]),
  ];
}

/** React Flow persists `undefined`, `null`, and an empty string as the same unnamed
 * handle. Every named handle remains exact and case-sensitive. */
export function normalizeFlowHandle(handle: string | null | undefined): string | null {
  return handle ? handle : null;
}

/** Resolve one port through the same dynamic contract used by connection validation. */
export function resolveFlowNodePort(
  context: FlowNodeContractContext,
  direction: FlowPortContract['direction'],
  handle: string | null | undefined,
): FlowPortContract | undefined {
  const normalizedHandle = normalizeFlowHandle(handle);
  return resolveFlowNodePorts(context)
    .find((port) => port.direction === direction && port.id === normalizedHandle);
}

function define(
  nodeType: FlowNodeType,
  role: FlowNodeExecutionRole,
  purpose: string,
  resolvePorts: PortResolver,
  upstream: readonly FlowNodeType[],
  downstream: readonly FlowNodeType[],
  apiCapability?: 'text' | 'image' | 'video' | 'audio',
): FlowNodeContract {
  return {
    type: nodeType,
    role,
    purpose,
    help: `${purpose} The node contract documents each accepted input, produced output, connection limit, and any setting that changes those ports.`,
    failureModes: [
      role === 'ui-only'
        ? 'The group can lose visual membership when referenced child nodes are deleted.'
        : 'Execution is blocked when required inputs are missing or a connected value has an incompatible type.',
    ],
    examples: [{
      title: `${humanizeNodeType(nodeType)} example`,
      upstream,
      downstream,
      description: buildExampleDescription(nodeType, upstream, downstream),
    }],
    resolvePorts,
    implementation: {
      status: role === 'ui-only' ? 'structural' : 'implemented',
      path: IMPLEMENTATION_PATHS[nodeType],
      apiCapability,
    },
  };
}

function input(
  id: string | null,
  label: string,
  types: readonly FlowDataType[],
  overrides: Partial<Omit<FlowPortContract, 'id' | 'direction' | 'label' | 'help' | 'types'>> = {},
): FlowPortContract {
  return {
    id,
    direction: 'input',
    label,
    help: `Accepts ${types.map(describeKind).join(' or ')}.`,
    types,
    required: false,
    maxConnections: 1,
    ordered: false,
    side: 'left',
    ...overrides,
    minConnections: overrides.required ? Math.max(1, overrides.minConnections ?? 1) : (overrides.minConnections ?? 0),
  };
}

function output(id: string | null, label: string, types: readonly FlowDataType[]): FlowPortContract {
  return {
    id,
    direction: 'output',
    label,
    help: `Produces ${types.map(describeKind).join(' or ')}.`,
    types,
    required: false,
    minConnections: 0,
    maxConnections: null,
    ordered: false,
    side: 'right',
  };
}

function resolveImagePorts(context: FlowNodeContractContext): readonly FlowPortContract[] {
  const modelCardPorts = resolveModelCardPorts(context.node);
  if (modelCardPorts) return modelCardPorts;
  const data = context.node.data;
  const provider = (typeof data.provider === 'string' ? data.provider : 'gemini') as ImageProvider;
  const modelId = typeof data.modelId === 'string' ? data.modelId : undefined;
  const model = getImageNodeControlModel(provider, modelId);
  const modelLabel = getImageModelDefinition(provider, modelId).label;
  const importMode = data.mediaMode === 'import';
  const editingSupported = model.capabilities.imageToImage || model.capabilities.promptEdit || model.capabilities.maskInpaint;
  const referenceSupported = model.capabilities.referenceImages;
  const maxReferences = referenceSupported ? model.capabilities.maxReferenceImages : 0;

  return [
    input(null, 'Prompt or video source', imagePromptInputTypes, {
      maxConnections: null,
      disabledReason: importMode ? 'Imported Image nodes are asset sources and do not consume prompt inputs.' : undefined,
    }),
    input('image-edit-source', 'Source image', imageCompositeInputTypes, {
      disabledReason: importMode
        ? 'Imported Image nodes do not edit an upstream image.'
        : editingSupported ? undefined : `${modelLabel} does not support image editing.`,
    }),
    input('image-mask', 'Mask image', imageCompositeInputTypes, {
      disabledReason: importMode
        ? 'Imported Image nodes do not use masks.'
        : model.capabilities.maskInpaint ? undefined : `${modelLabel} does not support mask inpainting.`,
    }),
    ...IMAGE_REFERENCE_HANDLES.map((id, index) => input(id, `Reference ${index + 1}`, imageReferenceInputTypes, {
      maxConnections: null,
      connectionGroups: [{ id: 'reference-image', types: imageCompositeInputTypes, maxConnections: 1 }],
      side: index % 2 === 0 ? 'left' : 'right',
      disabledReason: importMode
        ? 'Imported Image nodes do not use reference guidance.'
        : !referenceSupported
          ? `${modelLabel} does not support reference images.`
          : index >= maxReferences ? `${modelLabel} supports at most ${maxReferences} reference image${maxReferences === 1 ? '' : 's'}.` : undefined,
    })),
    output(null, 'Image', [imageType]),
  ];
}

function resolveVideoPorts(context: FlowNodeContractContext): readonly FlowPortContract[] {
  const modelCardPorts = resolveModelCardPorts(context.node);
  if (modelCardPorts) return modelCardPorts;
  const data = context.node.data;
  const modelId = typeof data.modelId === 'string' ? data.modelId : undefined;
  const provider = (typeof data.provider === 'string' ? data.provider : 'gemini') as VideoProvider;
  const importMode = data.mediaMode === 'import';
  const support = getVideoModelSupport(provider, modelId ?? '');
  const unsupported = (capability: boolean, description: string) => importMode
    ? 'Imported Video nodes do not consume generation inputs.'
    : capability ? undefined : `${modelId || 'The selected model'} does not support ${description} through this API route.`;

  return [
    input('video-prompt', 'Prompt / config', textualPromptInputTypes, { maxConnections: null, disabledReason: importMode ? 'Imported Video nodes do not consume prompts.' : undefined }),
    input('video-start-frame', 'Start frame', imageCompositeInputTypes, { disabledReason: unsupported(support.imageToVideo, 'image-to-video') }),
    input('video-end-frame', 'End frame', imageCompositeInputTypes, { disabledReason: unsupported(support.interpolation, 'first/last-frame interpolation') }),
    ...['video-reference-1', 'video-reference-2', 'video-reference-3'].map((id, index) => input(id, `Reference ${index + 1}`, imageReferenceInputTypes, {
      maxConnections: null,
      connectionGroups: [{ id: 'reference-image', types: imageCompositeInputTypes, maxConnections: 1 }],
      disabledReason: unsupported(support.referenceImages && index < support.maxReferenceImages, 'reference-image guidance'),
    })),
    input('video-source-video', support.videoEdit ? 'Video to edit' : 'Video to extend', [videoType], { disabledReason: unsupported(support.videoExtension || support.videoEdit, support.videoEdit ? 'video editing' : 'video extension') }),
    output(null, 'Video', [videoType]),
  ];
}

function resolveCompositionPorts(context: FlowNodeContractContext): readonly FlowPortContract[] {
  const data = context.node.data;
  const connectedAudioHandles = getConnectedCompositionAudioHandles(context.node.id, context.edges);
  const { effectiveCount: count } = resolveCompositionAudioTrackModel(data.compositionAudioTrackCount, connectedAudioHandles);
  // A Composition can be driven in two equivalent ways: an incoming Flow video edge, or the
  // sequence authored directly in the Video workspace. The executor already renders the embedded
  // sequence first; keeping the edge mandatory here prevented that valid route from ever reaching
  // the executor. Stage-only compositions are valid too (for titles/cards over a blank canvas).
  const hasEmbeddedEditorSequence = getEditorVisualClips(data).length > 0
    || getEditorStageObjects(data).length > 0;
  const presetId = data.editorExportPresetPlan?.presetId;
  const packageOutput = data.resultType === 'package'
    || presetId === 'png-image-sequence'
    || presetId === 'jpeg-image-sequence';
  return [
    input('composition-video', 'Video track', [videoType], { required: !hasEmbeddedEditorSequence }),
    ...Array.from({ length: count }, (_, index) => input(`composition-audio-${index + 1}`, `Audio track ${index + 1}`, [audioType], { ordered: true })),
    output(null, packageOutput ? 'Rendered image-sequence package' : 'Rendered video', [packageOutput ? packageType : videoType]),
  ];
}

function resolveListPorts(context: FlowNodeContractContext): readonly FlowPortContract[] {
  const relevantEdges = context.edges.filter((edge) => edge.target === context.node.id && /^list-item-\d+$/.test(edge.targetHandle ?? ''));
  const highestConnectedIndex = relevantEdges.reduce((highest, edge) => Math.max(highest, Number((edge.targetHandle ?? '').split('-').pop()) || 0), -1);
  const configuredCount = Math.max(1, Math.floor(finiteNumber(context.node.data.listSlotCount, 1)));
  const slotCount = Math.max(configuredCount, highestConnectedIndex + 2);
  const item = itemTypeFromData(context.node.data.envelopeItemKind ?? context.node.data.resultType);
  const accepted = item.kind === 'mixed' ? allKnownValueTypes : [item];
  return [
    ...Array.from({ length: slotCount }, (_, index) => input(`list-item-${index}`, `Item ${index + 1}`, accepted, { ordered: true })),
    output(null, 'Typed list', [containerType('list', item)]),
  ];
}

function resolveFunctionPorts(context: FlowNodeContractContext): readonly FlowPortContract[] {
  const contract = context.node.data.functionNode?.contract;
  if (!contract) return [input(null, 'Function input', allInspectableTypes), output(null, 'Function output', [unknownType])];
  return [
    ...[...contract.inputPorts].sort((a, b) => a.order - b.order).map((port) => input(port.id, port.label, functionInputTypes(port.resultType), { required: port.required, maxConnections: port.allowMultiple ? null : 1 })),
    ...[...contract.outputPorts].sort((a, b) => a.order - b.order).map((port) => output(port.id, port.label, [functionValueType(port.resultType)])),
  ];
}

function letterInputs(ids: readonly string[], types: readonly FlowDataType[]): FlowPortContract[] {
  return ids.map((id) => input(id, `Input ${id}`, types));
}

function primitiveType(value: unknown): FlowDataType {
  return value === 'number' || value === 'boolean' || value === 'json' ? type(value) : textType;
}

function declaredOutputType(data: NodeData): FlowDataType {
  const declared = data.declaredOutputType;
  return isFlowResultKind(declared) ? runtimeTypeFromResultType(declared) : unknownType;
}

function functionValueType(value: unknown): FlowDataType {
  if (value === 'any' || !isFlowResultKind(value)) return unknownType;
  return runtimeTypeFromResultType(value as Exclude<FunctionValueKind, 'any'>);
}

function functionInputTypes(value: unknown): readonly FlowDataType[] {
  if (value === 'any') return allInspectableTypes;
  if (value === 'list') return allListTypes;
  if (value === 'envelope') return allEnvelopeTypes;
  return [functionValueType(value)];
}

function itemTypeFromData(value: unknown): FlowDataType | { kind: 'mixed' } {
  if (value === 'mixed' || value === undefined || value === null) return { kind: 'mixed' };
  return isFlowResultKind(value) ? runtimeTypeFromResultType(value) : { kind: 'mixed' };
}

function type(kind: Exclude<FlowDataType['kind'], 'list' | 'envelope'>): FlowDataType {
  return { kind };
}

function containerType(kind: 'list' | 'envelope', item: FlowDataType | { kind: 'mixed' }): FlowDataType {
  return { kind, item };
}

function describeKind(value: FlowDataType): string {
  if (value.kind === 'list' || value.kind === 'envelope') {
    return `${value.kind}<${value.item.kind}>`;
  }
  return value.kind;
}

function finiteNumber(value: unknown, fallback: number): number {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function humanizeNodeType(value: string): string {
  return value.replace(/Node$/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (letter) => letter.toUpperCase());
}

function buildExampleDescription(
  nodeType: FlowNodeType,
  upstream: readonly FlowNodeType[],
  downstream: readonly FlowNodeType[],
): string {
  const before = upstream.length > 0 ? upstream.map(humanizeNodeType).join(' + ') : 'manual configuration';
  const after = downstream.length > 0 ? downstream.map(humanizeNodeType).join(' + ') : 'a completed workflow';
  return `Connect ${before} through ${humanizeNodeType(nodeType)} and continue to ${after}.`;
}

// Compile-time and runtime guard: additions to FLOW_NODE_TYPES cannot bypass this registry.
void (FLOW_NODE_TYPES satisfies readonly (keyof typeof FLOW_NODE_CONTRACTS)[]);
