import { describe, expect, it } from 'vitest';
import { loadFlowNodeAuditRows, renderFlowNodeAudit } from './generate-flow-node-audit.mjs';

describe('Flow node audit generator', () => {
  it('derives one complete audit row for every registered node type', async () => {
    const rows = await loadFlowNodeAuditRows();

    expect(rows).toHaveLength(65);
    expect(new Set(rows.map((row) => row.type)).size).toBe(rows.length);
    for (const row of rows) {
      expect(row.label.trim()).not.toBe('');
      expect(row.purpose.trim().length).toBeGreaterThan(12);
      expect(row.inputs).toBeTruthy();
      expect(row.outputs).toBeTruthy();
      expect(row.example.trim().length).toBeGreaterThan(12);
      expect(row.implementation).toMatch(/^src\//);
      expect(row.verification).toContain('flowNodeContracts.test.ts');
    }
  });

  it('renders a stable generated matrix without placeholder text', async () => {
    const markdown = renderFlowNodeAudit(await loadFlowNodeAuditRows());

    expect(markdown).toContain('# Flow Node Contract/Runtime Parity Audit — 2026-07-15');
    expect(markdown).not.toContain('MISSING RUNTIME EVIDENCE');
    expect(markdown).toContain('Runtime evidence');
    expect(markdown).toContain('65 registered node types');
    expect(markdown).not.toMatch(/\b(?:TODO|TBD|placeholder)\b/i);
    expect(markdown.match(/^\| `[^`]+` \|/gm)).toHaveLength(65);
  });
});
