import {
  memo,
  useEffect,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ComponentType,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { Position } from '@xyflow/react';
import {
  FileJson2,
  Image as ImageIcon,
  LayoutGrid,
  Music2,
  RotateCcw,
  Save,
  Sparkles,
  Video,
} from 'lucide-react';
import type { AppNodeProps, NodeData } from '../../types/flow';
import type { ImageProvider } from '../../types/flow';
import type {
  CardHandlePlacementV1,
  CardLayoutContainerV1,
  CardLayoutElementV1,
  FlowModelCardV1,
  ModelCardLayoutOverrideV1,
  ModelCardRefV1,
  ModelFieldV1,
} from '../../lib/providerPackContracts';
import {
  listModelCardLayoutHandles,
  resolveAllCardHandlePlacements,
} from '../../lib/providerCardHandles';
import type { FlowPortContract } from '../../lib/flowNodeContracts';
import {
  CARD_WIDTH_MAX,
  CARD_WIDTH_MIN,
  CARD_WIDTH_PRESETS,
} from '../../lib/providerPackContracts';
import {
  createLayoutOverride,
  resolveCardLayout,
} from '../../lib/providerPackPortability';
import { buildCardFitReport } from '../../lib/providerCardLayout';
import {
  migrateModelCardOperationEdges,
  resolveModelCardPorts,
} from '../../lib/providerCardFlow';
import {
  collectModelCardConnectedValues,
  fetchRemoteOptions,
  modelCardInputHandle,
  modelCardOutputHandle,
} from '../../lib/providerPackExecution';
import {
  initializeProviderPackRegistry,
  providerPackRegistry,
} from '../../lib/providerPackRegistry';
import { useFlowStore } from '../../store/flowStore';
import { BaseNode } from './BaseNode';
import { TypedHandle } from './TypedHandle';
import { withFlowNodeInteractionClasses } from '../../lib/flowNodeInteraction';
import { ImageMaskPainterDialog } from './ImageMaskPainterDialog';

const inputClass = withFlowNodeInteractionClasses(
  'w-full rounded-lg border border-gray-700/70 bg-[#0a1018] px-2.5 py-2 text-xs text-gray-100 outline-none focus:border-cyan-400/70',
);

// The HOC is intentionally colocated with the adaptive component it selects.
// eslint-disable-next-line react-refresh/only-export-components
export function withAdaptiveModelCard(
  LegacyComponent: ComponentType<AppNodeProps>,
  options: { productionRenderer?: boolean } = {},
): ComponentType<AppNodeProps> {
  const ModelCardAware = (props: AppNodeProps) => (
    parseModelCardRef(props.data.modelCardRef)
      ? options.productionRenderer
        ? <ProductionAdaptiveModelCardNode LegacyComponent={LegacyComponent} {...props} />
        : <AdaptiveModelCardNode {...props} />
      : <LegacyComponent {...props} />
  );
  ModelCardAware.displayName = `Adaptive(${LegacyComponent.displayName ?? LegacyComponent.name ?? 'LegacyNode'})`;
  return memo(ModelCardAware);
}

function ProductionAdaptiveModelCardNode({
  LegacyComponent,
  ...props
}: AppNodeProps & { LegacyComponent: ComponentType<AppNodeProps> }) {
  useSyncExternalStore(
    providerPackRegistry.subscribe,
    providerPackRegistry.getSnapshot,
    providerPackRegistry.getSnapshot,
  );
  useEffect(() => {
    void initializeProviderPackRegistry();
  }, []);
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const ref = parseModelCardRef(props.data.modelCardRef);
  const resolved = ref
    ? providerPackRegistry.resolveCard(ref, props.data.embeddedProviderPackSnapshots)
    : null;
  const card = resolved?.card;
  if (!ref || !resolved || !card || !card.modalities.includes('image')) {
    return <AdaptiveModelCardNode {...props} />;
  }
  const personal = providerPackRegistry.getPersonalLayout(ref.packId, card.id);
  const nodeOverride = parseLayoutOverride(props.data.modelCardLayoutOverride);
  const layout = resolveCardLayout({ card, nodeOverride, personal }).layout;
  const operationId = typeof props.data.modelCardOperationId === 'string'
    ? props.data.modelCardOperationId
    : card.operations[0]?.id;
  const operation = card.operations.find((candidate) => candidate.id === operationId)
    ?? card.operations[0];
  if (!operation) return <AdaptiveModelCardNode {...props} />;
  const values = isRecord(props.data.modelCardValues) ? props.data.modelCardValues : {};
  const legacyValues = modelCardValuesForProductionImage(card, values);
  const providerId = ref.packId.startsWith('sloom.bundled.')
    ? ref.packId.slice('sloom.bundled.'.length)
    : props.data.provider;
  const productionProvider = isImageProvider(providerId) ? providerId : props.data.provider;
  const onChange: NonNullable<NodeData['onChange']> = (key, value) => {
    if (key === 'provider' || key === 'modelId' || key === 'mediaMode') return;
    const field = modelCardFieldForProductionImageKey(card, key);
    if (field) {
      patchNodeData(props.id, {
        modelCardValues: { ...values, [field.id]: value },
      });
      return;
    }
    props.data.onChange?.(key, value);
  };
  const changeOperation = (nextOperationId: string) => {
    const state = useFlowStore.getState();
    const migrated = migrateModelCardOperationEdges({
      nodeId: props.id,
      edges: state.edges,
      card,
      previousOperationId: operation.id,
      nextOperationId,
    });
    patchNodeData(props.id, { modelCardOperationId: nextOperationId });
    useFlowStore.setState({ edges: migrated });
  };

  return (
    <LegacyComponent
      {...props}
      data={{
        ...props.data,
        ...legacyValues,
        mediaMode: 'generate',
        modelCardBuilderCard: { ...card, layout },
        modelCardBuilderOperationId: operation.id,
        modelCardOperationChange: changeOperation,
        modelId: card.modelId,
        onChange,
        provider: productionProvider,
      }}
    />
  );
}

function isImageProvider(value: unknown): value is ImageProvider {
  return value === 'gemini'
    || value === 'openai'
    || value === 'huggingface'
    || value === 'bfl'
    || value === 'stability'
    || value === 'localOpen'
    || value === 'android'
    || value === 'atlas'
    || value === 'byteplus';
}

function modelCardValuesForProductionImage(
  card: FlowModelCardV1,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const field of card.fields) {
    const value = values[field.id] ?? field.defaultValue;
    if (value === undefined) continue;
    output[field.id] = value;
    const key = productionImageKeyForField(field);
    if (key) output[key] = value;
  }
  return output;
}

