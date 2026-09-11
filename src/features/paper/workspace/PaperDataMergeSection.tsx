// Mounted Data Merge authoring surface for the Paper inspector. Attach or clear a bounded CSV
// recipient source, preview derived records without mutating the template, and export the
// deterministic artifacts the feature actually produces.

import { useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { PaperDocument } from '../../../types/paper';
import {
  collectPaperDataMergeFields,
  createPaperDataMergeToken,
  derivePaperDataMergeRecordDocument,
  exportPaperDataMergeJsonl,
  PAPER_DATA_MERGE_LIMITS,
  parsePaperDataMergeCsv,
} from '../../../lib/paperDataMerge';
import { buildDownloadFilename, downloadTextFileWithOutcome } from '../../../lib/downloadAsset';
import { usePaperStore } from '../../../store/paperStore';

const CSV_ERROR_MESSAGES: Record<string, string> = {
  empty: 'the CSV text is empty',
  'too-large': `the CSV exceeds the ${PAPER_DATA_MERGE_LIMITS.maxCsvLength} byte import limit`,
  'invalid-quote': 'a quoted value is unterminated or has trailing text',
  'invalid-header': 'the header row contains invalid or empty field names (lowercase a-z, digits, "-" and "_")',
  'too-many-columns': `more than ${PAPER_DATA_MERGE_LIMITS.maxCsvColumns} columns`,
  'duplicate-column': 'duplicate header names',
  'too-many-records': `more than ${PAPER_DATA_MERGE_LIMITS.maxRecords} data rows`,
  'ragged-row': 'a data row has more cells than the header row',
  'value-too-long': `a cell exceeds the ${PAPER_DATA_MERGE_LIMITS.maxValueLength} character value limit`,
  'value-budget-exceeded': `the combined cell values exceed the ${PAPER_DATA_MERGE_LIMITS.maxTotalValueLength} character budget; nothing was attached so no values are lost`,
};

interface SectionMessage {
  tone: 'info' | 'success' | 'error';
  text: string;
}

function derivedSampleLines(document: PaperDocument, limit = 4): string[] {
  const lines: string[] = [];
  const collectFrames = (frames: PaperDocument['pages'][number]['frames'], pageLabel: string) => {
    for (const frame of frames) {
      if (lines.length >= limit) return;
      const text = frame.text ?? (frame.richText ?? []).map((paragraph) => paragraph.runs.map((run) => run.text).join('')).join('\n');
      if (!text?.trim()) continue;
      lines.push(`${pageLabel} · ${text.slice(0, 160)}${text.length > 160 ? '…' : ''}`);
    }
  };
  document.pages.forEach((page) => collectFrames(page.frames, `p${page.pageNumber}`));
  document.parentPages.forEach((page) => collectFrames(page.frames, page.name));
  return lines;
}

export function PaperDataMergeSection({
  document,
  onExportDerivedPdf,
}: {
  document: PaperDocument;
  /** Routes one derived record document through the existing Paper PDF/print export pipeline. */
  onExportDerivedPdf?: (derivedDocument: PaperDocument) => void | Promise<void>;
}) {
  const updatePaperDataMerge = usePaperStore((state) => state.updatePaperDataMerge);
  const source = document.dataMerge;
  const [csvText, setCsvText] = useState('');
  const [message, setMessage] = useState<SectionMessage | null>(null);
  const [selectedRecordId, setSelectedRecordId] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const authoredFields = useMemo(() => collectPaperDataMergeFields(document), [document]);
  const records = source?.records ?? [];
  const selectedRecord = records.find((record) => record.id === selectedRecordId) ?? records[0];
  const preview = useMemo(
    () => (selectedRecord ? derivePaperDataMergeRecordDocument(document, selectedRecord) : null),
    [document, selectedRecord],
  );
  const orphanFields = authoredFields.filter((field) => !(source?.columns ?? []).some((column) => column.name === field));

  const importCsv = (csv: string, label: string) => {
    const result = parsePaperDataMergeCsv(csv);
    if (!result.ok) {
      setMessage({
        tone: 'error',
        text: `${label} rejected — ${CSV_ERROR_MESSAGES[result.error]} (code: ${result.error}). Nothing was changed.`,
      });
      return;
    }
    updatePaperDataMerge(result.source);
    setMessage({
      tone: 'success',
      text: `${label}: attached ${result.source.records.length} recipient${result.source.records.length === 1 ? '' : 's'} across ${result.source.columns.length} column${result.source.columns.length === 1 ? '' : 's'}. Every accepted value is preserved.`,
    });
  };

  const handleFileChosen = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > PAPER_DATA_MERGE_LIMITS.maxCsvLength) {
      setMessage({ tone: 'error', text: `${file.name} rejected — ${CSV_ERROR_MESSAGES['too-large']}. Nothing was changed.` });
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    try {
      importCsv(await file.text(), file.name);
    } catch (error) {
      setMessage({ tone: 'error', text: `${file.name} could not be read as text: ${error instanceof Error ? error.message : String(error)}.` });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const exportBatchJsonl = async () => {
    if (!source || !records.length) return;
    try {
      const jsonl = exportPaperDataMergeJsonl(document, source);
      const fileName = buildDownloadFilename(`${document.title} merge batch`, 'application/x-ndjson', 'jsonl');
      const outcome = await downloadTextFileWithOutcome(fileName, jsonl, 'application/x-ndjson');
      if (outcome.status === 'failed') {
        setMessage({ tone: 'error', text: `JSONL export failed: ${outcome.error}` });
      } else {
        setMessage({ tone: 'success', text: `Generated deterministic JSONL with ${records.length} line(s): ${fileName}.` });
      }
    } catch (error) {
      setMessage({ tone: 'error', text: `JSONL export failed: ${error instanceof Error ? error.message : String(error)}` });
    }
  };

  const messageColor = message?.tone === 'error'
    ? 'text-rose-100/90'
    : message?.tone === 'success'
      ? 'text-emerald-100/85'
      : 'text-cyan-100/55';

  return (
    <div className="space-y-2" data-paper-data-merge="true">
      <div className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1 text-[11px] leading-4 text-cyan-100/55">
        Derived output only: author <span className="text-cyan-100/80">{'{{merge:name}}'}</span> tokens in any frame text.
        The template is never rewritten; records resolve only in previews and exports.
      </div>

      <div className="rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/40">Recipient source</div>
          {source ? (
            <button
              aria-label="Remove data merge source"
              className="rounded border border-rose-300/20 px-1.5 py-0.5 text-[10px] text-rose-100/70 hover:border-rose-300/50 hover:text-white"
              onClick={() => {
                updatePaperDataMerge(null);
                setMessage({ tone: 'info', text: 'Removed the recipient source.' });
              }}
              type="button"
            >Remove</button>
          ) : null}
        </div>
        <div className="mb-2 text-[11px] leading-4 text-cyan-100/60">
          {source
            ? `${source.name || 'Untitled source'} · ${source.columns.length} column(s) · ${records.length} record(s)`
            : 'No recipient source attached to this document.'}
        </div>
        <input
          accept=".csv,text/csv,text/plain"
          aria-label="Choose bounded CSV file"
          onChange={(event) => void handleFileChosen(event.target.files?.[0])}
          ref={fileInputRef}
          type="file"
        />
        <textarea
          aria-label="Paste bounded CSV"
          className="paper-input mt-2 min-h-[72px] w-full px-1.5 py-1 font-mono text-[11px]"
          maxLength={PAPER_DATA_MERGE_LIMITS.maxCsvLength}
          onChange={(event) => setCsvText(event.target.value)}
          placeholder={'name,email\nAda,ada@example.test'}
          rows={4}
          value={csvText}
        />
        <button
          className="mt-2 w-full rounded-md border border-cyan-300/25 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:border-cyan-300/60 disabled:opacity-40"
          disabled={!csvText.trim()}
          onClick={() => {
            importCsv(csvText, 'Pasted CSV');
            setCsvText('');
          }}
          type="button"
        >Attach CSV</button>
        <p className="mt-1 text-[10px] leading-3.5 text-cyan-100/40">
          Imports are bounded at {PAPER_DATA_MERGE_LIMITS.maxCsvColumns} columns × {PAPER_DATA_MERGE_LIMITS.maxRecords} rows,
          {PAPER_DATA_MERGE_LIMITS.maxValueLength} characters per value, and a combined{' '}
          {PAPER_DATA_MERGE_LIMITS.maxTotalValueLength}-character value budget. An import that cannot keep every value fails
          explicitly instead of truncating.
        </p>
      </div>

      {authoredFields.length ? (
        <div className="rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2 text-[11px] leading-4 text-cyan-100/55">
          Authored merge fields: <span className="font-mono text-cyan-100/75">{authoredFields.join(', ')}</span>
          {orphanFields.length ? (
            <div className="mt-1 text-amber-100/80">
              No matching column for: <span className="font-mono">{orphanFields.map((field) => `{{merge:${field}}}`).join(', ')}</span> — these stay literal.
            </div>
          ) : null}
        </div>
      ) : null}

      {source && selectedRecord ? (
        <>
          <div className="rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2">
            <Field label={`Preview record (${records.length})`}>
              <select
                aria-label="Select record to preview"
                className="paper-input"
                onChange={(event) => setSelectedRecordId(event.target.value)}
                value={selectedRecord.id}
              >
                {records.map((record, index) => (
                  <option key={record.id} value={record.id}>{`${index + 1}. ${record.id}`}</option>
                ))}
              </select>
            </Field>
            {preview ? (
              <div className="space-y-1 text-[11px] leading-4 text-cyan-100/60">
                <div>
                  Derived identity: <span className="font-mono text-cyan-100/75">{preview.document.id}</span>
                </div>
                <div>
                  Resolved fields: {preview.resolvedFields.length ? <span className="font-mono">{preview.resolvedFields.join(', ')}</span> : 'none'}
                  {' · '}Missing on this record: {preview.missingFields.length ? <span className="font-mono text-amber-100/80">{preview.missingFields.join(', ')}</span> : 'none'}
                </div>
                {derivedSampleLines(preview.document).map((line) => (
                  <div className="truncate rounded border border-cyan-300/10 bg-[#10131b] px-1.5 py-0.5" key={line}>{line}</div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <button
              className="w-full rounded-md border border-cyan-300/25 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:border-cyan-300/60"
              onClick={() => void exportBatchJsonl()}
              type="button"
            >Download batch JSONL ({records.length})</button>
            <button
              className="w-full rounded-md border border-cyan-300/25 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-cyan-100 hover:border-cyan-300/60 disabled:opacity-40"
              disabled={!onExportDerivedPdf || !preview}
              onClick={() => {
                if (!preview) return;
                void onExportDerivedPdf?.(preview.document);
              }}
              type="button"
            >Print / PDF this record…</button>
            <p className="text-[10px] leading-3.5 text-cyan-100/40">
              JSONL carries every record deterministically. The PDF button routes only the selected record&apos;s derived copy
              through the standard Paper print pipeline; the base document stays untouched.
            </p>
          </div>
        </>
      ) : null}

      {message ? (
        <div className={`rounded border border-cyan-300/15 bg-[#10131b] px-2 py-1 text-[11px] ${messageColor}`} role="status">
          {message.text}
        </div>
      ) : null}

      {source?.columns.length ? (
        <div className="rounded-lg border border-cyan-300/10 bg-[#0b121d] p-2 text-[11px] leading-4 text-cyan-100/50">
          Column tokens:{' '}
          {(source.columns).map((column, index) => (
            <span key={column.name}>
              {index > 0 ? ', ' : ''}
              <span className="font-mono text-cyan-100/70">{createPaperDataMergeToken(column.name)}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Field({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="block space-y-1">
      <span className="block text-[10px] uppercase tracking-[0.14em] text-cyan-100/40">{label}</span>
      {children}
    </label>
  );
}
