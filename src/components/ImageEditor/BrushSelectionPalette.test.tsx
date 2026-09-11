// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BRUSH_SETTINGS } from '../../types/imageEditor';
import { useImageEditorStore } from '../../store/imageEditorStore';
import { useSettingsStore } from '../../store/settingsStore';
import { IMAGE_BRUSH_PRESETS, applyBrushPreset } from './ImageBrushPresets';
import { normalizeBrushSettings } from './ImageBrushEngine';
import { BrushSelectionPalette } from './BrushSelectionPalette';

const pencil = IMAGE_BRUSH_PRESETS.find((preset) => preset.id === 'pencil')!;

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = Object.getPrototypeOf(input);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('BrushSelectionPalette', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const localStorageStub = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    vi.stubGlobal('localStorage', localStorageStub);
    Object.defineProperty(window, 'localStorage', { configurable: true, value: localStorageStub });
    (useSettingsStore as typeof useSettingsStore & {
      persist?: {
        setOptions?: (options: {
          storage: {
            getItem: (name: string) => string | null;
            setItem: (name: string, value: string) => void;
            removeItem: (name: string) => void;
          };
        }) => void;
      };
    }).persist?.setOptions?.({
      storage: localStorageStub,
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    useImageEditorStore.setState({
      tool: 'brush',
      brushSettings: { ...DEFAULT_BRUSH_SETTINGS },
    });
    useSettingsStore.setState({
      customBrushPresets: [],
    } as Partial<ReturnType<typeof useSettingsStore.getState>>);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('renders the preset library and the My Presets manager', () => {
    act(() => {
      root.render(<BrushSelectionPalette />);
    });
    expect(container.textContent).toContain('My Presets');
    expect(container.textContent).toContain('173 brushes');
    expect(container.textContent).toContain('Graphite & Pencil');
    expect(container.textContent).toContain('Watercolor');
    expect(container.textContent).toContain('Soft Round');
  });

  it('keeps media families collapsed until requested and expands a complete set on demand', () => {
    act(() => {
      root.render(<BrushSelectionPalette />);
    });

    const watercolorGroup = container.querySelector<HTMLElement>('[data-brush-preset-group="Watercolor"]');
    const trigger = watercolorGroup?.querySelector<HTMLButtonElement>('button[aria-expanded]');
    expect(trigger?.getAttribute('aria-expanded')).toBe('false');
    expect(container.textContent).not.toContain('Mop Wash');

    act(() => {
      trigger?.click();
    });

    expect(trigger?.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('Mop Wash');
    expect(watercolorGroup?.querySelectorAll('[data-brush-preset-preview]')).toHaveLength(9);
  });

  it('highlights the active preset and shows a modified badge once a property diverges', () => {
    useImageEditorStore.setState({ brushSettings: applyBrushPreset(normalizeBrushSettings({}), pencil) });
    act(() => {
      root.render(<BrushSelectionPalette />);
    });
    expect(container.textContent).not.toContain('modified');

    act(() => {
      useImageEditorStore.setState((state) => ({
        brushSettings: { ...state.brushSettings, size: state.brushSettings.size + 25 },
      }));
      root.render(<BrushSelectionPalette />);
    });
    expect(container.textContent).toContain('modified');
  });

  it('saves custom presets, exports them to JSON, and deletes them', () => {
    act(() => {
      root.render(<BrushSelectionPalette />);
    });

    const nameInput = container.querySelector<HTMLInputElement>('input[aria-label="Brush preset name"]');
    expect(nameInput).not.toBeNull();
    const saveButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Save Preset'));
    expect(saveButton).not.toBeUndefined();

    act(() => {
      setInputValue(nameInput!, 'Storyboard Inker');
      saveButton?.click();
    });

    expect(useSettingsStore.getState().customBrushPresets).toHaveLength(1);
    expect(container.textContent).toContain('Storyboard Inker');

    const exportButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('Export Presets'));
    expect(exportButton).not.toBeUndefined();

    act(() => {
      exportButton?.click();
    });

    const packTextarea = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Brush preset pack JSON"]');
    expect(packTextarea?.value).toContain('Storyboard Inker');
    const exportedPack = JSON.parse(packTextarea?.value ?? '{}') as {
      metadata?: {
        descriptorId: string;
        importExport: { ready: boolean; exportableUserPresets: number };
        tags: string[];
      };
      presets?: Array<{ metadata?: { preview?: { deterministic: boolean }; tags?: string[] } }>;
    };
    expect(exportedPack.metadata).toMatchObject({
      descriptorId: 'image-brush-preset-pack:v1',
      importExport: {
        ready: true,
        exportableUserPresets: 1,
      },
    });
    expect(exportedPack.metadata?.tags).toEqual(expect.arrayContaining([
      'origin:user',
      'readiness:exportable',
    ]));
    expect(exportedPack.presets?.[0]?.metadata).toMatchObject({
      preview: { deterministic: true },
      tags: expect.arrayContaining(['origin:user']),
    });

    const deleteButton = Array.from(container.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === 'Delete Storyboard Inker');
    expect(deleteButton).not.toBeUndefined();

    act(() => {
      deleteButton?.click();
    });

    expect(useSettingsStore.getState().customBrushPresets).toHaveLength(0);
  });

  it('exposes deterministic preset preview signatures on brush preset tiles', () => {
    act(() => {
      root.render(<BrushSelectionPalette />);
    });

    const sketchGroup = container.querySelector<HTMLElement>('[data-brush-preset-group="Sketch"]');
    act(() => {
      sketchGroup?.querySelector<HTMLButtonElement>('button[aria-expanded]')?.click();
    });

    const pencilPreview = container.querySelector<SVGSVGElement>('svg[data-brush-preset-preview="pencil"]');
    expect(pencilPreview).not.toBeNull();
    expect(pencilPreview?.getAttribute('data-brush-preset-preview-signature')).toBe(
      '4:0.04:0.72:0.18:17:6,9->66,9:61',
    );

    const hardRoundPreview = container.querySelector<SVGSVGElement>('svg[data-brush-preset-preview="hardRound"]');
    expect(hardRoundPreview?.getAttribute('data-brush-preset-preview-signature')).toBe(
      '18:0.1:0.72:0.15:17:6,9->66,9:37',
    );
  });
});
