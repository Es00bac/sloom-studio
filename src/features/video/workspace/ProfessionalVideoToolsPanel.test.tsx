// @vitest-environment jsdom

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { EditorVisualClip } from '../../../types/flow';
import { createEditorAudioClip, createEditorVisualClip } from '../../../lib/manualEditorState';
import { createDefaultEditorProfessionalVideoState } from '../../../types/videoProfessional';
import {
  applyInterchangeResult,
  findInterchangeSourceItem,
  ProfessionalVideoToolsPanel,
} from './ProfessionalVideoToolsPanel';

vi.hoisted(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
});

const trackingMock = vi.hoisted(() => {
  class MaskTrackingMediaError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'MaskTrackingMediaError';
    }
  }
  return { run: vi.fn(), MaskTrackingMediaError };
});
vi.mock('../../../lib/videoRotoTracking', () => ({ runBrowserMaskTracking: trackingMock.run, MaskTrackingMediaError: trackingMock.MaskTrackingMediaError }));

describe('ProfessionalVideoToolsPanel', () => {
  it('presents imported and generated media as separate professional pools', () => {
    const markup = renderToStaticMarkup(
      <ProfessionalVideoToolsPanel
        audioClips={[]}
        frameRate={24}
        onChange={vi.fn()}
        onExportFcpXml={vi.fn()}
        onImportTimelineClips={vi.fn()}
        onUpdateAudioClip={vi.fn()}
        onUpdateVisualClip={vi.fn()}
        sourceItems={[
          { id: 'camera', nodeId: 'camera', label: 'Camera A', kind: 'video', professional: { version: 1, origin: 'imported', onlineState: 'online', proxy: { status: 'ready' } } },
          { id: 'generated', nodeId: 'generated', label: 'Generated plate', kind: 'video', professional: { version: 1, origin: 'generated' } },
        ]}
        state={createDefaultEditorProfessionalVideoState()}
        visualClips={[]}
      />,
    );

    expect(markup).toContain('Professional Video');
    expect(markup).toContain('Imported');
    expect(markup).toContain('Generated');
    expect(markup).toContain('Proxies');
    expect(markup).toContain('Long-form performance');
  });

  it('provides four clear tool groups and a persistent status region', () => {
    const markup = renderToStaticMarkup(
      <ProfessionalVideoToolsPanel
        audioClips={[]}
        frameRate={30}
        onChange={vi.fn()}
        onExportFcpXml={vi.fn()}
        onImportTimelineClips={vi.fn()}
        onUpdateAudioClip={vi.fn()}
        onUpdateVisualClip={vi.fn()}
        sourceItems={[]}
        visualClips={[]}
      />,
    );

    expect(markup).toContain('Media');
    expect(markup).toContain('Timeline');
    expect(markup).toContain('Finish');
    expect(markup).toContain('Text &amp; I/O');
    expect(markup).toContain('aria-live="polite"');
  });

  it('mounts the external I/O boundary without claiming browser hardware support', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => {
        root.render(<ProfessionalVideoToolsPanel audioClips={[]} frameRate={30} onChange={vi.fn()} onExportFcpXml={vi.fn()} onImportTimelineClips={vi.fn()} onUpdateAudioClip={vi.fn()} onUpdateVisualClip={vi.fn()} sourceItems={[]} visualClips={[]} />);
      });
      const externalTab = [...container.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'External I/O');
      expect(externalTab).toBeTruthy();
      await act(async () => { externalTab?.click(); });
      expect(container.querySelector('[data-external-monitoring-panel="true"]')).not.toBeNull();
      expect(container.textContent).toContain('No native external adapter is installed');
      expect(container.textContent).toContain('never claims hardware output');
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });

  it('mounts the explicit Sloom handoff control while leaving binary AAF unavailable', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    let root: Root | undefined;

    try {
      root = createRoot(container);
      await act(async () => {
        root?.render(
          <ProfessionalVideoToolsPanel
            audioClips={[]}
            frameRate={25}
            onChange={vi.fn()}
            onExportFcpXml={vi.fn()}
            onImportTimelineClips={vi.fn()}
            onUpdateAudioClip={vi.fn()}
            onUpdateVisualClip={vi.fn()}
            sourceItems={[]}
            visualClips={[]}
          />,
        );
      });
      const deliveryTab = [...container.querySelectorAll('button')].find((element) => element.textContent?.trim() === 'Text & I/O') as HTMLButtonElement;
      await act(async () => { deliveryTab.click(); });

      expect(container.textContent).toContain('Export Sloom AAF handoff');
      expect(container.textContent).toContain('AAF binary unavailable — handoff is JSON');
      const input = container.querySelector<HTMLInputElement>('input[accept*=".aaf"]');
      expect(input).not.toBeNull();
      const binaryAaf = new File(['not decoded'], 'hostile.aaf', { type: 'application/octet-stream' });
      const readBinaryText = vi.fn(async () => 'not decoded');
      Object.defineProperty(binaryAaf, 'text', { value: readBinaryText });
      Object.defineProperty(input, 'files', { configurable: true, value: [binaryAaf] });
      await act(async () => {
        input?.dispatchEvent(new Event('change', { bubbles: true }));
        await Promise.resolve();
      });

      expect(readBinaryText).not.toHaveBeenCalled();
      expect(container.textContent).toContain('AAF parsing and writing are not implemented');
    } finally {
      await act(async () => { root?.unmount(); });
      container.remove();
    }
  });

  it('mounts primary correction controls and persists bounded changes through the selected clip callback', async () => {
    const initialClip: EditorVisualClip = {
      ...createEditorVisualClip('source-1', 'video'),
      id: 'clip-1',
      filterStack: [{ id: 'kept-hue', kind: 'hue-rotate', amount: 10, enabled: true }],
    };
    const onUpdateVisualClip = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    let root: Root | undefined;

    function Harness() {
      const [clip, setClip] = useState<EditorVisualClip>(initialClip);
      return (
        <ProfessionalVideoToolsPanel
          audioClips={[]}
          frameRate={30}
          onChange={vi.fn()}
          onExportFcpXml={vi.fn()}
          onImportTimelineClips={vi.fn()}
          onUpdateAudioClip={vi.fn()}
          onUpdateVisualClip={(clipId, patch, label) => {
            onUpdateVisualClip(clipId, patch, label);
            setClip((current) => ({ ...current, ...patch }));
          }}
          selectedVisualClip={clip}
          sourceItems={[]}
          state={createDefaultEditorProfessionalVideoState()}
          visualClips={[clip]}
        />
      );
    }

    const button = (label: string) => [...container.querySelectorAll('button')]
      .find((element) => element.textContent?.trim() === label) as HTMLButtonElement;
    const setInputValue = async (label: string, value: string) => {
      const input = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
      expect(input).not.toBeNull();
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, value);
        input?.dispatchEvent(new Event('input', { bubbles: true }));
        input?.dispatchEvent(new Event('change', { bubbles: true }));
      });
    };

    try {
      root = createRoot(container);
      await act(async () => { root?.render(<Harness />); });
      await act(async () => { button('Finish').click(); });

      expect(container.querySelector('[data-primary-color-route="executable"]')).not.toBeNull();
      expect(container.textContent).toContain('LUT references, RGB lift/gamma/gain, qualifiers, curves, and scopes remain unavailable for output');

      await setInputValue('Exposure trim', '1.5');
      expect(onUpdateVisualClip).toHaveBeenLastCalledWith('clip-1', expect.objectContaining({
        professional: expect.objectContaining({ color: expect.objectContaining({ exposureStops: 1.5 }) }),
        filterStack: expect.arrayContaining([expect.objectContaining({ id: 'professional-primary-exposure', amount: 15 })]),
      }), 'Adjust primary exposure');
      expect(button('Reset primary correction').disabled).toBe(false);

      await act(async () => { button('Reset primary correction').click(); });
      expect(onUpdateVisualClip).toHaveBeenLastCalledWith('clip-1', expect.objectContaining({
        filterStack: [{ id: 'kept-hue', kind: 'hue-rotate', amount: 10, enabled: true }],
      }), 'Reset primary color correction');
    } finally {
      await act(async () => { root?.unmount(); });
      container.remove();
    }
  });

  it('mounts executable selected-clip routing and persisted bus gain/pan/mute/solo controls', async () => {
    const initialClip = { ...createEditorAudioClip('audio-source', 0), id: 'audio-clip' };
    const onChange = vi.fn();
    const onUpdateAudioClip = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    let root: Root | undefined;

    function Harness() {
      const [state, setState] = useState(createDefaultEditorProfessionalVideoState());
      const [clip, setClip] = useState(initialClip);
      return <ProfessionalVideoToolsPanel
        audioClips={[clip]}
        frameRate={30}
        onChange={(next, label) => { onChange(next, label); setState(next); }}
        onExportFcpXml={vi.fn()}
        onImportTimelineClips={vi.fn()}
        onUpdateAudioClip={(clipId, patch, label) => {
          onUpdateAudioClip(clipId, patch, label);
          setClip((current) => ({ ...current, ...patch }));
        }}
        onUpdateVisualClip={vi.fn()}
        selectedAudioClip={clip}
        sourceItems={[]}
        state={state}
        visualClips={[]}
      />;
    }
    const button = (label: string) => [...container.querySelectorAll('button')]
      .find((element) => element.textContent?.trim() === label) as HTMLButtonElement;

    try {
      root = createRoot(container);
      await act(async () => { root?.render(<Harness />); });
      await act(async () => { button('Finish').click(); });
      expect(container.querySelector('[data-video-audio-mixer="executable"]')).not.toBeNull();
      expect(container.textContent).toContain('Program Monitor and browser/native sequence export');

      await act(async () => { button('Add submix').click(); });
      const route = container.querySelector<HTMLSelectElement>('select[aria-label="Selected audio clip bus"]');
      expect(route).not.toBeNull();
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
        setter?.call(route, route?.options[1]?.value);
        route?.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(onUpdateAudioClip).toHaveBeenLastCalledWith('audio-clip', expect.objectContaining({
        professional: expect.objectContaining({ busId: expect.stringMatching(/^bus-/u) }),
      }), 'Route selected audio clip');

      const gain = container.querySelector<HTMLInputElement>('input[aria-label="Submix 1 gain dB"]');
      expect(gain).not.toBeNull();
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(gain, '-6');
        gain?.dispatchEvent(new Event('input', { bubbles: true }));
        gain?.dispatchEvent(new Event('change', { bubbles: true }));
      });
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
        audioBuses: expect.arrayContaining([expect.objectContaining({ name: 'Submix 1', gainDb: -6 })]),
      }), 'Set Submix 1 bus gain');
      await act(async () => { button('Mute').click(); });
      await act(async () => { button('Solo').click(); });
      expect(container.querySelector('[data-video-audio-bus^="bus-"]')).not.toBeNull();
    } finally {
      await act(async () => { root?.unmount(); });
      container.remove();
    }
  });

  it('mounts an explicit final-mix loudness opt-in and persists its delivery targets', async () => {
    const onChange = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    let root: Root | undefined;
    try {
      root = createRoot(container);
      await act(async () => root?.render(
        <ProfessionalVideoToolsPanel
          audioClips={[]}
          frameRate={30}
          onChange={onChange}
          onExportFcpXml={vi.fn()}
          onImportTimelineClips={vi.fn()}
          onUpdateAudioClip={vi.fn()}
          onUpdateVisualClip={vi.fn()}
          sourceItems={[]}
          state={createDefaultEditorProfessionalVideoState()}
          visualClips={[]}
        />,
      ));
      const finish = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === 'Finish') as HTMLButtonElement;
      await act(async () => finish.click());
      const section = container.querySelector('[data-video-loudness-normalization="true"]');
      expect(section?.textContent).toContain('Normalize final rendered mix');
      expect(section?.textContent).toContain('offline FFmpeg loudnorm first pass');

      const toggle = section?.querySelector('input[type="checkbox"]') as HTMLInputElement;
      await act(async () => toggle.click());
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
        loudnessNormalization: expect.objectContaining({ enabled: true, targetLufs: -14, truePeakCeilingDbtp: -1 }),
      }), 'Enable final-mix loudness normalization');
    } finally {
      await act(async () => root?.unmount());
      container.remove();
    }
  });

  it('mounts bounded decoded tracking and persists only its completed keyframes', async () => {
    trackingMock.run.mockResolvedValueOnce({
      sampledFrames: 3,
      keyframes: [
        { timeMs: 1_000, offsetX: 0, offsetY: 0, scale: 1 },
        { timeMs: 1_500, offsetX: 0.1, offsetY: 0, scale: 1 },
      ],
    });
    const initialClip = { ...createEditorVisualClip('camera-a', 'video', { sourceInMs: 1_000, sourceOutMs: 3_000, durationSeconds: 2 }), id: 'tracked-clip' };
    const onUpdateVisualClip = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    let root: Root | undefined;

    function Harness() {
      const [clip, setClip] = useState(initialClip);
      return <ProfessionalVideoToolsPanel
        audioClips={[]}
        frameRate={30}
        onChange={vi.fn()}
        onExportFcpXml={vi.fn()}
        onImportTimelineClips={vi.fn()}
        onUpdateAudioClip={vi.fn()}
        onUpdateVisualClip={(clipId, patch, label) => {
          onUpdateVisualClip(clipId, patch, label);
          setClip((current) => ({ ...current, ...patch }));
        }}
        selectedVisualClip={clip}
        sourceItems={[{ id: 'camera-a', nodeId: 'camera-a', label: 'Camera A', kind: 'video', assetUrl: 'blob:camera-a' }]}
        state={createDefaultEditorProfessionalVideoState()}
        visualClips={[clip]}
      />;
    }
    const button = (label: string) => [...container.querySelectorAll('button')]
      .find((element) => element.textContent?.trim() === label) as HTMLButtonElement;

    try {
      root = createRoot(container);
      await act(async () => { root?.render(<Harness />); });
      await act(async () => { button('Finish').click(); });
      await act(async () => { button('Add ellipse mask').click(); });
      await act(async () => { button('Track mask (bounded)').click(); await Promise.resolve(); });

      expect(trackingMock.run).toHaveBeenCalledWith(expect.objectContaining({
        assetUrl: 'blob:camera-a',
        startMs: 1_000,
        durationMs: 2_000,
      }));
      expect(onUpdateVisualClip).toHaveBeenLastCalledWith('tracked-clip', expect.objectContaining({
        professional: expect.objectContaining({
          masks: [expect.objectContaining({ tracking: { status: 'ready', keyframes: [
            { timeMs: 0, offsetX: 0, offsetY: 0, scale: 1 },
            { timeMs: 500, offsetX: 0.1, offsetY: 0, scale: 1 },
          ] } })],
        }),
      }), 'Track selected mask from bounded decoded frames');
      expect(container.textContent).toContain('Stage and browser/native delivery now resolve the tracked mask at clip time');
    } finally {
      await act(async () => { root?.unmount(); });
      container.remove();
    }
  });

  it('merges completed tracking into the current clip state without reverting concurrent professional edits', async () => {
    let resolveRun: (value: { sampledFrames: number; keyframes: Array<{ timeMs: number; offsetX: number; offsetY: number; scale: number }> }) => void = () => undefined;
    trackingMock.run.mockImplementationOnce(() => new Promise((resolve) => { resolveRun = resolve; }));
    const initialClip = { ...createEditorVisualClip('camera-a', 'video', { sourceInMs: 0, sourceOutMs: 2_000, durationSeconds: 2 }), id: 'tracked-clip' };
    const onUpdateVisualClip = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    let root: Root | undefined;

    function Harness() {
      const [clip, setClip] = useState(initialClip);
      return <ProfessionalVideoToolsPanel
        audioClips={[]}
        frameRate={30}
        onChange={vi.fn()}
        onExportFcpXml={vi.fn()}
        onImportTimelineClips={vi.fn()}
        onUpdateAudioClip={vi.fn()}
        onUpdateVisualClip={(clipId, patch, label) => {
          onUpdateVisualClip(clipId, patch, label);
          setClip((current) => ({ ...current, ...patch }));
        }}
        selectedVisualClip={clip}
        sourceItems={[{ id: 'camera-a', nodeId: 'camera-a', label: 'Camera A', kind: 'video', assetUrl: 'blob:camera-a' }]}
        state={createDefaultEditorProfessionalVideoState()}
        visualClips={[clip]}
      />;
    }
    const button = (label: string) => [...container.querySelectorAll('button')]
      .find((element) => element.textContent?.trim() === label) as HTMLButtonElement;

    try {
      root = createRoot(container);
      await act(async () => { root?.render(<Harness />); });
      await act(async () => { button('Finish').click(); });
      await act(async () => { button('Add ellipse mask').click(); });
      await act(async () => { button('Track mask (bounded)').click(); await Promise.resolve(); });
      await act(async () => { button('Save stab setup').click(); });
      await act(async () => {
        resolveRun({ sampledFrames: 2, keyframes: [{ timeMs: 0, offsetX: 0, offsetY: 0, scale: 1 }] });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(onUpdateVisualClip).toHaveBeenLastCalledWith('tracked-clip', expect.objectContaining({
        professional: expect.objectContaining({
          stabilization: expect.objectContaining({ enabled: true, strengthPercent: 50, cropMode: 'auto-scale' }),
          masks: [expect.objectContaining({ tracking: { status: 'ready', keyframes: [{ timeMs: 0, offsetX: 0, offsetY: 0, scale: 1 }] } })],
        }),
      }), 'Track selected mask from bounded decoded frames');
    } finally {
      await act(async () => { root?.unmount(); });
      container.remove();
    }
  });

  it('retires honestly without writing keyframes when the mask setup changed during the run', async () => {
    let resolveRun: (value: { sampledFrames: number; keyframes: Array<{ timeMs: number; offsetX: number; offsetY: number; scale: number }> }) => void = () => undefined;
    trackingMock.run.mockImplementationOnce(() => new Promise((resolve) => { resolveRun = resolve; }));
    const initialClip = { ...createEditorVisualClip('camera-a', 'video', { sourceInMs: 0, sourceOutMs: 2_000, durationSeconds: 2 }), id: 'tracked-clip' };
    const onUpdateVisualClip = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    let root: Root | undefined;

    function Harness() {
      const [clip, setClip] = useState(initialClip);
      return <ProfessionalVideoToolsPanel
        audioClips={[]}
        frameRate={30}
        onChange={vi.fn()}
        onExportFcpXml={vi.fn()}
        onImportTimelineClips={vi.fn()}
        onUpdateAudioClip={vi.fn()}
        onUpdateVisualClip={(clipId, patch, label) => {
          onUpdateVisualClip(clipId, patch, label);
          setClip((current) => ({ ...current, ...patch }));
        }}
        selectedVisualClip={clip}
        sourceItems={[{ id: 'camera-a', nodeId: 'camera-a', label: 'Camera A', kind: 'video', assetUrl: 'blob:camera-a' }]}
        state={createDefaultEditorProfessionalVideoState()}
        visualClips={[clip]}
      />;
    }
    const button = (label: string) => [...container.querySelectorAll('button')]
      .find((element) => element.textContent?.trim() === label) as HTMLButtonElement;

    try {
      root = createRoot(container);
      await act(async () => { root?.render(<Harness />); });
      await act(async () => { button('Finish').click(); });
      await act(async () => { button('Add ellipse mask').click(); });
      await act(async () => { button('Track mask (bounded)').click(); await Promise.resolve(); });
      await act(async () => { button('Add ellipse mask').click(); });
      await act(async () => {
        resolveRun({ sampledFrames: 2, keyframes: [{ timeMs: 0, offsetX: 0, offsetY: 0, scale: 1 }] });
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(onUpdateVisualClip).not.toHaveBeenCalledWith('tracked-clip', expect.anything(), 'Track selected mask from bounded decoded frames');
      expect(container.textContent).toContain('changed during the run');
    } finally {
      await act(async () => { root?.unmount(); });
      container.remove();
    }
  });

  it('reports a distinct media failure instead of a cancellation when decoding fails', async () => {
    trackingMock.run.mockRejectedValueOnce(new trackingMock.MaskTrackingMediaError('The source media could not be decoded: DEMUXER_ERROR_COULD_NOT_OPEN'));
    const initialClip = { ...createEditorVisualClip('camera-a', 'video', { sourceInMs: 0, sourceOutMs: 2_000, durationSeconds: 2 }), id: 'tracked-clip' };
    const container = document.createElement('div');
    document.body.append(container);
    let root: Root | undefined;

    function Harness() {
      const [clip, setClip] = useState(initialClip);
      return <ProfessionalVideoToolsPanel
        audioClips={[]}
        frameRate={30}
        onChange={vi.fn()}
        onExportFcpXml={vi.fn()}
        onImportTimelineClips={vi.fn()}
        onUpdateAudioClip={vi.fn()}
        onUpdateVisualClip={(_clipId, patch) => setClip((current) => ({ ...current, ...patch }))}
        selectedVisualClip={clip}
        sourceItems={[{ id: 'camera-a', nodeId: 'camera-a', label: 'Camera A', kind: 'video', assetUrl: 'blob:camera-a' }]}
        state={createDefaultEditorProfessionalVideoState()}
        visualClips={[clip]}
      />;
    }
    const button = (label: string) => [...container.querySelectorAll('button')]
      .find((element) => element.textContent?.trim() === label) as HTMLButtonElement;

    try {
      root = createRoot(container);
      await act(async () => { root?.render(<Harness />); });
      await act(async () => { button('Finish').click(); });
      await act(async () => { button('Add ellipse mask').click(); });
      await act(async () => { button('Track mask (bounded)').click(); await Promise.resolve(); await Promise.resolve(); });

      expect(container.textContent).toContain('Mask tracking failed: The source media could not be decoded: DEMUXER_ERROR_COULD_NOT_OPEN');
      expect(container.textContent).not.toContain('Mask tracking cancelled');
    } finally {
      await act(async () => { root?.unmount(); });
      container.remove();
    }
  });

  it('mounts a persisted multicam host and records a camera switch at the playhead', async () => {
    const initialClip = { ...createEditorVisualClip('camera-a', 'video', { startMs: 0, sourceInMs: 0, sourceOutMs: 4_000, durationSeconds: 4 }), id: 'host' };
    const onChange = vi.fn();
    const container = document.createElement('div');
    document.body.append(container);
    let root: Root | undefined;

    function Harness() {
      const [state, setState] = useState(createDefaultEditorProfessionalVideoState());
      const [clip, setClip] = useState(initialClip);
      return <ProfessionalVideoToolsPanel
        audioClips={[]}
        frameRate={30}
        playheadMs={1_000}
        onChange={(next, label) => { onChange(next, label); setState(next); }}
        onExportFcpXml={vi.fn()}
        onImportTimelineClips={vi.fn()}
        onUpdateAudioClip={vi.fn()}
        onUpdateVisualClip={(_clipId, patch) => setClip((current) => ({ ...current, ...patch }))}
        selectedVisualClip={clip}
        sourceItems={[
          { id: 'camera-a', nodeId: 'camera-a', label: 'Camera A', kind: 'video' },
          { id: 'camera-b', nodeId: 'camera-b', label: 'Camera B', kind: 'video' },
        ]}
        state={state}
        visualClips={[clip]}
      />;
    }

    const button = (prefix: string) => [...container.querySelectorAll('button')]
      .find((element) => element.textContent?.trim().startsWith(prefix)) as HTMLButtonElement;
    try {
      root = createRoot(container);
      await act(async () => { root?.render(<Harness />); });
      await act(async () => { button('Timeline').click(); });
      await act(async () => { button('Create from first').click(); });
      expect(container.querySelector('[data-multicam-route="executable"]')).not.toBeNull();
      await act(async () => { button('Attach selected').click(); });
      await act(async () => { button('Record Camera 2').click(); });
      expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
        multicamSources: [expect.objectContaining({
          activeAngleId: 'camera-b',
          cuts: expect.arrayContaining([expect.objectContaining({ timelineMs: 0, angleSourceId: 'camera-a' }), expect.objectContaining({ timelineMs: 1_000, angleSourceId: 'camera-b' })]),
        })],
      }), 'Record multicam camera cut');
    } finally {
      await act(async () => { root?.unmount(); });
      container.remove();
    }
  });

  it('places imported interchange clips only when media resolves unambiguously', () => {
    const onChange = vi.fn();
    const onImportTimelineClips = vi.fn();
    const result = applyInterchangeResult({
      sequence: {
        name: 'Imported cut',
        frameRate: 24,
        tracks: [{
          id: 'v-main',
          name: 'V1',
          kind: 'video',
          index: 0,
          items: [
            { type: 'clip', id: 'hero', name: 'Hero', startMs: 2_000, durationMs: 3_000, sourceInMs: 500, mediaReference: 'file:///media/Hero.mov', enabled: true, speed: 2 },
            { type: 'clip', id: 'missing', name: 'Missing', startMs: 5_000, durationMs: 1_000, sourceInMs: 0, enabled: true, speed: 1 },
          ],
        }],
      },
      report: { format: 'otio-json', mapped: [], approximated: [], dropped: [] },
    }, createDefaultEditorProfessionalVideoState(), [{
      id: 'hero-source',
      nodeId: 'hero-node',
      label: 'Hero camera original',
      kind: 'video',
      nativeFilePath: '/media/Hero.mov',
    }], onChange, onImportTimelineClips);

    expect(result).toEqual({ placedClips: 1, unlinkedClips: 1 });
    expect(onImportTimelineClips).toHaveBeenCalledOnce();
    expect(onImportTimelineClips.mock.calls[0][0][0]).toMatchObject({
      sourceNodeId: 'hero-node',
      trackIndex: 0,
      startMs: 2_000,
      sourceInMs: 500,
      sourceOutMs: 6_500,
      durationSeconds: 3,
      playbackRate: 2,
      professional: { trackId: 'v-main' },
    });
    expect(onChange).toHaveBeenCalledOnce();
  });

  it('exactly resolves FCP7 file://localhost paths before ambiguous basename fallback', () => {
    const sources = [
      { id: 'hero-a', nodeId: 'hero-a', label: 'Hero A', kind: 'video' as const, nativeFilePath: '/roll-a/Hero.mov' },
      { id: 'hero-b', nodeId: 'hero-b', label: 'Hero B', kind: 'video' as const, nativeFilePath: '/roll-b/Hero.mov' },
    ];
    expect(findInterchangeSourceItem('file://localhost/roll-b/Hero.mov', 'Hero', sources)?.id).toBe('hero-b');
    expect(findInterchangeSourceItem('file:///unknown/Hero.mov', 'Hero', sources)).toBeUndefined();
  });

  it('preserves disabled video semantics as a documented zero-opacity approximation', () => {
    const onChange = vi.fn();
    const onImportTimelineClips = vi.fn();
    applyInterchangeResult({
      sequence: {
        name: 'Disabled cut', frameRate: 24,
        tracks: [{
          id: 'v-disabled', name: 'V1', kind: 'video', index: 0,
          items: [{ type: 'clip', id: 'disabled', name: 'Hero', startMs: 0, durationMs: 1_000, sourceInMs: 0, enabled: false, speed: 1 }],
        }],
      },
      report: { format: 'fcp7-xml', mapped: [], approximated: [], dropped: [] },
    }, createDefaultEditorProfessionalVideoState(), [{
      id: 'hero-source', nodeId: 'hero-node', label: 'Hero', kind: 'video', nativeFilePath: '/media/Hero.mov',
    }], onChange, onImportTimelineClips);

    expect(onImportTimelineClips.mock.calls[0][0][0]).toMatchObject({
      opacityPercent: 0,
      professional: { trackId: 'v-disabled' },
    });
    expect(onChange.mock.calls[0][0].interchangeHistory[0].warnings).toContainEqual(expect.stringMatching(/zero opacity/));
  });

  it('records a Sloom handoff import in persisted professional history without calling it an AAF binary', () => {
    const onChange = vi.fn();
    const onImportTimelineClips = vi.fn();
    applyInterchangeResult({
      sequence: {
        name: 'Sloom handoff', frameRate: 25,
        tracks: [{
          id: 'v-handoff', name: 'V1', kind: 'video', index: 0,
          items: [{ type: 'clip', id: 'hero', name: 'Hero', startMs: 0, durationMs: 1_000, sourceInMs: 0, mediaReference: 'file:///media/Hero.mov', enabled: true, speed: 1 }],
        }],
      },
      report: {
        format: 'sloom-aaf-handoff',
        mapped: [],
        approximated: [{ sourceId: 'sloom-aaf-handoff', message: 'This manifest is not an AAF binary.' }],
        dropped: [],
      },
    }, createDefaultEditorProfessionalVideoState(), [{
      id: 'hero-source', nodeId: 'hero-node', label: 'Hero', kind: 'video', nativeFilePath: '/media/Hero.mov',
    }], onChange, onImportTimelineClips);

    expect(onImportTimelineClips).toHaveBeenCalledOnce();
    expect(onChange.mock.calls[0][0].interchangeHistory[0]).toMatchObject({
      format: 'aaf-handoff',
      direction: 'import',
      warnings: [expect.stringMatching(/not an AAF binary/)],
    });
  });

  it('mounts an atomic nested-sequence action and places an adjustment pass on a dedicated higher track', () => {
    const host = document.createElement('div');
    document.body.append(host);
    let root: Root | undefined;
    const onCreateNestedSequence = vi.fn();
    const onUpdateVisualClip = vi.fn();
    const selectedVisualClip = {
      ...createEditorVisualClip('source-a', 'image', { trackIndex: 1, durationSeconds: 3 }),
      id: 'selected-clip',
    };
    const upperTrackClip = { ...createEditorVisualClip('source-b', 'image', { trackIndex: 3 }), id: 'upper-clip' };

    try {
      act(() => {
        root = createRoot(host);
        root.render(
          <ProfessionalVideoToolsPanel
            audioClips={[]}
            frameRate={24}
            onChange={vi.fn()}
            onCreateNestedSequence={onCreateNestedSequence}
            onExportFcpXml={vi.fn()}
            onImportTimelineClips={vi.fn()}
            onUpdateAudioClip={vi.fn()}
            onUpdateVisualClip={onUpdateVisualClip}
            selectedVisualClip={selectedVisualClip}
            sourceItems={[]}
            state={createDefaultEditorProfessionalVideoState()}
            visualClips={[selectedVisualClip, upperTrackClip]}
          />,
        );
      });
      const button = (label: string) => [...host.querySelectorAll('button')].find((candidate) => candidate.textContent === label);
      act(() => button('Timeline')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      act(() => button('New nested sequence')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      act(() => button('Make adjustment layer')?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

      expect(onCreateNestedSequence).toHaveBeenCalledWith(
        expect.objectContaining({
          visualClips: [expect.objectContaining({ id: 'selected-clip' })],
        }),
        expect.objectContaining({
          id: 'selected-clip',
          professional: expect.objectContaining({ adjustmentLayer: false }),
        }),
        'Nest selected visual clip',
      );
      expect(onUpdateVisualClip).toHaveBeenCalledWith(
        'selected-clip',
        expect.objectContaining({
          trackIndex: 4,
          professional: expect.objectContaining({ adjustmentLayer: true }),
        }),
        'Make adjustment layer',
      );
    } finally {
      act(() => root?.unmount());
      host.remove();
    }
  });
});
