import { Plus } from 'lucide-react';

export interface FlowWorkspaceSwitcherProps {
  activeWorkspaceId?: string;
  onCreateWorkspace: () => void;
  onSelectWorkspace: (id: string) => void;
  workspaces: Array<{
    id: string;
    name: string;
  }>;
}

export function FlowWorkspaceSwitcher({
  activeWorkspaceId,
  onCreateWorkspace,
  onSelectWorkspace,
  workspaces,
}: FlowWorkspaceSwitcherProps) {
  const selectedWorkspaceId = activeWorkspaceId ?? workspaces[0]?.id ?? '';

  return (
    <div className="theme-control flex items-center gap-2 rounded-full border px-2 py-1.5">
      <label className="sr-only" htmlFor="flow-workspace-switcher">
        Flow workspace
      </label>
      <select
        aria-label="Flow workspace"
        className="w-28 min-w-0 bg-transparent px-2 py-1 text-sm text-cyan-100/80 outline-none min-[1000px]:w-auto min-[1000px]:min-w-[9rem]"
        id="flow-workspace-switcher"
        onChange={(event) => onSelectWorkspace(event.target.value)}
        value={selectedWorkspaceId}
      >
        {workspaces.map((workspace) => (
          <option
            className="bg-slate-950 text-white"
            key={workspace.id}
            value={workspace.id}
          >
            {workspace.name}
          </option>
        ))}
      </select>

      <button
        aria-label="New Flow workspace"
        className="rounded-full p-2 text-cyan-100/75 transition-colors hover:bg-cyan-400/10 hover:text-white"
        onClick={onCreateWorkspace}
        title="New Flow workspace"
        type="button"
      >
        <Plus size={16} />
      </button>
    </div>
  );
}
