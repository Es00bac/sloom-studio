import { describe, expect, it } from 'vitest';
import type { AppNode } from '../types/flow';
import { BUNDLED_PROVIDER_PACKS } from './bundledProviderPacks';
import {
  BUNDLED_CARD_HEIGHT_BUDGET,
  CARD_WIDTH_MAX,
  CARD_WIDTH_MIN,
  PROVIDER_PACK_LIMITS,
  type ProviderPackV1,
} from './providerPackContracts';
import {
  autoArrangeCard,
  alignCardElements,
  buildCardFitReport,
  CardLayoutHistory,
  moveCardElement,
  distributeCardElements,
  resizeCardElement,
  setContainerColumns,
  snapCardElement,
} from './providerCardLayout';
import {
  listModelCardLayoutHandles,
  resolveAllCardHandlePlacements,
  setCardHandlePlacement,
  setCardHandlePlacements,
} from './providerCardHandles';
import {
  createEmbeddedProviderSnapshot,
  createLayoutOverride,
  generateProviderPackCommunityPost,
  hashProviderPack,
  resolveCardLayout,
  serializeProviderPack,
  stripCredentialMaterial,
} from './providerPackPortability';
import {
  attachProjectSnapshotsToModelCardNodes,
  collectProjectProviderPackSnapshots,
  sanitizeEmbeddedProviderPackSnapshots,
} from './providerPackProject';
import {
  ProviderPackImportError,
  parseProviderPackText,
  validateProviderPack,
} from './providerPackValidation';
import { sanitizeProjectDocument } from './projectValidation';

