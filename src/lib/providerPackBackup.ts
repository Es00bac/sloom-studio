import type {
  CardColumnCountV1,
  FlowModelCardV1,
  ModelCardLayoutOverrideV1,
  ProviderPackSettingsBackupV1,
} from './providerPackContracts';
import { importProviderPack } from './providerPackPortability';

export function sanitizeProviderPackSettingsBackup(value: unknown): ProviderPackSettingsBackupV1 {
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new Error('Dynamic provider backup data has an unsupported schema.');
  }
  const packs = boundedBackupArray(value.packs, 512, 'provider packs').flatMap((entry) => {
    if (!isRecord(entry) || !isRecord(entry.pack)) return [];
    try {
      const { pack } = importProviderPack(JSON.stringify(entry.pack));
      return [{
        pack,
        sourceLabel: typeof entry.sourceLabel === 'string' ? entry.sourceLabel.slice(0, 512) : undefined,
      }];
    } catch {
      return [];
    }
  });
  const drafts = boundedBackupArray(value.drafts, 512, 'provider drafts').flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !isRecord(entry.pack)) return [];
    try {
      const { pack } = importProviderPack(JSON.stringify(entry.pack));
      return [{
        schemaVersion: 1 as const,
        id: entry.id.slice(0, 512),
        pack,
        createdAt: finiteBackupNumber(entry.createdAt),
        updatedAt: finiteBackupNumber(entry.updatedAt),
        revision: Math.max(1, Math.floor(finiteBackupNumber(entry.revision, 1))),
      }];
    } catch {
      return [];
    }
  });
  const personalLayouts = boundedBackupArray(value.personalLayouts, 5_000, 'personal layouts').flatMap((entry) => {
    if (
      !isRecord(entry)
      || entry.schemaVersion !== 1
      || typeof entry.packId !== 'string'
      || typeof entry.cardId !== 'string'
      || typeof entry.packHash !== 'string'
      || !isRecord(entry.override)
      || entry.override.schemaVersion !== 1
      || typeof entry.override.cardId !== 'string'
    ) return [];
    const override = sanitizePresentationOverride(entry.override, {
      id: entry.cardId,
      layout: {
        containers: Array.isArray(entry.override.containers)
          ? entry.override.containers.flatMap((container) =>
              isRecord(container) && typeof container.id === 'string' ? [{ id: container.id }] : []
            )
          : [],
        elements: Array.isArray(entry.override.elements)
          ? entry.override.elements.flatMap((element) =>
              isRecord(element) && typeof element.id === 'string' ? [{ id: element.id }] : []
            )
          : [],
      },
    });
    return [{
      schemaVersion: 1 as const,
      packId: entry.packId.slice(0, 256),
      cardId: entry.cardId.slice(0, 256),
      packHash: entry.packHash.slice(0, 128),
      override,
      updatedAt: finiteBackupNumber(entry.updatedAt),
    }];
  });
  const credentials = boundedBackupArray(value.credentials, 512, 'dynamic credentials').flatMap((entry) => {
    if (
      !isRecord(entry)
      || typeof entry.packId !== 'string'
      || typeof entry.slotId !== 'string'
      || typeof entry.approvedOrigin !== 'string'
      || typeof entry.value !== 'string'
      || entry.value.length > 65_536
    ) return [];
    try {
      const origin = new URL(entry.approvedOrigin);
      if (origin.origin !== entry.approvedOrigin || origin.username || origin.password) return [];
    } catch {
      return [];
    }
    return [{
      packId: entry.packId.slice(0, 256),
      slotId: entry.slotId.slice(0, 256),
      approvedOrigin: entry.approvedOrigin,
      value: entry.value,
    }];
  });
  return {
    schemaVersion: 1,
    packs,
    drafts,
    personalLayouts,
    credentials,
  };
}

