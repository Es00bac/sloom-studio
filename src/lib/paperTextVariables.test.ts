import { describe, expect, it } from 'vitest';
import { addFrameToPaperPage, createDefaultPaperDocument, exportPaperDocumentToPrintHtml, parsePaperDocument, updatePaperDocumentSetup } from './paperDocument';
import { flattenPaperRichText } from './paperRichText';
import { compilePaperRenderPlan } from './paperRenderPlan';
import { buildPaperIdmlParts } from './paperIdmlExport';
import {
  PAPER_TEXT_TEMPLATE_LIMITS,
  normalizePaperTextConditions,
  normalizePaperTextVariables,
  resolvePaperRichTextTemplates,
  resolvePaperTextTemplates,
} from './paperTextVariables';
import type { PaperRichParagraph } from '../types/paper';

const templateContext = {
  textVariables: [
    { id: 'var-edition', name: 'edition', value: 'Issue One' },
    { id: 'var-loop', name: 'loop', value: '{{var:edition}}' },
  ],
  textConditions: [
    { id: 'condition-print', name: 'print', enabled: true },
    { id: 'condition-accessible', name: 'accessible', enabled: false },
  ],
} as const;

describe('Paper text variables and conditional text', () => {
  it('resolves bounded variables and nested named conditions without recursively interpreting replacement values', () => {
    const source = 'Edition {{var:edition}} — {{if:print}}Press{{else}}Screen{{/if}} {{if:accessible}}A11y {{if:print}}proof{{/if}}{{else}}standard{{/if}} — {{var:loop}}';

    expect(resolvePaperTextTemplates(source, templateContext)).toBe('Edition Issue One — Press standard — {{var:edition}}');
    expect(source).toContain('{{var:edition}}');
  });

  it('keeps malformed and unknown marker source visible rather than silently dropping authored content', () => {
    const source = 'Unknown {{var:missing}} / {{if:missing}}keep this{{else}}and this{{/if}} / {{if:print}}unclosed';

    expect(resolvePaperTextTemplates(source, templateContext)).toBe(source);
  });

  it('resolves markup split across rich runs while preserving authored rich source and replacement styling', () => {
    const source: PaperRichParagraph[] = [{
      runs: [
        { text: 'Edition {{va', fontWeight: '700' },
        { text: 'r:edition}} ', fontStyle: 'italic' },
        { text: '{{if:print}}Press', color: '#22c55e' },
        { text: '{{else}}Screen{{/if}}', color: '#ef4444' },
      ],
    }];
    const snapshot = structuredClone(source);

    const resolved = resolvePaperRichTextTemplates(source, templateContext)!;

    expect(flattenPaperRichText(resolved)).toBe('Edition Issue One Press');
    expect(resolved[0].runs.find((run) => run.text === 'Issue One')).toMatchObject({ fontWeight: '700' });
    expect(resolved[0].runs.find((run) => run.text === 'Press')).toMatchObject({ color: '#22c55e' });
    expect(source).toEqual(snapshot);
  });

  it('persists a sanitized catalog and resolves it in print and managed render-plan output without mutating authored source', async () => {
    const base = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Variable proof' }), templateContext);
    const added = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'text',
      label: 'Variable proof',
      xMm: 15,
      yMm: 20,
      widthMm: 100,
      heightMm: 30,
      text: '{{var:edition}} {{if:print}}Press{{else}}Screen{{/if}} {page}/{pages}',
    });

    const html = exportPaperDocumentToPrintHtml(added.document);
    const plan = await compilePaperRenderPlan(added.document);
    const parsed = parsePaperDocument(JSON.stringify(added.document));

    expect(html).toContain('Issue One Press 1/1');
    expect(html).not.toContain('{{var:edition}}');
    const textNode = plan.pages[0].nodes.find((node) => node.kind === 'text');
    expect(textNode?.kind).toBe('text');
    // The unmanaged test font intentionally has no glyph output, but the plan's source-coordinate map
    // still proves it composed the 19-character derived string rather than the longer authored markup.
    expect(textNode?.kind === 'text' ? textNode.composed.caretMap : []).toHaveLength('Issue One Press 1/1'.length + 1);
    expect(added.document.pages[0].frames[0].text).toBe('{{var:edition}} {{if:print}}Press{{else}}Screen{{/if}} {page}/{pages}');
    expect(parsed.textVariables).toEqual(templateContext.textVariables);
    expect(parsed.textConditions).toEqual(templateContext.textConditions);
  });

  it('fails closed while normalizing untrusted persisted catalog entries and bounds duplicate names', () => {
    expect(normalizePaperTextVariables([
      { id: 'one', name: 'Edition', value: 'First' },
      { id: 'two', name: 'edition', value: 'Second' },
      { id: 'bad', name: 'not allowed!', value: 'Discard' },
    ])).toEqual([{ id: 'one', name: 'edition', value: 'First' }]);
    expect(normalizePaperTextConditions([
      { id: 'print', name: 'PRINT', enabled: true },
      { id: 'duplicate', name: 'print', enabled: false },
      { id: 'untrusted', name: 'preview', enabled: 'yes' },
    ])).toEqual([
      { id: 'print', name: 'print', enabled: true },
      { id: 'untrusted', name: 'preview', enabled: false },
    ]);
    const bounded = normalizePaperTextVariables([
      { id: 'large', name: 'large', value: 'x'.repeat(PAPER_TEXT_TEMPLATE_LIMITS.maxValueLength + 32) },
    ]);
    expect(bounded?.[0]?.value).toHaveLength(PAPER_TEXT_TEMPLATE_LIMITS.maxValueLength);
    expect(normalizePaperTextVariables([{ id: 'oversized-name', name: `a${'x'.repeat(48)}`, value: 'discard' }])).toEqual([]);
  });

  it('resolves catalog values exactly once in print and IDML serializers', () => {
    const base = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Literal value proof' }), templateContext);
    const added = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'text',
      label: 'Literal variable value',
      xMm: 15,
      yMm: 20,
      widthMm: 100,
      heightMm: 30,
      text: '{{var:loop}}',
    });

    const html = exportPaperDocumentToPrintHtml(added.document);
    const idml = Object.values(buildPaperIdmlParts(added.document)).join('\n');

    expect(html).toContain('{{var:edition}}');
    expect(html).not.toContain('{{var:loop}}');
    expect(idml).toContain('<Content>{{var:edition}}</Content>');
    expect(idml).not.toContain('{{var:loop}}');
  });

  it('resolves folio markers contained in a variable value after template substitution', () => {
    const base = updatePaperDocumentSetup(createDefaultPaperDocument({ title: 'Variable folio proof' }), {
      textVariables: [{ id: 'var-running-head', name: 'running-head', value: 'Page {page} of {pages}' }],
    });
    const added = addFrameToPaperPage(base, base.pages[0].id, {
      kind: 'text',
      label: 'Running head',
      xMm: 15,
      yMm: 20,
      widthMm: 100,
      heightMm: 30,
      text: '{{var:running-head}}',
    });

    const html = exportPaperDocumentToPrintHtml(added.document);

    expect(html).toContain('Page 1 of 1');
    expect(added.document.pages[0].frames[0].text).toBe('{{var:running-head}}');
  });
});
