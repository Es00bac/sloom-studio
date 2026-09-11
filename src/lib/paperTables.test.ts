import { describe, expect, it } from 'vitest';
import {
  addPaperTableColumn,
  addPaperTableRow,
  clearPaperTableFills,
  createPaperTable,
  normalizePaperTable,
  removePaperTableColumn,
  removePaperTableRow,
  setPaperTableBandFill,
  setPaperTableCell,
  setPaperTableHeaderFill,
} from './paperTables';

describe('paper tables core', () => {
  it('creates a normalized rows×cols grid of empty cells', () => {
    const table = createPaperTable(2, 3);
    expect(table.rows).toBe(2);
    expect(table.cols).toBe(3);
    expect(table.cells).toEqual([['', '', ''], ['', '', '']]);
    expect(table.headerRow).toBe(true);
  });

  it('pads/truncates ragged cells and clamps dimensions on normalize', () => {
    const table = normalizePaperTable({ rows: 2, cols: 2, cells: [['a']], borderWidthMm: -1 });
    expect(table.cells).toEqual([['a', ''], ['', '']]);
    expect(table.borderWidthMm).toBe(0); // clamped from -1
    expect(normalizePaperTable({ rows: 999, cols: 0 }).rows).toBe(50); // clamp high; cols floored to 1
    expect(normalizePaperTable({ rows: 999, cols: 0 }).cols).toBe(1);
  });

  it('sets a cell immutably and ignores out-of-range coordinates', () => {
    const table = createPaperTable(2, 2);
    const next = setPaperTableCell(table, 0, 1, 'hello');
    expect(next.cells[0][1]).toBe('hello');
    expect(table.cells[0][1]).toBe(''); // original unchanged
    expect(setPaperTableCell(table, 5, 5, 'x')).toEqual(table); // out of range = no-op
  });

  it('adds and removes rows/columns, preserving content', () => {
    let table = setPaperTableCell(createPaperTable(2, 2), 1, 1, 'keep');
    table = addPaperTableRow(table);
    expect(table.rows).toBe(3);
    expect(table.cells[1][1]).toBe('keep');
    table = addPaperTableColumn(table, 0); // prepend a column
    expect(table.cols).toBe(3);
    expect(table.cells[1][2]).toBe('keep'); // shifted right by the new first column

    table = removePaperTableColumn(table, 0);
    expect(table.cols).toBe(2);
    expect(table.cells[1][1]).toBe('keep');
    table = removePaperTableRow(table, 0);
    expect(table.rows).toBe(2);
  });

  it('never drops below a single row or column', () => {
    const oneByOne = createPaperTable(1, 1);
    expect(removePaperTableRow(oneByOne, 0)).toEqual(oneByOne);
    expect(removePaperTableColumn(oneByOne, 0)).toEqual(oneByOne);
  });

  it('shades the header row, bands alternating body rows, and clears fills', () => {
    const base = createPaperTable(4, 2); // headerRow defaults true
    const header = setPaperTableHeaderFill(base, '#4472c4');
    expect(header.cellFills?.[0]).toEqual(['#4472c4', '#4472c4']);
    expect(header.cellFills?.[1]).toEqual(['', '']);

    const banded = setPaperTableBandFill(header, '#d9e1f2');
    // Header stays; body rows 1 and 3 are the alternating bands (row index 1 = first body row).
    expect(banded.cellFills?.[0]).toEqual(['#4472c4', '#4472c4']);
    expect(banded.cellFills?.[1]).toEqual(['#d9e1f2', '#d9e1f2']);
    expect(banded.cellFills?.[2]).toEqual(['', '']);
    expect(banded.cellFills?.[3]).toEqual(['#d9e1f2', '#d9e1f2']);

    expect(clearPaperTableFills(banded).cellFills).toBeUndefined();
  });

  it('bands from the first row when there is no header row', () => {
    const noHeader = normalizePaperTable({ rows: 3, cols: 1, cells: [], headerRow: false });
    const banded = setPaperTableBandFill(noHeader, '#eeeeee');
    expect(banded.cellFills?.[0]).toEqual(['#eeeeee']); // row 0 is the first band
    expect(banded.cellFills?.[1]).toEqual(['']);
    expect(banded.cellFills?.[2]).toEqual(['#eeeeee']);
  });
});
