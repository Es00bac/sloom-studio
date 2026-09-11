import { FolderOpen, Play, ShieldCheck, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { imageDocumentToBlob } from './ImageDocumentExport';
import { createImageDocumentFromFile } from './ImageSourceDocument';
import { clearSelection } from './selectionRegistry';
import { runPhotoshopQuickAction } from './PhotoshopQuickActionRunner';
import { pickDirectory } from '../../lib/fileSystemWorkspace';
import { disposeEditorOperations } from './ImageHistoryResources';
import { disposeImageDocumentNamedSnapshots } from './ImageSnapshots';
import {
  executeImageBatchFolder,
  type ImageBatchFolderExecutionReport,
} from './ImageBatchFolderExecution';

interface BrowserFileHandle {
  createWritable(): Promise<{ write(value: Blob): Promise<void>; close(): Promise<void> }>;
}

interface BrowserDirectoryHandle {
  name: string;
  getDirectoryHandle(name: string, options: { create: boolean }): Promise<BrowserDirectoryHandle>;
  getFileHandle(name: string, options: { create: boolean }): Promise<BrowserFileHandle>;
}

let activeFolderBatchRun: symbol | null = null;

function safeOutputName(file: File, index: number): string {
  const stem = (file.name.replace(/\.[^.]+$/, '') || 'image')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'image';
  return `${String(index + 1).padStart(3, '0')}-${stem}.png`;
}

async function writeToDirectory(directory: BrowserDirectoryHandle, outputPath: string, output: Blob): Promise<void> {
  const parts = outputPath.split('/').filter(Boolean);
  const fileName = parts.pop();
  if (!fileName) throw new Error('The output name is empty.');
  let target = directory;
  for (const part of parts) target = await target.getDirectoryHandle(part, { create: true });
  const writable = await (await target.getFileHandle(fileName, { create: true })).createWritable();
  try {
    await writable.write(output);
  } finally {
    await writable.close();
  }
}

async function runMacroAgainstIsolatedFile(file: File, macroId: string, signal: AbortSignal): Promise<Blob> {
  const baseline = useImageEditorStore.getState();
  const macro = baseline.quickActionMacros.find((entry) => entry.id === macroId);
  if (!macro) throw new Error(`Saved action ${macroId} is unavailable.`);
  const saved = {
    documents: baseline.documents,
    activeDocId: baseline.activeDocId,
    undoStacks: baseline.undoStacks,
    redoStacks: baseline.redoStacks,
  };
  const doc = await createImageDocumentFromFile(file, { id: `image-folder-batch-${Date.now()}-${Math.random().toString(16).slice(2)}` });

  try {
    useImageEditorStore.setState({
      documents: [doc],
      activeDocId: doc.id,
      undoStacks: {},
      redoStacks: {},
    });
    const failedSteps: string[] = [];
    if (macro.steps.length === 0) {
      throw new Error(`Saved action ${macroId} has no executable steps for ${file.name}.`);
    }
    for (const [index, step] of macro.steps.entries()) {
      if (signal.aborted) throw new Error('The folder batch was cancelled.');
      if (!runPhotoshopQuickAction(step.actionId, { skipRecording: true })) {
        failedSteps.push(`${index + 1}:${step.actionId}`);
      }
    }
    if (failedSteps.length > 0) {
      throw new Error(`Saved action ${macroId} partially applied for ${file.name}; failed steps: ${failedSteps.join(', ')}.`);
    }
    const processed = useImageEditorStore.getState().documents.find((candidate) => candidate.id === doc.id);
    if (!processed) throw new Error(`Saved action ${macroId} removed the isolated source document.`);
    return imageDocumentToBlob(processed, 'image/png');
  } finally {
    const temporaryState = useImageEditorStore.getState();
    disposeEditorOperations([
      ...(temporaryState.undoStacks[doc.id] ?? []),
      ...(temporaryState.redoStacks[doc.id] ?? []),
    ]);
    disposeImageDocumentNamedSnapshots(doc);
    clearSelection(doc.id);
    useImageEditorStore.setState(saved);
  }
}

export function ImageBatchFolderRunnerPanel() {
  const quickActionMacros = useImageEditorStore((state) => state.quickActionMacros);
  const pickerRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [outputDirectory, setOutputDirectory] = useState<BrowserDirectoryHandle | null>(null);
  const [macroId, setMacroId] = useState('');
  const [report, setReport] = useState<ImageBatchFolderExecutionReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [outputError, setOutputError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const browserDirectoryPicker = (globalThis as typeof globalThis & {
    showDirectoryPicker?: () => Promise<BrowserDirectoryHandle>;
  }).showDirectoryPicker;
  const selectedMacro = useMemo(
    () => quickActionMacros.find((macro) => macro.id === macroId) ?? null,
    [macroId, quickActionMacros],
  );

  useEffect(() => {
    pickerRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  useEffect(() => () => {
    abortControllerRef.current?.abort();
  }, []);

  const chooseOutputDirectory = async () => {
    if (!browserDirectoryPicker) return;
    try {
      setOutputError(null);
      setOutputDirectory(await pickDirectory() as unknown as BrowserDirectoryHandle);
    } catch (error) {
      setOutputError(error instanceof Error ? error.message : 'The output folder could not be approved for writing.');
    }
  };

  const run = async () => {
    if (!selectedMacro || !outputDirectory || files.length === 0 || activeFolderBatchRun) return;
    const runToken = Symbol('image-folder-batch');
    activeFolderBatchRun = runToken;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setBusy(true);
    try {
      const next = await executeImageBatchFolder({
        runId: `image-folder-batch-${Date.now()}`,
        macroId: selectedMacro.id,
        signal: controller.signal,
        items: [...files].sort((left, right) => (left.webkitRelativePath || left.name).localeCompare(right.webkitRelativePath || right.name)).map((file, index) => ({
          id: `${index + 1}-${file.webkitRelativePath || file.name}`,
          inputPath: file.webkitRelativePath || file.name,
          outputPath: safeOutputName(file, index),
          file,
        })),
        adapter: {
          transform: ({ file, macroId: queuedMacroId, signal }) => runMacroAgainstIsolatedFile(file, queuedMacroId, signal),
          write: ({ item, output }) => writeToDirectory(outputDirectory, item.outputPath, output),
        },
      });
      setReport(next);
    } finally {
      abortControllerRef.current = null;
      setBusy(false);
      if (activeFolderBatchRun === runToken) activeFolderBatchRun = null;
    }
  };

  return (
    <div className="mt-3 border-t border-cyan-300/10 pt-3" data-image-folder-batch-runner="ready">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-cyan-100/65">Folder batch</div>
        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-200/70"><ShieldCheck size={10} /> local only</span>
      </div>
      <p className="mt-1 text-[10px] leading-4 text-cyan-100/45">
        Runs one saved action per selected local file in an isolated temporary Image document, then writes a flattened PNG to the output folder you approve. A failed file does not stop later files.
      </p>
      <input
        aria-label="Choose local image folder for batch actions"
        className="hidden"
        multiple
        onChange={(event) => {
          setFiles(Array.from(event.currentTarget.files ?? []));
          setReport(null);
        }}
        ref={pickerRef}
        type="file"
      />
      <div className="mt-2 grid grid-cols-2 gap-1">
        <button
          aria-label="Choose local image folder for batch actions"
          className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1 text-[10px] font-semibold text-cyan-100/65 hover:border-cyan-300/30 hover:text-white"
          onClick={() => pickerRef.current?.click()}
          type="button"
        ><span className="inline-flex items-center gap-1"><FolderOpen size={10} /> Input {files.length || ''}</span></button>
        <button
          aria-label="Choose batch output folder"
          className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1 text-[10px] font-semibold text-cyan-100/65 hover:border-cyan-300/30 hover:text-white disabled:opacity-35"
          disabled={!browserDirectoryPicker}
          onClick={() => void chooseOutputDirectory()}
          type="button"
        >Output {outputDirectory ? 'ready' : browserDirectoryPicker ? '' : 'unavailable'}</button>
      </div>
      <select
        aria-label="Saved action for local folder batch"
        className="mt-1 w-full rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1 text-[10px] text-cyan-100/70"
        onChange={(event) => setMacroId(event.target.value)}
        value={macroId}
      >
        <option value="">Choose saved action</option>
        {quickActionMacros.map((macro) => <option key={macro.id} value={macro.id}>{macro.name}</option>)}
      </select>
      <button
        aria-label="Run saved action over local folder"
        className="mt-1 w-full rounded border border-emerald-300/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold text-emerald-100 hover:border-emerald-300/45 disabled:cursor-not-allowed disabled:opacity-35"
        disabled={busy || !selectedMacro || !outputDirectory || files.length === 0}
        onClick={() => void run()}
        type="button"
      ><span className="inline-flex items-center gap-1"><Play size={10} /> {busy ? 'Running folder action…' : 'Run folder action'}</span></button>
      {outputError ? <div className="mt-2 rounded border border-rose-300/20 bg-rose-400/10 px-2 py-1.5 text-[10px] text-rose-100" role="alert">{outputError}</div> : null}
      {busy ? (
        <button
          aria-label="Cancel local folder batch"
          className="mt-1 w-full rounded border border-amber-300/20 bg-amber-400/10 px-2 py-1 text-[10px] font-semibold text-amber-100 hover:border-amber-300/45"
          onClick={() => abortControllerRef.current?.abort()}
          type="button"
        ><span className="inline-flex items-center gap-1"><Square size={10} /> Cancel folder batch</span></button>
      ) : null}
      {report ? (
        <div className="mt-2 rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1.5 text-[10px] text-cyan-100/60" data-image-folder-batch-report>
          <div>{report.succeededCount} written · {report.failedCount} failed · {report.cancelledCount} cancelled. Results remain visible for this session; output files persist in the approved folder.</div>
          <ul className="mt-1 space-y-0.5" aria-label="Folder batch item results">
            {report.entries.map((entry) => <li key={entry.id}><span className="font-semibold">{entry.status}</span> — {entry.inputPath}: {entry.message}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
