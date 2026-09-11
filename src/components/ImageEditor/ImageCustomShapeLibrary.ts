import type { CustomVectorShapePreset, ImageVectorShape } from '../../types/imageEditor';

const STORAGE_KEY = 'signal-loom:image-custom-shape-library:v1';
const MAX_RECORDS = 100;
const PRESET_KINDS = new Set<CustomVectorShapePreset['kind']>(['line', 'triangle', 'diamond', 'polygon', 'star']);

export interface ImageCustomShapeLibraryRecord {
  id: string;
  name: string;
  preset: CustomVectorShapePreset;
  fillColor: string;
  fillOpacity: number;
  strokeColor: string;
  strokeOpacity: number;
  strokeWidth: number;
  createdAt: number;
}

export function loadImageCustomShapeLibrary(storage: Storage | null = safeStorage()): ImageCustomShapeLibraryRecord[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isRecord).slice(0, MAX_RECORDS) : [];
  } catch { return []; }
}

export function saveImageCustomShapeLibraryRecord(
  input: Omit<ImageCustomShapeLibraryRecord, 'id' | 'createdAt'>,
  storage: Storage | null = safeStorage(),
): ImageCustomShapeLibraryRecord[] {
  const existing = loadImageCustomShapeLibrary(storage).filter((record) => record.name !== input.name);
  const next = [{ ...input, id: `shape-library-${Date.now()}`, createdAt: Date.now() }, ...existing].slice(0, MAX_RECORDS);
  persist(next, storage);
  return next;
}

export function deleteImageCustomShapeLibraryRecord(id: string, storage: Storage | null = safeStorage()): ImageCustomShapeLibraryRecord[] {
  const next = loadImageCustomShapeLibrary(storage).filter((record) => record.id !== id);
  persist(next, storage);
  return next;
}

export function shapeLibraryRecordFromVectorShape(name: string, shape: ImageVectorShape): Omit<ImageCustomShapeLibraryRecord, 'id' | 'createdAt'> | null {
  if (shape.kind !== 'path' || !shape.preset) return null;
  return { name: name.trim() || 'Custom shape', preset: { ...shape.preset }, fillColor: shape.fillColor, fillOpacity: shape.fillOpacity, strokeColor: shape.strokeColor, strokeOpacity: shape.strokeOpacity, strokeWidth: shape.strokeWidth };
}

function persist(records: ImageCustomShapeLibraryRecord[], storage: Storage | null): void {
  try { storage?.setItem(STORAGE_KEY, JSON.stringify(records)); } catch { /* local storage is optional */ }
}
function safeStorage(): Storage | null { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } }
function isRecord(value: unknown): value is ImageCustomShapeLibraryRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<ImageCustomShapeLibraryRecord>;
  const preset = record.preset as Partial<CustomVectorShapePreset> | undefined;
  return Boolean(
    typeof record.id === 'string'
    && typeof record.name === 'string'
    && preset
    && typeof preset.kind === 'string'
    && PRESET_KINDS.has(preset.kind as CustomVectorShapePreset['kind'])
    && (preset.polygonSides === undefined || isFiniteNumber(preset.polygonSides))
    && (preset.starInnerRadius === undefined || isFiniteNumber(preset.starInnerRadius))
    && typeof record.fillColor === 'string'
    && isFiniteNumber(record.fillOpacity)
    && typeof record.strokeColor === 'string'
    && isFiniteNumber(record.strokeOpacity)
    && isFiniteNumber(record.strokeWidth)
    && isFiniteNumber(record.createdAt)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
