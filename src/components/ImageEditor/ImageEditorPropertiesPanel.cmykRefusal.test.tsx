// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyImageDocument, useImageEditorStore } from '../../store/imageEditorStore';
import { ImageEditorPropertiesPanel } from './ImageEditorPropertiesPanel';

describe('ImageEditorPropertiesPanel CMYK refusal status', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    const doc = createEmptyImageDocument({ id: 'closed-properties', title: 'Ink', width: 1, height: 1 });
    useImageEditorStore.setState({ documents: [doc], activeDocId: doc.id });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it('keeps a CMYK refusal visible while Document Properties remains closed', () => {
    act(() => root.render(<ImageEditorPropertiesPanel />));
    expect(container.querySelector('[aria-expanded="false"]')).not.toBeNull();

    act(() => window.dispatchEvent(new CustomEvent('sloom-cmyk-tool-refused', {
      detail: { tool: 'crop', disclosure: 'Crop is refused for native CMYK; no ink authority changed.' },
    })));

    const status = container.querySelector('[data-image-cmyk-refusal-status]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toContain('Crop is refused');
  });
});
