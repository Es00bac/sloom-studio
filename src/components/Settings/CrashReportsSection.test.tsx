// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CrashReportsSection } from './CrashReportsSection';
import { useCrashReportStore } from '../../store/crashReportStore';
import type { NativeCrashReportState } from '../../lib/nativeApp';

vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);

let capturedBlobs: Blob[] = [];
let capturedFileNames: string[] = [];
let originalAnchorClick: typeof HTMLAnchorElement.prototype.click | undefined;

beforeEach(() => {
  capturedBlobs = [];
  capturedFileNames = [];
  const createObjectURL = vi.fn((blob: Blob) => {
    capturedBlobs.push(blob);
    return 'blob:captured';
  });
  window.URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
  window.URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL;
  originalAnchorClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function recordAnchorClick(this: HTMLAnchorElement) {
    capturedFileNames.push(this.download);
  };
});

afterEach(() => {
  delete window.signalLoomNative;
  useCrashReportStore.setState({ reports: [], captureEnabled: false });
  if (originalAnchorClick) {
    HTMLAnchorElement.prototype.click = originalAnchorClick;
    originalAnchorClick = undefined;
  }
});

async function renderSection(): Promise<{ host: HTMLDivElement; root: Root }> {
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => {
    root.render(<CrashReportsSection />);
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return { host, root };
}

function clickAsync(host: HTMLDivElement, selector: string, root: Root): Promise<void> {
  return act(async () => {
    host.querySelector<HTMLButtonElement>(selector)?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    void root;
  });
}

describe('CrashReportsSection', () => {
  it('renders the honest opt-in contract and records nothing while capture is off', async () => {
    const { host, root } = await renderSection();

    const text = host.textContent ?? '';
    expect(text).toContain('Crash Reports');
    expect(text).toContain('never leave this device');
    expect(text).toContain('structurally redacted');
    expect(text).toContain('no third-party crash service');
    expect(text).toContain('Crash capture is off, so nothing is recorded.');

    const exportButton = host.querySelector<HTMLButtonElement>('button[name="crash-report-export"]');
    expect(exportButton?.disabled).toBe(true);

    await act(async () => root.unmount());
  });

  it('enables opt-in capture from the toggle and persists the choice in the store', async () => {
    const crashReportSetEnabled = vi.fn(async () => ({ enabled: true, persistResult: { ok: true } }));
    window.signalLoomNative = { crashReportSetEnabled } as never;
    const { host, root } = await renderSection();

    await act(async () => {
      host.querySelector<HTMLInputElement>('[data-testid="crash-report-capture-toggle"]')?.click();
    });

    expect(useCrashReportStore.getState().captureEnabled).toBe(true);
    expect(crashReportSetEnabled).toHaveBeenCalledWith(true);
    expect(host.textContent).toContain('Crash capture is on');

    await act(async () => root.unmount());
  });

  it('lists recorded reports with inspectable stacks and exports them as redacted JSON', async () => {
    const { host, root } = await renderSection();
    useCrashReportStore.setState({
      captureEnabled: true,
      reports: [
        {
          id: 'report-1',
          timestamp: Date.parse('2026-08-26T12:00:00.000Z'),
          kind: 'renderer-render',
          message: 'canvas exploded',
          surface: 'Flow Canvas',
          stack: 'Error: canvas exploded\n    at Canvas (app.js:1:1)',
        },
      ],
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const summary = host.querySelector('details summary');
    expect(summary?.textContent).toContain('canvas exploded');
    expect(summary?.textContent).toContain('renderer-render');

    await act(async () => {
      summary?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(host.querySelector('details pre')?.textContent).toContain('at Canvas (app.js:1:1)');

    await clickAsync(host, 'button[name="crash-report-export"]', root);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(capturedBlobs).toHaveLength(1);
    expect(capturedFileNames[0]).toMatch(/^sloom-crash-reports-.*\.json$/);
    const blobText = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result));
      reader.readAsText(capturedBlobs[0]!);
    });
    const payload = JSON.parse(blobText);
    expect(payload.type).toBe('sloom-studio-crash-reports');
    expect(payload.reportCount).toBe(1);
    expect(payload.reports[0]).toMatchObject({ id: 'report-1', message: 'canvas exploded' });
    expect(host.textContent).toContain('Export started for 1 report');

    await act(async () => root.unmount());
  });

  it('merges desktop main-process reports into the inspectable list', async () => {
    const nativeState: NativeCrashReportState = {
      enabled: true,
      nativeReporterStarted: true,
      pendingMinidumpCount: 2,
      crashDumpsPath: '/tmp/sloom/Crashpad',
      reports: [
        {
          id: 'main-1',
          timestamp: Date.parse('2026-08-26T13:00:00.000Z'),
          kind: 'renderer-process-gone',
          message: 'Renderer process gone: crashed',
          detail: 'reason=crashed exitCode=11',
        },
      ],
    };
    const crashReportClear = vi.fn(async () => ({ ok: true, minidumpsRemoved: 2, persistError: undefined, minidumpError: undefined }));
    window.signalLoomNative = {
      crashReportState: vi.fn(async () => nativeState),
      crashReportClear,
    } as never;
    const { host, root } = await renderSection();

    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Renderer process gone: crashed'));
    });

    expect(host.textContent).toContain('2 pending minidumps');
    expect(host.textContent).toContain('/tmp/sloom/Crashpad');

    await clickAsync(host, 'button[name="crash-report-clear"]', root);
    expect(host.textContent).toContain('This permanently deletes');

    await clickAsync(host, 'button[name="crash-report-clear-confirm"]', root);
    await act(async () => {
      await vi.waitFor(() => expect(host.textContent).toContain('Cleared local crash reports and 2 minidumps'));
    });
    expect(crashReportClear).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
  });

  it('keeps clear gated behind confirmation for the browser-only queue', async () => {
    useCrashReportStore.setState({
      captureEnabled: true,
      reports: [
        { id: 'browser-1', timestamp: Date.now(), kind: 'renderer-unhandled-error', message: 'browser crash' },
      ],
    });
    const { host, root } = await renderSection();

    await clickAsync(host, 'button[name="crash-report-clear"]', root);
    expect(useCrashReportStore.getState().reports).toHaveLength(1);

    await clickAsync(host, 'button[name="crash-report-clear-cancel"]', root);
    expect(host.textContent).not.toContain('Delete crash reports');

    await clickAsync(host, 'button[name="crash-report-clear"]', root);
    await clickAsync(host, 'button[name="crash-report-clear-confirm"]', root);
    expect(useCrashReportStore.getState().reports).toHaveLength(0);
    expect(host.textContent).toContain('Cleared local crash reports.');

    await act(async () => root.unmount());
  });
});
