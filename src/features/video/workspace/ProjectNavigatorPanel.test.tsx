/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeVideoSequenceNavigatorModel } from '../../../lib/videoSequenceNavigator';
import { ProjectNavigatorPanel, type ProjectNavigatorPanelProps } from './ProjectNavigatorPanel';

function createProps(dependent = false): ProjectNavigatorPanelProps {
  return {
    model: normalizeVideoSequenceNavigatorModel({
      bins: [{ id: 'edits', name: 'Edits', order: 0, collapsed: false }],
      sequences: [
        { id: 'main', name: 'Main Cut', binId: 'edits', durationMs: 65_000, frameRate: 24, createdAt: 1, updatedAt: 1 },
        { id: 'alt', name: 'Alternate', durationMs: 30_000, frameRate: 24, createdAt: 2, updatedAt: 2 },
      ],
      tabs: [{ sequenceId: 'main', pinned: false }], activeSequenceId: 'main',
      dependencies: dependent ? [{ id: 'delivery', requiredSequenceId: 'main', kind: 'delivery-job', label: 'Picture master delivery' }] : [],
    }),
    onCommand: vi.fn(),
  };
}

describe('ProjectNavigatorPanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('renders accessible tabs, bounded metadata status, bins, and sequence controls', () => {
    const markup = renderToStaticMarkup(<ProjectNavigatorPanel {...createProps()} />);
    expect(markup).toContain('aria-label="Project navigator"');
    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('2/128');
    expect(markup).toContain('metadata only');
    expect(markup).toContain('Move selected sequence to bin');
  });

  it('emits typed callbacks for bin, tab, activation, rename, duplicate, and safe delete groups', () => {
    const props = createProps();
    act(() => root.render(<ProjectNavigatorPanel {...props} />));

    changeInput('New bin name', 'Finishing');
    clickButton('Add bin');
    clickButton('Alternate');
    clickButton('Open Alternate in tab');
    clickButton('Rename');
    changeInput('Sequence name', 'Alternate Lock');
    clickButton('Save');
    clickButton('Duplicate');
    clickButton('Delete…');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('media sources remain');
    clickButton('Confirm delete');

    expect(props.onCommand).toHaveBeenCalledWith({ kind: 'create-bin', name: 'Finishing' });
    expect(props.onCommand).toHaveBeenCalledWith({ kind: 'activate-sequence', sequenceId: 'alt' });
    expect(props.onCommand).toHaveBeenCalledWith({ kind: 'open-tab', sequenceId: 'alt' });
    expect(props.onCommand).toHaveBeenCalledWith({ kind: 'rename-sequence', sequenceId: 'alt', name: 'Alternate Lock' });
    expect(props.onCommand).toHaveBeenCalledWith({ kind: 'duplicate-sequence', sequenceId: 'alt', suggestedName: 'Alternate Copy' });
    expect(props.onCommand).toHaveBeenCalledWith({ kind: 'delete-sequence', sequenceId: 'alt' });
  });

  it('shows dependency blockers and never emits a destructive command', () => {
    const props = createProps(true);
    act(() => root.render(<ProjectNavigatorPanel {...props} />));
    clickButton('Delete…');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('blocked by 1 project dependency');
    expect(container.textContent).toContain('Picture master delivery');
    expect(props.onCommand).not.toHaveBeenCalledWith(expect.objectContaining({ kind: 'delete-sequence' }));
  });

  function clickButton(label: string): void {
    const button = [...container.querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === label || candidate.getAttribute('aria-label') === label);
    expect(button, `button ${label}`).toBeDefined();
    act(() => button?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  }

  function changeInput(label: string, value: string): void {
    const input = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`);
    expect(input).not.toBeNull();
    act(() => {
      if (!input) return;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  }
});
