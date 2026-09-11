import type { FlowNodeType } from '../types/flow';

export type FlowRuntimePortFamily =
  | 'prompt-context'
  | 'image-composite'
  | 'image-reference'
  | 'video-source'
  | 'audio-source'
  | 'generation-config'
  | 'container'
  | 'source-library'
  | 'pass-through'
  | 'primitive'
  | 'text-transform'
  | 'structured-data'
  | 'function-boundary'
  | 'execution-control'
  | 'editor-bridge';

export interface FlowRuntimePortEvidence {
  pattern: string;
  family: FlowRuntimePortFamily;
  consumer: string;
  verification: string;
}

const signal = 'src/lib/flowSignals.ts';
const signalTest = 'src/lib/flowSignals.test.ts';
const store = 'src/store/flowStore.ts';
const storeTest = 'src/store/flowStore.test.ts';
const list = 'src/lib/listNodes.ts';
const listTest = 'src/lib/listNodes.test.ts';
const codeTest = 'src/lib/flowSignals.test.ts';

const evidence = (
  pattern: string,
  family: FlowRuntimePortFamily,
  consumer: string,
  verification: string,
): FlowRuntimePortEvidence => ({ pattern, family, consumer, verification });

const controlBreak = evidence('control-break', 'execution-control', store, storeTest);
const anySignal = (pattern = '*') => evidence(pattern, 'pass-through', signal, signalTest);
const primitive = (pattern: string) => evidence(pattern, 'primitive', signal, signalTest);
const textTransform = (pattern: string) => evidence(pattern, 'text-transform', signal, signalTest);
const structured = (pattern: string) => evidence(pattern, 'structured-data', signal, codeTest);

/**
 * Independent runtime-evidence inventory for every Flow node type. This does not declare port
 * types; it names the consumer that must honor the types declared by `flowNodeContracts.ts` and
 * the regression suite that proves the behavior. The audit gate resolves actual dynamic ports and
 * requires each one to match an entry here.
 */
