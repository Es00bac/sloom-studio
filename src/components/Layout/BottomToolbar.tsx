import React from 'react';
import { Activity, AlignLeft, Braces, ChevronDown, Database, Image, LayoutTemplate, List, Repeat, ScrollText, Settings, Sigma, Sparkles } from 'lucide-react';
import {
  createImageNodeTemplateDataPatch,
  listImageNodeTemplates,
  imageNodeTemplateDescription,
  imageNodeTemplateHighlight,
  type ImageNodeTemplate,
} from '../../lib/imageNodeTemplates';
import {
  FLOW_NODE_CATALOG_CATEGORIES,
  getNodeCatalogEntriesForCategory,
  nodeCategoryLabel,
  nodeCategoryDescription,
  nodeCatalogEntryLabel,
  nodeCatalogEntryDescription,
  type FlowNodeCatalogCategory,
  type FlowNodeCatalogCategoryId,
  type FlowNodeCatalogEntry,
} from '../../lib/nodeCatalog';
import type { FlowNodeType, NodeData } from '../../types/flow';
import { useI18n } from '../../lib/useI18n';
import { NodeContractHelp } from './NodeContractHelp';
import {
  initializeProviderPackRegistry,
  providerPackRegistry,
} from '../../lib/providerPackRegistry';
import {
  createModelCardNodeData,
  nodeTypeForModelCard,
} from '../../lib/providerCardFlow';
import { useSettingsStore } from '../../store/settingsStore';
import type { ProviderPackRuntimeRecord } from '../../lib/providerPackContracts';
import { FlowStarterGallery } from '../Flow/FlowStarterGallery';

interface BottomToolbarProps {
  onAddNode: (type: FlowNodeType, initialData?: Partial<NodeData>) => void;
  /** When provided, a leading Start menu opens the built-in starter-template gallery. */
  onInsertStarterTemplate?: (templateId: string) => void;
  /** When provided, the Start menu offers importing a shared .sloompack file. */
  onImportNodePack?: () => void;
  dockable?: boolean;
  variant?: 'floating' | 'dockable' | 'topbar';
}

const CATEGORY_ICONS: Record<FlowNodeCatalogCategoryId, React.ReactNode> = {
  generate: <Sparkles size={18} />,
  'inputs-data': <Database size={18} />,
  'lists-envelopes': <List size={18} />,
  'flow-control': <Repeat size={18} />,
  'logic-math': <Sigma size={18} />,
  'text-tools': <AlignLeft size={18} />,
  'story-tools': <ScrollText size={18} />,
  'reuse-layout': <Braces size={18} />,
  'monitor-debug': <Activity size={18} />,
  settings: <Settings size={18} />,
};

export const BottomToolbar: React.FC<BottomToolbarProps> = ({ onAddNode, onInsertStarterTemplate, onImportNodePack, dockable = false, variant }) => {
  const resolvedVariant = variant ?? (dockable ? 'dockable' : 'floating');
  const compact = resolvedVariant === 'topbar';
  const imageTemplates = React.useMemo(() => listImageNodeTemplates(), []);
  React.useSyncExternalStore(
    providerPackRegistry.subscribe,
    providerPackRegistry.getSnapshot,
    providerPackRegistry.getSnapshot,
  );
  React.useEffect(() => {
    void initializeProviderPackRegistry();
  }, []);
  const providerPackRecords = providerPackRegistry.listRecords().filter((record) => record.active);
  const className = resolvedVariant === 'topbar'
    ? 'pointer-events-auto flex w-max items-center justify-center gap-1 px-1 py-0.5'
    : `theme-popover ${resolvedVariant === 'dockable' ? 'flex w-max max-w-full flex-wrap' : 'absolute bottom-8 left-1/2 z-40 flex -translate-x-1/2'} items-center gap-2 bg-[#252830] border border-gray-700 px-4 py-3 rounded-2xl shadow-2xl backdrop-blur-md`;

  return (
    <div className={className} data-toolbar-variant={resolvedVariant}>
      {onInsertStarterTemplate ? (
        <StarterTemplatesMenu compact={compact} onImportNodePack={onImportNodePack} onInsertStarterTemplate={onInsertStarterTemplate} />
      ) : null}
      {FLOW_NODE_CATALOG_CATEGORIES.map((category) => (
        <NodeCategoryMenu
          category={category}
          compact={compact}
          imageTemplates={imageTemplates}
          providerPackRecords={providerPackRecords}
          key={category.id}
          onAddNode={onAddNode}
        />
      ))}
    </div>
  );
}

