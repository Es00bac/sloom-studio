import type { WorkspaceView } from '../types/flow';

const SLOOM_STUDIO_PAPER_PREFIX = /^sloom studio(?: paper)?\s*(?:[—–-]|:)\s*/i;

const WORKSPACE_WINDOW_LABEL: Record<WorkspaceView, string> = {
  flow: 'Sloom Studio Flow',
  image: 'Sloom Studio Image',
  paper: 'Sloom Studio Paper',
  editor: 'Sloom Studio Video',
};

export function paperDocumentWindowLabel(title: string): string {
  const normalized = title.trim().replace(SLOOM_STUDIO_PAPER_PREFIX, '').trim();
  return normalized || 'Untitled Paper Layout';
}

export function buildWorkspaceWindowTitle(
  workspaceView: WorkspaceView,
  paperDocumentTitle: string,
  _licenseIsCommercial: boolean,
): string {
  if (workspaceView === 'paper') {
    const title = `${WORKSPACE_WINDOW_LABEL.paper} — ${paperDocumentWindowLabel(paperDocumentTitle)}`;
    return title;
  }
  const title = WORKSPACE_WINDOW_LABEL[workspaceView];
  return title;
}
