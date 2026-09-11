import { isAndroidLanServerAvailable, notifyLanProjectChange } from './androidLanServer';
import { getLocalDeviceId } from './deviceIdentity';
import { isServedLanSession } from './remoteHostClient';
import { registerProjectSyncChannel, type ProjectSyncChannel } from './projectSyncService';
import {
  applyTeamReviewOperation,
  createTeamReviewState,
  normalizeTeamReviewState,
  parseTeamReviewState,
  serializeTeamReviewState,
  TEAM_REVIEW_CHANNEL,
  type TeamReviewMember,
  type TeamReviewOperation,
  type TeamReviewState,
} from './teamReviewAuthority';

const STORAGE_KEY = 'sloom.team-review.authority.v1';
let initialized = false;
let state: TeamReviewState;
const subscribers = new Set<(next: TeamReviewState) => void>();

function ownerIdentity(): TeamReviewMember {
  return { actorId: getLocalDeviceId(), label: isAndroidLanServerAvailable() ? 'Phone' : 'Desktop browser', role: 'owner', joinedAt: Date.now() };
}

function readPersistedState(owner: TeamReviewMember): TeamReviewState {
  try {
    const text = globalThis.localStorage?.getItem(STORAGE_KEY);
    return text ? parseTeamReviewState(text, owner) : createTeamReviewState(owner);
  } catch {
    return createTeamReviewState(owner);
  }
}

function persist(next: TeamReviewState): void {
  try { globalThis.localStorage?.setItem(STORAGE_KEY, serializeTeamReviewState(next)); } catch { /* storage is optional */ }
}

function publishState(next: TeamReviewState): void {
  state = next;
  persist(next);
  for (const subscriber of subscribers) subscriber(state);
}

const teamReviewChannel: ProjectSyncChannel<TeamReviewState | TeamReviewOperation> = {
  id: TEAM_REVIEW_CHANNEL,
  applyRemote(change) {
    if (isState(change)) {
      publishState(normalizeTeamReviewState(change, ownerIdentity()));
      return true;
    }
    const result = applyTeamReviewOperation(state, change);
    if (!result.ok) return false;
    if (!result.duplicate) publishState(result.state);
    return true;
  },
  snapshot() {
    return state;
  },
};

export function initializeTeamReviewSync(): void {
  if (initialized) return;
  initialized = true;
  state = readPersistedState(ownerIdentity());
  registerProjectSyncChannel(teamReviewChannel);
}

export function getTeamReviewState(): TeamReviewState {
  if (!state) initializeTeamReviewSync();
  return state;
}

export function subscribeTeamReviewState(listener: (next: TeamReviewState) => void): () => void {
  if (!state) initializeTeamReviewSync();
  subscribers.add(listener);
  return () => subscribers.delete(listener);
}

/**
 * Dispatch through the phone authority. On the phone, the local reducer accepts then appends the op
 * to the shared monotonic log. On a served client, the authenticated LAN mutate route applies it at
 * the phone and the normal event subscriber mirrors the accepted result back here.
 */
export async function submitTeamReviewOperation(operation: TeamReviewOperation): Promise<boolean> {
  if (!state) initializeTeamReviewSync();
  if (isAndroidLanServerAvailable()) {
    const result = applyTeamReviewOperation(state, operation);
    if (!result.ok) return false;
    if (!result.duplicate) publishState(result.state);
    return result.duplicate || await notifyLanProjectChange(TEAM_REVIEW_CHANNEL, operation);
  }
  if (isServedLanSession()) return notifyLanProjectChange(TEAM_REVIEW_CHANNEL, operation);
  return false;
}

export function makeTeamReviewOperation(
  type: TeamReviewOperation['type'],
  fields: Omit<TeamReviewOperation, 'type' | 'opId' | 'actorId' | 'actorLabel' | 'baseRevision' | 'at'> = {},
): TeamReviewOperation {
  const device = { id: getLocalDeviceId(), label: isAndroidLanServerAvailable() ? 'Phone' : 'Desktop browser' };
  return {
    type,
    ...fields,
    opId: globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    actorId: device.id,
    actorLabel: device.label,
    baseRevision: getTeamReviewState().revision,
    at: Date.now(),
  } as TeamReviewOperation;
}

export function __resetTeamReviewSyncForTests(): void {
  initialized = false;
  subscribers.clear();
  state = undefined as unknown as TeamReviewState;
}

function isState(value: TeamReviewState | TeamReviewOperation): value is TeamReviewState {
  return Boolean(value && typeof value === 'object' && 'members' in value && 'threads' in value);
}
