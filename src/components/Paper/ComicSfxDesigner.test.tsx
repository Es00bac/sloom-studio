import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPaperComicSfxDesign } from '../../lib/paperComicSfx';
import { useComicSfxDesignerStore } from '../../store/comicSfxDesignerStore';
import { ComicSfxDesigner } from './ComicSfxDesigner';

describe('ComicSfxDesigner', () => {
  beforeEach(() => {
    useComicSfxDesignerStore.setState({
      lastDesign: createPaperComicSfxDesign('bang'),
      savedStyles: [],
    });
  });

  it('renders a preview-first designer with controls for every SFX effect parameter before placement', () => {
    const html = renderToStaticMarkup(
      <ComicSfxDesigner
        initialPresetId="bang"
        onClose={vi.fn()}
        onPlace={vi.fn()}
      />,
    );

    expect(html).toContain('Comic SFX Designer');
    expect(html).toContain('Preview');
    expect(html).toContain('BANG!');
    expect(html).toContain('Place on Page');

    expect(html).toContain('Trail scale');
    expect(html).toContain('Burst stroke');
    expect(html).toContain('Burst stroke width');
    expect(html).toContain('Line width');
    expect(html).toContain('Line length');
    expect(html).toContain('Line spacing');
    expect(html).toContain('Line opacity');
    expect(html).toContain('Dot radius');
    expect(html).toContain('Dot opacity');
  });

  it('can open from a retained design for editing an already placed SFX layer', () => {
    const html = renderToStaticMarkup(
      <ComicSfxDesigner
        initialDesign={createPaperComicSfxDesign('zap', {
          text: 'edit me',
          fillColor: '#22d3ee',
        })}
        initialPresetId="bang"
        onClose={vi.fn()}
        onPlace={vi.fn()}
        placeLabel="Update Layer"
      />,
    );

    expect(html).toContain('EDIT ME');
    expect(html).toContain('Update Layer');
    expect(html).toContain('#22d3ee');
  });
});
