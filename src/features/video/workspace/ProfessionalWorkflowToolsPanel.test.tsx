/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorVisualClip } from '../../../lib/manualEditorState';
import { createVideoCaptionDocument } from '../../../lib/videoCaptionAuthoring';
import { createDefaultEditorProfessionalWorkflowState } from '../../../types/videoProduction';
import {
  ProfessionalWorkflowToolsPanel,
  type ProfessionalWorkflowToolsPanelProps,
} from './ProfessionalWorkflowToolsPanel';

function createProps(): ProfessionalWorkflowToolsPanelProps {
  return {
    state: createDefaultEditorProfessionalWorkflowState(),
    sourceItems: [{ id: 'camera-a', nodeId: 'camera-a', kind: 'video', label: 'Camera A' }],
    visualClips: [{ ...createEditorVisualClip('camera-a', 'video'), id: 'clip-a' }],
    audioClips: [],
    selectedClipIds: ['clip-a'],
    selectedSourceItemIds: ['camera-a'],
    playheadMs: 62_000,
    compositionSignature: 'composition-signature-a',
    historyEntries: [{ id: 'history-1', label: 'Insert clip', current: true, timestamp: '12:01' }],
    canUndo: true,
    canRedo: true,
    onWorkflowStateChange: vi.fn(),
    onHistoryCommand: vi.fn(),
    onBatchCommand: vi.fn(),
    onSourceRecordCommand: vi.fn(),
    onTrimCommand: vi.fn(),
    onMediaLoggingCommand: vi.fn(),
    onReviewCommand: vi.fn(),
    onCaptionCommand: vi.fn(),
    onQcCommand: vi.fn(),
    onDeliveryCommand: vi.fn(),
  };
}

describe('ProfessionalWorkflowToolsPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders an accessible compact tab surface and honest initial execution labels', () => {
    const markup = renderToStaticMarkup(<ProfessionalWorkflowToolsPanel {...createProps()} />);
    expect(markup).toContain('aria-label="Professional workflow tools"');
    expect(markup.match(/role="tab"/g)).toHaveLength(5);
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('Edit');
    expect(markup).toContain('Time &amp; Media');
    expect(markup).toContain('QC &amp; Delivery');
    expect(markup).toContain('not crash-persistent project versioning');
    expect(markup).toContain('aria-live="polite"');
  });

  it('emits one coarse integration callback for every major workflow group', () => {
    const props = createProps();
    props.mediaLogging = {
      records: [{ sourceItemId: 'camera-a', tags: ['select'], rating: 5, status: 'select', subclips: [] }],
      smartBins: [{ id: 'selects', name: 'Selects', match: 'all', predicates: [{ field: 'rating', operator: 'at-least', value: 4 }] }],
    };
    act(() => root.render(<ProfessionalWorkflowToolsPanel {...props} />));

    clickButton('Undo');
    clickButton('Move selected');
    clickButton('Match frame');
    clickButton('Start slide');
    expect(props.onHistoryCommand).toHaveBeenCalledWith({ kind: 'undo' });
    expect(props.onBatchCommand).toHaveBeenCalledWith({ kind: 'move', clipIds: ['clip-a'], deltaFrames: 1 });
    expect(props.onSourceRecordCommand).toHaveBeenCalledWith({ kind: 'match-frame', playheadMs: 62_000, clipId: 'clip-a' });
    expect(props.onTrimCommand).toHaveBeenCalledWith({ kind: 'begin', mode: 'slide', deltaFrames: 1 });

    clickButton('Time & Media');
    const timebase = container.querySelector<HTMLSelectElement>('[aria-label="Sequence timebase"]');
    expect(timebase).not.toBeNull();
    act(() => {
      if (!timebase) return;
      timebase.value = '29.97-df';
      timebase.dispatchEvent(new Event('change', { bubbles: true }));
    });
    clickButton('Suggest duplicates');
    clickButton('Selects · 1');
    expect(props.onWorkflowStateChange).toHaveBeenCalledWith(
      expect.objectContaining({ timebase: expect.objectContaining({ numerator: 30_000, denominator: 1_001, dropFrame: true }) }),
      'Set rational Video timebase',
    );
    expect(props.onMediaLoggingCommand).toHaveBeenCalledWith({ kind: 'suggest-duplicates' });
    expect(props.onMediaLoggingCommand).toHaveBeenCalledWith({ kind: 'apply-smart-bin', smartBinId: 'selects' });
    expect(container.textContent).toContain('10,000 items / 100 smart bins');

    clickButton('Review');
    clickButton('Approve this signature');
    expect(props.onReviewCommand).toHaveBeenCalledWith({ kind: 'set-approval', status: 'approved', compositionSignature: 'composition-signature-a' });
    expect(container.textContent).toContain('Local file exchange only');
    expect(container.textContent).toContain('Import JSON');

    clickButton('Captions');
    clickButton('Run accessibility QC');
    expect(props.onCaptionCommand).toHaveBeenCalledWith({ kind: 'run-accessibility-qc' });
    expect(container.textContent).toContain('CEA-608/708');

    clickButton('QC & Delivery');
    clickButton('Run decoded-signal QC');
    clickButton('Run structural QC');
    clickButton('Plan Standard delivery');
    expect(props.onQcCommand).toHaveBeenCalledWith({ kind: 'run-decoded-signal' });
    expect(props.onQcCommand).toHaveBeenCalledWith({ kind: 'run-structural' });
    expect(props.onDeliveryCommand).toHaveBeenCalledWith({
      kind: 'plan',
      profileId: 'standard-delivery',
      compositionSignature: 'composition-signature-a',
    });
    expect(container.textContent).toContain('nothing renders in the background after the app closes');
  });

  it('reports interrupted render-queue work honestly and offers to resume only what was lost', () => {
    const props = createProps();
    props.state = {
      ...createDefaultEditorProfessionalWorkflowState(),
      deliveryJobs: [{
        id: 'job-1',
        profileId: 'standard-delivery',
        compositionSignature: 'composition-signature-a',
        status: 'interrupted',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        hostDurability: 'browser-session-only',
        outputs: [
          {
            id: 'qc',
            label: 'Structural QC',
            fileName: 'project-qc.json',
            status: 'succeeded',
            missingCapabilities: [],
            truthfulnessNote: '',
            attempts: 1,
            result: { byteSize: 2_048 },
          },
          {
            id: 'captions',
            label: 'Captions',
            fileName: 'project-captions.vtt',
            status: 'interrupted',
            missingCapabilities: [],
            truthfulnessNote: '',
            attempts: 1,
          },
        ],
      }],
    };
    act(() => root.render(<ProfessionalWorkflowToolsPanel {...props} />));
    clickButton('QC & Delivery');

    expect(container.textContent).toContain('stopped when a previous session ended');
    expect(container.textContent).toContain('Nothing restarts on its own');
    // The delivered output reports measured bytes; the lost one reports its remaining attempts.
    expect(container.textContent).toContain('delivered · 2 KB');
    expect(container.textContent).toContain('interrupted · attempt 1/3');
    expect(container.querySelector('[aria-label="Durable render queue"]')).not.toBeNull();

    clickButton('Resume');
    expect(props.onDeliveryCommand).toHaveBeenCalledWith({ kind: 'retry', jobId: 'job-1' });
    clickButton('Cancel');
    expect(props.onDeliveryCommand).toHaveBeenCalledWith({ kind: 'cancel', jobId: 'job-1' });
  });

  it('admits a plan explicitly and refuses to offer either action once the cut has moved on', () => {
    const props = createProps();
    const planned = {
      id: 'job-2',
      profileId: 'standard-delivery',
      compositionSignature: 'composition-signature-a',
      status: 'planned' as const,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
      hostDurability: 'browser-session-only' as const,
      outputs: [{
        id: 'qc',
        label: 'Structural QC',
        fileName: 'project-qc.json',
        status: 'queued' as const,
        missingCapabilities: [],
        truthfulnessNote: '',
        attempts: 0,
      }],
    };
    props.state = { ...createDefaultEditorProfessionalWorkflowState(), deliveryJobs: [planned] };
    act(() => root.render(<ProfessionalWorkflowToolsPanel {...props} />));
    clickButton('QC & Delivery');

    clickButton('Queue');
    expect(props.onDeliveryCommand).toHaveBeenCalledWith({ kind: 'queue', jobId: 'job-2' });

    act(() => root.render(<ProfessionalWorkflowToolsPanel
      {...props}
      state={{ ...props.state!, deliveryJobs: [{ ...planned, compositionSignature: 'an-earlier-cut' }] }}
    />));
    expect(container.textContent).toContain('Frozen against an earlier cut');
    expect(findButton('Queue')).toBeUndefined();
  });

  it('says the queue is paused when runnable work exists that this session has not started', () => {
    const props = createProps();
    props.state = {
      ...createDefaultEditorProfessionalWorkflowState(),
      deliveryJobs: [{
        id: 'job-4',
        profileId: 'standard-delivery',
        compositionSignature: 'composition-signature-a',
        status: 'queued',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        hostDurability: 'browser-session-only',
        outputs: [{
          id: 'qc',
          label: 'Structural QC',
          fileName: 'project-qc.json',
          status: 'queued',
          target: 'browser',
          missingCapabilities: [],
          truthfulnessNote: '',
          attempts: 0,
        }],
      }],
    };
    act(() => root.render(<ProfessionalWorkflowToolsPanel {...props} />));
    clickButton('QC & Delivery');

    expect(container.textContent).toContain('Opening a project never starts a render on its own');
    clickButton('Resume queue');
    expect(props.onDeliveryCommand).toHaveBeenCalledWith({ kind: 'resume-queue' });

    // Once the session is working the queue, the paused notice must not linger.
    act(() => root.render(<ProfessionalWorkflowToolsPanel {...props} renderQueueRunning />));
    expect(container.textContent).not.toContain('Queue paused');
    expect(findButton('Resume queue')).toBeUndefined();
  });

  it('names the capability a blocked output is waiting on instead of implying it can run', () => {
    const props = createProps();
    props.state = {
      ...createDefaultEditorProfessionalWorkflowState(),
      deliveryJobs: [{
        id: 'job-3',
        profileId: 'standard-delivery',
        compositionSignature: 'composition-signature-a',
        status: 'failed',
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        hostDurability: 'browser-session-only',
        outputs: [{
          id: 'master',
          label: 'Master video',
          fileName: 'project-master.mov',
          status: 'blocked',
          missingCapabilities: ['encode:prores-422-hq', 'mux:mov'],
          truthfulnessNote: '',
          attempts: 0,
        }],
      }],
    };
    act(() => root.render(<ProfessionalWorkflowToolsPanel {...props} />));
    clickButton('QC & Delivery');

    expect(container.textContent).toContain('blocked · needs encode:prores-422-hq');
    // Nothing about a blocked output is resumable, so no retry is offered.
    expect(findButton('Retry')).toBeUndefined();
    expect(findButton('Resume')).toBeUndefined();
  });

  it('shows cancellable decoded-signal work and persisted signal findings', () => {
    const props = createProps();
    props.decodedSignalQcRunning = true;
    props.decodedSignalQcReport = {
      version: 1, scope: 'decoded-sampled', disclaimer: 'Sampled only.', compositionSignature: 'older-signature', createdAt: 1,
      sourceResults: [{ sourceId: 'camera-a', label: 'Camera A', kind: 'video', status: 'analyzed', decodedFrameSamples: 2, decodedAudioWindows: 0 }],
      issues: [{ id: 'signal-1', code: 'black-frame-run', severity: 'warning', title: 'Black decoded-frame interval', detail: 'Sampled.', navigation: { sourceId: 'camera-a', timeMs: 0 } }],
      summary: { errors: 0, warnings: 1, info: 0, blocking: false, analyzedSources: 1, partialSources: 0, unavailableSources: 0 }, truncated: false,
    };
    act(() => root.render(<ProfessionalWorkflowToolsPanel {...props} />));
    clickButton('QC & Delivery');
    expect(container.textContent).toContain('The saved report belongs to an earlier composition signature');
    clickButton('Cancel analysis');
    const finding = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent?.includes('Black decoded-frame interval'));
    expect(finding).toBeDefined();
    act(() => finding?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(props.onQcCommand).toHaveBeenCalledWith({ kind: 'cancel-decoded-signal' });
    expect(props.onQcCommand).toHaveBeenCalledWith({ kind: 'navigate', issueId: 'signal-1' });
  });

  it('shows a partial decoded source as a bounded delivery-blocking QC finding', () => {
    const props = createProps();
    props.decodedSignalQcReport = {
      version: 1, scope: 'decoded-sampled', disclaimer: 'Sampled only.', compositionSignature: 'composition-signature-a', createdAt: 1,
      sourceResults: [{ sourceId: 'camera-a', label: 'Camera A', kind: 'video', status: 'partial', decodedFrameSamples: 1, decodedAudioWindows: 0, message: 'PCM audio unavailable: source over limit.' }],
      issues: [{ id: 'signal-partial', code: 'source-unavailable', severity: 'error', title: 'Source was only partially decoded for QC', detail: 'Camera A: PCM audio unavailable: source over limit.', navigation: { sourceId: 'camera-a' } }],
      summary: { errors: 1, warnings: 0, info: 0, blocking: true, analyzedSources: 0, partialSources: 1, unavailableSources: 0 }, truncated: false,
    };
    act(() => root.render(<ProfessionalWorkflowToolsPanel {...props} />));
    clickButton('QC & Delivery');
    expect(container.textContent).toContain('Partial');
    expect(container.textContent).toContain('Source was only partially decoded for QC');
    expect(container.textContent).toContain('failed frame or PCM side remains visible as a partial source');
  });

  it('uses a clear inline confirmation before destructive batch deletion', () => {
    const props = createProps();
    act(() => root.render(<ProfessionalWorkflowToolsPanel {...props} />));
    clickButton('Delete selected…');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('one undoable transaction');
    expect(props.onBatchCommand).not.toHaveBeenCalled();
    clickButton('Confirm delete');
    expect(props.onBatchCommand).toHaveBeenCalledWith({ kind: 'delete', clipIds: ['clip-a'] });
  });

  it('mounts caption import and the explicit, bounded embedded-MP4/MOV delivery control', async () => {
    const props = createProps();
    props.captionDocument = createVideoCaptionDocument({
      id: 'primary-captions',
      language: 'eng',
      cues: [{ id: 'cue-1', startMs: 0, endMs: 1_000, text: 'Existing caption' }],
    });
    act(() => root.render(<ProfessionalWorkflowToolsPanel {...props} />));
    clickButton('Captions');

    expect(container.textContent).toContain('Native CPU only');
    expect(container.textContent).toContain('plain timing/text only');
    clickButton('Embed primary captions in MP4/MOV');
    expect(props.onCaptionCommand).toHaveBeenCalledWith({ kind: 'set-embedding', enabled: true });

    const importInput = container.querySelector<HTMLInputElement>('input[type="file"][accept*=".srt"]');
    expect(importInput).not.toBeNull();
    const file = {
      name: 'delivery.srt',
      size: 44,
      text: () => Promise.resolve('1\n00:00:00,000 --> 00:00:01,000\nImported caption\n'),
    } as File;
    Object.defineProperty(importInput, 'files', { configurable: true, value: [file] });
    await act(async () => {
      importInput?.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
    expect(props.onCaptionCommand).toHaveBeenCalledWith({
      kind: 'import',
      format: 'srt',
      language: 'eng',
      data: '1\n00:00:00,000 --> 00:00:01,000\nImported caption\n',
    });
  });

  function findButton(label: string): HTMLButtonElement | undefined {
    return [...container.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === label);
  }

  function clickButton(label: string): void {
    const button = findButton(label);
    expect(button, `button ${label}`).toBeDefined();
    act(() => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  }
});