function StarterTemplatesMenu({
  compact,
  onInsertStarterTemplate,
  onImportNodePack,
}: {
  compact: boolean;
  onInsertStarterTemplate: (templateId: string) => void;
  onImportNodePack?: () => void;
}) {
  const { t } = useI18n();
  const menuRef = React.useRef<HTMLDetailsElement>(null);
  // Anchored to the trigger's left edge (not centered) so the popover never hangs off-screen
  // horizontally when the trigger sits near a narrow viewport's edge — the Start button is
  // always the leftmost item in this toolbar. `max-h` + its own scroll keeps the whole popover
  // (not just the inner template list) from running past the bottom of a short viewport too.
  const menuClassName = compact
    ? 'absolute left-0 top-9 z-50 max-h-[calc(100vh-3rem)] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-gray-700 bg-[#10151f] p-2 shadow-2xl'
    : 'absolute bottom-12 left-0 z-50 max-h-[calc(100vh-3rem)] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-gray-700 bg-[#10151f] p-2 shadow-2xl';

  return (
    <details className="relative" data-keyboard-focus-scope="true" data-starter-template-menu="true" ref={menuRef}>
      <summary
        aria-label={t('flow.starter.openMenu')}
        className={compact
          ? 'theme-icon-button flex h-8 cursor-pointer list-none items-center gap-1 rounded-md border border-fuchsia-300/25 bg-fuchsia-500/10 px-2 text-fuchsia-100 transition-colors hover:border-fuchsia-200/60 hover:bg-fuchsia-500/20 hover:text-white [&::-webkit-details-marker]:hidden'
          : 'theme-button flex cursor-pointer list-none items-center gap-2 rounded-xl border border-fuchsia-300/25 bg-fuchsia-500/10 px-3 py-2 text-sm text-fuchsia-100 transition-all duration-200 hover:border-fuchsia-200/60 hover:bg-fuchsia-500/20 hover:text-white [&::-webkit-details-marker]:hidden'}
        title={t('flow.starter.openMenu')}
      >
        <LayoutTemplate size={18} />
        <span className={compact ? 'hidden min-[1600px]:inline' : undefined}>{t('flow.starter.menuLabel')}</span>
        <ChevronDown size={13} />
      </summary>
      <div
        className={menuClassName}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && menuRef.current) {
            event.stopPropagation();
            menuRef.current.open = false;
            // The focused control lives inside the now-closed <details>
            // subtree; return focus to the summary trigger so keyboard users
            // keep their place and can reopen the menu.
            menuRef.current.querySelector('summary')?.focus();
          }
        }}
      >
        <div className="px-2 pb-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fuchsia-200/60">
            {t('flow.starter.panelTitle')}
          </div>
          <div className="mt-1 text-[11px] leading-4 text-gray-400">{t('flow.starter.panelDescription')}</div>
        </div>
        <FlowStarterGallery
          onInsert={(templateId) => {
            onInsertStarterTemplate(templateId);
            if (menuRef.current) {
              menuRef.current.open = false;
              // Closing the details hides the clicked button; move focus back
              // to the summary trigger so keyboard users are not stranded on a
              // hidden element.
              menuRef.current.querySelector('summary')?.focus();
            }
          }}
          variant="menu"
        />
        {onImportNodePack ? (
          <div className="mt-1 border-t border-gray-700/60 px-2 pb-1 pt-2">
            <button
              className="w-full rounded-md border border-cyan-300/25 bg-cyan-300/10 px-2.5 py-2 text-left text-xs font-semibold text-cyan-50 transition-colors hover:border-cyan-200/60 hover:bg-cyan-300/20"
              data-import-node-pack="true"
              onClick={() => {
                onImportNodePack();
                if (menuRef.current) {
                  menuRef.current.open = false;
                  // The native file chooser triggered above is a separate
                  // modal surface; closing the details now (instead of
                  // waiting on the async import) keeps the menu from
                  // sitting open over the graph once nodes land.
                  menuRef.current.querySelector('summary')?.focus();
                }
              }}
              type="button"
            >
              {t('flow.nodePack.importAction')}
            </button>
            <p className="mt-1 text-[10px] leading-4 text-gray-500">{t('flow.nodePack.importHint')}</p>
          </div>
        ) : null}
      </div>
    </details>
  );
};

