import { describe, expect, it } from 'vitest';
import { HELP_SECTIONS, getHelpSection } from './helpContent';

describe('help content', () => {
  it('provides project documentation, tutorial, feature help, and shortcuts sections', () => {
    expect(HELP_SECTIONS.map((section) => section.id)).toEqual([
      'project-documentation',
      'tutorial',
      'feature-help',
      'keyboard-shortcuts',
    ]);
  });

  it('keeps help menu sections populated with actionable content', () => {
    expect(getHelpSection('tutorial').groups.length).toBeGreaterThan(2);
    expect(getHelpSection('feature-help').groups.length).toBeGreaterThan(3);
    expect(getHelpSection('project-documentation').summary).toContain('Sloom Studio');
    expect(getHelpSection('project-documentation').summary).toContain('Flow');
    expect(getHelpSection('project-documentation').summary).toContain('Image');
    expect(getHelpSection('project-documentation').summary).toContain('Video');
    expect(getHelpSection('project-documentation').summary).toContain('Paper');
  });

  it('documents recovery, self-hosted sync boundaries, and honest render routing', () => {
    const projectDocumentation = getHelpSection('project-documentation');
    const content = projectDocumentation.groups.flatMap((group) => group.items).join('\n');

    expect(content).toContain('Autosave');
    expect(content).toContain('self-hosted');
    expect(content).toContain('VA-API');
    expect(content).toContain('general compositor');
    expect(content).toContain('durable render queue');
  });

  it('documents setup and cost expectations for advanced image providers', () => {
    const featureHelp = getHelpSection('feature-help');
    const cloudImageModels = featureHelp.groups.find((group) => group.title === 'Cloud Image Models');

    expect(cloudImageModels?.items.join('\n')).toContain('Black Forest Labs');
    expect(cloudImageModels?.items.join('\n')).toContain('Stability AI');
    expect(cloudImageModels?.items.join('\n')).toContain('Local/Open');
    expect(cloudImageModels?.items.join('\n')).toContain('cost');
  });

  it('documents Android accelerator setup and Paper print upscale behavior', () => {
    const featureHelp = getHelpSection('feature-help');
    const androidHelp = featureHelp.groups.find((group) => group.title === 'Android Accelerator Setup');

    expect(androidHelp?.items.join('\n')).toContain('companion');
    expect(androidHelp?.items.join('\n')).toContain('/v1/generate');
    expect(androidHelp?.items.join('\n')).toContain('/v1/upscale');
    expect(androidHelp?.items.join('\n')).toContain('Auto-upscale');
    expect(androidHelp?.items.join('\n')).toContain('$0 provider spend');
  });
});
