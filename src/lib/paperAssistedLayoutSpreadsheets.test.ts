import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { normalizePaperAssistedLayoutSourceBundle } from './paperAssistedLayout';
import {
  parsePaperAssistedLayoutDelimitedText,
  parsePaperAssistedLayoutXlsx,
} from './paperAssistedLayoutSpreadsheets';

function buildXlsx(options: {
  worksheetXml?: string;
  relationshipsXml?: string;
  extraEntries?: Record<string, Uint8Array>;
} = {}): Uint8Array {
  const worksheetXml = options.worksheetXml ?? `
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1">
          <c r="A1" t="s"><v>0</v></c>
          <c r="B1" t="inlineStr"><is><t>North &amp; West</t></is></c>
        </row>
        <row r="2">
          <c r="A2"><v>42</v></c>
          <c r="C2" t="b"><v>1</v></c>
        </row>
      </sheetData>
    </worksheet>`;
  const relationshipsXml = options.relationshipsXml ?? `
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
    </Relationships>`;
  return zipSync({
    '[Content_Types].xml': strToU8(`
      <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      </Types>`),
    'xl/workbook.xml': strToU8(`
      <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <sheets><sheet name="Sales &amp; Forecast" sheetId="1" r:id="rId1"/></sheets>
      </workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(relationshipsXml),
    'xl/sharedStrings.xml': strToU8(`
      <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <si><t>Product</t></si>
      </sst>`),
    'xl/worksheets/sheet1.xml': strToU8(worksheetXml),
    ...options.extraEntries,
  }, { level: 6 });
}

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

describe('assisted-layout delimited spreadsheet extraction', () => {
  it('normalizes quoted CSV cells to an inert tab/newline table block', async () => {
    const bundle = await normalizePaperAssistedLayoutSourceBundle([
      new File(['Name,Notes\r\nAda,"Line one\nLine two"\r\nGrace,"Quoted ""word"""'], 'people.csv', { type: 'text/csv' }),
    ]);

    expect(bundle.files[0]).toMatchObject({
      title: 'people',
      format: 'csv',
      blocks: [{
        role: 'table',
        text: 'Name\tNotes\nAda\tLine one\nLine two\nGrace\tQuoted "word"',
      }],
    });
  });

  it('preserves TSV rows while keeping formula-like cells as literal text', async () => {
    const bundle = await normalizePaperAssistedLayoutSourceBundle([
      new File(['Item\tValue\nTotal\t=SUM(B2:B4)'], 'totals.tsv', { type: 'text/tab-separated-values' }),
    ]);

    expect(bundle.files[0]).toMatchObject({
      format: 'tsv',
      blocks: [{ role: 'table', text: 'Item\tValue\nTotal\t=SUM(B2:B4)' }],
    });
  });

  it('rejects malformed and over-limit delimited sources', () => {
    expect(() => parsePaperAssistedLayoutDelimitedText('a,"open', 'bad.csv', 'csv', 100))
      .toThrow(/unterminated quoted cell/i);
    expect(() => parsePaperAssistedLayoutDelimitedText('abcdef', 'large.csv', 'csv', 5))
      .toThrow(/exceeds 5 characters/i);
  });
});

describe('assisted-layout XLSX extraction', () => {
  it('extracts bounded worksheet values as heading and table blocks', async () => {
    const xlsx = buildXlsx();
    const bundle = await normalizePaperAssistedLayoutSourceBundle([
      new File([asArrayBuffer(xlsx)], 'sales.xlsx', {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    ]);

    expect(bundle.files[0]).toMatchObject({
      title: 'sales',
      format: 'xlsx',
      blocks: [
        { role: 'heading', text: 'Sales & Forecast' },
        { role: 'table', text: 'Product\tNorth & West\n42\t\tTRUE' },
      ],
    });
  });

  it('rejects formula workbooks rather than evaluating or forwarding formulas', async () => {
    const xlsx = buildXlsx({
      worksheetXml: '<worksheet><sheetData><row><c r="A1"><f>SUM(A2:A3)</f><v>42</v></c></row></sheetData></worksheet>',
    });
    await expect(normalizePaperAssistedLayoutSourceBundle([
      new File([asArrayBuffer(xlsx)], 'formula.xlsx'),
    ])).rejects.toMatchObject({
      issues: [expect.objectContaining({ message: expect.stringMatching(/contains formulas/i) })],
    });
  });

  it('rejects external relationships and embedded active content', async () => {
    const external = buildXlsx({
      relationshipsXml: '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="https://example.test/sheet.xml" TargetMode="External"/></Relationships>',
    });
    await expect(normalizePaperAssistedLayoutSourceBundle([
      new File([asArrayBuffer(external)], 'external.xlsx'),
    ])).rejects.toMatchObject({
      issues: [expect.objectContaining({ message: expect.stringMatching(/external relationship/i) })],
    });

    const embedded = buildXlsx({ extraEntries: { 'xl/embeddings/object.bin': strToU8('payload') } });
    await expect(normalizePaperAssistedLayoutSourceBundle([
      new File([asArrayBuffer(embedded)], 'embedded.xlsx'),
    ])).rejects.toMatchObject({
      issues: [expect.objectContaining({ message: expect.stringMatching(/active or external content/i) })],
    });
  });

  it('preflights suspicious archive expansion before decompression', () => {
    const suspicious = zipSync({
      '[Content_Types].xml': strToU8('A'.repeat(1_000_000)),
    }, { level: 9 });
    expect(() => parsePaperAssistedLayoutXlsx(suspicious, 'bomb.xlsx', 4_000_000))
      .toThrow(/suspicious compression ratio/i);
  });

  it('rejects legacy and macro-enabled Excel formats explicitly', async () => {
    await expect(normalizePaperAssistedLayoutSourceBundle([
      new File([asArrayBuffer(strToU8('legacy'))], 'legacy.xls', { type: 'application/vnd.ms-excel' }),
    ])).rejects.toMatchObject({
      issues: [expect.objectContaining({ message: expect.stringMatching(/legacy \.xls/i) })],
    });
    await expect(normalizePaperAssistedLayoutSourceBundle([
      new File([asArrayBuffer(strToU8('macro'))], 'macro.xlsm'),
    ])).rejects.toMatchObject({
      issues: [expect.objectContaining({ message: expect.stringMatching(/macro-enabled/i) })],
    });
  });
});
