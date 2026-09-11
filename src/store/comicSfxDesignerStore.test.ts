import { describe, expect, it } from 'vitest';
import { createPaperComicSfxDesign } from '../lib/paperComicSfx';
import { useComicSfxDesignerStore } from './comicSfxDesignerStore';

describe('comicSfxDesignerStore', () => {
  it('persists the last designer draft and reusable saved styles', () => {
    useComicSfxDesignerStore.setState({
      lastDesign: createPaperComicSfxDesign('bang'),
      savedStyles: [],
    });

    const design = createPaperComicSfxDesign('kapow', {
      text: 'ka-thunk',
      fillColor: '#f0abfc',
      strokeColor: '#111827',
      burstEnabled: true,
      speedLinesEnabled: false,
    });

    useComicSfxDesignerStore.getState().setLastDesign(design);
    const styleId = useComicSfxDesignerStore.getState().saveStyle('Door Slam', design);

    const state = useComicSfxDesignerStore.getState();
    expect(state.lastDesign).toMatchObject({
      presetId: 'kapow',
      text: 'KA-THUNK',
      fillColor: '#f0abfc',
      burstEnabled: true,
      speedLinesEnabled: false,
    });
    expect(styleId).toMatch(/^sfx-style-/);
    expect(state.savedStyles).toHaveLength(1);
    expect(state.savedStyles[0]).toMatchObject({
      id: styleId,
      name: 'Door Slam',
      design: state.lastDesign,
    });

    useComicSfxDesignerStore.getState().deleteStyle(styleId);
    expect(useComicSfxDesignerStore.getState().savedStyles).toHaveLength(0);
  });
});
