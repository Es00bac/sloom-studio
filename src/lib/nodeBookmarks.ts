import type { AppNode, FlowNodeType } from '../types/flow';

export interface NodeBookmark {
  id: string;
  title: string;
  type: FlowNodeType;
}

export interface NodeBookmarkRenameResult {
  patch: {
    customTitle?: string;
  };
  shouldOpenBookmarkSidebar: boolean;
}

export function resolveNodeDisplayTitle(defaultTitle: string, customTitle: unknown): string {
  return typeof customTitle === 'string' && customTitle.trim()
    ? customTitle.trim()
    : defaultTitle;
}

export function resolveNodeBookmarkRename(rawTitle: string | null): NodeBookmarkRenameResult | undefined {
  if (rawTitle === null) {
    return undefined;
  }

  const title = rawTitle.trim();

  return {
    patch: {
      customTitle: title || undefined,
    },
    shouldOpenBookmarkSidebar: Boolean(title),
  };
}

export function collectNodeBookmarks(nodes: AppNode[]): NodeBookmark[] {
  return nodes.flatMap((node) => {
    const title = typeof node.data.customTitle === 'string' ? node.data.customTitle.trim() : '';

    return title
      ? [{
          id: node.id,
          title,
          type: node.type,
        }]
      : [];
  });
}

export function getNodeTypeLabel(type: FlowNodeType): string {
  switch (type) {
    case 'textNode':
      return 'Text';
    case 'imageGen':
      return 'Image';
    case 'cropImageNode':
      return 'Crop Image';
    case 'videoGen':
      return 'Video';
    case 'audioGen':
      return 'Audio';
    case 'transcriptionNode':
      return 'Transcription';
    case 'audioProcessNode':
      return 'Audio Process';
    case 'settings':
      return 'Config';
    case 'composition':
      return 'Composition';
    case 'sourceBin':
      return 'Source Bin';
    case 'list':
      return 'List';
    case 'expander':
      return 'Expander';
    case 'envelope':
      return 'Envelope';
    case 'valueNode':
      return 'Value';
    case 'virtual':
      return 'Virtual';
    case 'portal':
      return 'Portal';
    case 'advancedImageEditor':
      return 'Image Editor';
    case 'switchNode':
      return 'Switch';
    case 'forkSwitchNode':
      return 'Fork Switch';
    case 'runMeNode':
      return 'RUN ME Trigger';
    case 'packageNode':
      return 'Asset Package';
    case 'loopNode':
      return 'Simple Loop';
    case 'visionVerifyNode':
      return 'Vision Verify';
    case 'logicNode':
      return 'Logic';
    case 'conditionalNode':
      return 'Conditional';
    case 'comparisonNode':
      return 'Comparison';
    case 'loopGateNode':
      return 'Loop Gate';
    case 'loopBreakNode':
      return 'Stop When';
    case 'mathNode':
      return 'Math Operator';
    case 'listLengthNode':
      return 'List Length';
    case 'valueMonitorNode':
      return 'Value Monitor';
    case 'stringTemplateNode':
      return 'String Template';
    case 'regexReplaceNode':
      return 'Regex Replace';
    case 'switchCaseNode':
      return 'Switch Case';
    case 'promptsJoinerNode':
      return 'Prompts Joiner';
    case 'negativePromptNode':
      return 'Negative Prompt';
    case 'seedSequencerNode':
      return 'Seed Sequencer';
    case 'promptMixerNode':
      return 'Prompt Mixer';
    case 'storyStateNode':
      return 'Story State Setter';
    case 'arrayFlatNode':
      return 'List Flattener';
    case 'textSentimentAnalysisNode':
      return 'Text Sentiment Analyzer';
    case 'imageFeatureExtractorNode':
      return 'Image Feature Extractor';
    case 'fallbackSelectorNode':
      return 'Fallback Selector';
    case 'dialogueScriptSplitterNode':
      return 'Dialogue Script Splitter';
    case 'numberNode':
      return 'Number';
    case 'colorSwatchNode':
      return 'Color Palette';
    case 'colorSwatchListNode':
      return 'Color Swatch';
    case 'loraSpecNode':
      return 'LoRA Spec';
    case 'slimgNode':
      return '.slimg';
    case 'doodleNode':
      return 'Doodle';
    case 'functionNode':
      return 'Function';
    case 'groupNode':
      return 'Group';
    case 'functionInputNode':
      return 'Function Input Marker';
    case 'functionOutputNode':
      return 'Function Output Marker';
    case 'javascriptNode':
      return 'JavaScript';
    case 'jsonQueryNode':
      return 'JSON Query';
    case 'regexParseNode':
      return 'Regex Parse';
    case 'pythonNode':
      return 'Python Script';
    case 'jsonBuilderNode':
      return 'JSON Builder';
    case 'htmlSandboxNode':
      return 'HTML Sandbox';
    case 'apiFetchNode':
      return 'API Requester';
    case 'sqlQueryNode':
      return 'SQL Query';
    case 'csvParserNode':
      return 'CSV Interop';
    case 'mathExpressionNode':
      return 'Math Expression';
    case 'xmlYamlNode':
      return 'XML/YAML Interop';
    default:
      return 'Custom';
  }
}
