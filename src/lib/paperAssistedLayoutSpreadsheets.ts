import { strFromU8 } from 'fflate';
import { unzipBoundedZipSync } from './boundedZip';

/**
 * Spreadsheet extraction is intentionally lossy and inert. It produces only
 * headings and tab/newline-delimited table text; it never evaluates formulas,
 * follows relationships, loads remote resources, or preserves executable
 * workbook features.
 */

export const PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS = {
  maxSheets: 64,
  maxRows: 20_000,
  maxColumns: 4_096,
  maxCells: 250_000,
  maxArchiveEntries: 2_048,
  maxArchiveEntryBytes: 16 * 1024 * 1024,
  maxArchiveUncompressedBytes: 64 * 1024 * 1024,
  maxArchiveCompressionRatio: 200,
} as const;

export type PaperAssistedLayoutSpreadsheetFormat = 'csv' | 'tsv' | 'xlsx';

export interface PaperAssistedLayoutSpreadsheetBlock {
  role: 'heading' | 'table';
  text: string;
}

export interface PaperAssistedLayoutSpreadsheetExtraction {
  title: string;
  format: PaperAssistedLayoutSpreadsheetFormat;
  blocks: PaperAssistedLayoutSpreadsheetBlock[];
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const UNSUPPORTED_SPREADSHEET_MIMES = new Set([
  'application/vnd.ms-excel',
  'application/vnd.ms-excel.sheet.binary.macroenabled.12',
  'application/vnd.ms-excel.sheet.macroenabled.12',
]);
const ACTIVE_OR_EXTERNAL_XLSX_PATH = /(?:^|\/)(?:activex|embeddings|externallinks|macrosheets|dialogsheets|querytables|webextensions|customui)(?:\/|$)|(?:^|\/)(?:connections|calcchain)\.xml$|(?:^|\/)vbaproject\.bin$/i;
const XML_FORMULA = /<(?:[A-Za-z_][\w.-]*:)?f(?:\s|>|\/)/i;
const XML_EXTERNAL_REFERENCES = /<(?:[A-Za-z_][\w.-]*:)?externalReferences(?:\s|>)/i;

export function inferPaperAssistedLayoutSpreadsheetFormat(
  fileName: string,
  mimeType?: string,
): PaperAssistedLayoutSpreadsheetFormat | 'unsupported-spreadsheet' | undefined {
  const lowerName = fileName.toLowerCase();
  const normalizedMime = mimeType?.split(';', 1)[0]?.trim().toLowerCase();
  if (
    lowerName.endsWith('.xls')
    || lowerName.endsWith('.xlsm')
    || lowerName.endsWith('.xlsb')
  ) {
    return 'unsupported-spreadsheet';
  }
  if (lowerName.endsWith('.csv')) return 'csv';
  if (lowerName.endsWith('.tsv')) return 'tsv';
  if (lowerName.endsWith('.xlsx')) return 'xlsx';
  if (normalizedMime === 'text/csv' || normalizedMime === 'application/csv') return 'csv';
  if (normalizedMime === 'text/tab-separated-values') return 'tsv';
  if (normalizedMime === XLSX_MIME) return 'xlsx';
  if (UNSUPPORTED_SPREADSHEET_MIMES.has(normalizedMime ?? '')) return 'unsupported-spreadsheet';
  return undefined;
}

export function parsePaperAssistedLayoutDelimitedText(
  text: string,
  fileName: string,
  format: Extract<PaperAssistedLayoutSpreadsheetFormat, 'csv' | 'tsv'>,
  maxCharacters: number,
): PaperAssistedLayoutSpreadsheetExtraction {
  if (text.length > maxCharacters) {
    throw new Error(`spreadsheet text exceeds ${maxCharacters} characters`);
  }
  const rows = parseDelimitedRows(text, format === 'csv' ? ',' : '\t');
  const tableText = rows.map((row) => row.join('\t')).join('\n');
  if (tableText.length > maxCharacters) {
    throw new Error(`normalized spreadsheet text exceeds ${maxCharacters} characters`);
  }
  return {
    title: stripExtension(fileName),
    format,
    blocks: tableText ? [{ role: 'table', text: tableText }] : [],
  };
}

export function parsePaperAssistedLayoutXlsx(
  bytes: Uint8Array,
  fileName: string,
  maxCharacters: number,
): PaperAssistedLayoutSpreadsheetExtraction {
  const archive = unzipBoundedZipSync(bytes, {
    archiveLabel: 'XLSX',
    maxEntries: PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxArchiveEntries,
    maxEntryUncompressedBytes: PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxArchiveEntryBytes,
    maxTotalUncompressedBytes: PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxArchiveUncompressedBytes,
    maxCompressionRatio: PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxArchiveCompressionRatio,
  });

  const contentTypes = readRequiredXml(archive, '[Content_Types].xml');
  if (/macroEnabled|vbaProject|activeX|oleObject|externalLink/i.test(decodeXmlEntities(contentTypes))) {
    throw new Error('XLSX contains active, embedded, macro, or external content');
  }
  Object.entries(archive).forEach(([path, entry]) => {
    if (ACTIVE_OR_EXTERNAL_XLSX_PATH.test(path)) {
      throw new Error(`XLSX contains unsupported active or external content: ${path}`);
    }
    if (path.toLowerCase().endsWith('.rels')) {
      const relationships = readXmlBytes(entry, path);
      if (containsExternalRelationship(relationships)) {
        throw new Error(`XLSX contains an external relationship: ${path}`);
      }
    }
  });

  const workbookXml = readRequiredXml(archive, 'xl/workbook.xml');
  if (XML_EXTERNAL_REFERENCES.test(workbookXml)) {
    throw new Error('XLSX contains external workbook references');
  }
  const workbookRelationships = readRequiredXml(archive, 'xl/_rels/workbook.xml.rels');
  const relationshipTargets = parseWorkbookRelationships(workbookRelationships);
  const sheets = parseWorkbookSheets(workbookXml);
  if (sheets.length === 0) throw new Error('XLSX does not contain any readable worksheets');
  if (sheets.length > PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxSheets) {
    throw new Error(`XLSX exceeds ${PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxSheets} worksheets`);
  }

  const sharedStrings = archive['xl/sharedStrings.xml']
    ? parseSharedStrings(readXmlBytes(archive['xl/sharedStrings.xml'], 'xl/sharedStrings.xml'))
    : [];
  const blocks: PaperAssistedLayoutSpreadsheetBlock[] = [];
  let totalCharacters = 0;
  let totalRows = 0;
  let totalCells = 0;

  sheets.forEach((sheet) => {
    const target = relationshipTargets.get(sheet.relationshipId);
    if (!target || target.type !== 'worksheet') {
      throw new Error(`XLSX worksheet ${sheet.name} has a missing or invalid relationship`);
    }
    const worksheetPath = resolveWorkbookTarget(target.path);
    const worksheetXml = readRequiredXml(archive, worksheetPath);
    if (XML_FORMULA.test(worksheetXml)) {
      throw new Error(`XLSX worksheet ${sheet.name} contains formulas; formulas are not imported`);
    }
    const extracted = parseWorksheet(worksheetXml, sharedStrings);
    totalRows += extracted.rows;
    totalCells += extracted.cells;
    if (totalRows > PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxRows) {
      throw new Error(`XLSX exceeds ${PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxRows} rows`);
    }
    if (totalCells > PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxCells) {
      throw new Error(`XLSX exceeds ${PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxCells} cells`);
    }
    totalCharacters += sheet.name.length + extracted.text.length;
    if (totalCharacters > maxCharacters) {
      throw new Error(`XLSX text exceeds ${maxCharacters} characters`);
    }
    blocks.push({ role: 'heading', text: sheet.name });
    if (extracted.text) blocks.push({ role: 'table', text: extracted.text });
  });

  return {
    title: stripExtension(fileName),
    format: 'xlsx',
    blocks,
  };
}

function parseDelimitedRows(text: string, delimiter: ',' | '\t'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let cellCount = 0;

  const pushCell = () => {
    row.push(normalizeSpreadsheetText(cell));
    cell = '';
    cellCount += 1;
    if (row.length > PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxColumns) {
      throw new Error(`spreadsheet row exceeds ${PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxColumns} columns`);
    }
    if (cellCount > PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxCells) {
      throw new Error(`spreadsheet exceeds ${PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxCells} cells`);
    }
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
    if (rows.length > PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxRows) {
      throw new Error(`spreadsheet exceeds ${PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxRows} rows`);
    }
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += character;
      }
      continue;
    }
    if (character === '"' && cell.length === 0) {
      inQuotes = true;
    } else if (character === delimiter) {
      pushCell();
    } else if (character === '\n') {
      pushRow();
    } else if (character === '\r') {
      if (text[index + 1] === '\n') index += 1;
      pushRow();
    } else {
      cell += character;
    }
  }
  if (inQuotes) throw new Error('spreadsheet contains an unterminated quoted cell');
  if (cell || row.length > 0) pushRow();

  while (rows.length > 0 && rows[rows.length - 1].every((value) => value === '')) rows.pop();
  return rows;
}