function modelCardFieldForProductionImageKey(
  card: FlowModelCardV1,
  key: string,
): ModelFieldV1 | undefined {
  return card.fields.find((field) =>
    field.id === key || productionImageKeyForField(field) === key
  );
}

function productionImageKeyForField(field: ModelFieldV1): string | undefined {
  if (field.id === 'imageSize') return 'imageResolutionTier';
  if (field.id === 'outputFormat') return 'imageOutputFormat';
  if (field.id === 'quality') return 'imageQuality';
  if (field.id === 'guidanceScale') return 'imageGuidanceScale';
  if (field.id === 'editStrength') return 'imageEditStrength';
  if (field.id === 'loraWeights') return 'imageLoraWeightsJson';
  if (field.id === 'safetyChecker') return 'imageSafetyCheckerEnabled';
  if (field.id === 'searchPrompt') return 'imageSearchPrompt';
  if (field.id === 'exactColorPrompt') return 'imageExactColor';
  if (field.id === 'textEditPrompt') return 'imageTextEditPrompt';
  if (field.id === 'negativePrompt') return 'imageNegativePrompt';
  if (field.id === 'creativity') return 'imageCreativity';
  if (field.semanticRole === 'seed') return 'imageSeed';
  if (field.semanticRole === 'width') return 'imageWidth';
  if (field.semanticRole === 'height') return 'imageHeight';
  return field.id;
}

