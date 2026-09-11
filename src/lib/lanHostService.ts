import type { SourceLibraryNativeChange } from './sourceLibraryNativeSync';
import {
  getProjectSyncEventsSince,
  getProjectSyncVersion,
  recordProjectSyncChange,
  resetProjectSyncLog,
  waitForProjectSyncEvents,
  type ProjectSyncEvent,
} from './projectSyncService';

/**
 * Phone-host side of "phone as data authority" (task #20 Phase B; design
 * `docs/notes/724-shared-state-design.md`). The phone is the single authority for the source library;
 * served desktop browsers tail its changes through a long-poll endpoint
 * (`GET /__loom/api/source-library/events`).
 *
 * As of task #50 (the unified op-sync core, `docs/notes/764`) this is a **thin source-library-flavored
 * facade** over the generic, workspace-agnostic `projectSyncService` — the source library is simply
 * channel `'source-library'` on the one monotonic version stream every workspace will ride. The public
 * surface here (channel-less `{ version, change }` events) is preserved verbatim so the existing served
 * client + wire format keep working unchanged; the only difference is the log now lives in the shared
 * core. New workspaces (Flow/Paper/Image) register their own channels directly on `projectSyncService`.
 *
 * The relay between NanoHTTPD and the WebView is strictly request→single-response, so a raw SSE stream
 * isn't possible over it. Long-poll is the faithful fit; the *semantics* match the desktop multi-window
 * sync (the client applies each event with `applySourceLibraryNativeChange`) — only the transport differs.
 */

/** The channel id the source library occupies on the shared op-sync stream. */
export const SOURCE_LIBRARY_SYNC_CHANNEL = 'source-library';

export interface HostEventsResult {
  version: number;
  events: HostSourceLibraryEvent[];
  gap: boolean;
}

export interface HostSourceLibraryEvent {
  version: number;
  change: SourceLibraryNativeChange;
}

/** Project the shared channel-tagged event back to the source-library's channel-less wire shape. */
function toSourceLibraryEvent(event: ProjectSyncEvent): HostSourceLibraryEvent {
  return { version: event.version, change: event.change as SourceLibraryNativeChange };
}

/** Current authority version — handed to a client when it seeds, then used as its long-poll cursor. */
export function getHostSourceLibraryVersion(): number {
  return getProjectSyncVersion();
}

/**
 * Record a source-library change as the next authority version and wake any parked long-poll waiters.
 * Called on the phone from the source-bin broadcast hooks and from an applied client `mutate`.
 */
export function recordHostSourceLibraryChange(change: SourceLibraryNativeChange): HostSourceLibraryEvent {
  return toSourceLibraryEvent(recordProjectSyncChange(SOURCE_LIBRARY_SYNC_CHANNEL, change));
}

/** Source-library events strictly newer than `since` (a client's last-applied version). */
export function getHostSourceLibraryEventsSince(since: number): HostSourceLibraryEvent[] {
  return getProjectSyncEventsSince(since, SOURCE_LIBRARY_SYNC_CHANNEL).map(toSourceLibraryEvent);
}

/**
 * Long-poll: resolve immediately with any source-library events newer than `since`, otherwise park
 * until the next source-library change or `timeoutMs` (a heartbeat that returns an empty batch).
 */
export function waitForHostSourceLibraryEvents(since: number, timeoutMs: number): Promise<HostEventsResult> {
  return waitForProjectSyncEvents(since, timeoutMs, SOURCE_LIBRARY_SYNC_CHANNEL).then((result) => ({
    version: result.version,
    events: result.events.map(toSourceLibraryEvent),
    gap: result.gap,
  }));
}

/** Test/teardown helper — reset the authority log to a pristine state. */
export function resetHostSourceLibraryLog(): void {
  resetProjectSyncLog();
}
