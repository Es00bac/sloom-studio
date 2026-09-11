import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * K3-4 shipping-caller gate: every print-package delivery pins a frozen linked-source identity
 * snapshot, builds the package from that snapshot, and re-asserts it immediately before the
 * durable browser download. Placed PDFs stay legitimate package content, so the caller must use
 * the identity-only guard, never the raster guard.
 */
describe('Paper print package delivery callers', () => {
  const source = readFileSync(new URL('./PaperWorkspace.tsx', import.meta.url), 'utf8');

  function packageCallSections(): string[] {
    const sections: string[] = [];
    let cursor = 0;
    for (;;) {
      const call = source.indexOf('buildPaperPackageExport(', cursor);
      if (call < 0) break;
      sections.push(source.slice(Math.max(0, call - 900), call + 900));
      cursor = call + 1;
    }
    return sections;
  }

  it('pins, builds from the pinned snapshot, and re-asserts before every package download', () => {
    const sections = packageCallSections();
    expect(sections.length).toBeGreaterThanOrEqual(2);
    for (const section of sections) {
      expect(section).toContain('createPaperLinkedSourceIdentityGuard');
      // The package is built from the guard's frozen snapshot, not live store items.
      expect(section).toMatch(/buildPaperPackageExport\([^,]+,\s*\[\.\.\.[A-Za-z]+Guard\.sourceItems\]/);
      // The identity assertion runs after the package exists and before the download delivers it.
      const build = section.indexOf('buildPaperPackageExport(');
      const assertCall = section.indexOf('Guard();', build);
      const download = section.indexOf('downloadBlob(', build);
      expect(assertCall).toBeGreaterThan(build);
      expect(download).toBeGreaterThan(assertCall);
    }
  });
});
