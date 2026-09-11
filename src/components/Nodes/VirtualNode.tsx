import { memo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { GitBranch, Link2 } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { NodeHelpText } from './NodeHelpText';
import { getCompatibleNodeActions } from '../../lib/nodeActionMenu';
import { resolveNodeDisplayTitle } from '../../lib/nodeBookmarks';
import { resolveVirtualSourceNode } from '../../lib/virtualNodes';
import { useFlowStore } from '../../store/flowStore';
import type { AppNodeProps, FlowNodeType } from '../../types/flow';

function VirtualNodeComponent({ id, data }: AppNodeProps) {
  const derived = useFlowStore(
    useShallow((state) => {
      const nodesById = new Map(state.nodes.map((node) => [node.id, node]));
      const virtualNode = nodesById.get(id);
      const sourceNode = virtualNode ? resolveVirtualSourceNode(virtualNode, nodesById, state.edges) : undefined;
      const sourceTitle = sourceNode
        ? resolveNodeDisplayTitle(getDefaultNodeTitle(sourceNode.type), sourceNode.data.customTitle)
        : undefined;
      const outputActionTypes =
        sourceNode && sourceNode.type !== 'virtual' ? sourceNode.type : undefined;
      return { sourceTitle, outputActionTypes };
    }),
  );
  const outputActions = derived.outputActionTypes
    ? getCompatibleNodeActions(derived.outputActionTypes)
    : [];

  return (
    <BaseNode
      nodeId={id}
      nodeType="virtual"
      icon={GitBranch}
      title="Virtual Node"
      outputActions={outputActions}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="rounded-lg border border-fuchsia-400/25 bg-fuchsia-500/10 p-3 text-xs text-fuchsia-50">
        <div className="flex items-center gap-2 font-semibold">
          <Link2 size={13} />
          {derived.sourceTitle ? `Alias of ${derived.sourceTitle}` : 'Waiting for a linked source'}
        </div>
        <NodeHelpText className="mt-2 text-fuchsia-50/75" helpKey="virtual" summary="How virtual aliasing works">
          Connect any completed or runnable node into this virtual node, then connect this node downstream. Downstream edges resolve as if they came from the linked source.
        </NodeHelpText>
      </div>
    </BaseNode>
  );
}

export const VirtualNode = memo(VirtualNodeComponent);

function getDefaultNodeTitle(type: FlowNodeType): string {
  switch (type) {
    case 'textNode':
      return 'Text Node';
    case 'imageGen':
      return 'Image Generation';
    case 'cropImageNode':
      return 'Crop Image';
    case 'videoGen':
      return 'Video Generation';
    case 'audioGen':
      return 'Audio Generation';
    case 'transcriptionNode':
      return 'Transcription';
    case 'audioProcessNode':
      return 'Audio Process';
    case 'settings':
      return 'Generation Defaults';
    case 'composition':
      return 'Composition';
    case 'sourceBin':
      return 'Source Bin';
    case 'valueNode':
      return 'Value';
    case 'list':
      return 'List';
    case 'expander':
      return 'Expander';
    case 'envelope':
      return 'Envelope';
    case 'virtual':
      return 'Virtual Node';
    case 'portal':
      return 'Portal';
    case 'advancedImageEditor':
      return 'Image Editor';
    case 'switchNode':
      return 'On/Off Switch';
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
      return 'Boolean Logic';
    case 'conditionalNode':
      return 'Conditional If/Else';
    case 'comparisonNode':
      return 'Value Comparison';
    case 'loopGateNode':
      return 'While Loop Gate';
    case 'loopBreakNode':
      return 'Stop When';
    case 'mathNode':
      return 'Math Operator';
    case 'listLengthNode':
      return 'List Length Counter';
    case 'valueMonitorNode':
      return 'Value Monitor';
    case 'stringTemplateNode':
      return 'String Template';
    case 'regexReplaceNode':
      return 'Regex Replace';
    case 'switchCaseNode':
      return 'Switch Case Router';
    case 'promptsJoinerNode':
      return 'Prompts Joiner';
    case 'negativePromptNode':
      return 'Negative Prompt Combiner';
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
      return 'Color Swatch';
    case 'colorSwatchListNode':
      return 'Color Swatch List';
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
      return 'JavaScript Script';
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
      return 'Custom Node';
  }
}
