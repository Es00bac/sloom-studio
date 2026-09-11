import type { PaperDocument, PaperFrame, PaperLayer, PaperPage } from '../../../types/paper';
import { resolvePaperPageInheritedFrames } from '../../../lib/paperDocument';
import { resolvePaperFrameLayer } from '../../../lib/paperLayers';

export interface PaperLayerPanelGroup {
  layer: PaperLayer;
  frames: PaperFrame[];
}

/** Include hidden/non-printing page objects while presenting the document's frontmost layer first. */
export function buildPaperLayerPanelGroups(
  document: PaperDocument,
  page: PaperPage | undefined,
): PaperLayerPanelGroup[] {
  const frames = page ? [...resolvePaperPageInheritedFrames(document, page), ...page.frames] : [];
  return [...document.layers].reverse().map((layer) => ({
    layer,
    frames: frames
      .filter((frame) => resolvePaperFrameLayer(document, frame).id === layer.id)
      .sort((left, right) => right.zIndex - left.zIndex),
  }));
}
