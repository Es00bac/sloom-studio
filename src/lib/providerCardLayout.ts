import {
  BUNDLED_CARD_HEIGHT_BUDGET,
  CARD_WIDTH_MAX,
  CARD_WIDTH_MIN,
  CARD_WIDTH_PRESETS,
  type CardColumnCountV1,
  type CardContainerKindV1,
  type CardFitTargetV1,
  type CardLayoutContainerV1,
  type CardLayoutElementV1,
  type CardLayoutV1,
  type FlowModelCardV1,
  type ModelCardOperationV1,
  type ModelFieldV1,
} from './providerPackContracts';
import { estimateLayoutHeight } from './providerPackValidation';

export interface CardFitReport {
  operationId: string;
  estimatedHeight: number;
  budget: number;
  fits: boolean;
  excessHeight: number;
  causes: Array<{
    containerId: string;
    label: string;
    estimatedHeight: number;
    suggestion?: string;
    predictedHeight?: number;
  }>;
}

export interface AlignmentGuide {
  axis: 'x' | 'y';
  position: number;
  sourceElementId: string;
  targetElementId: string;
}

export interface SnapResult {
  x: number;
  y: number;
  guides: AlignmentGuide[];
}

export class CardLayoutHistory {
  private readonly past: CardLayoutV1[] = [];
  private readonly future: CardLayoutV1[] = [];
  private current: CardLayoutV1;

  constructor(initial: CardLayoutV1) {
    this.current = clone(initial);
  }

  get value(): CardLayoutV1 {
    return clone(this.current);
  }

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  commit(next: CardLayoutV1): CardLayoutV1 {
    if (same(this.current, next)) return this.value;
    this.past.push(clone(this.current));
    if (this.past.length > 100) this.past.shift();
    this.current = clone(next);
    this.future.length = 0;
    return this.value;
  }

  undo(): CardLayoutV1 {
    const previous = this.past.pop();
    if (!previous) return this.value;
    this.future.push(clone(this.current));
    this.current = previous;
    return this.value;
  }

  redo(): CardLayoutV1 {
    const next = this.future.pop();
    if (!next) return this.value;
    this.past.push(clone(this.current));
    this.current = next;
    return this.value;
  }
}