function NodeCategoryMenu({
  category,
  compact,
  imageTemplates,
  onAddNode,
  providerPackRecords,
}: {
  category: FlowNodeCatalogCategory;
  compact: boolean;
  imageTemplates: ImageNodeTemplate[];
  providerPackRecords: ProviderPackRuntimeRecord[];
  onAddNode: (type: FlowNodeType, initialData?: Partial<NodeData>) => void;
}) {
  const { tf, locale } = useI18n();
  const entries = getNodeCatalogEntriesForCategory(category.id);
  const categoryLabel = nodeCategoryLabel(category, locale);
  const categoryDescription = nodeCategoryDescription(category, locale);
  const menuClassName = compact
    ? 'absolute left-1/2 top-9 z-50 w-80 -translate-x-1/2 rounded-lg border border-gray-700 bg-[#10151f] p-2 shadow-2xl'
    : 'absolute bottom-12 left-0 z-50 w-80 rounded-lg border border-gray-700 bg-[#10151f] p-2 shadow-2xl';

  const closeMenu = (target: EventTarget | null) => {
    const details = target instanceof Element ? target.closest('details') : null;
    if (details instanceof HTMLDetailsElement) {
      details.open = false;
    }
  };

  return (
    <details className="relative" data-node-category-menu="true">
      <summary
        aria-label={tf('flow.toolbar.openCategory', { name: categoryLabel })}
        className={compact
          ? 'theme-icon-button flex h-8 cursor-pointer list-none items-center gap-1 rounded-md border border-transparent px-2 text-cyan-100/75 transition-colors hover:border-cyan-300/25 hover:bg-cyan-400/10 hover:text-white [&::-webkit-details-marker]:hidden'
          : 'theme-button flex cursor-pointer list-none items-center gap-2 rounded-xl border border-transparent px-3 py-2 text-sm text-gray-300 transition-all duration-200 hover:border-gray-600 hover:bg-gray-700/50 hover:text-white [&::-webkit-details-marker]:hidden'}
        title={categoryDescription}
      >
        {CATEGORY_ICONS[category.id]}
        {/* Category labels show on standard-width monitors (≥1600px keeps labelled buttons on one
            row); below that the bar stays icon-only so 1080p/1440p don't wrap to a second row.
            (UX review F02: the old 3200px gate hid labels on virtually every laptop and monitor.) */}
        <span className={compact ? 'hidden min-[1600px]:inline' : undefined}>{categoryLabel}</span>
        <ChevronDown size={13} />
      </summary>
      <div className={menuClassName}>
        <div className="px-2 pb-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">{category.label}</div>
          <div className="mt-1 text-[11px] leading-4 text-gray-400">{category.description}</div>
        </div>
        <div className="grid max-h-[62vh] gap-1 overflow-y-auto pr-1">
          {entries.map((entry) => (
            <NodeEntryButton
              entry={entry}
              key={entry.type}
              onAdd={(event) => {
                onAddNode(entry.type, entry.initialData);
                closeMenu(event.currentTarget);
              }}
            />
          ))}
          {category.id === 'generate' ? (
            <>
              <PortableModelCardMenuItems
                closeMenu={closeMenu}
                onAddNode={onAddNode}
                records={providerPackRecords}
              />
              <ImageTemplateMenuItems
                closeMenu={closeMenu}
                onAddNode={onAddNode}
                templates={imageTemplates}
              />
            </>
          ) : null}
        </div>
      </div>
    </details>
  );
}

