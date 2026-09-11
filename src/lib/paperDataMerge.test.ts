import { describe, expect, it } from 'vitest';
import {
  addFrameToPaperPage,
  createDefaultPaperDocument,
  parsePaperDocument,
  serializePaperDocument,
} from './paperDocument';
import {
  buildPaperDataMergeBatch,
  collectPaperDataMergeFields,
  createPaperDataMergeToken,
  exportPaperDataMergeJsonl,
  normalizePaperDataMergeSource,
  PAPER_DATA_MERGE_LIMITS,
  parsePaperDataMergeCsv,
  previewPaperDataMerge,
  resolvePaperDataMergeText,
} from './paperDataMerge';

describe('Paper data merge', () => {
  it('parses quoted CSV values and keeps the source bounded and deterministic', () => {
    const result = parsePaperDataMergeCsv('name,email\r\n"Ada, Lovelace",ada@example.test\r\nGrace,grace@example.test', 'Recipients');
    expect(result).toEqual({
      ok: true,
      source: {
        version: 1,
        name: 'Recipients',
        columns: [{ name: 'name' }, { name: 'email' }],
        records: [
          { id: 'AdaLovelace', values: { name: 'Ada, Lovelace', email: 'ada@example.test' } },
          { id: 'Grace', values: { name: 'Grace', email: 'grace@example.test' } },
        ],
      },
    });
  });

  it('rejects malformed, duplicate, and oversized imports before generation', () => {
    const duplicate = parsePaperDataMergeCsv('name,name\nAda,Ada');
    const malformed = parsePaperDataMergeCsv('name\n"Ada');
    const trailingText = parsePaperDataMergeCsv('name\n"Ada"oops');
    const oversized = parsePaperDataMergeCsv('name\n' + 'x'.repeat(4_194_305));
    expect(duplicate.ok).toBe(false);
    expect(malformed.ok).toBe(false);
    expect(trailingText.ok).toBe(false);
    expect(oversized.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error).toBe('duplicate-column');
    if (!malformed.ok) expect(malformed.error).toBe('invalid-quote');
    if (!trailingText.ok) expect(trailingText.error).toBe('invalid-quote');
    if (!oversized.ok) expect(oversized.error).toBe('too-large');
  });

  it('normalizes hostile persisted input without allowing recursive or unbounded values', () => {
    const source = normalizePaperDataMergeSource({
      version: 99,
      name: '  Recipients  ',
      columns: [{ name: 'Name', label: 'Display name' }, { name: 'name' }, { name: 'bad name' }],
      records: [
        { id: 'same id!', values: { name: '{{merge:email}}', ignored: 'drop' } },
        { id: 'same id!', values: { name: 'Grace' } },
      ],
    });
    expect(source).toEqual({
      version: 1,
      name: 'Recipients',
      columns: [{ name: 'name', label: 'Display name' }],
      records: [
        { id: 'sameid', values: { name: '{{merge:email}}' } },
        { id: 'sameid-2', values: { name: 'Grace' } },
      ],
    });
  });

  it('resolves authored tokens, reports missing fields, and does not recurse into values', () => {
    expect(createPaperDataMergeToken('First Name')).toBeUndefined();
    expect(createPaperDataMergeToken('First_Name')).toBe('{{merge:first_name}}');
    expect(resolvePaperDataMergeText(
      'Hello {{ merge:name }}, {{merge:email}} / {{merge:missing}}',
      { id: 'r1', values: { name: 'Ada', email: '{{merge:other}}' } },
    )).toEqual({
      text: 'Hello Ada, {{merge:other}} / {{merge:missing}}',
      changed: true,
      fields: ['name', 'email', 'missing'],
      missingFields: ['missing'],
    });
  });

  it('keeps prototype names literal and reports them missing instead of reading inherited values', () => {
    expect(resolvePaperDataMergeText('Value: {{merge:constructor}}', {
      id: 'r1', values: { name: 'Ada' },
    })).toEqual({
      text: 'Value: {{merge:constructor}}',
      changed: false,
      fields: ['constructor'],
      missingFields: ['constructor'],
    });
  });

  it('previews plain and rich text across document and parent-page frames without mutating the template', () => {
    let document = createDefaultPaperDocument({ title: 'Letter' });
    const pageId = document.pages[0].id;
    document = addFrameToPaperPage(document, pageId, {
      kind: 'text', xMm: 12, yMm: 12, widthMm: 80, heightMm: 30,
      text: 'To {{merge:name}}',
    }).document;
    document = addFrameToPaperPage(document, pageId, {
      kind: 'text', xMm: 12, yMm: 48, widthMm: 80, heightMm: 30,
      richText: [{ runs: [{ text: 'Email: {{merge:email}}' }], listMarker: '{{merge:name}}' }],
    }).document;
    const template = serializePaperDocument(document);
    const preview = previewPaperDataMerge(document, {
      id: 'ada', values: { name: 'Ada', email: 'ada@example.test' },
    });
    expect(preview.document.pages[0].frames[0].text).toBe('To Ada');
    expect(preview.document.pages[0].frames[1].richText?.[0].runs[0].text).toBe('Email: ada@example.test');
    expect(preview.resolvedFields).toEqual(['name', 'email']);
    expect(serializePaperDocument(document)).toBe(template);
  });

  it('uses canonical rich-text flattening for multi-run and list derived plain-text mirrors', () => {
    let document = createDefaultPaperDocument({ title: 'Rich merge' });
    const pageId = document.pages[0].id;
    document = addFrameToPaperPage(document, pageId, {
      kind: 'text', xMm: 12, yMm: 12, widthMm: 80, heightMm: 30,
      richText: [{ runs: [{ text: 'Dear ' }, { text: '{{merge:name}}' }, { text: ', welcome!' }] }, { runs: [{ text: '{{merge:item}}' }], listMarker: '1.' }],
    }).document;
    const preview = previewPaperDataMerge(document, {
      id: 'ada', values: { name: 'Ada', item: 'Item Ada' },
    });
    const frame = preview.document.pages[0].frames[0];
    expect(frame.text).toBe('Dear Ada, welcome!\n1.\tItem Ada');
    expect(frame.richText?.[0].runs.map((run) => run.text).join('')).toBe('Dear Ada, welcome!');
    expect(frame.richText?.[1].listMarker).toBe('1.');
  });

  it('builds stable derived documents and line-delimited export records', () => {
    const document = createDefaultPaperDocument({ title: 'Invitation' });
    const source = normalizePaperDataMergeSource({
      name: 'Guests', columns: [{ name: 'name' }], records: [{ id: 'ada', values: { name: 'Ada' } }],
    })!;
    const batch = buildPaperDataMergeBatch(document, source);
    expect(batch.items[0].document.id).toContain('-merge-ada');
    const lines = exportPaperDataMergeJsonl(document, source).split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).recordId).toBe('ada');
  });

  it('keeps every value for an import that sits inside the declared bounds', () => {
    const filler = (row: number, column: number, length: number) =>
      `${String.fromCharCode(97 + column)}${row}-`.repeat(Math.ceil(length / (String(row).length + 2))).slice(0, length);
    const csv = ['alpha,beta,gamma', ...Array.from({ length: 200 }, (_, row) =>
      [filler(row, 0, 700), filler(row, 1, 900), filler(row, 2, 1100)].join(','))].join('\n');
    const result = parsePaperDataMergeCsv(csv);
    if (!result.ok) throw new Error(`expected success, got ${result.error}`);
    expect(result.source.records).toHaveLength(200);
    expect(result.source.columns.map((column) => column.name)).toEqual(['alpha', 'beta', 'gamma']);
    const inputRows = csv.split('\n').slice(1);
    result.source.records.forEach((record, index) => {
      expect(record.values.alpha).toBe(inputRows[index].split(',')[0]);
      expect(record.values.beta).toBe(inputRows[index].split(',')[1]);
      expect(record.values.gamma).toBe(inputRows[index].split(',')[2]);
    });
  });

  it('fails explicitly instead of silently truncating when declared bounds cannot hold the values', () => {
    const wideRow = Array.from({ length: 6 }, () => 'v'.repeat(700)).join(',');
    const csv = ['one,two,three,four,five,six', ...Array.from({ length: 260 }, () => wideRow)].join('\n');
    // ~1.09M characters of values: inside every per-file/per-record/per-column/per-value limit
    // but past the combined value budget, which previously reported ok:true while dropping values.
    expect(csv.length).toBeLessThan(PAPER_DATA_MERGE_LIMITS.maxCsvLength);
    const overBudget = parsePaperDataMergeCsv(csv);
    expect(overBudget).toEqual({ ok: false, error: 'value-budget-exceeded' });

    const oversizedCell = parsePaperDataMergeCsv(`name\n${'x'.repeat(PAPER_DATA_MERGE_LIMITS.maxValueLength + 1)}`);
    expect(oversizedCell).toEqual({ ok: false, error: 'value-too-long' });

    const ragged = parsePaperDataMergeCsv('name,email\nAda,ada@example.test,extra');
    expect(ragged).toEqual({ ok: false, error: 'ragged-row' });

    expect(parsePaperDataMergeCsv(`name\nAda\n${'y'.repeat(PAPER_DATA_MERGE_LIMITS.maxValueLength)}`).ok).toBe(true);
  });

  it('rejects invalid headers with their own error code and keeps multi-cell all-empty rows', () => {
    expect(parsePaperDataMergeCsv('Bad Header,x\n1,2')).toEqual({ ok: false, error: 'invalid-header' });
    expect(parsePaperDataMergeCsv(',x\n1,2')).toEqual({ ok: false, error: 'invalid-header' });
    expect(parsePaperDataMergeCsv('good_name\nv')).toEqual({
      ok: true,
      source: {
        version: 1,
        name: 'CSV data',
        columns: [{ name: 'good_name' }],
        records: [{ id: 'v', values: { good_name: 'v' } }],
      },
    });

    const keptEmptyRow = parsePaperDataMergeCsv('alpha,beta\n,\n1,2');
    if (!keptEmptyRow.ok) throw new Error(`expected success, got ${keptEmptyRow.error}`);
    expect(keptEmptyRow.source.records).toEqual([
      { id: 'record-1', values: { alpha: '', beta: '' } },
      { id: '1', values: { alpha: '1', beta: '2' } },
    ]);

    const blankLinesIgnored = parsePaperDataMergeCsv('alpha,beta\n\n1,2\n\n');
    if (!blankLinesIgnored.ok) throw new Error(`expected success, got ${blankLinesIgnored.error}`);
    expect(blankLinesIgnored.source.records).toEqual([
      { id: '1', values: { alpha: '1', beta: '2' } },
    ]);

    const quotedSingleEmptyRows = parsePaperDataMergeCsv('name\n""\n\nAda\n""');
    if (!quotedSingleEmptyRows.ok) throw new Error(`expected success, got ${quotedSingleEmptyRows.error}`);
    expect(quotedSingleEmptyRows.source.records).toEqual([
      { id: 'record-1', values: { name: '' } },
      { id: 'Ada', values: { name: 'Ada' } },
      { id: 'record-3', values: { name: '' } },
    ]);
  });

  it('gives truncated long identities distinct deterministic derived documents', () => {
    const document = createDefaultPaperDocument({ title: 'Long id' });
    document.id = 'd'.repeat(400);
    const source = normalizePaperDataMergeSource({
      name: 'Guests',
      columns: [{ name: 'name' }],
      records: [{ id: 'left', values: {} }, { id: 'right', values: {} }],
    })!;
    const batch = buildPaperDataMergeBatch(document, source);
    const ids = batch.items.map((item) => item.document.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id.length).toBeLessThanOrEqual(192);
      expect(id.startsWith(`${'d'.repeat(120)}-merge-`)).toBe(true);
    }
    expect(buildPaperDataMergeBatch(document, source).items.map((item) => item.document.id)).toEqual(ids);
  });

  it('treats an emptied or absent source as removable and drops it from persisted JSON', () => {
    expect(normalizePaperDataMergeSource(undefined)).toBeUndefined();
    expect(normalizePaperDataMergeSource(null)).toBeUndefined();
    expect(normalizePaperDataMergeSource([])).toBeUndefined();
    expect(normalizePaperDataMergeSource({})).toBeUndefined();
    expect(normalizePaperDataMergeSource({ version: 1, name: '', columns: [], records: [] })).toBeUndefined();

    let document = createDefaultPaperDocument({ title: 'Round trip' });
    document = addFrameToPaperPage(document, document.pages[0].id, {
      kind: 'text', xMm: 12, yMm: 12, widthMm: 80, heightMm: 30, text: 'Hi {{merge:name}}',
    }).document;
    const bare = serializePaperDocument(document);
    expect(bare.includes('"dataMerge"')).toBe(false);
    expect(parsePaperDocument(bare).dataMerge).toBeUndefined();
  });

  it('finds authored fields and persists the source through Paper JSON', () => {
    let document = createDefaultPaperDocument({ title: 'Merge template' });
    document = addFrameToPaperPage(document, document.pages[0].id, {
      kind: 'text', xMm: 12, yMm: 12, widthMm: 80, heightMm: 30, text: 'Hi {{merge:name}}',
    }).document;
    expect(collectPaperDataMergeFields(document)).toEqual(['name']);
    const saved = serializePaperDocument({
      ...document,
      dataMerge: normalizePaperDataMergeSource({ name: 'Guests', columns: [{ name: 'name' }], records: [] }),
    });
    expect(parsePaperDocument(saved).dataMerge?.name).toBe('Guests');
  });
});
