import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FlowWorkspaceSwitcher } from './FlowWorkspaceSwitcher';

describe('FlowWorkspaceSwitcher', () => {
  it('renders the Flow workspace picker and create action', () => {
    const onCreateWorkspace = vi.fn();
    const onSelectWorkspace = vi.fn();

    const html = renderToStaticMarkup(
      <FlowWorkspaceSwitcher
        activeWorkspaceId="alt"
        onCreateWorkspace={onCreateWorkspace}
        onSelectWorkspace={onSelectWorkspace}
        workspaces={[
          { id: 'main', name: 'Main Flow' },
          { id: 'alt', name: 'Alt Flow' },
        ]}
      />,
    );

    expect(html).toContain('aria-label="Flow workspace"');
    expect(html).toContain('Main Flow');
    expect(html).toContain('Alt Flow');
    expect(html).toContain('aria-label="New Flow workspace"');
  });
});
