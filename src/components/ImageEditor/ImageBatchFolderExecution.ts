export type ImageBatchFolderExecutionStatus = 'succeeded' | 'failed' | 'cancelled';

export interface ImageBatchFolderExecutionItem {
  id: string;
  inputPath: string;
  outputPath: string;
}

export interface ImageBatchFolderExecutionEntry extends ImageBatchFolderExecutionItem {
  status: ImageBatchFolderExecutionStatus;
  message: string;
}

export interface ImageBatchFolderExecutionReport {
  schemaVersion: 1;
  runId: string;
  macroId: string;
  startedAt: string;
  finishedAt: string;
  entries: ImageBatchFolderExecutionEntry[];
  succeededCount: number;
  failedCount: number;
  cancelledCount: number;
}

export interface ImageBatchFolderExecutionAdapter<TFile> {
  transform: (input: { item: ImageBatchFolderExecutionItem; file: TFile; macroId: string; signal: AbortSignal }) => Promise<Blob>;
  write: (input: { item: ImageBatchFolderExecutionItem; output: Blob }) => Promise<void>;
}

class ImageBatchFolderCancelledError extends Error {
  constructor() {
    super('The folder batch was cancelled before this item completed.');
    this.name = 'ImageBatchFolderCancelledError';
  }
}

export async function executeImageBatchFolder<TFile>(input: {
  runId: string;
  macroId: string;
  startedAt?: string;
  items: ReadonlyArray<ImageBatchFolderExecutionItem & { file: TFile }>;
  adapter: ImageBatchFolderExecutionAdapter<TFile>;
  now?: () => string;
  signal?: AbortSignal;
}): Promise<ImageBatchFolderExecutionReport> {
  const now = input.now ?? (() => new Date().toISOString());
  const startedAt = input.startedAt ?? now();
  const entries: ImageBatchFolderExecutionEntry[] = [];

  for (const queued of input.items) {
    const item: ImageBatchFolderExecutionItem = {
      id: queued.id,
      inputPath: queued.inputPath,
      outputPath: queued.outputPath,
    };
    if (input.signal?.aborted) {
      entries.push({ ...item, status: 'cancelled', message: 'Skipped because the folder batch was cancelled.' });
      continue;
    }
    try {
      const output = await input.adapter.transform({ item, file: queued.file, macroId: input.macroId, signal: input.signal ?? new AbortController().signal });
      if (input.signal?.aborted) throw new ImageBatchFolderCancelledError();
      await input.adapter.write({ item, output });
      entries.push({ ...item, status: 'succeeded', message: `Wrote ${item.outputPath}.` });
    } catch (error) {
      if (error instanceof ImageBatchFolderCancelledError || input.signal?.aborted) {
        entries.push({ ...item, status: 'cancelled', message: error instanceof Error ? error.message : 'The item was cancelled.' });
        continue;
      }
      entries.push({
        ...item,
        status: 'failed',
        message: error instanceof Error ? error.message : 'The item failed without a readable error.',
      });
    }
  }

  return {
    schemaVersion: 1,
    runId: input.runId,
    macroId: input.macroId,
    startedAt,
    finishedAt: now(),
    entries,
    succeededCount: entries.filter((entry) => entry.status === 'succeeded').length,
    failedCount: entries.filter((entry) => entry.status === 'failed').length,
    cancelledCount: entries.filter((entry) => entry.status === 'cancelled').length,
  };
}

export function serializeImageBatchFolderExecutionReport(report: ImageBatchFolderExecutionReport): string {
  return JSON.stringify(report);
}

export function parseImageBatchFolderExecutionReport(value: string): ImageBatchFolderExecutionReport | null {
  try {
    const parsed = JSON.parse(value) as Partial<ImageBatchFolderExecutionReport>;
    if (
      parsed.schemaVersion !== 1
      || typeof parsed.runId !== 'string'
      || typeof parsed.macroId !== 'string'
      || typeof parsed.startedAt !== 'string'
      || typeof parsed.finishedAt !== 'string'
      || !Array.isArray(parsed.entries)
      || !Number.isInteger(parsed.succeededCount)
      || !Number.isInteger(parsed.failedCount)
    ) return null;
    if (!parsed.entries.every((entry) => (
      entry
      && typeof entry.id === 'string'
      && typeof entry.inputPath === 'string'
      && typeof entry.outputPath === 'string'
      && (entry.status === 'succeeded' || entry.status === 'failed' || entry.status === 'cancelled')
      && typeof entry.message === 'string'
    ))) return null;
    const cancelledCount = Number.isInteger(parsed.cancelledCount)
      ? parsed.cancelledCount
      : parsed.entries.filter((entry) => entry.status === 'cancelled').length;
    return { ...parsed, cancelledCount } as ImageBatchFolderExecutionReport;
  } catch {
    return null;
  }
}