function readRequiredXml(archive: Record<string, Uint8Array>, path: string): string {
  const entry = archive[path];
  if (!entry) throw new Error(`XLSX archive is missing ${path}`);
  return readXmlBytes(entry, path);
}

function readXmlBytes(bytes: Uint8Array, path: string): string {
  if (bytes.byteLength > PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxArchiveEntryBytes) {
    throw new Error(`XLSX XML part ${path} is too large`);
  }
  const text = strFromU8(bytes);
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error(`XLSX XML part ${path} contains a forbidden declaration`);
  return text;
}

interface WorkbookRelationship {
  type: 'worksheet' | 'other';
  path: string;
}

function parseWorkbookRelationships(xml: string): Map<string, WorkbookRelationship> {
  const relationships = new Map<string, WorkbookRelationship>();
  for (const match of xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?Relationship\b([^>]*)\/?\s*>/gi)) {
    const attributes = parseXmlAttributes(match[1]);
    const id = attributes.Id ?? attributes.id;
    const target = attributes.Target ?? attributes.target;
    const type = attributes.Type ?? attributes.type ?? '';
    if (!id || !target) continue;
    if (relationships.has(id)) throw new Error(`XLSX contains duplicate workbook relationship ${id}`);
    relationships.set(id, { type: /\/worksheet$/i.test(type) ? 'worksheet' : 'other', path: target });
    if (relationships.size > PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxArchiveEntries) {
      throw new Error('XLSX contains too many workbook relationships');
    }
  }
  return relationships;
}

