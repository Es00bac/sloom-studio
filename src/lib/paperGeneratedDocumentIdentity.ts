import type {
  PaperDocument,
  PaperFrame,
  PaperGuide,
  PaperRichParagraph,
  PaperTextRun,
} from '../types/paper';

export interface FreshenPaperDocumentIdentityOptions {
  createId?: (kind: string, previousId: string, ordinal: number) => string;
  timestamp?: number;
}

/**
 * Give a generated proposal a new document-scoped identity graph before opening it as a tab.
 * Content-addressed assets/fonts/ICC profiles and Source Library references intentionally keep their
 * stable identities; editable document structures and every reference between them are remapped.
 */
export function freshenGeneratedPaperDocumentIdentity(
  source: PaperDocument,
  options: FreshenPaperDocumentIdentityOptions = {},
): PaperDocument {
  let ordinal = 0;
  const freshId = (kind: string, previousId: string): string => {
    ordinal += 1;
    return options.createId?.(kind, previousId, ordinal) ?? createFreshPaperGeneratedId(kind);
  };
  const buildMap = (kind: string, ids: readonly string[]): Map<string, string> => new Map(
    ids.map((id) => [id, freshId(kind, id)]),
  );
  const mapOptional = (mapping: ReadonlyMap<string, string>, value: string | undefined): string | undefined => (
    value === undefined ? undefined : mapping.get(value) ?? value
  );

  const layerIds = buildMap('layer', source.layers.map((layer) => layer.id));
  const parentPageIds = buildMap('parent-page', source.parentPages.map((page) => page.id));
  const pageIds = buildMap('page', source.pages.map((page) => page.id));
  const parentFrames = source.parentPages.flatMap((page) => page.frames);
  const pageFrames = source.pages.flatMap((page) => page.frames);
  const frameIds = buildMap('frame', [...parentFrames, ...pageFrames].map((frame) => frame.id));
  const paragraphStyleIds = buildMap('paragraph-style', source.styles.paragraph.map((style) => style.id));
  const characterStyleIds = buildMap('character-style', source.styles.character.map((style) => style.id));
  const objectStyleIds = buildMap('object-style', source.styles.object.map((style) => style.id));
  const swatchIds = buildMap('swatch', (source.swatches ?? []).map((swatch) => swatch.id));
  const threadIds = buildMap('thread', uniqueDefined([...parentFrames, ...pageFrames].map((frame) => frame.threadId)));
  const bubbleChainIds = buildMap('bubble-chain', uniqueDefined([...parentFrames, ...pageFrames].map((frame) => frame.bubbleChainId)));
  const timestamp = options.timestamp ?? Date.now();

  const remapRun = (run: PaperTextRun): PaperTextRun => ({
    ...run,
    ...(run.id ? { id: freshId('text-run', run.id) } : {}),
  });
  const remapParagraph = (paragraph: PaperRichParagraph): PaperRichParagraph => ({
    ...paragraph,
    ...(paragraph.id ? { id: freshId('paragraph', paragraph.id) } : {}),
    runs: paragraph.runs.map(remapRun),
  });
  const remapFrame = (frame: PaperFrame): PaperFrame => ({
    ...frame,
    id: frameIds.get(frame.id) ?? freshId('frame', frame.id),
    ...(frame.layerId ? { layerId: mapOptional(layerIds, frame.layerId) } : {}),
    ...(frame.threadId ? { threadId: mapOptional(threadIds, frame.threadId) } : {}),
    ...(frame.bubbleChainId ? { bubbleChainId: mapOptional(bubbleChainIds, frame.bubbleChainId) } : {}),
    ...(frame.paragraphStyleId ? { paragraphStyleId: mapOptional(paragraphStyleIds, frame.paragraphStyleId) } : {}),
    ...(frame.characterStyleId ? { characterStyleId: mapOptional(characterStyleIds, frame.characterStyleId) } : {}),
    ...(frame.objectStyleId ? { objectStyleId: mapOptional(objectStyleIds, frame.objectStyleId) } : {}),
    ...(frame.fillSwatchId ? { fillSwatchId: mapOptional(swatchIds, frame.fillSwatchId) } : {}),
    ...(frame.strokeSwatchId ? { strokeSwatchId: mapOptional(swatchIds, frame.strokeSwatchId) } : {}),
    typography: {
      ...frame.typography,
      ...(frame.typography.colorSwatchId
        ? { colorSwatchId: mapOptional(swatchIds, frame.typography.colorSwatchId) }
        : {}),
    },
    ...(frame.parentPageId ? { parentPageId: mapOptional(parentPageIds, frame.parentPageId) } : {}),
    ...(frame.parentFrameId ? { parentFrameId: mapOptional(frameIds, frame.parentFrameId) } : {}),
    ...(frame.richText ? { richText: frame.richText.map(remapParagraph) } : {}),
  });
  const remapGuide = (guide: PaperGuide): PaperGuide => ({
    ...guide,
    id: freshId('guide', guide.id),
  });

  return {
    ...source,
    id: freshId('document', source.id),
    layers: source.layers.map((layer) => ({ ...layer, id: layerIds.get(layer.id)! })),
    parentPages: source.parentPages.map((page) => ({
      ...page,
      id: parentPageIds.get(page.id)!,
      frames: page.frames.map(remapFrame),
      guides: page.guides.map(remapGuide),
    })),
    styles: {
      paragraph: source.styles.paragraph.map((style) => ({
        ...style,
        id: paragraphStyleIds.get(style.id)!,
        ...(style.basedOnId ? { basedOnId: mapOptional(paragraphStyleIds, style.basedOnId) } : {}),
        typography: {
          ...style.typography,
          ...(style.typography.colorSwatchId
            ? { colorSwatchId: mapOptional(swatchIds, style.typography.colorSwatchId) }
            : {}),
        },
      })),
      character: source.styles.character.map((style) => ({
        ...style,
        id: characterStyleIds.get(style.id)!,
        ...(style.basedOnId ? { basedOnId: mapOptional(characterStyleIds, style.basedOnId) } : {}),
        typography: {
          ...style.typography,
          ...(style.typography.colorSwatchId
            ? { colorSwatchId: mapOptional(swatchIds, style.typography.colorSwatchId) }
            : {}),
        },
      })),
      object: source.styles.object.map((style) => ({
        ...style,
        id: objectStyleIds.get(style.id)!,
        ...(style.basedOnId ? { basedOnId: mapOptional(objectStyleIds, style.basedOnId) } : {}),
      })),
    },
    ...(source.swatches ? {
      swatches: source.swatches.map((swatch) => ({ ...swatch, id: swatchIds.get(swatch.id)! })),
    } : {}),
    pages: source.pages.map((page) => ({
      ...page,
      id: pageIds.get(page.id)!,
      ...(page.parentPageId ? { parentPageId: mapOptional(parentPageIds, page.parentPageId) } : {}),
      frames: page.frames.map(remapFrame),
      guides: page.guides.map(remapGuide),
    })),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function uniqueDefined(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

function createFreshPaperGeneratedId(kind: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `paper-${kind}-${uuid}` : `paper-${kind}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