function AdaptiveModelCardNodeComponent({ id, data, selected, type }: AppNodeProps) {
  useSyncExternalStore(
    providerPackRegistry.subscribe,
    providerPackRegistry.getSnapshot,
    providerPackRegistry.getSnapshot,
  );
  useEffect(() => {
    void initializeProviderPackRegistry();
  }, []);
  const ref = parseModelCardRef(data.modelCardRef);
  const resolved = ref
    ? providerPackRegistry.resolveCard(ref, data.embeddedProviderPackSnapshots)
    : null;
  const card = resolved?.card;
  const personal = ref && card ? providerPackRegistry.getPersonalLayout(ref.packId, card.id) : undefined;
  const nodeOverride = parseLayoutOverride(data.modelCardLayoutOverride);
  const layoutResolution = card
    ? resolveCardLayout({ card, nodeOverride, personal })
    : undefined;
  const layout = layoutResolution?.layout;
  const values = isRecord(data.modelCardValues) ? data.modelCardValues : {};
  const operationId = card && typeof data.modelCardOperationId === 'string'
    ? data.modelCardOperationId
    : card?.operations[0]?.id;
  const operation = card?.operations.find((candidate) => candidate.id === operationId)
    ?? card?.operations[0];
  const currentPortNode = useFlowStore.getState().nodes.find((candidate) => candidate.id === id);
  const ports = currentPortNode ? resolveModelCardPorts(currentPortNode) ?? [] : [];
  const patchNodeData = useFlowStore((state) => state.patchNodeData);
  const nodes = useFlowStore((state) => state.nodes);
  const edges = useFlowStore((state) => state.edges);
  const [collapsedContainers, setCollapsedContainers] = useState<Record<string, boolean>>({});
  const [activeTabs, setActiveTabs] = useState<Record<string, string>>({});
  const [layoutMenuOpen, setLayoutMenuOpen] = useState(false);
  const [maskPainterFieldId, setMaskPainterFieldId] = useState<string>();
  const [maskBrushSize, setMaskBrushSize] = useState(32);
  const [remoteOptions, setRemoteOptions] = useState<Record<string, Array<{ value: string; label: string }>>>({});

  useEffect(() => {
    if (!resolved?.executable || !card) return;
    let cancelled = false;
    const fields = card.fields.filter((field) => field.optionCatalogId);
    void Promise.all(fields.map(async (field) => {
      const options = await fetchRemoteOptions({
        pack: resolved.pack,
        catalogId: field.optionCatalogId!,
      });
      return [field.id, options] as const;
    })).then((entries) => {
      if (!cancelled) setRemoteOptions(Object.fromEntries(entries));
    }).catch(() => {
      // A remote option list is supplementary; the field remains usable with its saved options.
    });
    return () => {
      cancelled = true;
    };
  }, [card, resolved?.executable, resolved?.hash, resolved?.pack]);

  if (!ref || !resolved || !card || !layout || !operation) {
    return (
      <BaseNode
        containerStyle={{ width: 390 }}
        error={resolved?.missingReason ?? 'This node has an invalid model-card reference.'}
        hasInput={false}
        hasOutput={false}
        icon={FileJson2}
        nodeId={id}
        nodeType={type}
        title="Missing model card"
      >
        <div className="text-xs leading-5 text-gray-400">
          Install the exact provider pack or restore the project’s embedded snapshot.
        </div>
      </BaseNode>
    );
  }

  const icon = modalityIcon(card.modalities[0]);
  const releasePolicy = providerPackRegistry.getReleasePolicy();
  const operationLocked = releasePolicy?.lockedOperationIds?.includes(operation.id) ?? false;
  const lockedFieldIds = new Set(releasePolicy?.lockedFieldIds ?? []);
  const runDisabledReason = !resolved.executable
    ? resolved.missingReason
    : card.status === 'draft'
      ? 'This draft has blocking issues and cannot run.'
      : operationLocked
        ? `${operation.label} is disabled by this Sloom release policy.`
        : undefined;
  const layoutHandles = resolveAllCardHandlePlacements(
    layout,
    listModelCardLayoutHandles(card, operation),
  ).flatMap(({ handle, placement }) => {
    const port = ports.find((candidate) => candidate.id === handle.portId);
    return port ? [{ port, placement }] : [];
  });
  const customHandles = layoutHandles
    .filter(({ placement }) => placement.anchor === 'card')
    .map(({ port, placement }, index) => {
    return (
      <TypedHandle
        className="!h-4 !w-4 !border-2 !border-[#111827]"
        contract={port}
        id={port.id ?? undefined}
        key={`${port.direction}:${port.id ?? index}`}
        position={positionForHandleSide(placement.side)}
        style={flowHandleEdgeStyle(placement)}
        title={`${port.label} · ${port.required ? 'Required' : 'Optional'}`}
        type={port.direction === 'input' ? 'target' : 'source'}
      />
    );
    });
  const elementHandles = new Map<string, RuntimeLayoutHandle[]>();
  for (const handle of layoutHandles) {
    if (handle.placement.anchor !== 'element' || !handle.placement.elementId) continue;
    elementHandles.set(handle.placement.elementId, [
      ...(elementHandles.get(handle.placement.elementId) ?? []),
      handle,
    ]);
  }
  const fit = buildCardFitReport({ ...card, layout }, operation);
  const currentNode = nodes.find((candidate) => candidate.id === id);
  const connectedValues = currentNode
    ? collectModelCardConnectedValues({
        node: currentNode,
        nodes,
        edges,
        card,
        operationId: operation.id,
      })
    : {};
  const renderedValues = { ...values, ...connectedValues };
  const sourceImageField = card.fields.find((field) =>
    operation.visibleFieldIds.includes(field.id) && field.semanticRole === 'source-image'
  );
  const maskPainterSourceUrl = sourceImageField && typeof renderedValues[sourceImageField.id] === 'string'
    ? renderedValues[sourceImageField.id] as string
    : undefined;
  const maskPainterField = maskPainterFieldId
    ? card.fields.find((field) => field.id === maskPainterFieldId)
    : undefined;

  const setValue = (fieldId: string, value: unknown) => {
    if (lockedFieldIds.has(fieldId)) return;
    patchNodeData(id, {
      modelCardValues: { ...values, [fieldId]: value },
    });
  };

  const changeOperation = (nextOperationId: string) => {
    const migrated = migrateModelCardOperationEdges({
      nodeId: id,
      edges,
      card,
      previousOperationId: operation.id,
      nextOperationId,
    });
    patchNodeData(id, { modelCardOperationId: nextOperationId });
    useFlowStore.setState({ edges: migrated });
  };

  const resizeNode = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!selected) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = layout.width;
    const pointerId = event.pointerId;
    event.currentTarget.setPointerCapture(pointerId);
    const move = (moveEvent: PointerEvent) => {
      const width = clamp(Math.round(startWidth + moveEvent.clientX - startX), CARD_WIDTH_MIN, CARD_WIDTH_MAX);
      patchNodeData(id, {
        modelCardLayoutOverride: {
          ...(nodeOverride ?? { schemaVersion: 1, cardId: card.id }),
          width,
        },
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
  };

  const setNodeWidth = (width: number) => {
    patchNodeData(id, {
      modelCardLayoutOverride: {
        ...(nodeOverride ?? { schemaVersion: 1, cardId: card.id }),
        width,
      },
    });
  };

  const savePersonal = async () => {
    await providerPackRegistry.savePersonalLayout({
      schemaVersion: 1,
      packId: ref.packId,
      cardId: card.id,
      packHash: ref.hash,
      override: createLayoutOverride(card.id, card.layout, layout, operation.id),
      // The registry owns the persistence timestamp so render/event code stays deterministic.
      updatedAt: 0,
    });
    setLayoutMenuOpen(false);
  };

  const applyAll = () => {
    const override = createLayoutOverride(card.id, card.layout, layout, operation.id);
    for (const node of nodes) {
      const candidate = parseModelCardRef(node.data.modelCardRef);
      if (candidate?.packId === ref.packId && candidate.cardId === ref.cardId) {
        patchNodeData(node.id, { modelCardLayoutOverride: override });
      }
    }
    setLayoutMenuOpen(false);
  };

  const promoteDraft = async () => {
    const pack = clone(resolved.pack);
    const target = pack.cards.find((candidate) => candidate.id === card.id);
    if (target) target.layout = layout;
    pack.version = incrementPatch(pack.version);
    await providerPackRegistry.saveDraft(`${pack.packId}:${pack.version}`, pack);
    setLayoutMenuOpen(false);
  };

  return (
    <BaseNode
      containerClassName="overflow-visible"
      containerStyle={{ width: layout.width }}
      customHandles={customHandles}
      error={data.error as string | undefined}
      hasInput={false}
      hasOutput={false}
      icon={icon}
      isRunning={Boolean(data.isRunning)}
      nodeId={id}
      nodeType={type}
      onRun={data.onRun}
      retryState={data.retryState}
      runDisabledReason={runDisabledReason}
      statusMessage={data.statusMessage as string | undefined}
      title={card.displayName}
    >
      <div className="space-y-3" data-model-card-id={card.id} data-model-card-operation={operation.id}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate text-[10px] font-semibold uppercase tracking-[0.15em] text-cyan-200/70">
              {resolved.pack.provider.name}
            </div>
            <div className="truncate text-[10px] text-gray-500">{card.modelId}</div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${
              card.status === 'tested'
                ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-200'
                : card.status === 'draft'
                  ? 'border-rose-400/40 bg-rose-400/10 text-rose-200'
                  : 'border-amber-400/40 bg-amber-400/10 text-amber-200'
            }`}>
              {card.status === 'ready-untested' ? 'Untested' : card.status}
            </span>
            <button
              aria-label="Card layout actions"
              className="rounded-md border border-gray-700/70 bg-[#0a1018] p-1.5 text-gray-400 hover:text-white"
              onClick={() => setLayoutMenuOpen((current) => !current)}
              type="button"
            >
              <LayoutGrid size={12} />
            </button>
          </div>
        </div>

        {layoutMenuOpen ? (
          <div className="nodrag nopan rounded-xl border border-cyan-300/20 bg-[#0b111a] p-2 shadow-xl">
            <div className="grid grid-cols-4 gap-1">
              {Object.entries(CARD_WIDTH_PRESETS).map(([label, width]) => (
                <button
                  className={`rounded border px-1 py-1.5 text-[9px] font-semibold capitalize ${
                    layout.width === width
                      ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-100'
                      : 'border-gray-700 text-gray-400 hover:text-white'
                  }`}
                  key={label}
                  onClick={() => setNodeWidth(width)}
                  type="button"
                >
                  {label.replace(/([A-Z])/g, ' $1')}
                </button>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-1 text-[10px]">
              <LayoutAction icon={Save} label="Personal default" onClick={() => void savePersonal()} />
              <LayoutAction icon={LayoutGrid} label="Apply to all" onClick={applyAll} />
              <LayoutAction icon={RotateCcw} label="Reset node" onClick={() => patchNodeData(id, { modelCardLayoutOverride: undefined })} />
              <LayoutAction
                icon={RotateCcw}
                label="Reset to pack"
                onClick={() => patchNodeData(id, {
                  modelCardLayoutOverride: {
                    schemaVersion: 1,
                    cardId: card.id,
                    containers: [],
                    elements: [],
                  },
                })}
              />
              <LayoutAction icon={Sparkles} label="Promote draft" onClick={() => void promoteDraft()} />
            </div>
            <div className="mt-2 text-[9px] text-gray-500">
              {layout.width}px × about {fit.estimatedHeight}px · {layoutResolution.source} layout · {fit.fits ? 'fits' : `${fit.excessHeight}px over target`}
            </div>
          </div>
        ) : null}

        {card.operations.length > 1 ? (
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(4, card.operations.length)}, minmax(0, 1fr))` }}>
            {card.operations.map((candidate) => (
              <button
                className={`nodrag nopan rounded-lg border px-2 py-1.5 text-[10px] font-semibold ${
                  candidate.id === operation.id
                    ? 'border-cyan-300/55 bg-cyan-400/15 text-cyan-50'
                    : 'border-gray-700/70 bg-[#0a1018] text-gray-400 hover:text-gray-100'
                }`}
                key={candidate.id}
                disabled={releasePolicy?.lockedOperationIds?.includes(candidate.id)}
                onClick={() => changeOperation(candidate.id)}
                type="button"
              >
                {candidate.label}
              </button>
            ))}
          </div>
        ) : null}

        {layout.containers
          .filter((container) => !container.parentId && containerVisible(container, operation.id))
          .sort((left, right) => left.order - right.order)
          .map((container) => (
            <CardContainer
              activeTab={activeTabs[container.id]}
              card={card}
              collapsed={collapsedContainers[container.id] ?? Boolean(container.collapsedByDefault)}
              container={container}
              containers={layout.containers}
              elementHandles={elementHandles}
              elements={layout.elements}
              key={container.id}
              onSetActiveTab={(tab) => setActiveTabs((current) => ({ ...current, [container.id]: tab }))}
              onToggleCollapsed={() => setCollapsedContainers((current) => ({
                ...current,
                [container.id]: !(current[container.id] ?? Boolean(container.collapsedByDefault)),
              }))}
              operationId={operation.id}
              optionOverrides={remoteOptions}
              lockedFieldIds={lockedFieldIds}
              maskPainterSourceUrl={maskPainterSourceUrl}
              onOpenMaskPainter={setMaskPainterFieldId}
              setValue={setValue}
              values={renderedValues}
            />
          ))}

        <OutputPreview
          card={card}
          data={data}
          elementHandles={elementHandles}
          layout={layout}
          operationId={operation.id}
        />

        {!fit.fits ? (
          <div className="rounded-lg border border-amber-400/25 bg-amber-400/10 px-2.5 py-2 text-[10px] leading-4 text-amber-100">
            About {fit.excessHeight}px over the {fit.budget}px target.
            {fit.causes[0]?.suggestion ? ` ${fit.causes[0].suggestion}.` : ' Use a wider card, tabs, or collapse Advanced.'}
          </div>
        ) : null}
      </div>
      {selected ? (
        <div
          aria-label="Resize model card"
          className="nodrag nopan absolute bottom-1 right-1 h-4 w-4 cursor-ew-resize rounded-br-lg border-b-2 border-r-2 border-cyan-300/70"
          onPointerDown={resizeNode}
          role="separator"
          title={`Drag to resize ${CARD_WIDTH_MIN}–${CARD_WIDTH_MAX}px`}
        />
      ) : null}
      {maskPainterField && maskPainterSourceUrl ? (
        <ImageMaskPainterDialog
          brushSize={maskBrushSize}
          initialMaskDataUrl={typeof values[maskPainterField.id] === 'string' ? values[maskPainterField.id] as string : undefined}
          mode="mask"
          onBrushSizeChange={setMaskBrushSize}
          onClose={() => setMaskPainterFieldId(undefined)}
          onSave={(maskDataUrl) => {
            setValue(maskPainterField.id, maskDataUrl);
            setMaskPainterFieldId(undefined);
          }}
          sourceImageUrl={maskPainterSourceUrl}
        />
      ) : null}
    </BaseNode>
  );
}