describe('portable provider-pack foundation', () => {
  it('expresses every shipped provider through the same valid bounded V1 schema', () => {
    const expected = [
      'android',
      'atlas',
      'bfl',
      'byteplus',
      'elevenlabs',
      'gemini',
      'huggingface',
      'localOpen',
      'openai',
      'stability',
    ];
    const actual = BUNDLED_PROVIDER_PACKS.map((pack) => pack.packId.replace('sloom.bundled.', '')).sort();
    expect(actual).toEqual(expected);

    const failures = BUNDLED_PROVIDER_PACKS.flatMap((pack) => {
      const result = validateProviderPack(pack, { provenance: 'bundled' });
      return result.activatable ? [] : [{ pack: pack.packId, issues: result.issues }];
    });
    expect(failures).toEqual([]);
  });

  it('keeps every bundled operation within the 900px logical default budget', () => {
    const failures = BUNDLED_PROVIDER_PACKS.flatMap((pack) => pack.cards.flatMap((card) =>
      card.operations.flatMap((operation) => {
        const report = buildCardFitReport(card, operation);
        return report.estimatedHeight <= BUNDLED_CARD_HEIGHT_BUDGET || card.layout.approvedHeightException
          ? []
          : [{ pack: pack.packId, card: card.id, operation: operation.id, height: report.estimatedHeight }];
      })
    ));
    expect(failures).toEqual([]);
  });

  it('preserves exact Atlas reference maxima, including 14-image galleries', () => {
    const atlas = BUNDLED_PROVIDER_PACKS.find((pack) => pack.packId === 'sloom.bundled.atlas');
    const referenceFields = atlas?.cards.flatMap((card) => card.fields.filter((field) =>
      field.semanticRole === 'reference-image' && field.constraints?.maxItems === 14
    )) ?? [];
    expect(referenceFields.length).toBeGreaterThan(0);
    expect(referenceFields.every((field) => field.constraints?.visiblePortCount === 14)).toBe(true);
  });

  it('keeps API-array prompt payloads as one connectable creative prompt port', () => {
    const gemini = BUNDLED_PROVIDER_PACKS.find((pack) => pack.packId === 'sloom.bundled.gemini')!;
    const card = gemini.cards.find((candidate) => candidate.modelId === 'gemini-3.1-flash-image')!;
    const prompt = card.fields.find((field) => field.semanticRole === 'prompt')!;
    const operation = card.operations.find((candidate) => candidate.id === 'text-to-image')!;
    expect(prompt.cardinality).toBe('one');
    expect(prompt.valueType).toBe('string');
    expect(listModelCardLayoutHandles(card, operation).filter((handle) => handle.fieldId === prompt.id))
      .toHaveLength(1);
  });

  it('strips credentials, emits the portable extension, hash, and complete community post', () => {
    const source = structuredClone(BUNDLED_PROVIDER_PACKS[0]) as ProviderPackV1 & {
      credentialValue?: string;
    };
    source.credentialValue = 'do-not-export';
    const serialized = serializeProviderPack(source);
    expect(serialized.fileName).toMatch(/\.sloom-provider\.json$/);
    expect(serialized.json).not.toContain('do-not-export');
    expect(serialized.hash).toMatch(/^[a-f0-9]{64}$/);

    const post = generateProviderPackCommunityPost({
      pack: source,
      sloomVersion: '0.9.12-t',
      testedAt: '2026-07-29',
      screenshots: ['https://example.test/card.png'],
    });
    expect(post).toContain('SHA-256');
    expect(post).toContain('Disclosed endpoints');
    expect(post).toContain('Safety and data handling');
    expect(post).not.toContain('do-not-export');
  });

  it('rejects hostile executable fields, credential destinations, and hard bounds', () => {
    const base = structuredClone(BUNDLED_PROVIDER_PACKS[0]);
    expect(() => parseProviderPackText(JSON.stringify({ ...base, script: 'alert(1)' })))
      .toThrow(ProviderPackImportError);
    expect(() => parseProviderPackText(JSON.stringify({
      ...base,
      provider: { ...base.provider, homepageUrl: 'javascript:alert(1)' },
    }))).toThrow(ProviderPackImportError);

    const tooManyCards = {
      ...base,
      cards: Array.from({ length: PROVIDER_PACK_LIMITS.cards + 1 }, () => base.cards[0]),
    };
    expect(() => parseProviderPackText(JSON.stringify(tooManyCards))).toThrow(ProviderPackImportError);

    const unsafeOrigin = structuredClone(base);
    unsafeOrigin.approvedOrigins = [{ origin: 'https://user:secret@example.test' }];
    expect(validateProviderPack(unsafeOrigin).activatable).toBe(false);
  });

  it('keeps presentation overrides isolated from execution bindings and obeys precedence', () => {
    const card = BUNDLED_PROVIDER_PACKS[0].cards[0];
    const edited = { ...card.layout, width: 650 };
    const override = createLayoutOverride(card.id, card.layout, edited);
    expect(Object.keys(override).sort()).toEqual([
      'cardId',
      'containers',
      'elements',
      'schemaVersion',
      'width',
    ]);
    expect(JSON.stringify(override)).not.toMatch(/endpoint|credential|apiPath|transport/);

    const personal = {
      schemaVersion: 1 as const,
      packId: 'pack',
      cardId: card.id,
      packHash: 'hash',
      override: { ...override, width: 520 },
      updatedAt: 1,
    };
    expect(resolveCardLayout({ card, personal }).layout.width).toBe(520);
    expect(resolveCardLayout({ card, personal, nodeOverride: { ...override, width: 780 } }).layout.width).toBe(780);
    expect(resolveCardLayout({ card }).source).toBe('pack');
  });

  it('embeds only referenced credential-free cards while preserving and verifying the source hash', () => {
    const pack = BUNDLED_PROVIDER_PACKS.find((candidate) => candidate.cards.length > 1) ?? BUNDLED_PROVIDER_PACKS[0];
    const sourceHash = hashProviderPack(pack);
    const snapshot = createEmbeddedProviderSnapshot(pack, [pack.cards[0].id], sourceHash);
    expect(snapshot.hash).toBe(sourceHash);
    expect(snapshot.contentHash).toBe(hashProviderPack(snapshot.pack));
    expect(snapshot.pack.cards).toHaveLength(1);
    expect(JSON.stringify(snapshot)).not.toMatch(/credentialValue|api[_-]?key|authorization/i);

    const restored = sanitizeEmbeddedProviderPackSnapshots([snapshot]);
    expect(restored).toHaveLength(1);
    const node = {
      id: 'model-card',
      type: 'imageGen',
      position: { x: 0, y: 0 },
      data: {
        modelCardRef: {
          packId: pack.packId,
          version: pack.version,
          hash: sourceHash,
          cardId: pack.cards[0].id,
        },
      },
    } as AppNode;
    expect(attachProjectSnapshotsToModelCardNodes([node], restored)[0].data.embeddedProviderPackSnapshots)
      .toHaveLength(1);

    const tampered = structuredClone(snapshot);
    tampered.pack.displayName = 'Tampered';
    expect(sanitizeEmbeddedProviderPackSnapshots([tampered])).toBeUndefined();
  });

  it('round-trips project-embedded snapshots and strips node-local credential-shaped values', () => {
    const pack = BUNDLED_PROVIDER_PACKS[0];
    const sourceHash = hashProviderPack(pack);
    const node = {
      id: 'portable-card',
      type: 'textNode',
      position: { x: 0, y: 0 },
      data: {
        modelCardRef: {
          packId: pack.packId,
          version: pack.version,
          hash: sourceHash,
          cardId: pack.cards[0].id,
        },
        modelCardOperationId: pack.cards[0].operations[0].id,
        modelCardValues: {
          prompt: 'safe creative text',
          api_key: 'must-not-survive',
        },
        modelCardLayoutOverride: {
          schemaVersion: 1,
          cardId: pack.cards[0].id,
          width: 520,
          endpointPath: 'https://attacker.example',
          handlePlacements: [{
            portId: 'model-card:prompt',
            anchor: 'element',
            elementId: pack.cards[0].layout.elements[0].id,
            side: 'bottom',
            offsetPercent: 67,
          }],
        },
      },
    } as AppNode;
    const snapshots = collectProjectProviderPackSnapshots({ nodes: [node] });
    const restored = sanitizeProjectDocument({
      id: 'project',
      name: 'Portable',
      savedAt: 1,
      flow: { version: 3, nodes: [node], edges: [] },
      providerPacks: snapshots,
    });
    expect(restored.providerPacks).toHaveLength(1);
    expect(restored.flow.nodes[0].data.embeddedProviderPackSnapshots).toHaveLength(1);
    expect(restored.flow.nodes[0].data.modelCardValues).toEqual({
      prompt: 'safe creative text',
      api_key: '__SLOOM_API_REQUESTER_CREDENTIAL_REDACTED__',
    });
    expect(restored.flow.nodes[0].data.modelCardLayoutOverride).not.toHaveProperty('endpointPath');
    expect(restored.flow.nodes[0].data.modelCardLayoutOverride).toMatchObject({
      handlePlacements: [{
        portId: 'model-card:prompt',
        anchor: 'element',
        side: 'bottom',
        offsetPercent: 67,
      }],
    });
  });
});