function parseWorkbookSheets(xml: string): Array<{ name: string; relationshipId: string }> {
  const sheets: Array<{ name: string; relationshipId: string }> = [];
  for (const match of xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?sheet\b([^>]*)\/?\s*>/gi)) {
    const attributes = parseXmlAttributes(match[1]);
    const name = normalizeSpreadsheetText(decodeXmlEntities(attributes.name ?? '')).slice(0, 512);
    const relationshipId = attributes['r:id'] ?? attributes.id ?? '';
    if (!name || !relationshipId) throw new Error('XLSX contains a worksheet without a name or relationship');
    sheets.push({ name, relationshipId });
    if (sheets.length > PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxSheets) {
      throw new Error(`XLSX exceeds ${PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxSheets} worksheets`);
    }
  }
  return sheets;
}

function resolveWorkbookTarget(target: string): string {
  const decoded = decodeXmlEntities(target).replaceAll('\\', '/');
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(decoded) || decoded.startsWith('//')) {
    throw new Error('XLSX worksheet relationship points outside the workbook');
  }
  const segments = (decoded.startsWith('/') ? decoded.slice(1) : `xl/${decoded}`).split('/');
  const resolved: string[] = [];
  segments.forEach((segment) => {
    if (!segment || segment === '.') return;
    if (segment === '..') {
      if (resolved.length === 0) throw new Error('XLSX worksheet relationship escapes the workbook');
      resolved.pop();
    } else {
      resolved.push(segment);
    }
  });
  const path = resolved.join('/');
  if (!path.toLowerCase().startsWith('xl/worksheets/')) {
    throw new Error('XLSX worksheet relationship does not reference a worksheet part');
  }
  return path;
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  for (const match of xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?si\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?si>/gi)) {
    const withoutPhonetics = match[1].replace(/<(?:[A-Za-z_][\w.-]*:)?rPh\b[\s\S]*?<\/(?:[A-Za-z_][\w.-]*:)?rPh>/gi, '');
    const text = [...withoutPhonetics.matchAll(/<(?:[A-Za-z_][\w.-]*:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t>/gi)]
      .map((textMatch) => decodeXmlEntities(textMatch[1]))
      .join('');
    strings.push(normalizeSpreadsheetText(text));
    if (strings.length > PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxCells) {
      throw new Error('XLSX shared-string table is too large');
    }
  }
  return strings;
}

