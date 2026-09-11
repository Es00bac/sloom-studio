import type {
  CardHandlePlacementV1,
  CardLayoutV1,
  FlowModelCardV1,
  ModelCardOperationV1,
} from './providerPackContracts';
import {
  modelCardInputHandle,
  modelCardOutputHandle,
} from './providerPackExecution';

export interface ModelCardLayoutHandle {
  portId: string;
  label: string;
  direction: 'input' | 'output';
  elementId?: string;
  fieldId?: string;
  outputId?: string;
  index?: number;
}

export function listModelCardLayoutHandles(
  card: FlowModelCardV1,
  operationOrId: ModelCardOperationV1 | string,
): ModelCardLayoutHandle[] {
  const operation = typeof operationOrId === 'string'
    ? card.operations.find((candidate) => candidate.id === operationOrId)
    : operationOrId;
  if (!operation) return [];
  const handles: ModelCardLayoutHandle[] = [];
  for (const fieldId of operation.inputPortFieldIds) {
    const field = card.fields.find((candidate) => candidate.id === fieldId);
    if (!field) continue;
    const elementId = card.layout.elements.find((element) => element.fieldId === field.id)?.id;
    const count = field.cardinality === 'many'
      ? field.constraints?.maxItems ?? field.constraints?.visiblePortCount ?? 0
      : 1;
    for (let index = 0; index < count; index += 1) {
      handles.push({
        portId: modelCardInputHandle(field.id, field.cardinality === 'many' ? index : undefined),
        label: field.cardinality === 'many' ? `${field.label} ${index + 1}` : field.label,
        direction: 'input',
        elementId,
        fieldId: field.id,
        ...(field.cardinality === 'many' ? { index } : {}),
      });
    }
  }
  for (const outputId of operation.outputIds) {
    const output = card.outputs.find((candidate) => candidate.id === outputId);
    if (!output) continue;
    handles.push({
      portId: modelCardOutputHandle(output.id),
      label: output.label,
      direction: 'output',
      elementId: card.layout.elements.find((element) => element.outputId === output.id)?.id,
      outputId: output.id,
    });
  }
  return handles;
}

export function resolveCardHandlePlacement(
  layout: CardLayoutV1,
  handle: ModelCardLayoutHandle,
  directionIndex: number,
  directionCount: number,
): CardHandlePlacementV1 {
  const saved = layout.handlePlacements?.find((placement) => placement.portId === handle.portId);
  if (saved) return saved;
  return {
    portId: handle.portId,
    anchor: 'card',
    side: handle.direction === 'input' ? 'left' : 'right',
    offsetPercent: defaultHandleOffset(directionIndex, directionCount),
  };
}

export function resolveAllCardHandlePlacements(
  layout: CardLayoutV1,
  handles: readonly ModelCardLayoutHandle[],
): Array<{ handle: ModelCardLayoutHandle; placement: CardHandlePlacementV1 }> {
  return handles.map((handle) => {
    const sameDirection = handles.filter((candidate) => candidate.direction === handle.direction);
    return {
      handle,
      placement: resolveCardHandlePlacement(
        layout,
        handle,
        sameDirection.findIndex((candidate) => candidate.portId === handle.portId),
        sameDirection.length,
      ),
    };
  });
}

export function setCardHandlePlacement(
  layout: CardLayoutV1,
  portId: string,
  patch: Partial<Omit<CardHandlePlacementV1, 'portId'>>,
  fallback: CardHandlePlacementV1,
): CardLayoutV1 {
  const existing = layout.handlePlacements?.find((placement) => placement.portId === portId) ?? fallback;
  const next: CardHandlePlacementV1 = {
    ...existing,
    ...patch,
    portId,
    offsetPercent: clamp(patch.offsetPercent ?? existing.offsetPercent, 0, 100),
  };
  if (next.anchor === 'card') delete next.elementId;
  return {
    ...layout,
    handlePlacements: [
      ...(layout.handlePlacements ?? []).filter((placement) => placement.portId !== portId),
      next,
    ],
  };
}

export function setCardHandlePlacements(
  layout: CardLayoutV1,
  handles: readonly ModelCardLayoutHandle[],
  patch: Partial<Omit<CardHandlePlacementV1, 'portId'>>,
): CardLayoutV1 {
  return handles.reduce((current, handle, index) => {
    const sameDirection = handles.filter((candidate) => candidate.direction === handle.direction);
    const fallback = resolveCardHandlePlacement(
      current,
      handle,
      sameDirection.findIndex((candidate) => candidate.portId === handle.portId),
      sameDirection.length,
    );
    return setCardHandlePlacement(current, handle.portId, {
      ...patch,
      offsetPercent: patch.offsetPercent ?? defaultHandleOffset(index, handles.length),
    }, fallback);
  }, layout);
}

export function defaultHandleOffset(index: number, count: number): number {
  if (count <= 0) return 50;
  return Math.round(Math.max(5, Math.min(95, ((index + 1) / (count + 1)) * 100)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
