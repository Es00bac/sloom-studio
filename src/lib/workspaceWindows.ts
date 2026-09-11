import type { WorkspaceView } from '../types/flow';

export const WORKSPACE_WINDOW_VIEWS = ['flow', 'editor', 'image', 'paper'] as const satisfies readonly WorkspaceView[];

export type WorkspaceWindowView = typeof WORKSPACE_WINDOW_VIEWS[number];

const WORKSPACE_LABELS: Record<WorkspaceWindowView, string> = {
  flow: 'Flow',
  editor: 'Video',
  image: 'Image',
  paper: 'Paper',
};

export function isWorkspaceWindowView(value: unknown): value is WorkspaceWindowView {
  return typeof value === 'string' && WORKSPACE_WINDOW_VIEWS.includes(value as WorkspaceWindowView);
}

export function parseWorkspaceWindowSearch(search: string): WorkspaceWindowView | undefined {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const workspace = params.get('workspace');
  return isWorkspaceWindowView(workspace) ? workspace : undefined;
}

export function getWorkspaceWindowLabel(workspace: WorkspaceWindowView): string {
  return WORKSPACE_LABELS[workspace];
}

export function getWorkspaceWindowTitle(workspace: WorkspaceWindowView, appName = 'Sloom Studio'): string {
  return `${appName} - ${getWorkspaceWindowLabel(workspace)}`;
}

export function buildWorkspaceWindowUrl(baseUrl: string, workspace: WorkspaceWindowView): string {
  const url = new URL(baseUrl);
  url.searchParams.set('workspace', workspace);
  return url.toString();
}