function parseWorksheet(xml: string, sharedStrings: readonly string[]): { text: string; rows: number; cells: number } {
  const renderedRows: string[] = [];
  let cellCount = 0;
  for (const rowMatch of xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?row\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?row>/gi)) {
    const cells: string[] = [];
    const occupiedColumns = new Set<number>();
    let implicitColumn = 0;
    for (const cellMatch of rowMatch[1].matchAll(/<(?:[A-Za-z_][\w.-]*:)?c\b([^>]*)>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?c>/gi)) {
      const attributes = parseXmlAttributes(cellMatch[1]);
      const reference = attributes.r ?? '';
      const explicitColumn = reference ? columnIndexFromCellReference(reference) : undefined;
      const column = explicitColumn ?? implicitColumn;
      if (column >= PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxColumns) {
        throw new Error(`XLSX row exceeds ${PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxColumns} columns`);
      }
      if (occupiedColumns.has(column)) throw new Error(`XLSX row contains duplicate cell column ${column + 1}`);
      occupiedColumns.add(column);
      cells[column] = parseCellValue(cellMatch[2], attributes.t, sharedStrings);
      implicitColumn = column + 1;
      cellCount += 1;
      if (cellCount > PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxCells) {
        throw new Error(`XLSX exceeds ${PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxCells} cells`);
      }
    }
    while (cells.length > 0 && (cells[cells.length - 1] ?? '') === '') cells.pop();
    renderedRows.push(Array.from({ length: cells.length }, (_, index) => cells[index] ?? '').join('\t'));
    if (renderedRows.length > PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxRows) {
      throw new Error(`XLSX exceeds ${PAPER_ASSISTED_LAYOUT_SPREADSHEET_LIMITS.maxRows} rows`);
    }
  }
  while (renderedRows.length > 0 && renderedRows[renderedRows.length - 1] === '') renderedRows.pop();
  return { text: renderedRows.join('\n'), rows: renderedRows.length, cells: cellCount };
}

function parseCellValue(xml: string, type: string | undefined, sharedStrings: readonly string[]): string {
  if (type === 'inlineStr') {
    return normalizeSpreadsheetText([...xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?t\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?t>/gi)]
      .map((match) => decodeXmlEntities(match[1]))
      .join(''));
  }
  const raw = /<(?:[A-Za-z_][\w.-]*:)?v\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z_][\w.-]*:)?v>/i.exec(xml)?.[1] ?? '';
  const decoded = normalizeSpreadsheetText(decodeXmlEntities(raw));
  if (type === 's') {
    if (!/^\d+$/.test(decoded)) throw new Error('XLSX contains an invalid shared-string reference');
    const value = sharedStrings[Number(decoded)];
    if (value === undefined) throw new Error('XLSX references a missing shared string');
    return value;
  }
  if (type === 'b') return decoded === '1' ? 'TRUE' : decoded === '0' ? 'FALSE' : decoded;
  return decoded;
}

function columnIndexFromCellReference(reference: string): number {
  const match = /^([A-Za-z]+)\d+$/.exec(reference);
  if (!match) throw new Error(`XLSX contains invalid cell reference ${reference}`);
  let index = 0;
  for (const character of match[1].toUpperCase()) index = index * 26 + character.charCodeAt(0) - 64;
  return index - 1;
}

function parseXmlAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of source.matchAll(/([A-Za-z_][\w.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[match[1]] = match[2] ?? match[3] ?? '';
  }
  return attributes;
}

function containsExternalRelationship(xml: string): boolean {
  for (const match of xml.matchAll(/<(?:[A-Za-z_][\w.-]*:)?Relationship\b([^>]*)\/?\s*>/gi)) {
    const attributes = parseXmlAttributes(match[1]);
    const mode = decodeXmlEntities(attributes.TargetMode ?? attributes.targetMode ?? '').toLowerCase();
    const target = decodeXmlEntities(attributes.Target ?? attributes.target ?? '').trim();
    if (mode === 'external' || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target) || target.startsWith('//')) return true;
  }
  return false;
}

function decodeXmlEntities(value: string): string {
  return value.replace(/&(?:#x([0-9A-Fa-f]+)|#(\d+)|amp|lt|gt|quot|apos);/g, (entity, hex: string | undefined, decimal: string | undefined) => {
    if (hex) return safeCodePoint(Number.parseInt(hex, 16));
    if (decimal) return safeCodePoint(Number.parseInt(decimal, 10));
    if (entity === '&amp;') return '&';
    if (entity === '&lt;') return '<';
    if (entity === '&gt;') return '>';
    if (entity === '&quot;') return '"';
    return "'";
  });
}

function safeCodePoint(value: number): string {
  if (!Number.isInteger(value) || value < 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return '';
  return String.fromCodePoint(value);
}

function normalizeSpreadsheetText(value: string): string {
  const normalized = value.normalize('NFC').replace(/\r\n?/g, '\n');
  return Array.from(normalized, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const allowedWhitespace = character === '\n' || character === '\t';
    return (codePoint < 32 || codePoint === 127) && !allowedWhitespace ? '' : character;
  }).join('');
}

function stripExtension(fileName: string): string {
  const basename = fileName.replaceAll('\\', '/').split('/').pop() ?? 'Spreadsheet';
  return normalizeSpreadsheetText(basename.replace(/\.[^.]+$/, '')).slice(0, 512) || 'Spreadsheet';
}