function PortableModelCardMenuItems({
  closeMenu,
  onAddNode,
  records,
}: {
  closeMenu: (target: EventTarget | null) => void;
  onAddNode: (type: FlowNodeType, initialData?: Partial<NodeData>) => void;
  records: ProviderPackRuntimeRecord[];
}) {
  const openSettings = useSettingsStore((state) => state.openSettings);
  const cards = records.flatMap((record) =>
    record.pack.cards.map((card) => ({ record, card }))
  ).slice(0, 80);
  return (
    <div className="mt-1 border-t border-gray-700/60 pt-1" data-portable-model-card-menu="true">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-cyan-200/60">Provider model cards</span>
        <button
          className="text-[9px] font-semibold text-cyan-300 hover:text-cyan-100"
          onClick={(event) => {
            openSettings('providers');
            closeMenu(event.currentTarget);
          }}
          type="button"
        >
          Connect / manage
        </button>
      </div>
      {cards.map(({ record, card }) => {
        const builtInEngine = record.pack.transports.find((transport) =>
          card.operations.some((operation) => operation.transportProfileId === transport.id)
          && transport.kind === 'built-in'
        )?.builtInEngineId;
        return (
          <button
            className="w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-cyan-500/10"
            key={`${record.hash}:${card.id}`}
            onClick={(event) => {
              onAddNode(
                nodeTypeForModelCard(card),
                createModelCardNodeData(
                  record.pack.packId,
                  record.pack.version,
                  record.hash,
                  card,
                  builtInEngine,
                ),
              );
              closeMenu(event.currentTarget);
            }}
            type="button"
          >
            <span className="block truncate text-xs font-semibold text-gray-100">{card.displayName}</span>
            <span className="mt-0.5 block truncate text-[9px] text-gray-500">
              {record.pack.provider.name} · {card.operations.map((operation) => operation.label).join(' / ')}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function NodeEntryButton({ entry, onAdd }: { entry: FlowNodeCatalogEntry; onAdd: (event: React.MouseEvent<HTMLButtonElement>) => void }) {
  const { tf, locale } = useI18n();
  const entryLabel = nodeCatalogEntryLabel(entry, locale);
  const addLabel = tf('flow.toolbar.addNode', { name: entryLabel });
  return (
    <div className="rounded-md px-0.5 py-0.5">
      <button
        aria-label={addLabel}
        className="w-full rounded-md px-2 py-1.5 text-left transition-colors hover:bg-blue-500/10"
        onClick={onAdd}
        title={addLabel}
        type="button"
      >
        <span className="block text-xs font-semibold text-gray-100">{entryLabel}</span>
        <span className="mt-0.5 block text-[10px] leading-4 text-gray-400">{nodeCatalogEntryDescription(entry, locale)}</span>
      </button>
      <NodeContractHelp initialData={entry.initialData} nodeType={entry.type} />
    </div>
  );
}

function ImageTemplateMenuItems({
  closeMenu,
  onAddNode,
  templates,
}: {
  closeMenu: (target: EventTarget | null) => void;
  onAddNode: (type: FlowNodeType, initialData?: Partial<NodeData>) => void;
  templates: ImageNodeTemplate[];
}) {
  const { t, tf, locale } = useI18n();
  return (
    <div className="mt-1 border-t border-gray-700/60 pt-1" data-image-provider-menu="true">
      <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-gray-500">
        {t('flow.toolbar.imageModelTemplates')}
      </div>
      {templates.map((template) => (
        <button
          aria-label={tf('flow.toolbar.addImageNode', { name: template.label })}
          className="w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-blue-500/10"
          key={template.id}
          onClick={(event) => {
            onAddNode('imageGen', createImageNodeTemplateDataPatch(template.id));
            closeMenu(event.currentTarget);
          }}
          title={tf('flow.toolbar.addImageNode', { name: template.label })}
          type="button"
        >
          <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-100"><Image size={12} />{template.label}</span>
          <span className="mt-0.5 block text-[10px] leading-4 text-gray-400">{imageNodeTemplateDescription(template, locale)}</span>
          <span className="mt-1 flex flex-wrap gap-1">
            {template.highlights.map((highlight) => (
              <span
                className="rounded border border-gray-700/70 bg-[#0d1118] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-400"
                key={highlight}
              >
                {imageNodeTemplateHighlight(highlight, locale)}
              </span>
            ))}
          </span>
        </button>
      ))}
    </div>
  );
}
