import { describe, expect, it } from 'vitest';
import {
  executeImageBatchFolder,
  parseImageBatchFolderExecutionReport,
  serializeImageBatchFolderExecutionReport,
} from './ImageBatchFolderExecution';

describe('ImageBatchFolderExecution', () => {
  it('continues after a failed item and retains a plain-data durable report', async () => {
    const writes: string[] = [];
    const report = await executeImageBatchFolder({
      runId: 'run-1',
      macroId: 'macro-cleanup',
      startedAt: '2026-08-27T02:00:00.000Z',
      now: () => '2026-08-27T02:01:00.000Z',
      items: [
        { id: 'one', inputPath: 'in/one.png', outputPath: 'out/one.png', file: 'one' },
        { id: 'two', inputPath: 'in/two.png', outputPath: 'out/two.png', file: 'two' },
        { id: 'three', inputPath: 'in/three.png', outputPath: 'out/three.png', file: 'three' },
      ],
      adapter: {
        transform: async ({ file }) => {
          if (file === 'two') throw new Error('decode failed');
          return new Blob([file]);
        },
        write: async ({ item }) => { writes.push(item.outputPath); },
      },
    });

    expect(writes).toEqual(['out/one.png', 'out/three.png']);
    expect(report).toMatchObject({ succeededCount: 2, failedCount: 1 });
    expect(report.entries.map((entry) => entry.status)).toEqual(['succeeded', 'failed', 'succeeded']);
    expect(parseImageBatchFolderExecutionReport(serializeImageBatchFolderExecutionReport(report))).toEqual(report);
    expect(parseImageBatchFolderExecutionReport('{"schemaVersion":1,"entries":[]}')).toBeNull();
  });

  it('marks queued work cancelled and does not write items after cancellation', async () => {
    const controller = new AbortController();
    const writes: string[] = [];
    const report = await executeImageBatchFolder({
      runId: 'run-cancel',
      macroId: 'macro-cancel',
      items: [
        { id: 'one', inputPath: 'one.png', outputPath: 'one.png', file: 'one' },
        { id: 'two', inputPath: 'two.png', outputPath: 'two.png', file: 'two' },
      ],
      signal: controller.signal,
      adapter: {
        transform: async ({ file }) => {
          controller.abort();
          return new Blob([file]);
        },
        write: async ({ item }) => { writes.push(item.outputPath); },
      },
    });

    expect(writes).toEqual([]);
    expect(report.entries.map((entry) => entry.status)).toEqual(['cancelled', 'cancelled']);
    expect(report.cancelledCount).toBe(2);
  });

  it('round-trips cancellation status while accepting legacy reports without a count', () => {
    const parsed = parseImageBatchFolderExecutionReport(JSON.stringify({
      schemaVersion: 1,
      runId: 'run-legacy',
      macroId: 'macro',
      startedAt: 'a',
      finishedAt: 'b',
      entries: [{ id: 'one', inputPath: 'one', outputPath: 'one', status: 'cancelled', message: 'stop' }],
      succeededCount: 0,
      failedCount: 0,
    }));
    expect(parsed?.cancelledCount).toBe(1);
  });
});
