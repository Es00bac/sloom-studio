/**
 * Shared echo guard for stores that participate in more than one project-sync channel.
 *
 * Video timeline data lives on Flow composition nodes, so an inbound Video patch also wakes the
 * Flow store subscription (and an inbound Flow snapshot wakes Video). A module-local boolean in
 * either channel cannot see the other channel's apply. This small re-entrant guard lets both policy
 * layers advance their baselines without publishing the inbound mutation back to the authority.
 */
let remoteApplyDepth = 0;

export function beginProjectSyncRemoteApply(): void {
  remoteApplyDepth += 1;
}

export function endProjectSyncRemoteApply(): void {
  remoteApplyDepth = Math.max(0, remoteApplyDepth - 1);
}

export function isProjectSyncRemoteApplyActive(): boolean {
  return remoteApplyDepth > 0;
}

/** Test-only: restore a clean guard after a deliberately interrupted apply. */
export function __resetProjectSyncRemoteApplyForTests(): void {
  remoteApplyDepth = 0;
}
