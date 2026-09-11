import { describe, expect, it } from 'vitest';
import {
  loadProviderModelAudit,
  renderProviderModelAudit,
} from './generate-provider-model-audit.mjs';

describe('provider model audit generator', () => {
  it('covers every curated contract and every normal selectable option', async () => {
    const audit = await loadProviderModelAudit();

    expect(audit.rows).toHaveLength(182);
    expect(audit.normalOptions).toHaveLength(178);
    expect(audit.orphanNormalOptions).toEqual([]);
    expect(new Set(audit.rows.map((row) => `${row.capability}:${row.providerId}:${row.modelId}`)).size)
      .toBe(audit.rows.length);
  });

  it('requires evidence for verified contracts and omits vestigial models from normal selection', async () => {
    const audit = await loadProviderModelAudit();
    const vestigial = new Set([
      'eleven_ttv_v3',
      'eleven_multilingual_ttv_v2',
      'eleven_turbo_v2_5',
      'eleven_turbo_v2',
      'eleven_monolingual_v1',
      'eleven_multilingual_v1',
    ]);

    expect(audit.rows.filter((row) => row.lifecycle !== 'unverified' && row.evidence.length === 0)).toEqual([]);
    expect(audit.normalOptions.some((option) => vestigial.has(option.modelId))).toBe(false);
  });

  it('renders every contract with API, lifecycle, limits, evidence, and a Flow example', async () => {
    const markdown = renderProviderModelAudit(await loadProviderModelAudit());

    expect(markdown).toContain('# Provider and Model API Audit — 2026-07-14');
    expect(markdown).toContain('182 curated model contracts');
    expect(markdown.match(/^\| (?:text|image|video|audio) \|/gm)).toHaveLength(182);
    expect(markdown).toContain('## Catalog lifecycle changes');
  });
});
