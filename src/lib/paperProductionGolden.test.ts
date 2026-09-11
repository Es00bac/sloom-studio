import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildPaperProductionGoldenFixture } from '../../test/fixtures/paper/production-golden';
import { exportValidatedPaperPdfx } from './paperProductionPreflight';

const outputDirectory = process.env.PAPER_PRODUCTION_OUTPUT_DIR;

describe('Paper production golden fixture', () => {
  it.each(['pdf-x-1a', 'pdf-x-4'] as const)('exports the production golden as %s', async (standard) => {
    const fixture = await buildPaperProductionGoldenFixture({ standard });
    const saved: Uint8Array[] = [];
    const result = await exportValidatedPaperPdfx(
      fixture.document,
      fixture.deps(standard, (bytes) => {
        saved.push(new Uint8Array(bytes));
      }),
    );

    expect(result.status, result.status === 'blocked' ? JSON.stringify(result.issues) : '').toBe('saved');
    if (result.status !== 'saved') return;

    expect(result.report.blockers).toEqual([]);
    expect(result.report.processObjects).toContain('exact-cmyk-panel');
    expect(result.report.spotPlates).toContain('PANTONE 185 C');
    expect(fixture.spotTints).toEqual([100, 50]);
    expect(result.report.overprintObjects).toContain('exact-cmyk-panel');
    expect(result.report.embeddedFonts.length).toBeGreaterThan(1);
    expect(result.report.imagePpi.every((entry) => entry.effectivePpi >= 300)).toBe(true);
    expect(result.report.imagePpi.every((entry) => entry.requiredPpi >= 300)).toBe(true);
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual(result.bytes);

    if (outputDirectory) {
      await mkdir(outputDirectory, { recursive: true });
      await writeFile(join(outputDirectory, `paper-production-golden-${standard}.pdf`), result.bytes);
    }
  }, 30_000);

  it.each(['pdf-x-1a', 'pdf-x-4'] as const)('is byte-stable for repeated %s generation', async (standard) => {
    const fixture = await buildPaperProductionGoldenFixture({ standard });
    const first = await exportValidatedPaperPdfx(fixture.document, fixture.deps(standard, () => undefined));
    const second = await exportValidatedPaperPdfx(fixture.document, fixture.deps(standard, () => undefined));

    expect(first.status).toBe('saved');
    expect(second.status).toBe('saved');
    if (first.status !== 'saved' || second.status !== 'saved') return;
    expect(first.bytes).toEqual(second.bytes);
  }, 30_000);
});
