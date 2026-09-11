import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BUNDLED_PROVIDER_PACKS } from '../../lib/bundledProviderPacks';
import { setContainerColumns } from '../../lib/providerCardLayout';
import {
  BuilderCanvas,
  ProviderPackLibrarySection,
  reorderCardElement,
} from './ProviderPackLibrarySection';

describe('WYSIWYG model-card builder', () => {
  const pack = BUNDLED_PROVIDER_PACKS.find((candidate) => candidate.packId === 'sloom.bundled.gemini')!;
  const sourceCard = pack.cards.find((candidate) => candidate.modelId === 'gemini-3.1-flash-image')!;
  const referenceField = sourceCard.fields.find((field) =>
    field.semanticRole === 'reference-image' && field.constraints?.maxItems === 14
  )!;
  const referenceElement = sourceCard.layout.elements.find((element) => element.fieldId === referenceField.id)!;
  const operation = sourceCard.operations.find((candidate) =>
    candidate.inputPortFieldIds.includes(referenceField.id)
  )!;

  it('renders the actual interactive card controls, exact gallery, and all editable handles', () => {
    const card = {
      ...sourceCard,
      layout: setContainerColumns(
        { ...sourceCard.layout, width: 1_040 },
        referenceElement.containerId,
        4,
        operation.id,
      ),
    };
    const html = renderToStaticMarkup(
      <BuilderCanvas
        card={card}
        onCommitLayout={() => undefined}
        onOperationChange={() => undefined}
        onSelect={() => undefined}
        onSelectHandle={() => undefined}
        operationId={operation.id}
        packId={pack.packId}
        providerName={pack.provider.name}
      />,
    );

    expect(html).toContain('data-model-card-builder-wysiwyg="true"');
    expect(html).toContain('data-flow-model-card-preview="production"');
    expect(html).toContain('data-production-image-model-card="true"');
    expect(html).toContain('data-image-reference-gallery="true"');
    expect(html).toContain('data-image-reference-slot="Reference 14"');
    expect(html).toContain('Production Flow renderer');
    expect(html).toContain('data-production-model-card-operation-switcher="true"');
    expect(html).toContain('>Text To Image</button>');
    expect(html).toContain('>Image Edit</button>');
    expect(html).toContain('Gemini 3.1 Flash Image');
    expect(html).not.toContain('Default for new image nodes');
    expect(html).not.toContain('Source Image');
    expect(html).not.toContain('Mask Image');
    expect(html).toContain('Image output');
    expect(html).toContain(`data-wysiwyg-handle="model-card:${referenceField.id}:13"`);
    expect(html).toContain('grid-template-columns:repeat(4, minmax(0, 1fr))');
    expect(html).toContain('width:1040px');
    expect(html).not.toContain('Builder preview');
    expect(html).not.toContain('data-wysiwyg-field-control=');
  });

  it('allows a fourteen-column reference gallery and continuous corner handle placement', () => {
    const fourteenColumns = setContainerColumns(
      { ...sourceCard.layout, width: 1_040 },
      referenceElement.containerId,
      14,
      operation.id,
    );
    const card = {
      ...sourceCard,
      layout: {
        ...fourteenColumns,
        handlePlacements: [{
          portId: `model-card:${referenceField.id}:13`,
          anchor: 'element' as const,
          elementId: referenceElement.id,
          side: 'top' as const,
          offsetPercent: 100,
        }],
      },
    };
    const html = renderToStaticMarkup(
      <BuilderCanvas
        card={card}
        onCommitLayout={() => undefined}
        onOperationChange={() => undefined}
        onSelect={() => undefined}
        onSelectHandle={() => undefined}
        operationId={operation.id}
        packId={pack.packId}
        providerName={pack.provider.name}
      />,
    );
    expect(html).toContain('grid-template-columns:repeat(14, minmax(0, 1fr))');
    expect(html).toContain('data-reference-side="top"');
    expect(html).toContain('left:100%');
  });

  it('reorders real controls between layout groups without changing field bindings', () => {
    const movable = sourceCard.layout.elements.find((element) => element.fieldId)!;
    const target = sourceCard.layout.elements.find((element) =>
      element.id !== movable.id && element.fieldId
    )!;
    const moved = reorderCardElement(
      sourceCard.layout,
      movable.id,
      target.containerId,
      target.id,
    );
    const movedElement = moved.elements.find((element) => element.id === movable.id)!;
    expect(movedElement.containerId).toBe(target.containerId);
    expect(movedElement.order).toBeLessThan(
      moved.elements.find((element) => element.id === target.id)!.order
    );
    expect(movedElement.fieldId).toBe(movable.fieldId);
  });

  it('moves the production output ahead of the input controls when the author puts it at the top', () => {
    const output = sourceCard.layout.elements.find((element) => element.outputId)!;
    const firstInput = sourceCard.layout.elements
      .filter((element) => element.fieldId)
      .sort((left, right) => left.order - right.order)[0]!;
    const moved = reorderCardElement(
      sourceCard.layout,
      output.id,
      firstInput.containerId,
      firstInput.id,
    );
    const movedOutput = moved.elements.find((element) => element.id === output.id)!;
    const unchangedInput = moved.elements.find((element) => element.id === firstInput.id)!;
    expect(movedOutput.containerId).toBe(firstInput.containerId);
    expect(movedOutput.order).toBeLessThan(unchangedInput.order);
    expect(movedOutput.outputId).toBe(output.outputId);
  });
});

describe('provider-pack extension surface', () => {
  it('shows the bounded declarative extension report beside installed packs', () => {
    const html = renderToStaticMarkup(<ProviderPackLibrarySection />);
    expect(html).toContain('data-provider-pack-extension-report="true"');
    expect(html).toContain('Declarative extension');
    expect(html).toContain('local-slots-only');
    expect(html).toContain('no arbitrary code');
    expect(html).toContain('release policy not-configured');
  });

  it('renders fresh bundled packs with missing required credentials as review, not ready', () => {
    const html = renderToStaticMarkup(<ProviderPackLibrarySection />);
    const requiredCredentialPackCount = BUNDLED_PROVIDER_PACKS.filter((pack) =>
      pack.credentialSlots.some((slot) => slot.required)
    ).length;
    const reviewCount = (html.match(/data-provider-pack-extension-readiness="review"/g) ?? []).length;

    expect(reviewCount).toBeGreaterThanOrEqual(requiredCredentialPackCount);
    expect(html).toContain('required local credentials are missing');
  });
});
