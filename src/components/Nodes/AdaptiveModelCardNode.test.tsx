import { ReactFlowProvider } from '@xyflow/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import type { AppNode } from '../../types/flow';
import { BUNDLED_PROVIDER_PACKS } from '../../lib/bundledProviderPacks';
import { hashProviderPack } from '../../lib/providerPackPortability';
import { useFlowStore } from '../../store/flowStore';
import { AdaptiveModelCardNode, withAdaptiveModelCard } from './AdaptiveModelCardNode';
import { ImageNode } from './ImageNode';

describe('AdaptiveModelCardNode', () => {
  beforeEach(() => {
    useFlowStore.setState({ nodes: [], edges: [] });
  });

  it('renders exact card-driven reference galleries and dynamic handles', () => {
    const pack = BUNDLED_PROVIDER_PACKS.find((candidate) => candidate.packId === 'sloom.bundled.atlas')!;
    const card = pack.cards.find((candidate) => candidate.fields.some((field) =>
      field.semanticRole === 'reference-image' && field.constraints?.maxItems === 14
    ))!;
    const field = card.fields.find((candidate) => candidate.semanticRole === 'reference-image')!;
    const operation = card.operations.find((candidate) => candidate.inputPortFieldIds.includes(field.id))!;
    const data = {
      modelCardRef: {
        packId: pack.packId,
        version: pack.version,
        hash: hashProviderPack(pack),
        cardId: card.id,
      },
      modelCardOperationId: operation.id,
      modelCardValues: {},
      modelCardLayoutOverride: {
        schemaVersion: 1 as const,
        cardId: card.id,
        handlePlacements: [{
          portId: `model-card:${field.id}:13`,
          anchor: 'element' as const,
          elementId: card.layout.elements.find((element) => element.fieldId === field.id)!.id,
          side: 'bottom' as const,
          offsetPercent: 72,
        }],
      },
    };
    const node = {
      id: 'adaptive',
      type: 'imageGen',
      position: { x: 0, y: 0 },
      data,
    } as AppNode;
    useFlowStore.setState({ nodes: [node], edges: [] });

    const html = renderToStaticMarkup(
      <ReactFlowProvider>
        <AdaptiveModelCardNode
          data={data}
          deletable
          dragging={false}
          draggable
          id="adaptive"
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          selectable
          selected
          type="imageGen"
          zIndex={0}
        />
      </ReactFlowProvider>,
    );

    expect(html).toContain(`width:${card.layout.width}px`);
    expect(html).toContain(`model-card:${field.id}:13`);
    expect(html).toContain(`${field.label} 14`);
    expect(html).toContain('left:72%;bottom:-8px');
    expect(html).toContain('Resize model card');
    expect(html).toContain('Untested');
  });

  it('renders an embedded card safely but keeps execution disabled on a new device', () => {
    const sourcePack = BUNDLED_PROVIDER_PACKS[0];
    const pack = {
      ...structuredClone(sourcePack),
      packId: 'missing.community.pack',
      displayName: 'Embedded community pack',
    };
    const sourceHash = hashProviderPack(pack);
    const card = pack.cards[0];
    const data = {
      modelCardRef: {
        packId: pack.packId,
        version: pack.version,
        hash: sourceHash,
        cardId: card.id,
      },
      modelCardOperationId: card.operations[0].id,
      onRun: () => undefined,
      embeddedProviderPackSnapshots: [{
        schemaVersion: 1 as const,
        pack,
        hash: sourceHash,
        contentHash: hashProviderPack(pack),
        referencedCardIds: [card.id],
      }],
    };
    const node = {
      id: 'embedded',
      type: 'textNode',
      position: { x: 0, y: 0 },
      data,
    } as AppNode;
    useFlowStore.setState({ nodes: [node], edges: [] });

    const html = renderToStaticMarkup(
      <ReactFlowProvider>
        <AdaptiveModelCardNode
          data={data}
          deletable
          dragging={false}
          draggable
          id="embedded"
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          selectable
          selected={false}
          type="textNode"
          zIndex={0}
        />
      </ReactFlowProvider>,
    );
    expect(html).toContain(card.displayName);
    expect(html).toContain('Project-embedded packs render safely');
  });

  it('uses the production ImageNode renderer for activated image model cards', () => {
    const pack = BUNDLED_PROVIDER_PACKS.find((candidate) => candidate.packId === 'sloom.bundled.gemini')!;
    const card = pack.cards.find((candidate) => candidate.modelId === 'gemini-3.1-flash-image')!;
    const operation = card.operations[0];
    const data = {
      mediaMode: 'generate' as const,
      modelCardRef: {
        packId: pack.packId,
        version: pack.version,
        hash: hashProviderPack(pack),
        cardId: card.id,
      },
      modelCardOperationId: operation.id,
      modelCardValues: {},
      modelId: card.modelId,
      provider: 'gemini' as const,
    };
    const node = {
      id: 'production-adaptive-image',
      type: 'imageGen',
      position: { x: 0, y: 0 },
      data,
    } as AppNode;
    useFlowStore.setState({ nodes: [node], edges: [] });
    const ProductionAdaptiveImage = withAdaptiveModelCard(ImageNode, { productionRenderer: true });
    const html = renderToStaticMarkup(
      <ReactFlowProvider>
        <ProductionAdaptiveImage
          data={data}
          deletable
          dragging={false}
          draggable
          id={node.id}
          isConnectable
          positionAbsoluteX={0}
          positionAbsoluteY={0}
          selectable
          selected={false}
          type="imageGen"
          zIndex={0}
        />
      </ReactFlowProvider>,
    );
    expect(html).toContain('data-production-image-model-card="true"');
    expect(html).toContain('data-production-model-card-operation-switcher="true"');
    expect(html).toContain('Gemini 3.1 Flash Image');
    expect(html).toContain('data-image-reference-slot="Reference 14"');
    expect(html).toContain('data-handleid="model-card:referenceImages:13"');
    expect(html).not.toContain('Untested');
  });
});