export function generateAutomaticCardLayout(
  card: Pick<FlowModelCardV1, 'id' | 'fields' | 'outputs' | 'operations'>,
  options: {
    width?: number;
    fitTarget?: CardFitTargetV1;
    heightBudget?: number;
    galleryColumns?: CardColumnCountV1;
  } = {},
): CardLayoutV1 {
  const width = clamp(options.width ?? CARD_WIDTH_PRESETS.standard, CARD_WIDTH_MIN, CARD_WIDTH_MAX);
  const fitTarget = options.fitTarget ?? '1080p';
  const operationIds = card.operations.map((operation) => operation.id);
  const primary = card.fields.filter((field) =>
    ['prompt', 'system-instruction', 'script'].includes(field.semanticRole)
  );
  const pinned = card.fields.filter((field) =>
    ['source-image', 'mask', 'source-video', 'source-audio', 'start-frame', 'end-frame', 'control-image'].includes(field.semanticRole)
  );
  const gallery = card.fields.filter((field) =>
    field.semanticRole === 'reference-image' || field.semanticRole === 'reference-video'
  );
  const inline = card.fields.filter((field) =>
    ['width', 'height', 'duration', 'frame-rate', 'resolution', 'format'].includes(field.semanticRole)
  );
  const advanced = card.fields.filter((field) => field.advanced || field.semanticRole === 'advanced');
  const ordinary = card.fields.filter((field) =>
    !primary.includes(field)
    && !pinned.includes(field)
    && !gallery.includes(field)
    && !inline.includes(field)
    && !advanced.includes(field)
  );
  const containers: CardLayoutContainerV1[] = [];
  const elements: CardLayoutElementV1[] = [];
  let order = 0;

  addContainer('primary', 'grid', 'Prompt & direction', primary, Math.min(2, columnsForWidth(width)));
  addContainer('media', 'pinned-media', 'Source media', pinned, Math.min(2, columnsForWidth(width)));
  addContainer(
    'references',
    'reference-gallery',
    'References',
    gallery,
    options.galleryColumns ?? columnsForWidth(width),
  );
  addContainer('dimensions', 'inline-row', 'Size & timing', inline, Math.min(4, columnsForWidth(width)));
  addContainer('controls', 'grid', 'Controls', ordinary, columnsForWidth(width));
  addContainer('advanced', 'collapsible', 'Advanced — optional', advanced, columnsForWidth(width), true);
  addContainer('outputs', 'pinned-media', 'Output & status', [], 1);
  for (const output of card.outputs) {
    elements.push({
      id: `output:${output.id}`,
      outputId: output.id,
      containerId: 'outputs',
      order: elements.length,
      height: output.primary ? 72 : 42,
    });
  }

  return {
    schemaVersion: 1,
    id: `layout:${card.id}`,
    width,
    minWidth: CARD_WIDTH_MIN,
    maxWidth: CARD_WIDTH_MAX,
    fitTarget,
    heightBudget: options.heightBudget ?? BUNDLED_CARD_HEIGHT_BUDGET,
    containers,
    elements,
  };

  function addContainer(
    id: string,
    kind: CardContainerKindV1,
    label: string,
    fields: ModelFieldV1[],
    columns: number,
    collapsedByDefault = false,
  ) {
    if (fields.length === 0 && id !== 'outputs') return;
    const boundedColumns = clamp(Math.round(columns), 1, 14) as CardColumnCountV1;
    containers.push({
      id,
      kind,
      label,
      order: order++,
      columns: boundedColumns,
      operationColumns: Object.fromEntries(operationIds.map((operationId) => [operationId, boundedColumns])),
      collapsedByDefault,
      height: kind === 'reference-gallery'
        && boundedColumns === 4
        && fields.some((field) => (field.constraints?.maxItems ?? field.constraints?.visiblePortCount ?? 0) > 12)
        ? 64
        : undefined,
    });
    for (const field of fields) {
      elements.push({
        id: `field:${field.id}`,
        fieldId: field.id,
        containerId: id,
        order: elements.length,
        height: field.control === 'prompt' || field.control === 'textarea' ? 88 : field.control === 'media' ? 96 : 42,
        conditions: [{ operationIds: field.operationIds }],
      });
    }
  }
}

export function autoArrangeCard(
  card: FlowModelCardV1,
  options: {
    fitTarget?: CardFitTargetV1;
    operationId?: string;
    heightBudget?: number;
  } = {},
): CardLayoutV1 {
  const widths = [
    CARD_WIDTH_PRESETS.compact,
    CARD_WIDTH_PRESETS.standard,
    CARD_WIDTH_PRESETS.wide,
    CARD_WIDTH_PRESETS.extraWide,
    780,
    910,
    CARD_WIDTH_MAX,
  ];
  const fitTarget = options.fitTarget ?? card.layout.fitTarget;
  const budget = Math.min(
    options.heightBudget ?? card.layout.heightBudget,
    logicalFitHeight(fitTarget),
  );
  let best = generateAutomaticCardLayout(card, { width: CARD_WIDTH_MAX, fitTarget, heightBudget: budget, galleryColumns: 4 });
  for (const width of widths) {
    const candidate = generateAutomaticCardLayout(card, {
      width,
      fitTarget,
      heightBudget: budget,
      galleryColumns: columnsForWidth(width),
    });
    const estimate = estimateLayoutHeight({ ...card, layout: candidate }, options.operationId);
    best = candidate;
    if (estimate <= budget) break;
  }
  return best;
}

export function compactCardLayout(card: FlowModelCardV1): CardLayoutV1 {
  const layout = generateAutomaticCardLayout(card, {
    width: CARD_WIDTH_PRESETS.compact,
    fitTarget: card.layout.fitTarget,
    heightBudget: card.layout.heightBudget,
    galleryColumns: 1,
  });
  return {
    ...layout,
    containers: layout.containers.map((container) =>
      container.id === 'advanced' ? { ...container, collapsedByDefault: true } : container
    ),
  };
}

