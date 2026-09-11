import { memo, useMemo } from 'react';
import { Eye } from 'lucide-react';
import { BaseNode } from './BaseNode';
import { useFlowStore } from '../../store/flowStore';
import { evaluateNodeSignal, signalToText } from '../../lib/flowSignals';
import { analyzeTextSentiment } from '../../lib/storyUtilityNodes';
import type { AppNodeProps } from '../../types/flow';

function TextSentimentAnalysisNodeComponent({ id, data }: AppNodeProps) {
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);
  const result = useMemo(() => {
    const edge = edges.find((candidate) => candidate.target === id);
    const text = edge
      ? signalToText(evaluateNodeSignal(edge.source, nodes, edges, new Set(), undefined, edge.sourceHandle))
      : '';
    return analyzeTextSentiment(text);
  }, [edges, id, nodes]);

  return (
    <BaseNode
      nodeId={id}
      nodeType="textSentimentAnalysisNode"
      icon={Eye}
      title="Text Sentiment Analyzer"
      hasInput={true}
      hasOutput={true}
      error={data.error}
      statusMessage={data.statusMessage}
      retryState={data.retryState}
    >
      <div className="flex flex-col gap-2 rounded-lg border border-purple-500/20 bg-purple-500/5 p-3 text-xs">
        <div className="flex flex-col gap-1.5">
          <label className="font-semibold text-gray-400">Current Score:</label>
          <div className="rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-xs text-purple-300 font-mono text-center">
            {result.score.toFixed(2)} ({result.label})
          </div>
        </div>
        <div className="mt-1 leading-5 text-gray-400">
          Runs a deterministic local positive/negative keyword heuristic. The JSON output includes score, label, and match counts; it is not a model-based emotion diagnosis.
        </div>
      </div>
    </BaseNode>
  );
}

export const TextSentimentAnalysisNode = memo(TextSentimentAnalysisNodeComponent);
