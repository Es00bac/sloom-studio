import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Source-level wiring checks for the MH-094/MH-097 real-browser UX repair (Faye Rowan's
// NOT QUALIFIED verdicts). App.tsx is exercised end to end by real-browser QA, not mounted
// here; these guard the specific call-site wiring a regression could silently drop.
describe('App.tsx MH-094/MH-097 UX repair wiring', () => {
  const source = () => readFileSync(new URL('./App.tsx', import.meta.url), 'utf8');

  it('routes viewport-center placement through the Source-Bin-aware resolver instead of the plain geometric center', () => {
    const text = source();
    expect(text).toContain("document.querySelector('[data-flow-source-bin-panel=\"true\"]')");
    expect(text).toContain('resolveFlowViewportCenterScreenPoint(');
  });

  it('re-centers the camera on inserted content through the Source-Bin-aware target instead of a plain setCenter, so the pan does not drag the graph back under the panel', () => {
    const text = source();
    expect(text).toContain('resolveSourceBinAwareSetCenterTarget');
    expect(text).toMatch(/setCenterClearOfSourceBin\(\s*\{ x: position\.x \+ bounds\.width \/ 2, y: position\.y \+ bounds\.height \/ 2 \}/);
    // Both the starter-template and node-pack insertion paths must use it, not a bare setCenter.
    const setCenterClearCalls = text.match(/setCenterClearOfSourceBin\(/g) ?? [];
    expect(setCenterClearCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('selects newly-installed node-pack nodes so the import leaves a visible confirmation', () => {
    const text = source();
    expect(text).toMatch(
      /insertTemplate\(buildFlowNodePackInsertPayload\(parsed\.value\), position, \{ select: true \}\);/,
    );
  });

  it('does not select newly-inserted starter-template nodes (Faye Rowan did not flag this for MH-094)', () => {
    const text = source();
    expect(text).toMatch(
      /insertTemplate\(buildStarterTemplateInsertPayload\(template\), position\);/,
    );
  });
});
