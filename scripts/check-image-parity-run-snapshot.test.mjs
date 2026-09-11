import { describe, expect, it } from 'vitest';
import { buildSnapshot, validateSnapshot } from './check-image-parity-run-snapshot.mjs';

describe('image parity run snapshot', () => {
  it('serializes checklist-complete rows as done without legacy estimate fields', () => {
    const model = {
      generatedAt: '2026-06-14T20:00:00.000Z',
      imageParity: {
        parityProgressPercent: 75,
        highPriorityProgress: 75,
        checklistAverage: 75,
        highPriorityChecklistAverage: 75,
      },
      imageParityRun: {
        features: [
          {
            id: 'brush-engine',
            feature: 'Brush / Eraser Engine',
            objective: 'Brush presets, tips, textures, dynamics, smoothing, symmetry, pressure and tilt response',
            status: 'done',
            priority: 'high',
            progressPercent: 100,
            currentState: 'Brush presets, tips, textures, dynamics, smoothing, symmetry, pressure and tilt response exist',
            checklist: {
              method: 'completed Boolean atoms / total Boolean atoms',
              total: 57,
              completed: 57,
              remaining: 0,
              progressPercent: 100,
              items: Array.from({ length: 57 }, (_, index) => ({
                id: `brush-engine:done:${index + 1}`,
                label: `Brush atom ${index + 1}`,
                complete: true,
              })),
            },
          },
          {
            id: 'text-tool',
            feature: 'Text Tool',
            objective: 'Live text and advanced typography',
            status: 'partial',
            priority: 'high',
            progressPercent: 50,
            currentState: 'Live text exists; advanced typography remains missing',
            checklist: {
              method: 'completed Boolean atoms / total Boolean atoms',
              total: 2,
              completed: 1,
              remaining: 1,
              progressPercent: 50,
              items: [
                { id: 'text-tool:done:1', label: 'Live text', complete: true },
                { id: 'text-tool:open:1', label: 'advanced typography', complete: false },
              ],
            },
          },
        ],
      },
    };

    const snapshot = buildSnapshot(model);
    validateSnapshot(snapshot);

    const brush = snapshot.rows.find((row) => row.id === 'brush-engine');
    expect(brush).toMatchObject({
      status: 'done',
      progressPercent: 100,
      checklistCompleted: 57,
      checklistTotal: 57,
    });
    expect(snapshot.statusCounts).toEqual({ partial: 1, done: 1, remaining: 0 });
    expect(snapshot.partialCount).toBe(1);
    expect(snapshot.doneCount).toBe(1);

    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain('parityEstimate');
    expect(serialized).not.toContain('verificationConfidence');
    expect(serialized).not.toContain('legacyEstimate');
    expect(serialized).not.toContain('auditAverage');
  });
});
