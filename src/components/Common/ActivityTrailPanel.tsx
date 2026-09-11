import { Clock3, Command, Trash2 } from 'lucide-react';
import { DockableDialog } from '../DockablePanel';
import type { ActivityTrailEvent, ActivityTrailEventKind, ActivityTrailSource } from '../../lib/activityTrail';
import type { WorkspaceView } from '../../types/flow';

interface ActivityTrailPanelProps {
  events: ActivityTrailEvent[];
  open: boolean;
  onClose: () => void;
  onClear: () => void;
}

export function ActivityTrailPanel({
  events,
  open,
  onClose,
  onClear,
}: ActivityTrailPanelProps) {
  if (!open) return null;

  const content = (
    <ActivityTrailPanelContent
      events={events}
      onClear={onClear}
    />
  );

  if (typeof document === 'undefined') {
    return (
      <section aria-label="Activity Trail" role="dialog">
        {content}
      </section>
    );
  }

  return (
    <DockableDialog
      allowedDockZones={['overlay', 'right', 'left']}
      closeOnBackdrop={false}
      defaultFloatingRect={{ x: 940, y: 92, width: 420, height: 620 }}
      dialogId="activity-trail"
      minSize={{ width: 340, height: 360 }}
      modal={false}
      onClose={onClose}
      open={open}
      title="Activity Trail"
      workspaceId="app-dialogs"
    >
      {content}
    </DockableDialog>
  );
}

function ActivityTrailPanelContent({
  events,
  onClear,
}: {
  events: ActivityTrailEvent[];
  onClear: () => void;
}) {
  return (
    <div
      aria-label="Activity Trail"
      className="theme-card flex h-full min-h-0 flex-col bg-[#0b121d] text-cyan-50"
    >
      <header className="theme-header flex items-center justify-between gap-3 border-b border-cyan-300/15 bg-[#101722]/95 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Command className="h-4 w-4 shrink-0 text-cyan-200/75" />
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-white">Activity Trail</h2>
            <div className="text-xs text-cyan-100/45">{events.length} recent actions</div>
          </div>
        </div>
        <button
          className="theme-button flex items-center gap-2 rounded-md border border-cyan-300/15 bg-black/25 px-2.5 py-1.5 text-xs font-semibold text-cyan-100/80 transition-colors hover:border-cyan-300/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
          disabled={events.length === 0}
          onClick={onClear}
          type="button"
        >
          <Trash2 size={13} />
          Clear
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {events.length === 0 ? (
          <div className="flex h-full min-h-48 items-center justify-center rounded-md border border-dashed border-cyan-300/15 bg-black/15 px-5 text-center text-sm text-cyan-100/45">
            No activity recorded yet.
          </div>
        ) : (
          <div className="space-y-2">
            {events.map((event) => (
              <article
                className="rounded-md border border-cyan-300/12 bg-cyan-300/[0.045] px-3 py-2.5 shadow-sm shadow-black/20"
                key={event.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-semibold text-white">{event.label}</span>
                      <span className="rounded border border-cyan-300/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-normal text-cyan-100/45">
                        {workspaceLabel(event.workspace)}
                      </span>
                      <span className="rounded border border-cyan-300/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-normal text-cyan-100/45">
                        {kindLabel(event.kind)}
                      </span>
                    </div>
                    {event.detail ? (
                      <div className="mt-1 truncate font-mono text-[11px] text-cyan-100/45">
                        {event.detail}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1 text-[11px] text-cyan-100/45">
                    <span className="flex items-center gap-1">
                      <Clock3 size={12} />
                      {formatActivityTime(event.timestamp)}
                    </span>
                    {event.source ? <span>{sourceLabel(event.source)}</span> : null}
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function workspaceLabel(workspace: WorkspaceView): string {
  switch (workspace) {
    case 'editor':
      return 'Video';
    case 'flow':
      return 'Flow';
    case 'image':
      return 'Image';
    case 'paper':
      return 'Paper';
  }
}

function kindLabel(kind: ActivityTrailEventKind): string {
  switch (kind) {
    case 'app-action':
      return 'App';
    case 'command':
      return 'Command';
    case 'workspace':
      return 'Workspace';
    case 'system':
      return 'System';
  }
}

function sourceLabel(source: ActivityTrailSource): string {
  switch (source) {
    case 'keyboard':
    case 'shortcut':
      return 'Shortcut';
    case 'native-menu':
      return 'Native Menu';
    case 'palette':
      return 'Palette';
    case 'topbar':
      return 'Topbar';
    case 'toolbar':
      return 'Toolbar';
    case 'menu':
      return 'Menu';
    case 'system':
      return 'System';
  }
}

function formatActivityTime(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return '';
  }
}
