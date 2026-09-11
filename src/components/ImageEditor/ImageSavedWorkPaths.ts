import type { ImageLayer, ImageSavedWorkPath, ImageVectorPathPoint } from '../../types/imageEditor';
import { createMask, setPolygon, type SelectionMask } from './SelectionMask';
import { getEditableVectorShape, getVectorPathDocumentPoints } from './ImageVectorShape';

export const MAX_SAVED_WORK_PATHS = 24;

export interface SavedWorkPathBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function sanitizeSavedWorkPathName(name: unknown): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim().slice(0, 80);
  return trimmed.length > 0 ? trimmed : null;
}

export function getNextSavedWorkPathName(existing: ImageSavedWorkPath[]): string {
  const usedNumbers = new Set(
    existing
      .map((path) => /^Path (\d+)$/.exec(path.name)?.[1])
      .filter((value): value is string => Boolean(value))
      .map(Number),
  );
  let next = 1;
  while (usedNumbers.has(next)) next += 1;
  return `Path ${next}`;
}

export function getUniqueSavedWorkPathName(baseName: string, existing: ImageSavedWorkPath[]): string {
  const names = new Set(existing.map((path) => path.name));
  if (!names.has(baseName)) return baseName;
  let suffix = 2;
  while (names.has(`${baseName} ${suffix}`)) suffix += 1;
  return `${baseName} ${suffix}`;
}

export function truncateSavedWorkPaths(paths: ImageSavedWorkPath[]): ImageSavedWorkPath[] {
  return paths.slice(-MAX_SAVED_WORK_PATHS);
}

/** Detaches a copy of a vector path layer's current geometry into an independent saved path. */
export function createSavedWorkPathFromLayer(
  layer: ImageLayer,
  existing: ImageSavedWorkPath[],
  preferredName?: string,
): ImageSavedWorkPath | null {
  const shape = getEditableVectorShape(layer);
  if (!shape || shape.kind !== 'path') return null;
  const points = getVectorPathDocumentPoints(layer);
  if (points.length < 2) return null;
  const name = sanitizeSavedWorkPathName(preferredName) ?? getUniqueSavedWorkPathName(layer.name, existing);
  const now = Date.now();
  return {
    id: `saved-path-${now}-${Math.floor(Math.random() * 1000)}`,
    name: getUniqueSavedWorkPathName(name, existing),
    kind: 'saved',
    closed: shape.closed,
    points: points.map((point) => ({ ...point })),
    createdAt: now,
    updatedAt: now,
  };
}

export function renameSavedWorkPath(
  path: ImageSavedWorkPath,
  name: string,
): ImageSavedWorkPath {
  return { ...path, name, updatedAt: Date.now() };
}

export function getSavedWorkPathBounds(path: Pick<ImageSavedWorkPath, 'points'>): SavedWorkPathBounds {
  if (path.points.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const xs = path.points.map((point) => point.x);
  const ys = path.points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Fills the saved path's polygon area into a fresh selection mask; requires 3+ points. */
export function savedWorkPathToSelectionMask(
  width: number,
  height: number,
  path: Pick<ImageSavedWorkPath, 'points'>,
): SelectionMask | null {
  if (path.points.length < 3) return null;
  const mask = createMask(width, height);
  setPolygon(mask, path.points.map((point): ImageVectorPathPoint => ({ x: point.x, y: point.y })));
  return mask;
}

export interface SavedWorkPathSelectionPlan {
  canApply: boolean;
  pathName: string;
  pointCount: number;
  summary: string;
  warnings: string[];
}

export function planSavedWorkPathToSelection(path: ImageSavedWorkPath): SavedWorkPathSelectionPlan {
  const canApply = path.points.length >= 3;
  return {
    canApply,
    pathName: path.name,
    pointCount: path.points.length,
    summary: canApply
      ? `Load "${path.name}" as a selection (${path.points.length} points).`
      : `"${path.name}" needs at least 3 points to become a selection.`,
    warnings: canApply ? [] : ['Saved path has fewer than 3 points and cannot be filled as a selection.'],
  };
}