export function buildCardFitReports(card: FlowModelCardV1): CardFitReport[] {
  return card.operations.map((operation) => buildCardFitReport(card, operation));
}

export function buildCardFitReport(
  card: FlowModelCardV1,
  operation: ModelCardOperationV1,
): CardFitReport {
  const budget = Math.min(card.layout.heightBudget, logicalFitHeight(card.layout.fitTarget));
  const estimatedHeight = estimateLayoutHeight(card, operation.id);
  const fieldById = new Map(card.fields.map((field) => [field.id, field]));
  const causes = card.layout.containers.flatMap((container) => {
    if (container.parentId) return [];
    if (container.collapsedByDefault) return [];
    const includedContainerIds = new Set([
      container.id,
      ...(container.kind === 'tabs'
        ? card.layout.containers.filter((candidate) => candidate.parentId === container.id).map((candidate) => candidate.id)
        : []),
    ]);
    const fields = card.layout.elements
      .filter((element) => includedContainerIds.has(element.containerId) && element.fieldId)
      .map((element) => fieldById.get(String(element.fieldId)))
      .filter((field): field is ModelFieldV1 => Boolean(field))
      .filter((field) => operation.visibleFieldIds.includes(field.id));
    const itemCount = fields.reduce((count, field) =>
      count + (container.kind === 'reference-gallery'
        ? field.constraints?.maxItems ?? field.constraints?.visiblePortCount ?? 1
        : 1), 0);
    const columns = container.operationColumns?.[operation.id] ?? container.columns ?? 1;
    const estimated = Math.ceil(itemCount / columns) * (
      container.kind === 'reference-gallery'
        ? container.height ?? galleryItemHeightForColumns(columns)
        : 50
    );
    if (estimated < 140) return [];
    const widerColumns = Math.min(14, columns + 1);
    return [{
      containerId: container.id,
      label: container.label ?? container.id,
      estimatedHeight: estimated,
      suggestion: widerColumns > columns
        ? `Change this group to ${widerColumns} columns`
        : container.id === 'advanced'
          ? 'Collapse Advanced by default'
          : 'Move secondary controls into Advanced',
      predictedHeight: Math.ceil(itemCount / widerColumns) * (
        container.kind === 'reference-gallery'
          ? container.height ?? galleryItemHeightForColumns(widerColumns)
          : 50
      ),
    }];
  }).sort((a, b) => b.estimatedHeight - a.estimatedHeight);
  return {
    operationId: operation.id,
    estimatedHeight,
    budget,
    fits: estimatedHeight <= budget,
    excessHeight: Math.max(0, estimatedHeight - budget),
    causes,
  };
}

function galleryItemHeightForColumns(columns: number): number {
  if (columns >= 4) return 84;
  if (columns === 3) return 92;
  if (columns === 2) return 104;
  return 112;
}

export function snapCardElement(
  layout: CardLayoutV1,
  elementId: string,
  proposed: { x: number; y: number },
  tolerance = 6,
): SnapResult {
  const source = layout.elements.find((element) => element.id === elementId);
  if (!source) return { ...proposed, guides: [] };
  let x = Math.max(0, proposed.x);
  let y = Math.max(0, proposed.y);
  const guides: AlignmentGuide[] = [];
  for (const target of layout.elements) {
    if (target.id === source.id || target.containerId !== source.containerId) continue;
    const targetX = target.x ?? 0;
    const targetY = target.y ?? 0;
    if (Math.abs(x - targetX) <= tolerance) {
      x = targetX;
      guides.push({ axis: 'x', position: x, sourceElementId: source.id, targetElementId: target.id });
    }
    if (Math.abs(y - targetY) <= tolerance) {
      y = targetY;
      guides.push({ axis: 'y', position: y, sourceElementId: source.id, targetElementId: target.id });
    }
  }
  return { x, y, guides };
}