function CardContainer({
  activeTab,
  card,
  collapsed,
  container,
  containers,
  elementHandles,
  elements,
  onSetActiveTab,
  onToggleCollapsed,
  operationId,
  optionOverrides,
  lockedFieldIds,
  maskPainterSourceUrl,
  onOpenMaskPainter,
  setValue,
  values,
}: {
  activeTab?: string;
  card: FlowModelCardV1;
  collapsed: boolean;
  container: CardLayoutContainerV1;
  containers: CardLayoutContainerV1[];
  elementHandles: ReadonlyMap<string, RuntimeLayoutHandle[]>;
  elements: CardLayoutElementV1[];
  onSetActiveTab: (tab: string) => void;
  onToggleCollapsed: () => void;
  operationId: string;
  optionOverrides: Record<string, Array<{ value: string; label: string }>>;
  lockedFieldIds: ReadonlySet<string>;
  maskPainterSourceUrl?: string;
  onOpenMaskPainter: (fieldId: string) => void;
  setValue: (fieldId: string, value: unknown) => void;
  values: Record<string, unknown>;
}) {
  const childTabs = container.kind === 'tabs'
    ? containers.filter((candidate) => candidate.parentId === container.id)
    : [];
  const includedContainerIds = new Set([
    container.id,
    ...childTabs.map((candidate) => candidate.id),
  ]);
  const visibleElements = elements
    .filter((element) =>
      includedContainerIds.has(element.containerId)
      && !element.hidden
      && elementVisible(element, operationId)
    )
    .sort((left, right) => left.order - right.order);
  const fields = visibleElements.flatMap((element) => {
    const fieldBase = element.fieldId ? card.fields.find((candidate) => candidate.id === element.fieldId) : undefined;
    const field = fieldBase && optionOverrides[fieldBase.id]
      ? { ...fieldBase, options: optionOverrides[fieldBase.id] }
      : fieldBase;
    return field && field.operationIds.includes(operationId) ? [{ element, field }] : [];
  });
  if (!fields.length || container.id === 'outputs') return null;
  const columns = container.operationColumns?.[operationId] ?? container.columns ?? 1;

  if (container.kind === 'collapsible') {
    const requiredCount = fields.filter(({ field }) => field.required).length;
    return (
      <section className="rounded-xl border border-gray-800/80 bg-[#0b1018]/70">
        <button
          className="nodrag nopan flex w-full items-center justify-between px-2.5 py-2 text-left text-[10px] font-semibold text-gray-300"
          onClick={onToggleCollapsed}
          type="button"
        >
          <span>{container.label ?? 'Advanced — optional'}</span>
          <span className="text-gray-500">{requiredCount ? `${requiredCount} required · ` : ''}{collapsed ? 'Show' : 'Hide'}</span>
        </button>
        {!collapsed ? (
          <FieldGrid columns={columns} elementHandles={elementHandles} fields={fields} lockedFieldIds={lockedFieldIds} maskPainterSourceUrl={maskPainterSourceUrl} onOpenMaskPainter={onOpenMaskPainter} setValue={setValue} values={values} />
        ) : null}
      </section>
    );
  }

  if (container.kind === 'tabs') {
    const tabs = childTabs.length
      ? childTabs.map((tab) => tab.tabId ?? tab.label ?? tab.id)
      : [...new Set(fields.map(({ element }) => element.conditions?.[0]?.fieldId ?? 'General'))];
    const selectedTab = activeTab && tabs.includes(activeTab) ? activeTab : tabs[0];
    return (
      <section className="rounded-xl border border-gray-800/80 bg-[#0b1018]/70 p-2">
        <div className="mb-2 flex gap-1">
          {tabs.map((tab) => (
            <button
              className={`nodrag nopan rounded px-2 py-1 text-[9px] ${tab === selectedTab ? 'bg-cyan-400/15 text-cyan-100' : 'text-gray-500'}`}
              key={tab}
              onClick={() => onSetActiveTab(tab)}
              type="button"
            >
              {tab}
            </button>
          ))}
        </div>
        <FieldGrid
          columns={columns}
          elementHandles={elementHandles}
          fields={fields.filter(({ element }) => {
            const child = childTabs.find((candidate) => candidate.id === element.containerId);
            return (child?.tabId ?? child?.label ?? element.conditions?.[0]?.fieldId ?? 'General') === selectedTab;
          })}
          lockedFieldIds={lockedFieldIds}
          maskPainterSourceUrl={maskPainterSourceUrl}
          onOpenMaskPainter={onOpenMaskPainter}
          setValue={setValue}
          values={values}
        />
      </section>
    );
  }

  if (container.kind === 'freeform') {
    return (
      <section
        className="relative rounded-xl border border-gray-800/70 bg-[#0b1018]/45 p-2"
        style={{ height: Math.max(72, container.height ?? 220) }}
      >
        {fields.map(({ element, field }) => (
          <div
            className="absolute overflow-visible"
            key={element.id}
            style={{
              height: element.height,
              left: element.x ?? 0,
              top: element.y ?? 0,
              width: element.width ?? 160,
            }}
          >
            <ModelFieldControl
              disabled={lockedFieldIds.has(field.id)}
              field={field}
              galleryColumns={columns}
              maskPainterSourceUrl={maskPainterSourceUrl}
              onChange={(value) => setValue(field.id, value)}
              onOpenMaskPainter={() => onOpenMaskPainter(field.id)}
              value={values[field.id]}
            />
            <ElementFlowHandles handles={elementHandles.get(element.id) ?? []} />
          </div>
        ))}
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-gray-800/70 bg-[#0b1018]/45 p-2">
      {container.label ? (
        <div className="mb-2 text-[9px] font-semibold uppercase tracking-[0.15em] text-gray-500">{container.label}</div>
      ) : null}
      <FieldGrid
        columns={columns}
        elementHandles={elementHandles}
        fields={fields}
        galleryItemHeight={container.kind === 'reference-gallery' ? container.height : undefined}
        lockedFieldIds={lockedFieldIds}
        maskPainterSourceUrl={maskPainterSourceUrl}
        onOpenMaskPainter={onOpenMaskPainter}
        setValue={setValue}
        values={values}
      />
    </section>
  );
}

function FieldGrid({
  columns,
  elementHandles,
  fields,
  galleryItemHeight,
  lockedFieldIds,
  maskPainterSourceUrl,
  onOpenMaskPainter,
  setValue,
  values,
}: {
  columns: number;
  elementHandles: ReadonlyMap<string, RuntimeLayoutHandle[]>;
  fields: Array<{ element: CardLayoutElementV1; field: ModelFieldV1 }>;
  galleryItemHeight?: number;
  lockedFieldIds: ReadonlySet<string>;
  maskPainterSourceUrl?: string;
  onOpenMaskPainter: (fieldId: string) => void;
  setValue: (fieldId: string, value: unknown) => void;
  values: Record<string, unknown>;
}) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {fields.map(({ element, field }) => (
        <div
          className="relative overflow-visible"
          key={element.id}
          style={{
            gridColumn: `span ${Math.min(
              columns,
              element.columnSpan ?? (field.control === 'reference-gallery' ? columns : 1),
            )} / span ${Math.min(
              columns,
              element.columnSpan ?? (field.control === 'reference-gallery' ? columns : 1),
            )}`,
          }}
        >
          <ModelFieldControl
            disabled={lockedFieldIds.has(field.id)}
            field={field}
            galleryColumns={columns}
            galleryItemHeight={galleryItemHeight}
            maskPainterSourceUrl={maskPainterSourceUrl}
            onChange={(value) => setValue(field.id, value)}
            onOpenMaskPainter={() => onOpenMaskPainter(field.id)}
            value={values[field.id]}
          />
          <ElementFlowHandles handles={elementHandles.get(element.id) ?? []} />
        </div>
      ))}
    </div>
  );
}