export const FLOW_RUNTIME_PORT_CAPABILITIES = {
  textNode: [evidence('default', 'prompt-context', store, storeTest), controlBreak],
  imageGen: [
    evidence('default', 'prompt-context', `${store}#collectPromptSignalForNode`, signalTest),
    evidence('image-edit-source', 'image-composite', `${store}#collectUpstreamImageInputForHandles`, storeTest),
    evidence('image-mask', 'image-composite', `${store}#collectImageMaskInput`, storeTest),
    evidence('image-reference-*', 'image-reference', `${store}#collectImageReferenceSlotInputs`, 'src/store/flowStore.referenceGroups.test.ts'),
    controlBreak,
  ],
  cropImageNode: [evidence('image', 'image-composite', `${store}#collectUpstreamImageInputForHandles`, storeTest), controlBreak],
  videoGen: [
    evidence('video-prompt', 'prompt-context', `${store}#collectPromptSignalForNode`, signalTest),
    evidence('video-start-frame', 'image-composite', `${store}#collectImageInputForHandle`, 'src/lib/videoFrameConnections.test.ts'),
    evidence('video-end-frame', 'image-composite', `${store}#collectImageInputForHandle`, 'src/lib/videoFrameConnections.test.ts'),
    evidence('video-reference-*', 'image-reference', `${store}#collectVideoReferenceSlotInputs`, 'src/lib/flowExecutionReferenceGroups.test.ts'),
    evidence('video-source-video', 'video-source', `${store}#collectVideoExtensionInput`, storeTest),
    controlBreak,
  ],
  audioGen: [evidence('default', 'audio-source', `${store}#collectUpstreamAudioInput`, storeTest), controlBreak],
  transcriptionNode: [
    evidence('media', 'audio-source', `${store}#collectUpstreamAudioInput/collectUpstreamVideoInput`, 'src/lib/flowExecutionTranscription.test.ts'),
    evidence('transcript', 'prompt-context', `${store}#collectPromptSignalForNode`, 'src/lib/flowExecutionTranscription.test.ts'),
    textTransform('transcript-text'),
    structured('timed-transcript'),
    textTransform('captions-vtt'),
    textTransform('captions-srt'),
    controlBreak,
  ],
  audioProcessNode: [
    evidence('media', 'audio-source', `${store}#collectUpstreamAudioInput/collectUpstreamVideoInput`, 'src/lib/flowExecutionAudioProcess.test.ts'),
    controlBreak,
  ],
  settings: [],
  composition: [
    evidence('composition-video', 'video-source', `${store}#collectResultInputForHandle`, storeTest),
    evidence('composition-audio-*', 'audio-source', `${store}#collectResultInputForHandle`, storeTest),
    controlBreak,
  ],
  sourceBin: [evidence('default', 'source-library', 'src/lib/sourceBin.ts', 'src/lib/sourceBin.test.ts')],
  valueNode: [],
  list: [evidence('list-item-*', 'container', `${list}#collectConnectedListItems`, listTest)],
  expander: [
    evidence('default', 'container', `${list}#buildExpanderSourceItems`, listTest),
    evidence('index', 'primitive', `${list}#resolveConnectedIndexValue`, listTest),
  ],
  envelope: [evidence('default', 'container', `${list}#collectEnvelopeItemsForEnvelopeNode`, listTest)],
  virtual: [evidence('default', 'pass-through', 'src/lib/virtualNodes.ts', 'src/lib/virtualNodes.test.ts')],
  portal: [evidence('default', 'pass-through', 'src/lib/virtualNodes.ts', 'src/lib/virtualNodes.test.ts')],
  advancedImageEditor: [
    evidence('sourceImage', 'editor-bridge', 'src/components/Nodes/AdvancedImageEditorNode.tsx', 'src/components/Nodes/AdvancedImageEditorNode.test.tsx'),
    evidence('mask', 'editor-bridge', 'src/components/Nodes/AdvancedImageEditorNode.tsx', 'src/components/Nodes/AdvancedImageEditorNode.test.tsx'),
    evidence('reference', 'editor-bridge', 'src/components/Nodes/AdvancedImageEditorNode.tsx', 'src/components/Nodes/AdvancedImageEditorNode.test.tsx'),
  ],
  switchNode: [primitive('condition'), anySignal('input')],
  forkSwitchNode: [primitive('condition'), anySignal('input')],
  runMeNode: [evidence('default', 'execution-control', `${store}#getExecutionDependencies`, storeTest)],
  packageNode: [
    evidence('image', 'image-composite', `${list}#resolvePackageNodeData`, listTest),
    textTransform('text'),
  ],
  loopNode: [evidence('default', 'container', `${signal}#evaluateLoopNode`, signalTest)],
  visionVerifyNode: [
    evidence('image', 'image-composite', `${store}#collectUpstreamImageInputForHandles`, storeTest),
    evidence('refImage', 'image-composite', `${store}#collectUpstreamImageInputForHandles`, storeTest),
    textTransform('prompt'),
    controlBreak,
  ],
  logicNode: [primitive('A'), primitive('B')],
  conditionalNode: [primitive('condition'), anySignal('valueIfTrue'), anySignal('valueIfFalse')],
  comparisonNode: [primitive('A'), primitive('B')],
  loopGateNode: [anySignal('input'), primitive('condition')],
  loopBreakNode: [primitive('condition')],
  mathNode: [primitive('A'), primitive('B')],
  listLengthNode: [evidence('default', 'container', `${signal}#resolveListLikeLength`, signalTest)],
  valueMonitorNode: [anySignal('default')],
  stringTemplateNode: [textTransform('A'), textTransform('B'), textTransform('C')],
  regexReplaceNode: [textTransform('default')],
  switchCaseNode: [primitive('key')],
  promptsJoinerNode: [textTransform('A'), textTransform('B'), textTransform('C')],
  negativePromptNode: [textTransform('text'), textTransform('exclude')],
  seedSequencerNode: [primitive('default')],
  promptMixerNode: [textTransform('A'), textTransform('B')],
  storyStateNode: [anySignal('default')],
  arrayFlatNode: [
    evidence('L1', 'container', `${signal}#evaluateArrayFlatNode`, signalTest),
    evidence('L2', 'container', `${signal}#evaluateArrayFlatNode`, signalTest),
    evidence('L3', 'container', `${signal}#evaluateArrayFlatNode`, signalTest),
  ],
  textSentimentAnalysisNode: [textTransform('default')],
  imageFeatureExtractorNode: [evidence('default', 'image-composite', 'src/components/Nodes/ImageFeatureExtractorNode.tsx', storeTest)],
  fallbackSelectorNode: [anySignal('primary'), anySignal('fallback')],
  dialogueScriptSplitterNode: [textTransform('default')],
  numberNode: [],
  colorSwatchNode: [],
  colorSwatchListNode: [textTransform('default')],
  loraSpecNode: [],
  slimgNode: [evidence('image', 'image-composite', 'src/components/Nodes/SlimgNode.tsx', storeTest)],
  doodleNode: [textTransform('default')],
  groupNode: [],
  functionNode: [evidence('*', 'function-boundary', `${store}#collectFunctionNodeInputs`, 'src/lib/functionNodes.test.ts'), controlBreak],
  functionInputNode: [],
  functionOutputNode: [evidence('default', 'function-boundary', signal, 'src/lib/functionNodes.test.ts')],
  javascriptNode: [structured('A'), structured('B'), structured('C')],
  jsonQueryNode: [structured('json'), textTransform('query')],
  regexParseNode: [textTransform('text'), textTransform('regex')],
  pythonNode: [structured('A'), structured('B'), structured('C')],
  jsonBuilderNode: [structured('A'), structured('B'), structured('C'), structured('D'), structured('E')],
  htmlSandboxNode: [textTransform('html'), textTransform('css'), textTransform('js')],
  apiFetchNode: [textTransform('default')],
  sqlQueryNode: [structured('A'), structured('B'), textTransform('query')],
  csvParserNode: [structured('csv'), textTransform('mode'), textTransform('delimiter')],
  mathExpressionNode: [primitive('A'), primitive('B'), primitive('C'), textTransform('expression')],
  xmlYamlNode: [structured('text'), textTransform('mode')],
} satisfies Record<FlowNodeType, readonly FlowRuntimePortEvidence[]>;

export function getFlowRuntimePortEvidence(
  nodeType: FlowNodeType,
  portId: string | null,
): FlowRuntimePortEvidence | undefined {
  const id = portId ?? 'default';
  const entries = FLOW_RUNTIME_PORT_CAPABILITIES[nodeType];
  return entries.find((entry) => entry.pattern === id)
    ?? entries.find((entry) => entry.pattern.endsWith('*') && id.startsWith(entry.pattern.slice(0, -1)));
}