export function sanitizePresentationOverride(
  value: unknown,
  card: Pick<FlowModelCardV1, 'id'> & {
    layout: {
      containers: Array<Pick<FlowModelCardV1['layout']['containers'][number], 'id'>>;
      elements: Array<Pick<FlowModelCardV1['layout']['elements'][number], 'id'>>;
    };
  },
): ModelCardLayoutOverrideV1 {
  const candidate = isRecord(value) ? value : {};
  const allowedContainers = new Set(card.layout.containers.map((container) => container.id));
  const allowedElements = new Set(card.layout.elements.map((element) => element.id));
  const width = typeof candidate.width === 'number' && Number.isFinite(candidate.width)
    ? Math.max(260, Math.min(1_040, candidate.width))
    : undefined;
  const fitTarget = ['1080p', '1440p', '4k'].includes(String(candidate.fitTarget))
    ? candidate.fitTarget as ModelCardLayoutOverrideV1['fitTarget']
    : undefined;
  const containers = Array.isArray(candidate.containers)
    ? candidate.containers.slice(0, 256).flatMap((entry) => {
        if (!isRecord(entry) || typeof entry.id !== 'string' || !allowedContainers.has(entry.id)) return [];
        return [{
          id: entry.id,
          order: finiteBackupNumber(entry.order, 0),
          ...(validColumns(entry.columns) ? { columns: entry.columns } : {}),
          ...(isRecord(entry.operationColumns) ? {
            operationColumns: Object.fromEntries(
              Object.entries(entry.operationColumns).filter(([, columns]) => validColumns(columns)),
            ) as Record<string, CardColumnCountV1>,
          } : {}),
          ...(typeof entry.collapsedByDefault === 'boolean' ? { collapsedByDefault: entry.collapsedByDefault } : {}),
          ...finitePresentationGeometry(entry),
        }];
      })
    : undefined;
  const elements = Array.isArray(candidate.elements)
    ? candidate.elements.slice(0, 1_024).flatMap((entry) => {
        if (
          !isRecord(entry)
          || typeof entry.id !== 'string'
          || !allowedElements.has(entry.id)
          || typeof entry.containerId !== 'string'
          || !allowedContainers.has(entry.containerId)
        ) return [];
        return [{
          id: entry.id,
          containerId: entry.containerId,
          order: finiteBackupNumber(entry.order, 0),
          ...(validColumns(entry.columnSpan) ? { columnSpan: entry.columnSpan } : {}),
          ...(typeof entry.hidden === 'boolean' ? { hidden: entry.hidden } : {}),
          ...finitePresentationGeometry(entry),
        }];
      })
    : undefined;
  const handlePlacements = Array.isArray(candidate.handlePlacements)
    ? candidate.handlePlacements.slice(0, 4_096).flatMap((entry) => {
        if (
          !isRecord(entry)
          || typeof entry.portId !== 'string'
          || !['card', 'element'].includes(String(entry.anchor))
          || !['left', 'right', 'top', 'bottom'].includes(String(entry.side))
          || typeof entry.offsetPercent !== 'number'
          || !Number.isFinite(entry.offsetPercent)
        ) return [];
        const elementId = entry.anchor === 'element' && typeof entry.elementId === 'string'
          && allowedElements.has(entry.elementId)
          ? entry.elementId
          : undefined;
        if (entry.anchor === 'element' && !elementId) return [];
        return [{
          portId: entry.portId.slice(0, 256),
          anchor: entry.anchor as 'card' | 'element',
          ...(elementId ? { elementId } : {}),
          side: entry.side as 'left' | 'right' | 'top' | 'bottom',
          offsetPercent: Math.max(0, Math.min(100, entry.offsetPercent)),
        }];
      })
    : undefined;
  return {
    schemaVersion: 1,
    cardId: card.id,
    ...(typeof candidate.operationId === 'string' ? { operationId: candidate.operationId.slice(0, 256) } : {}),
    ...(width === undefined ? {} : { width }),
    ...(fitTarget === undefined ? {} : { fitTarget }),
    ...(containers === undefined ? {} : { containers }),
    ...(elements === undefined ? {} : { elements }),
    ...(handlePlacements === undefined ? {} : { handlePlacements }),
  };
}

function boundedBackupArray(value: unknown, limit: number, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Dynamic ${label} backup data must be an array.`);
  if (value.length > limit) throw new Error(`Dynamic ${label} backup data exceeds its safety limit.`);
  return value;
}

function finiteBackupNumber(value: unknown, fallback = Date.now()): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function finitePresentationGeometry(
  value: Record<string, unknown>,
): Pick<NonNullable<ModelCardLayoutOverrideV1['elements']>[number], 'x' | 'y' | 'width' | 'height'> {
  return Object.fromEntries(
    ['x', 'y', 'width', 'height'].flatMap((key) =>
      typeof value[key] === 'number' && Number.isFinite(value[key])
        ? [[key, value[key]]]
        : []
    ),
  );
}

function validColumns(value: unknown): value is CardColumnCountV1 {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 14;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