export function moveCardElement(
  layout: CardLayoutV1,
  elementId: string,
  proposed: { x: number; y: number },
): { layout: CardLayoutV1; guides: AlignmentGuide[] } {
  const snapped = snapCardElement(layout, elementId, proposed);
  return {
    layout: {
      ...layout,
      elements: layout.elements.map((element) =>
        element.id === elementId ? { ...element, x: snapped.x, y: snapped.y } : element
      ),
    },
    guides: snapped.guides,
  };
}

export function resizeCardElement(
  layout: CardLayoutV1,
  elementId: string,
  size: { width: number; height: number },
): CardLayoutV1 {
  return {
    ...layout,
    elements: layout.elements.map((element) =>
      element.id === elementId
        ? { ...element, width: Math.max(32, size.width), height: Math.max(32, size.height) }
        : element
    ),
  };
}

export function alignCardElements(
  layout: CardLayoutV1,
  elementIds: readonly string[],
  axis: 'x' | 'y',
  alignment: 'start' | 'center' | 'end',
): CardLayoutV1 {
  const selected = layout.elements.filter((element) => elementIds.includes(element.id));
  if (!selected.length) return clone(layout);
  const positions = selected.map((element) => axis === 'x' ? element.x ?? 0 : element.y ?? 0);
  const ends = selected.map((element) =>
    (axis === 'x' ? element.x ?? 0 : element.y ?? 0)
    + (axis === 'x' ? element.width ?? 0 : element.height ?? 0)
  );
  const start = Math.min(...positions);
  const end = Math.max(...ends);
  const center = (start + end) / 2;
  return {
    ...layout,
    elements: layout.elements.map((element) => {
      if (!elementIds.includes(element.id)) return element;
      const size = axis === 'x' ? element.width ?? 0 : element.height ?? 0;
      const position = alignment === 'start' ? start : alignment === 'end' ? end - size : center - size / 2;
      return axis === 'x'
        ? { ...element, x: Math.max(0, position) }
        : { ...element, y: Math.max(0, position) };
    }),
  };
}

export function distributeCardElements(
  layout: CardLayoutV1,
  elementIds: readonly string[],
  axis: 'x' | 'y',
): CardLayoutV1 {
  const selected = layout.elements
    .filter((element) => elementIds.includes(element.id))
    .sort((left, right) => (axis === 'x' ? left.x ?? 0 : left.y ?? 0) - (axis === 'x' ? right.x ?? 0 : right.y ?? 0));
  if (selected.length < 3) return clone(layout);
  const first = axis === 'x' ? selected[0].x ?? 0 : selected[0].y ?? 0;
  const last = axis === 'x' ? selected.at(-1)?.x ?? first : selected.at(-1)?.y ?? first;
  const step = (last - first) / (selected.length - 1);
  const positions = new Map(selected.map((element, index) => [element.id, first + step * index]));
  return {
    ...layout,
    elements: layout.elements.map((element) => {
      const position = positions.get(element.id);
      if (position === undefined) return element;
      return axis === 'x' ? { ...element, x: position } : { ...element, y: position };
    }),
  };
}

export function setContainerColumns(
  layout: CardLayoutV1,
  containerId: string,
  columns: CardColumnCountV1,
  operationId?: string,
): CardLayoutV1 {
  return {
    ...layout,
    containers: layout.containers.map((container) => {
      if (container.id !== containerId) return container;
      return operationId
        ? {
            ...container,
            operationColumns: { ...container.operationColumns, [operationId]: columns },
          }
        : { ...container, columns };
    }),
  };
}

export function logicalFitHeight(target: CardFitTargetV1): number {
  if (target === '4k') return 1_800;
  if (target === '1440p') return 1_200;
  return BUNDLED_CARD_HEIGHT_BUDGET;
}

export function columnsForWidth(width: number): 1 | 2 | 3 | 4 {
  if (width >= CARD_WIDTH_PRESETS.extraWide) return 4;
  if (width >= CARD_WIDTH_PRESETS.wide) return 3;
  if (width >= CARD_WIDTH_PRESETS.standard) return 2;
  return 1;
}

function clone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as T;
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
