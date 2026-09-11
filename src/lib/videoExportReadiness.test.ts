import { describe, expect, it } from 'vitest';
import { createEditorAudioClip, createEditorVisualClip } from './manualEditorState';
import { analyzeVideoExportReadiness } from './videoExportReadiness';

describe('videoExportReadiness', () => {
  it('blocks render readiness when timeline clips reference missing source media', () => {
    const visualClip = createEditorVisualClip('missing-image', 'image', { id: 'visual-missing' });
    const audioClip = createEditorAudioClip('missing-audio', 0);

    const readiness = analyzeVideoExportReadiness({
      hasComposition: true,
      visualClips: [visualClip],
      audioClips: [audioClip],
      stageObjectCount: 0,
      availableSourceIds: ['available-image'],
    });

    expect(readiness.summary).toEqual(expect.objectContaining({
      tone: 'error',
      label: 'Missing media',
      issueCount: 2,
    }));
    expect(readiness.summary.detail).toContain('2 missing timeline sources');
    expect(readiness.issues.map((issue) => issue.title)).toEqual([
      'Missing visual source',
      'Missing audio source',
    ]);
  });

  it('reports generic dirty-span plans as analysis-only until cached segment artifacts exist', () => {
    const readiness = analyzeVideoExportReadiness({
      hasComposition: true,
      visualClips: [createEditorVisualClip('source-image', 'image', { id: 'visual-ok' })],
      audioClips: [],
      stageObjectCount: 0,
      availableSourceIds: ['source-image'],
      dirtySpanSummary: 'Incremental render plan: 1/3 timeline spans changed.',
    });

    expect(readiness.summary).toEqual(expect.objectContaining({
      tone: 'info',
      label: 'Analysis only',
      issueCount: 1,
    }));
    expect(readiness.summary.detail).toContain('artifact-aware render-cache reuse requires cached segment artifacts');
    expect(readiness.issues[0]).toEqual(expect.objectContaining({
      severity: 'info',
      title: 'Dirty-span analysis only',
    }));
  });

  it('reports cache-hit summaries as real render cache state', () => {
    const readiness = analyzeVideoExportReadiness({
      hasComposition: true,
      visualClips: [createEditorVisualClip('source-image', 'image', { id: 'visual-ok' })],
      audioClips: [],
      stageObjectCount: 0,
      availableSourceIds: ['source-image'],
      dirtySpanSummary: 'Render cache hit: no timeline spans changed; reused the previous rendered preview.',
    });

    expect(readiness.summary).toEqual(expect.objectContaining({
      tone: 'info',
      label: 'Render cache',
      issueCount: 1,
    }));
    expect(readiness.summary.detail).toContain('reused the previous rendered preview');
    expect(readiness.summary.detail).not.toContain('requires cached segment artifacts');
    expect(readiness.issues[0]).toEqual(expect.objectContaining({
      severity: 'info',
      title: 'Render cache',
    }));
  });

  it('reports segment artifact reuse summaries as render cache state', () => {
    const readiness = analyzeVideoExportReadiness({
      hasComposition: true,
      visualClips: [createEditorVisualClip('source-image', 'image', { id: 'visual-ok' })],
      audioClips: [],
      stageObjectCount: 0,
      availableSourceIds: ['source-image'],
      dirtySpanSummary: 'Segment artifact reuse: 1 reusable cached span, 1 queued dirty span.',
    });

    expect(readiness.summary).toEqual(expect.objectContaining({
      tone: 'info',
      label: 'Render cache',
      issueCount: 1,
    }));
    expect(readiness.summary.detail).toContain('1 reusable');
    expect(readiness.summary.detail).not.toContain('requires cached segment artifacts');
    expect(readiness.issues[0]).toEqual(expect.objectContaining({
      severity: 'info',
      title: 'Render cache',
    }));
  });

  it('reports ready when renderable media is present and all timeline sources resolve', () => {
    const readiness = analyzeVideoExportReadiness({
      hasComposition: true,
      visualClips: [createEditorVisualClip('text-overlay', 'text', { id: 'text-ok', textContent: 'Title' })],
      audioClips: [],
      stageObjectCount: 0,
      availableSourceIds: [],
    });

    expect(readiness.summary).toEqual({
      tone: 'ready',
      label: 'Ready',
      detail: 'Video export sources are available.',
      issueCount: 0,
    });
  });

  it('surfaces the actionable bundled-face failure and blocks exact export readiness', () => {
    const readiness = analyzeVideoExportReadiness({
      hasComposition: true,
      visualClips: [createEditorVisualClip('text-overlay', 'text', { id: 'text-ok', textContent: 'Title' })],
      audioClips: [],
      stageObjectCount: 0,
      availableSourceIds: [],
      managedFontError: 'Liberation Sans face abc is unavailable or unauthorized. Reinstall the audited bundled font library.',
    });

    expect(readiness.summary).toMatchObject({ tone: 'error', label: 'Missing font', issueCount: 1 });
    expect(readiness.summary.detail).toMatch(/Liberation Sans.*unavailable or unauthorized.*Reinstall/i);
    expect(readiness.issues[0]).toMatchObject({ severity: 'error', title: 'Missing bundled font face' });
  });

  it('blocks preview and export while managed face registration is loading', () => {
    const readiness = analyzeVideoExportReadiness({
      hasComposition: true,
      visualClips: [],
      audioClips: [],
      stageObjectCount: 1,
      availableSourceIds: [],
      managedFontState: { status: 'loading' },
    });

    expect(readiness.summary).toMatchObject({ tone: 'error', label: 'Loading fonts', issueCount: 1 });
  });
});
