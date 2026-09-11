import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  addFrameToPaperPage,
  addFrameToPaperParentPage,
  addPaperParentPage,
  assignPaperParentPage,
  createDefaultPaperDocument,
} from '../../../lib/paperDocument';
import { addPaperLayer, assignPaperFramesToLayer, updatePaperLayer } from '../../../lib/paperLayers';
import { PaperLayersPanel } from './PaperLayersPanel';
import { buildPaperLayerPanelGroups } from './paperLayersPanelModel';

const callbacks = {
  onAddLayer: vi.fn(),
  onAssignSelectionToLayer: vi.fn(),
  onMoveLayer: vi.fn(),
  onRenameLayer: vi.fn(),
  onSelectFrame: vi.fn(),
  onSetLayerLocked: vi.fn(),
  onSetLayerPrintability: vi.fn(),
  onSetLayerVisibility: vi.fn(),
  onStackFrame: vi.fn(),
  onToggleFrameLock: vi.fn(),
};

describe('PaperLayersPanel', () => {
  it('lists local and inherited visible objects, topmost first, with accessible selection state', () => {
    let document = createDefaultPaperDocument({ title: 'Layered page' });
    document = addPaperParentPage(document, 'A-Parent');
    const parentId = document.parentPages[0].id;
    document = addFrameToPaperParentPage(document, parentId, {
      id: 'parent-heading',
      kind: 'text',
      label: 'Parent heading',
      xMm: 12,
      yMm: 12,
      widthMm: 80,
      heightMm: 12,
      zIndex: 1,
    }).document;
    const pageId = document.pages[0].id;
    document = assignPaperParentPage(document, pageId, parentId);
    document = addFrameToPaperPage(document, pageId, {
      id: 'local-art',
      kind: 'image',
      label: 'Local art',
      xMm: 10,
      yMm: 30,
      widthMm: 100,
      heightMm: 80,
      zIndex: 5,
    }).document;

    const addedLayer = addPaperLayer(document, 'Artwork');
    document = addedLayer.document;
    document = assignPaperFramesToLayer(document, pageId, ['local-art'], addedLayer.layerId!);
    document = updatePaperLayer(document, addedLayer.layerId!, { visible: false, printable: false });

    const html = renderToStaticMarkup(
      <PaperLayersPanel
        {...callbacks}
        document={document}
        page={document.pages[0]}
        selectedFrameIds={['local-art']}
      />,
    );

    expect(html).toContain('Local art');
    expect(html).toContain('Parent heading');
    expect(html.indexOf('Local art')).toBeLessThan(html.indexOf('Parent heading'));
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Inherited');
    expect(html).toContain('Artwork');
    expect(html).toContain('Show layer');
    expect(html).toContain('Print layer');
    expect(html).toContain('Move selection to this layer');
  });

  it('groups hidden and non-printing objects in front-to-back document layer order', () => {
    let document = createDefaultPaperDocument({ title: 'Layer groups' });
    const pageId = document.pages[0].id;
    document = addFrameToPaperPage(document, pageId, {
      id: 'background',
      kind: 'shape',
      label: 'Background',
      xMm: 0,
      yMm: 0,
      widthMm: 100,
      heightMm: 100,
    }).document;
    const addedLayer = addPaperLayer(document, 'Lettering');
    document = addedLayer.document;
    document = addFrameToPaperPage(document, pageId, {
      id: 'caption',
      kind: 'caption',
      label: 'Caption',
      xMm: 10,
      yMm: 10,
      widthMm: 40,
      heightMm: 10,
      layerId: addedLayer.layerId,
    }).document;
    document = updatePaperLayer(document, addedLayer.layerId!, { visible: false, printable: false });

    const groups = buildPaperLayerPanelGroups(document, document.pages[0]);

    expect(groups.map((group) => group.layer.name)).toEqual(['Lettering', 'Layer 1']);
    expect(groups[0].frames.map((frame) => frame.id)).toEqual(['caption']);
    expect(groups[1].frames.map((frame) => frame.id)).toEqual(['background']);
  });
});