interface RuntimeLayoutHandle {
  port: FlowPortContract;
  placement: CardHandlePlacementV1;
}

function ElementFlowHandles({ handles }: { handles: readonly RuntimeLayoutHandle[] }) {
  return handles.map(({ port, placement }) => (
    <TypedHandle
      className="!h-4 !w-4 !border-2 !border-[#111827]"
      contract={port}
      id={port.id ?? undefined}
      key={`${port.direction}:${port.id}`}
      position={positionForHandleSide(placement.side)}
      style={flowHandleEdgeStyle(placement)}
      title={`${port.label} · ${port.required ? 'Required' : 'Optional'}`}
      type={port.direction === 'input' ? 'target' : 'source'}
    />
  ));
}

function positionForHandleSide(side: CardHandlePlacementV1['side']): Position {
  if (side === 'right') return Position.Right;
  if (side === 'top') return Position.Top;
  if (side === 'bottom') return Position.Bottom;
  return Position.Left;
}

function flowHandleEdgeStyle(placement: CardHandlePlacementV1): CSSProperties {
  if (placement.side === 'top' || placement.side === 'bottom') {
    return {
      left: `${placement.offsetPercent}%`,
      [placement.side]: -8,
    };
  }
  return {
    top: `${placement.offsetPercent}%`,
    [placement.side]: -8,
  };
}