describe('model-card layout engine', () => {
  const card = BUNDLED_PROVIDER_PACKS
    .flatMap((pack) => pack.cards)
    .find((candidate) => candidate.fields.some((field) => field.semanticRole === 'reference-image'))
    ?? BUNDLED_PROVIDER_PACKS[0].cards[0];

  it('supports continuous 260–1040 widths and 1–4 operation-specific columns', () => {
    expect(card.layout.minWidth).toBe(CARD_WIDTH_MIN);
    expect(card.layout.maxWidth).toBe(CARD_WIDTH_MAX);
    const container = card.layout.containers[0];
    const operation = card.operations[0];
    for (const columns of [1, 2, 3, 4] as const) {
      const layout = setContainerColumns(card.layout, container.id, columns, operation.id);
      expect(layout.containers[0].operationColumns?.[operation.id]).toBe(columns);
    }
  });

  it('supports snapping, free movement, minimum resize targets, undo, and redo', () => {
    const layout = structuredClone(card.layout);
    const first = layout.elements[0];
    const second = layout.elements[1] ?? { ...first, id: `${first.id}:second` };
    layout.elements = [
      { ...first, x: 5, y: 7, width: 50, height: 50 },
      { ...second, x: 100, y: 120, width: 50, height: 50, containerId: first.containerId },
    ];
    const snap = snapCardElement(layout, first.id, { x: 96, y: 116 });
    expect(snap).toMatchObject({ x: 100, y: 120 });
    expect(snap.guides).toHaveLength(2);

    const moved = moveCardElement(layout, first.id, { x: 100, y: 120 }).layout;
    const resized = resizeCardElement(moved, first.id, { width: 2, height: 4 });
    expect(resized.elements[0]).toMatchObject({ width: 32, height: 32 });

    const history = new CardLayoutHistory(layout);
    history.commit(resized);
    expect(history.canUndo).toBe(true);
    expect(history.undo()).toEqual(layout);
    expect(history.redo()).toEqual(resized);

    const third = { ...layout.elements[0], id: 'third', x: 250, y: 240 };
    const multi = { ...layout, elements: [...layout.elements, third] };
    const aligned = alignCardElements(multi, multi.elements.map((element) => element.id), 'y', 'start');
    expect(new Set(aligned.elements.map((element) => element.y))).toEqual(new Set([7]));
    const distributed = distributeCardElements(multi, multi.elements.map((element) => element.id), 'x');
    expect(distributed.elements[1].x).toBeCloseTo(127.5);
  });

  it('auto-arranges to the narrowest fitting candidate without exceeding width bounds', () => {
    const layout = autoArrangeCard(card, { operationId: card.operations[0].id, fitTarget: '1080p' });
    expect(layout.width).toBeGreaterThanOrEqual(CARD_WIDTH_MIN);
    expect(layout.width).toBeLessThanOrEqual(CARD_WIDTH_MAX);
    expect(buildCardFitReport({ ...card, layout }, card.operations[0]).fits).toBe(true);
  });

  it('makes the exact 14-reference card wider and materially shorter at three or four columns', () => {
    const referenceCard = BUNDLED_PROVIDER_PACKS
      .flatMap((pack) => pack.cards)
      .find((candidate) => candidate.fields.some((field) =>
        field.semanticRole === 'reference-image' && field.constraints?.maxItems === 14
      ))!;
    const referenceField = referenceCard.fields.find((field) =>
      field.semanticRole === 'reference-image' && field.constraints?.maxItems === 14
    )!;
    const referenceElement = referenceCard.layout.elements.find((element) => element.fieldId === referenceField.id)!;
    const operation = referenceCard.operations.find((candidate) => candidate.inputPortFieldIds.includes(referenceField.id))!;
    const twoColumns = setContainerColumns(
      { ...referenceCard.layout, width: 520 },
      referenceElement.containerId,
      2,
      operation.id,
    );
    const threeColumns = setContainerColumns(
      { ...referenceCard.layout, width: 780 },
      referenceElement.containerId,
      3,
      operation.id,
    );
    const fourColumns = setContainerColumns(
      { ...referenceCard.layout, width: 1_040 },
      referenceElement.containerId,
      4,
      operation.id,
    );
    const twoHeight = buildCardFitReport({ ...referenceCard, layout: twoColumns }, operation).estimatedHeight;
    const threeHeight = buildCardFitReport({ ...referenceCard, layout: threeColumns }, operation).estimatedHeight;
    const fourHeight = buildCardFitReport({ ...referenceCard, layout: fourColumns }, operation).estimatedHeight;
    expect(threeHeight).toBeLessThan(twoHeight);
    expect(fourHeight).toBeLessThan(threeHeight);
    expect(fourColumns.width).toBe(1_040);
  });

  it('stores independently editable control and main-card handle placement as presentation only', () => {
    const referenceCard = BUNDLED_PROVIDER_PACKS
      .flatMap((pack) => pack.cards)
      .find((candidate) => candidate.fields.some((field) =>
        field.semanticRole === 'reference-image' && field.constraints?.maxItems === 14
      ))!;
    const referenceField = referenceCard.fields.find((field) =>
      field.semanticRole === 'reference-image' && field.constraints?.maxItems === 14
    )!;
    const operation = referenceCard.operations.find((candidate) =>
      candidate.inputPortFieldIds.includes(referenceField.id)
    )!;
    const handles = listModelCardLayoutHandles(referenceCard, operation);
    const referenceHandles = handles.filter((handle) => handle.index !== undefined);
    expect(referenceHandles).toHaveLength(14);

    let edited = setCardHandlePlacements(referenceCard.layout, referenceHandles, {
      anchor: 'element',
      elementId: referenceHandles[0].elementId,
      side: 'bottom',
    });
    const resolved = resolveAllCardHandlePlacements(edited, handles);
    const output = resolved.find(({ handle }) => handle.direction === 'output')!;
    edited = setCardHandlePlacement(edited, output.handle.portId, {
      anchor: 'card',
      side: 'top',
      offsetPercent: 72,
    }, output.placement);
    const override = createLayoutOverride(referenceCard.id, referenceCard.layout, edited);
    expect(override.handlePlacements).toHaveLength(15);
    expect(JSON.stringify(override)).not.toMatch(/endpoint|credential|apiPath|transport/);
    expect(resolveCardLayout({ card: referenceCard, nodeOverride: override }).layout.handlePlacements)
      .toEqual(edited.handlePlacements);
  });

  it('does not mutate source packs while stripping credential material', () => {
    const pack = structuredClone(BUNDLED_PROVIDER_PACKS[0]);
    const before = JSON.stringify(pack);
    stripCredentialMaterial(pack);
    expect(JSON.stringify(pack)).toBe(before);
  });
});
