import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatErrorDetails } from '../../lib/errorRecoveryDetails';
import { createDefaultPaperDocument } from '../../lib/paperDocument';
import { usePaperStore } from '../../store/paperStore';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { useCrashReportStore } from '../../store/crashReportStore';
import type { ImageDocument } from '../../types/imageEditor';
import { ErrorBoundary, RecoveryFallback } from './ErrorBoundary';

afterEach(() => {
  usePaperStore.getState().restoreSnapshot(undefined);
  usePaperStore.setState({ discardedDocumentRecoveries: [] });
  useImageEditorStore.getState().restoreProjectSnapshot(undefined);
  useImageEditorStore.setState({ discardedDocumentRecoveries: [] });
  useCrashReportStore.setState({ reports: [], captureEnabled: false });
});

describe('RecoveryFallback', () => {
  it('renders dark recovery actions for a caught render error', () => {
    const html = renderToStaticMarkup(
      <RecoveryFallback
        error={new Error('canvas exploded')}
        level="canvas"
        onClearPersistedState={vi.fn()}
        onCopyDetails={vi.fn()}
        onReloadApp={vi.fn()}
        onResetBoundary={vi.fn()}
        onResetLayout={vi.fn()}
        onResetProject={vi.fn()}
        title="Flow Canvas"
      />,
    );

    expect(html).toContain('Recovery Boundary');
    expect(html).toContain('Flow Canvas');
    expect(html).toContain('canvas exploded');
    expect(html).toContain('Reload App');
    expect(html).toContain('Reset Blank Project');
    expect(html).toContain('Clear Recoverable State');
    expect(html).toContain('Provider and API keys are preserved');
    expect(html).toContain('cannot safely offer or guarantee an asynchronous editable save');
    expect(html).toContain('captures every dirty Image and Paper tab');
  });

  it('requires an explicit crash-reset decision and Cancel Reset preserves exact live state', async () => {
    const paper = createDefaultPaperDocument({ title: 'Cancel keeps Paper' });
    usePaperStore.getState().restoreSnapshot({ document: paper, tool: 'select', zoom: 0.8 });
    usePaperStore.getState().addPage();
    const image: ImageDocument = {
      id: 'cancel-keeps-image',
      title: 'Cancel keeps Image',
      width: 10,
      height: 10,
      layers: [],
      activeLayerId: null,
      hasSelection: false,
      selectionVersion: 0,
      viewport: { zoom: 1, panX: 0, panY: 0 },
      dirty: true,
    };
    useImageEditorStore.setState({ documents: [image], activeDocId: image.id });
    const paperStateBefore = usePaperStore.getState();
    const imageStateBefore = useImageEditorStore.getState();
    const boundary = new ErrorBoundary({ children: null, level: 'root' });
    const setState = vi.spyOn(boundary, 'setState').mockImplementation((patch) => {
      const resolved = typeof patch === 'function' ? patch(boundary.state, boundary.props) : patch;
      boundary.state = { ...boundary.state, ...resolved };
    });

    boundary.resetProject();
    await Promise.resolve();

    expect(setState).toHaveBeenCalledWith(expect.objectContaining({ confirmProjectReset: true }));
    expect(usePaperStore.getState()).toBe(paperStateBefore);
    expect(useImageEditorStore.getState()).toBe(imageStateBefore);
    const cancelProjectReset = (boundary as unknown as { cancelProjectReset: () => void }).cancelProjectReset;
    expect(cancelProjectReset).toEqual(expect.any(Function));
    cancelProjectReset.call(boundary);
    expect(usePaperStore.getState()).toBe(paperStateBefore);
    expect(useImageEditorStore.getState()).toBe(imageStateBefore);
    expect(boundary.state.actionStatus).toBe('Blank project reset canceled. Your Image and Paper documents remain open.');
  });

  it('renders the exact explicit crash-reset recovery choice', () => {
    const html = renderToStaticMarkup(
      <RecoveryFallback
        confirmProjectReset
        error={new Error('root failed')}
        level="root"
        onCancelResetProject={vi.fn()}
        onClearPersistedState={vi.fn()}
        onConfirmResetProject={vi.fn()}
        onCopyDetails={vi.fn()}
        onReloadApp={vi.fn()}
        onResetBoundary={vi.fn()}
        onResetLayout={vi.fn()}
        onResetProject={vi.fn()}
      />,
    );

    expect(html).toContain(
      'Reset Blank Project will replace every open workspace. Every dirty Image and Paper tab will be captured in bounded local recovery first.',
    );
    expect(html).toContain('Cancel Reset');
    expect(html).toContain('Reset with Recovery');
  });

  it('captures dirty Image and Paper after the explicit ErrorBoundary Reset with Recovery decision', async () => {
    const paper = createDefaultPaperDocument({ title: 'Crash reset Paper' });
    usePaperStore.getState().restoreSnapshot({ document: paper, tool: 'select', zoom: 0.8 });
    usePaperStore.setState({ discardedDocumentRecoveries: [] });
    usePaperStore.getState().addPage();
    const image: ImageDocument = {
      id: 'crash-reset-image',
      title: 'Crash reset Image',
      width: 10,
      height: 10,
      layers: [],
      activeLayerId: null,
      hasSelection: false,
      selectionVersion: 0,
      viewport: { zoom: 1, panX: 0, panY: 0 },
      dirty: true,
    };
    useImageEditorStore.setState({ documents: [image], activeDocId: image.id });
    const boundary = new ErrorBoundary({ children: null, level: 'root' });
    vi.spyOn(boundary, 'setState').mockImplementation(() => undefined);
    const resetBoundary = vi.spyOn(boundary, 'resetBoundary').mockImplementation(() => undefined);

    boundary.resetProject();
    expect(resetBoundary).not.toHaveBeenCalled();
    expect(usePaperStore.getState().document.title).toBe('Crash reset Paper');
    expect(useImageEditorStore.getState().documents[0]).toBe(image);
    boundary.confirmProjectReset();

    await vi.waitFor(() => expect(resetBoundary).toHaveBeenCalled());
    expect(usePaperStore.getState().discardedDocumentRecoveries).toHaveLength(1);
    expect(usePaperStore.getState().discardedDocumentRecoveries[0]).toMatchObject({
      reason: 'crash-recovery',
      snapshot: { document: { title: 'Crash reset Paper' } },
    });
    expect(usePaperStore.getState().document.title).toBe('Untitled Paper Layout');
    expect(useImageEditorStore.getState().discardedDocumentRecoveries[0]).toMatchObject({
      reason: 'crash-recovery',
      snapshot: { title: 'Crash reset Image' },
    });
    expect(useImageEditorStore.getState().documents).toEqual([]);
    expect(resetBoundary).toHaveBeenCalledWith(
      'Project reset to a blank workspace. Captured 1 dirty Image tab and 1 dirty Paper tab in bounded local recovery.',
    );
  });

  it('formats error details with stack and component stack', () => {
    const error = new Error('panel failed');
    error.stack = 'Error: panel failed\n    at Panel';

    expect(formatErrorDetails(error, { componentStack: '\n    at DockablePanel' }, 'Source Bin')).toContain(
      'Surface: Source Bin',
    );
    expect(formatErrorDetails(error, { componentStack: '\n    at DockablePanel' }, 'Source Bin')).toContain(
      'Component stack:',
    );
  });

  it('records one redacted crash report from componentDidCatch only while capture is enabled', () => {
    const boundary = new ErrorBoundary({ children: null, level: 'workspace', title: 'Timeline Panel' });

    boundary.componentDidCatch(new Error('timeline exploded'), {
      componentStack: '\n    at TimelinePanel',
      digest: 'x',
    } as never);
    expect(useCrashReportStore.getState().reports).toHaveLength(0);

    useCrashReportStore.setState({ captureEnabled: true });
    boundary.componentDidCatch(new Error('timeline exploded with Bearer abcdef123456789012345678'), {
      componentStack: '\n    at TimelinePanel',
      digest: 'x',
    } as never);

    const reports = useCrashReportStore.getState().reports;
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({
      kind: 'renderer-render',
      surface: 'Timeline Panel',
      componentStack: expect.stringContaining('at TimelinePanel'),
    });
    expect(reports[0]?.message).not.toContain('abcdef123456789012345678');
  });

  it('keeps recovery working when crash-report recording itself fails', () => {
    useCrashReportStore.setState({
      captureEnabled: true,
      recordReport: () => {
        throw new Error('queue storage unavailable');
      },
    });
    const boundary = new ErrorBoundary({ children: null, level: 'workspace', title: 'Canvas' });
    vi.spyOn(boundary, 'setState').mockImplementation(() => undefined);

    expect(() => boundary.componentDidCatch(new Error('render failed'), {
      componentStack: '',
      digest: '',
    } as never)).not.toThrow();
  });
});