function defaultGalleryItemHeight(columns: number): number {
  if (columns >= 4) return 84;
  if (columns === 3) return 92;
  if (columns === 2) return 104;
  return 112;
}

export function ModelFieldControl({
  disabled,
  field,
  galleryColumns,
  galleryItemHeight,
  maskPainterSourceUrl,
  onChange,
  onOpenMaskPainter,
  value,
}: {
  disabled: boolean;
  field: ModelFieldV1;
  galleryColumns: number;
  galleryItemHeight?: number;
  maskPainterSourceUrl?: string;
  onChange: (value: unknown) => void;
  onOpenMaskPainter: () => void;
  value: unknown;
}) {
  const label = (
    <span className="mb-1 flex items-center gap-1 text-[9px] font-semibold text-gray-400">
      {field.label}{field.required ? <span className="text-rose-300">*</span> : null}
    </span>
  );
  if (field.control === 'reference-gallery') {
    const count = field.constraints?.maxItems ?? field.constraints?.visiblePortCount ?? 0;
    return (
      <div>
        {label}
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(1, Math.min(14, galleryColumns))}, minmax(0, 1fr))` }}>
          {Array.from({ length: count }, (_, index) => (
            <div
              className="relative flex items-center justify-center rounded-md border border-dashed border-emerald-400/25 bg-emerald-400/5 text-[9px] text-emerald-200/60"
              key={index}
              style={{ height: galleryItemHeight ?? defaultGalleryItemHeight(galleryColumns) }}
              title={`${field.label} ${index + 1} · ${modelCardInputHandle(field.id, index)}`}
            >
              {index + 1}
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (field.control === 'media') {
    return (
      <div>
        {label}
        <div className="flex min-h-16 items-center justify-center rounded-lg border border-dashed border-blue-400/25 bg-blue-400/5 px-2 text-center text-[9px] leading-4 text-blue-200/65">
          {typeof value === 'string' && field.valueType === 'image'
            ? <img alt={field.label} className="max-h-24 w-full rounded object-contain" src={value} />
            : `Connect ${field.label}`}
        </div>
        {field.semanticRole === 'mask' ? (
          <button
            className="nodrag nopan mt-1.5 w-full rounded border border-pink-400/30 bg-pink-400/10 px-2 py-1.5 text-[9px] font-semibold text-pink-100 disabled:opacity-40"
            disabled={disabled || !maskPainterSourceUrl}
            onClick={onOpenMaskPainter}
            type="button"
          >
            Paint mask from source
          </button>
        ) : null}
      </div>
    );
  }
  if (field.control === 'toggle') {
    return (
      <label className="nodrag nopan flex min-h-9 items-center justify-between gap-2 rounded-lg border border-gray-700/70 bg-[#0a1018] px-2.5 text-[10px] text-gray-300">
        <span>{field.label}{field.required ? ' *' : ''}</span>
        <input checked={Boolean(value ?? field.defaultValue)} disabled={disabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      </label>
    );
  }
  if (field.control === 'dropdown') {
    return (
      <label className="block">
        {label}
        <select className={`${inputClass} nodrag nopan`} disabled={disabled} onChange={(event) => onChange(event.target.value)} value={String(value ?? field.defaultValue ?? '')}>
          <option value="">Choose…</option>
          {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </label>
    );
  }
  if (field.control === 'slider') {
    const numericValue = Number(value ?? field.defaultValue ?? field.constraints?.min ?? 0);
    return (
      <label className="block">
        {label}
        <div className="flex items-center gap-2">
          <input
            className="nodrag nopan min-w-0 flex-1 accent-cyan-400"
            disabled={disabled}
            max={field.constraints?.max}
            min={field.constraints?.min}
            onChange={(event) => onChange(Number(event.target.value))}
            step={field.constraints?.step}
            type="range"
            value={numericValue}
          />
          <span className="w-10 text-right text-[9px] text-gray-400">{numericValue}</span>
        </div>
      </label>
    );
  }
  if (field.control === 'number') {
    return (
      <label className="block">
        {label}
        <input
          className={`${inputClass} nodrag nopan`}
          disabled={disabled}
          max={field.constraints?.max}
          min={field.constraints?.min}
          onChange={(event) => onChange(event.target.value === '' ? undefined : Number(event.target.value))}
          step={field.constraints?.step}
          type="number"
          value={typeof value === 'number' ? value : typeof field.defaultValue === 'number' ? field.defaultValue : ''}
        />
      </label>
    );
  }
  const multiline = field.control === 'prompt' || field.control === 'textarea';
  return (
    <label className="block">
      {label}
      {multiline ? (
        <textarea
          className={`${inputClass} nodrag nopan min-h-20 resize-y`}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.description}
          value={String(value ?? field.defaultValue ?? '')}
        />
      ) : (
        <input
          className={`${inputClass} nodrag nopan`}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder={field.description}
          type="text"
          value={String(value ?? field.defaultValue ?? '')}
        />
      )}
    </label>
  );
}

function OutputPreview({
  card,
  data,
  elementHandles,
  layout,
  operationId,
}: {
  card: FlowModelCardV1;
  data: NodeData;
  elementHandles: ReadonlyMap<string, RuntimeLayoutHandle[]>;
  layout: FlowModelCardV1['layout'];
  operationId: string;
}) {
  const output = card.outputs.find((candidate) => candidate.primary && candidate.operationIds.includes(operationId));
  const result = typeof data.result === 'string' ? data.result : undefined;
  if (!output) return null;
  const outputElement = layout.elements.find((element) => element.outputId === output.id);
  return (
    <section className="relative rounded-xl border border-violet-400/20 bg-violet-400/5 p-2">
      <div className="mb-1 flex items-center justify-between text-[9px] font-semibold uppercase tracking-[0.15em] text-violet-200/60">
        <span>{output.label}</span>
        <span>{modelCardOutputHandle(output.id)}</span>
      </div>
      {result ? (
        output.resultType === 'image' ? <img alt={output.label} className="max-h-56 w-full rounded-lg object-contain" src={result} />
          : output.resultType === 'video' ? <video className="max-h-56 w-full rounded-lg" controls src={result} />
            : output.resultType === 'audio' ? <audio className="w-full" controls src={result} />
              : <pre className="max-h-40 overflow-auto whitespace-pre-wrap text-[10px] text-gray-200">{result}</pre>
      ) : (
        <div className="flex min-h-14 items-center justify-center text-[10px] text-gray-500">Output appears here after a run.</div>
      )}
      <ElementFlowHandles handles={outputElement ? elementHandles.get(outputElement.id) ?? [] : []} />
    </section>
  );
}

function LayoutAction({
  icon: Icon,
  label,
  onClick,
}: {
  icon: ComponentType<{ size?: number }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className="flex items-center gap-1.5 rounded border border-gray-700/70 px-2 py-1.5 text-left text-gray-300 hover:border-cyan-300/40 hover:text-white"
      onClick={onClick}
      type="button"
    >
      <Icon size={11} />{label}
    </button>
  );
}

function modalityIcon(modality?: string) {
  if (modality === 'video') return Video;
  if (modality === 'audio') return Music2;
  if (modality === 'text') return FileJson2;
  return ImageIcon;
}

function containerVisible(container: CardLayoutContainerV1, operationId: string): boolean {
  return !container.conditions?.some((condition) =>
    condition.operationIds && !condition.operationIds.includes(operationId)
  );
}

function elementVisible(element: CardLayoutElementV1, operationId: string): boolean {
  return !element.conditions?.some((condition) =>
    condition.operationIds && !condition.operationIds.includes(operationId)
  );
}

function parseModelCardRef(value: unknown): ModelCardRefV1 | null {
  return isRecord(value)
    && typeof value.packId === 'string'
    && typeof value.version === 'string'
    && typeof value.hash === 'string'
    && typeof value.cardId === 'string'
    ? value as unknown as ModelCardRefV1
    : null;
}

function parseLayoutOverride(value: unknown): ModelCardLayoutOverrideV1 | undefined {
  return isRecord(value) && value.schemaVersion === 1 && typeof value.cardId === 'string'
    ? value as unknown as ModelCardLayoutOverrideV1
    : undefined;
}

function incrementPatch(version: string): string {
  const parts = version.split('.').map(Number);
  return `${parts[0] || 1}.${parts[1] || 0}.${(parts[2] || 0) + 1}`;
}

function clone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as T;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export const AdaptiveModelCardNode = memo(AdaptiveModelCardNodeComponent);
