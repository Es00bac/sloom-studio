import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PaperPrintMarksControls } from './PaperPrintMarksControls';

describe('PaperPrintMarksControls', () => {
  it('keeps crop geometry hidden until crop marks are enabled while always exposing slug space', () => {
    const html = renderToStaticMarkup(
      <PaperPrintMarksControls
        jobInfo={{ jobName: '', jobNumber: '', client: '', author: '', notes: '' }}
        marks={{
          cropMarks: false,
          cropMarkLengthMm: 5,
          cropMarkOffsetMm: 2,
          cropMarkStrokePt: 0.25,
          registrationMarks: false,
          colorBars: false,
          slugAreaMm: 0,
        }}
        onChange={vi.fn()}
        onJobInfoChange={vi.fn()}
      />,
    );

    expect(html).toContain('data-paper-print-marks-controls="true"');
    expect(html).toContain('Include crop marks');
    expect(html).toContain('Reserved slug (mm)');
    expect(html).not.toContain('Length (mm)');
  });

  it('shows bounded crop mark geometry controls when enabled', () => {
    const html = renderToStaticMarkup(
      <PaperPrintMarksControls
        jobInfo={{ jobName: 'Summer catalog', jobNumber: 'CAT-42', client: 'Example Press', author: 'A. Operator', notes: 'Coated stock' }}
        marks={{
          cropMarks: true,
          cropMarkLengthMm: 5,
          cropMarkOffsetMm: 2,
          cropMarkStrokePt: 0.25,
          registrationMarks: true,
          colorBars: true,
          slugAreaMm: 12,
        }}
        onChange={vi.fn()}
        onJobInfoChange={vi.fn()}
      />,
    );

    expect(html).toContain('Length (mm)');
    expect(html).toContain('Offset (mm)');
    expect(html).toContain('Stroke (pt)');
    expect(html).toContain('min="2"');
    expect(html).toContain('max="20"');
    expect(html).toContain('Include registration marks');
    expect(html).toContain('Include CMYK color bars');
    expect(html).toContain('data-paper-slug-job-info="true"');
    expect(html).toContain('Summer catalog');
  });
});
