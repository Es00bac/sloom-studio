import { describe, expect, it } from 'vitest';
import { getImageGenerationProgressDetail } from './imageGenerationProgress';

describe('getImageGenerationProgressDetail', () => {
  it('explains when the progress backdrop is synthetic because no partial frame is available', () => {
    expect(getImageGenerationProgressDetail(false)).toBe(
      'Synthetic progress backdrop; the provider returns the final image when it is ready.',
    );
  });

  it('explains when the previous image is blurred during a new run', () => {
    expect(getImageGenerationProgressDetail(true)).toBe(
      'Blurring the previous image while the provider renders the next final frame.',
    );
  });
});
