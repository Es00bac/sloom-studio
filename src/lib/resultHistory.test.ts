import { describe, expect, it } from 'vitest';
import {
  appendResultAttempt,
  resolveSelectedResultAttempt,
} from './resultHistory';

describe('appendResultAttempt', () => {
  it('appends a new attempt and makes it the active selection', () => {
    const first = appendResultAttempt([], {
      result: 'data:image/png;base64,AAA',
      resultType: 'image',
      statusMessage: 'Generated with model-a',
      usage: {
        source: 'actual',
        confidence: 'fixed',
        provider: 'gemini',
        modelId: 'model-a',
        costUsd: 0.039,
        imageCount: 1,
      },
    });
    const second = appendResultAttempt(first.attempts, {
      result: 'data:image/png;base64,BBB',
      resultType: 'image',
      statusMessage: 'Generated with model-b',
    });

    expect(first.attempts).toHaveLength(1);
    expect(second.attempts).toHaveLength(2);
    expect(second.selectedAttemptId).toBe(second.attempts[1].id);
    expect(second.attempts[0].result).toBe('data:image/png;base64,AAA');
    expect(second.attempts[0].usage?.costUsd).toBeCloseTo(0.039, 6);
    expect(second.attempts[1].result).toBe('data:image/png;base64,BBB');
  });
});

describe('resolveSelectedResultAttempt', () => {
  it('returns the requested attempt so the node can switch previews/runs', () => {
    const { attempts } = appendResultAttempt([], {
      result: 'first-result',
      resultType: 'text',
      statusMessage: 'First',
    });
    const next = appendResultAttempt(attempts, {
      result: 'second-result',
      resultType: 'text',
      statusMessage: 'Second',
    });

    expect(resolveSelectedResultAttempt(next.attempts, next.attempts[0].id)?.result).toBe('first-result');
    expect(resolveSelectedResultAttempt(next.attempts, next.attempts[1].id)?.result).toBe('second-result');
    expect(resolveSelectedResultAttempt(next.attempts, 'missing')).toBeUndefined();
  });

  it('preserves Boolean false and true when selecting an earlier verification run', () => {
    const failed = appendResultAttempt([], {
      result: false,
      resultType: 'boolean',
      statusMessage: 'Verified: FALSE',
    });
    const passed = appendResultAttempt(failed.attempts, {
      result: true,
      resultType: 'boolean',
      statusMessage: 'Verified: TRUE',
    });

    expect(resolveSelectedResultAttempt(passed.attempts, failed.selectedAttemptId)).toMatchObject({
      result: false,
      resultType: 'boolean',
    });
    expect(resolveSelectedResultAttempt(passed.attempts, passed.selectedAttemptId)).toMatchObject({
      result: true,
      resultType: 'boolean',
    });
  });
});
