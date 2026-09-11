#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDashboardModel } from '../ops/dev-dashboard/dashboard-lib.mjs';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceRelativePath = 'src/components/ImageEditor/ImagePhotoshopParity.ts';
const artifactRelativePath = 'ops/dev-dashboard/artifacts/image-parity-run-snapshot-latest.json';
const artifactPath = join(repoRoot, artifactRelativePath);

if (isCliInvocation()) {
  await writeSnapshotArtifact();
}

export async function writeSnapshotArtifact({
  rootDir = repoRoot,
  artifact = artifactPath,
  artifactRelative = artifactRelativePath,
  sourceRelative = sourceRelativePath,
  now = new Date(),
} = {}) {
  const model = buildDashboardModel({ rootDir, now });
  const snapshot = buildSnapshot(model, { source: sourceRelative });
  validateSnapshot(snapshot);

  await mkdir(dirname(artifact), { recursive: true });
  await writeFile(artifact, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');

  const persisted = JSON.parse(await readFile(artifact, 'utf8'));
  validateSnapshot(persisted);

  const summary = {
    ok: true,
    artifact: artifactRelative,
    source: sourceRelative,
    rowCount: persisted.rowCount,
    averageProgress: persisted.averageProgress,
    highPriorityProgress: persisted.highPriorityProgress,
    statusCounts: persisted.statusCounts,
    top20LowestParityRows: persisted.top20LowestParityRows.length,
  };
  console.log(JSON.stringify(summary, null, 2));
  return persisted;
}

export function buildSnapshot(model, { source = sourceRelativePath } = {}) {
  const rows = normalizeSnapshotRows(model);
  const statusCounts = rows.reduce(
    (counts, row) => {
      counts[row.status] += 1;
      return counts;
    },
    { partial: 0, done: 0, remaining: 0 },
  );

  return {
    kind: 'image-parity-run-snapshot',
    generatedAt: model.generatedAt,
    source,
    unit: 'percent',
    rowCount: rows.length,
    averageProgress: model.imageParity.parityProgressPercent,
    highPriorityProgress: model.imageParity.highPriorityProgress,
    checklistAverage: model.imageParity.checklistAverage,
    highPriorityChecklistAverage: model.imageParity.highPriorityChecklistAverage,
    statusCounts,
    partialCount: statusCounts.partial,
    doneCount: statusCounts.done,
    remainingCount: statusCounts.remaining,
    rows,
    top20LowestParityRows: [...rows]
      .sort(compareLowestProgressRows)
      .slice(0, 20)
      .map((row, index) => ({
        ...lowestProgressRowSnapshot(row),
        rank: index + 1,
      })),
    caveat: 'Checklist-only snapshot: status and progress are completed Boolean checklist atoms divided by total checklist atoms. Manual estimates and verification confidence are intentionally omitted.',
  };
}

function normalizeSnapshotRows(model) {
  const features = Array.isArray(model.imageParityRun?.features) ? model.imageParityRun.features : [];
  const rows = features.map((feature) => {
    const progressPercent = featureProgress(feature);
    const status = featureStatus(feature, progressPercent);
    return {
      id: feature.id,
      area: feature.feature,
      priority: feature.priority,
      status,
      progressPercent,
      checklistCompleted: feature.checklist?.completed,
      checklistTotal: feature.checklist?.total,
      checklistRemaining: feature.checklist?.remaining,
      objective: feature.objective,
      currentState: feature.currentState,
      openChecklistItems: openChecklistItems(feature.checklist),
    };
  });
  if (rows.length === 0) {
    throw new Error('No Image parity run rows were available.');
  }
  return rows;
}

function compareLowestProgressRows(a, b) {
  return a.progressPercent - b.progressPercent
    || priorityRank(a.priority) - priorityRank(b.priority)
    || a.area.localeCompare(b.area)
    || a.id.localeCompare(b.id);
}

function lowestProgressRowSnapshot(row) {
  return {
    id: row.id,
    area: row.area,
    priority: row.priority,
    status: row.status,
    progressPercent: row.progressPercent,
    checklistCompleted: row.checklistCompleted,
    checklistTotal: row.checklistTotal,
    checklistRemaining: row.checklistRemaining,
    objective: row.objective,
    currentState: row.currentState,
    openChecklistItems: row.openChecklistItems,
  };
}

function featureProgress(feature) {
  const checklist = feature.checklist;
  if (checklist?.total > 0 && Number.isFinite(checklist.completed)) {
    return roundPercent((checklist.completed / checklist.total) * 100);
  }
  return roundPercent(Number(feature.progressPercent) || 0);
}

function featureStatus(feature, progressPercent) {
  const checklist = feature.checklist;
  if (checklist?.total > 0 && checklist.remaining === 0) return 'done';
  if (progressPercent >= 100) return 'done';
  if (feature.status === 'remaining') return 'remaining';
  return 'partial';
}

function openChecklistItems(checklist) {
  if (!Array.isArray(checklist?.items)) return [];
  return checklist.items
    .filter((item) => !item.complete)
    .map((item) => item.label);
}

function priorityRank(priority) {
  if (priority === 'high') return 0;
  if (priority === 'medium') return 1;
  if (priority === 'low') return 2;
  return 3;
}

export function validateSnapshot(snapshot) {
  const requiredFields = [
    'generatedAt',
    'rowCount',
    'averageProgress',
    'highPriorityProgress',
    'checklistAverage',
    'highPriorityChecklistAverage',
    'statusCounts',
    'rows',
    'top20LowestParityRows',
    'caveat',
  ];
  for (const field of requiredFields) {
    if (!(field in snapshot)) {
      throw new Error(`Snapshot missing ${field}.`);
    }
  }
  if (Number.isNaN(Date.parse(snapshot.generatedAt))) {
    throw new Error('Snapshot timestamp is not parseable.');
  }
  if (!Number.isInteger(snapshot.rowCount) || snapshot.rowCount <= 0) {
    throw new Error('Snapshot rowCount must be a positive integer.');
  }
  if (!Number.isFinite(snapshot.averageProgress) || !Number.isFinite(snapshot.highPriorityProgress)) {
    throw new Error('Snapshot averages must be finite numbers.');
  }
  if (snapshot.averageProgress !== snapshot.checklistAverage) {
    throw new Error('Snapshot averageProgress must match checklistAverage.');
  }
  const counts = snapshot.statusCounts;
  const statusTotal = counts.partial + counts.done + counts.remaining;
  if (statusTotal !== snapshot.rowCount) {
    throw new Error(`Snapshot status counts sum to ${statusTotal}, expected ${snapshot.rowCount}.`);
  }
  if (!Array.isArray(snapshot.top20LowestParityRows) || snapshot.top20LowestParityRows.length !== Math.min(20, snapshot.rowCount)) {
    throw new Error('Snapshot must include the top 20 lowest parity rows.');
  }
  if (!Array.isArray(snapshot.rows) || snapshot.rows.length !== snapshot.rowCount) {
    throw new Error('Snapshot rows must match rowCount.');
  }
  if (!String(snapshot.caveat).toLowerCase().includes('checklist-only')) {
    throw new Error('Snapshot caveat must state that this is checklist-only.');
  }
  for (const row of [...snapshot.rows, ...snapshot.top20LowestParityRows]) {
    if (!Number.isFinite(row.progressPercent)) {
      throw new Error(`Snapshot row ${row.id} missing progressPercent.`);
    }
    if (row.checklistTotal > 0 && row.checklistCompleted === row.checklistTotal && row.status !== 'done') {
      throw new Error(`Snapshot row ${row.id} is checklist-complete but not done.`);
    }
  }
}

function roundPercent(value) {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function isCliInvocation() {
  return process.argv[1] === fileURLToPath(import.meta.url);
}
