import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

describe('interface theme CSS coverage', () => {
  it('provides semantic themed classes for shared app surfaces and controls', () => {
    for (const className of [
      '.theme-card',
      '.theme-card-soft',
      '.theme-popover',
      '.theme-button',
      '.theme-button-accent',
      '.theme-icon-button',
      '.theme-input',
      '.theme-pill',
      '.theme-workspace-loading',
    ]) {
      expect(css).toContain(className);
    }
  });

  it('maps legacy hard-coded dark shell utilities back to theme variables', () => {
    for (const selector of [
      '[class*="bg-[#111217]"]',
      '[class*="bg-[#0d0f15]"]',
      '[class*="bg-[#10151f]"]',
      '[class*="bg-[#252830]"]',
      '[class*="border-gray-700"]',
      '[class*="text-gray-100"]',
      '[class*="text-gray-300"]',
      '[class*="text-cyan-100"]',
      '[class*="text-cyan-200"]',
      '[class*="bg-cyan-"]',
      '[class*="bg-blue-"]',
    ]) {
      expect(css).toContain(selector);
    }
  });
});
