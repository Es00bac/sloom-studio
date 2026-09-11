import { describe, expect, it } from 'vitest';
import {
  aggregateUsageTelemetries,
  mergeUsageRollups,
  scaleUsageRollup,
  scaleUsageTelemetry,
  type UsageRollup,
} from './costEstimation';
import type { UsageTelemetry } from '../types/flow';

const baseTelemetry: UsageTelemetry = {
  source: 'estimate',
  confidence: 'heuristic',
  provider: 'bfl',
  modelId: 'flux-2-pro',
  inputTokens: 100,
  outputTokens: 0,
  totalTokens: 100,
  imageCount: 1,
  costUsd: 0.05,
  notes: ['base'],
};

describe('usage scaling helpers (FBL-017 follow-up)', () => {
  it('scales a usage telemetry by a positive factor', () => {
    const scaled = scaleUsageTelemetry(baseTelemetry, 3);

    expect(scaled.inputTokens).toBe(300);
    expect(scaled.imageCount).toBe(3);
    expect(scaled.costUsd).toBeCloseTo(0.15);
    expect(scaled.notes).toEqual(['base']);
  });

  it('scales a usage telemetry to zero when all iterations are resumable', () => {
    const scaled = scaleUsageTelemetry(baseTelemetry, 0);

    expect(scaled.inputTokens).toBe(0);
    expect(scaled.imageCount).toBe(0);
    expect(scaled.costUsd).toBe(0);
    expect(scaled.notes?.some((note) => note.includes('resumable'))).toBe(true);
  });

  it('scales a usage rollup, including unknown-cost counts', () => {
    const unknownTelemetry: UsageTelemetry = {
      ...baseTelemetry,
      costUsd: undefined,
    };
    const rollup = aggregateUsageTelemetries([baseTelemetry, unknownTelemetry]);
    const scaled = scaleUsageRollup(rollup, 2);

    expect(scaled.totalKnownCostUsd).toBeCloseTo(0.1);
    expect(scaled.inputTokens).toBe(400);
    expect(scaled.imageCount).toBe(4);
    expect(scaled.knownCostCount).toBe(2);
    expect(scaled.unknownCostCount).toBe(2);
  });

  it('merges dependency and scaled target rollups', () => {
    const dependencyRollup: UsageRollup = {
      totalKnownCostUsd: 0.1,
      inputTokens: 200,
      outputTokens: 0,
      totalTokens: 200,
      characters: 0,
      durationSeconds: 0,
      imageCount: 2,
      knownCostCount: 1,
      unknownCostCount: 0,
    };
    const targetRollup: UsageRollup = {
      totalKnownCostUsd: 0.05,
      inputTokens: 100,
      outputTokens: 0,
      totalTokens: 100,
      characters: 0,
      durationSeconds: 0,
      imageCount: 1,
      knownCostCount: 1,
      unknownCostCount: 0,
    };

    const merged = mergeUsageRollups(dependencyRollup, scaleUsageRollup(targetRollup, 3));

    expect(merged.totalKnownCostUsd).toBeCloseTo(0.25);
    expect(merged.inputTokens).toBe(500);
    expect(merged.imageCount).toBe(5);
  });
});
