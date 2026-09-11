/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ExternalMonitoringControlPanel } from './ExternalMonitoringControlPanel';
import type { ExternalMonitoringAction, ExternalMonitoringAdapter, ExternalMonitoringDevice, ExternalMonitoringSession } from '../../../lib/videoExternalMonitoring';

vi.hoisted(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

function clickButton(container: HTMLElement, label: string) {
  const button = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent === label);
  expect(button, `button ${label}`).toBeTruthy();
  act(() => { button?.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

describe('ExternalMonitoringControlPanel', () => {
  it('discloses the browser-only refusal when no adapter is supplied', () => {
    const markup = renderToStaticMarkup(<ExternalMonitoringControlPanel />);
    expect(markup).toContain('No native external adapter is installed');
    expect(markup).toContain('never claims hardware output');
    expect(markup).toContain('No device discovery');
  });

  it('discovers, connects, and dispatches only advertised commands', async () => {
    const sent: unknown[] = [];
    const discoveredDevice = { id: 'surface', label: 'Surface', kind: 'combined', transport: 'vendor-control', online: true, capabilities: ['monitor-output', 'transport', 'jog', 'shuttle'] } as const satisfies ExternalMonitoringDevice;
    const adapter: ExternalMonitoringAdapter = {
      id: 'test-adapter', label: 'Test adapter', vendor: 'Fixture',
      discover: vi.fn(async () => [discoveredDevice]),
      connect: vi.fn(async () => ({ send: async (action: ExternalMonitoringAction) => { sent.push(action); }, close: async () => undefined })),
    };
    const container = document.createElement('div');
    document.body.append(container);
    const root: Root = createRoot(container);
    act(() => root.render(<ExternalMonitoringControlPanel adapters={[adapter]} />));
    await act(async () => { clickButton(container, 'Discover devices'); });
    await act(async () => { clickButton(container, 'Connect'); });
    await act(async () => { clickButton(container, 'Play'); });
    await act(async () => { clickButton(container, 'Jog +10 frames'); });
    expect(adapter.discover).toHaveBeenCalledOnce();
    expect(adapter.connect).toHaveBeenCalledWith('surface');
    expect(sent).toEqual([{ kind: 'transport', command: 'play' }, { kind: 'jog', frames: 10 }]);
    act(() => root.unmount());
    container.remove();
  });

  it('closes a session that resolves after the panel unmounts', async () => {
    const device = { id: 'deferred-device', label: 'Deferred device', kind: 'monitor', transport: 'sdi', online: true, capabilities: ['monitor-output'] } as const satisfies ExternalMonitoringDevice;
    const close = vi.fn(async () => undefined);
    let resolveSession: ((session: ExternalMonitoringSession) => void) | undefined;
    const adapter: ExternalMonitoringAdapter = {
      id: 'deferred-adapter', label: 'Deferred adapter', vendor: 'Fixture',
      discover: vi.fn(async () => [device]),
      connect: vi.fn(() => new Promise<ExternalMonitoringSession>((resolve) => { resolveSession = resolve; })),
    };
    const container = document.createElement('div');
    document.body.append(container);
    const root: Root = createRoot(container);
    act(() => root.render(<ExternalMonitoringControlPanel adapters={[adapter]} />));
    await act(async () => { clickButton(container, 'Discover devices'); });
    await act(async () => { clickButton(container, 'Connect'); });
    expect(adapter.connect).toHaveBeenCalledWith('deferred-device');
    act(() => root.unmount());
    await act(async () => {
      resolveSession?.({ send: async () => undefined, close });
      await Promise.resolve();
    });
    expect(close).toHaveBeenCalledOnce();
    container.remove();
  });
});
