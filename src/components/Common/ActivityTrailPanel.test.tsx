import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ActivityTrailPanel } from './ActivityTrailPanel';

describe('ActivityTrailPanel', () => {
  it('renders recent activity with workspace, source, detail, and clear controls', () => {
    const html = renderToStaticMarkup(
      <ActivityTrailPanel
        events={[
          {
            id: 'event-1',
            timestamp: Date.parse('2026-06-04T12:00:00.000Z'),
            kind: 'command',
            workspace: 'editor',
            label: 'Cut Tool',
            command: 'timeline:cut',
            detail: 'timeline:cut',
            source: 'shortcut',
          },
        ]}
        onClear={() => undefined}
        onClose={() => undefined}
        open
      />,
    );

    expect(html).toContain('aria-label="Activity Trail"');
    expect(html).toContain('Activity Trail');
    expect(html).toContain('Cut Tool');
    expect(html).toContain('Video');
    expect(html).toContain('Shortcut');
    expect(html).toContain('timeline:cut');
    expect(html).toContain('Clear');
  });

  it('does not render while closed', () => {
    const html = renderToStaticMarkup(
      <ActivityTrailPanel events={[]} onClear={() => undefined} onClose={() => undefined} open={false} />,
    );

    expect(html).toBe('');
  });

  it('renders an empty state for a clean project', () => {
    const html = renderToStaticMarkup(
      <ActivityTrailPanel events={[]} onClear={() => undefined} onClose={() => undefined} open />,
    );

    expect(html).toContain('No activity recorded yet.');
  });
});
