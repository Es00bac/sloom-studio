import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(fileName: string): string {
  return readFileSync(new URL(fileName, import.meta.url), 'utf8');
}

describe('story utility node UI truthfulness', () => {
  it('shows computed sentiment rather than a hard-coded neutral placeholder', () => {
    const file = source('TextSentimentAnalysisNode.tsx');
    expect(file).toContain('analyzeTextSentiment');
    expect(file).not.toContain("'0.00 (Neutral)'");
  });

  it('describes the loop gate as a gate and does not expose an unused iteration limit', () => {
    const file = source('LoopGateNode.tsx');
    expect(file).toContain('Use Loop to repeat values');
    expect(file).not.toContain('Max Iterations:');
  });

  it('describes negative prompt and fallback behavior that matches their evaluators', () => {
    expect(source('NegativePromptNode.tsx')).not.toContain('Strips locally specified negative words');
    expect(source('FallbackSelectorNode.tsx')).not.toContain('error-tolerant script compilation');
  });
});
