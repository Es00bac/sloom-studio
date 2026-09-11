import type { AppLocale } from './i18n';
import type {
  NativeInterfaceLocaleState,
  NativeInterfaceLocaleUpdateRequest,
  NativeInterfaceLocaleUpdateResult,
} from './nativeApp';

export interface RendererLocalePreference {
  locale: AppLocale;
  localeChosen: boolean;
}

interface NativeLocaleSyncBridge {
  getNativeState: () => Promise<{ interfaceLocale?: NativeInterfaceLocaleState }>;
  setLocale: (request: NativeInterfaceLocaleUpdateRequest) => Promise<NativeInterfaceLocaleUpdateResult>;
  onInterfaceLocaleChanged: (callback: (state: NativeInterfaceLocaleState) => void) => () => void;
}

interface NativeLocaleSyncOptions {
  bridge: NativeLocaleSyncBridge;
  getLocalPreference: () => RendererLocalePreference;
  applyAuthoritativePreference: (preference: RendererLocalePreference) => void;
  subscribeLocalIntent: (callback: (preference: RendererLocalePreference) => void) => () => void;
}

function isPreference(value: unknown): value is RendererLocalePreference {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<RendererLocalePreference>;
  return (candidate.locale === 'en' || candidate.locale === 'ja')
    && typeof candidate.localeChosen === 'boolean';
}

export function isNativeInterfaceLocaleState(value: unknown): value is NativeInterfaceLocaleState {
  if (!isPreference(value)) return false;
  const candidate = value as Partial<NativeInterfaceLocaleState>;
  return candidate.owner === 'electron-main'
    && Number.isSafeInteger(candidate.revision)
    && (candidate.revision ?? -1) >= 0;
}

function samePreference(
  left: RendererLocalePreference | NativeInterfaceLocaleState,
  right: RendererLocalePreference | NativeInterfaceLocaleState,
): boolean {
  return left.locale === right.locale && left.localeChosen === right.localeChosen;
}

/**
 * Reconciles one renderer with Electron's process-owned interface-locale authority.
 *
 * The controller subscribes before reading startup state so it cannot miss an update from another
 * window. Revision 0 is seeded from this renderer's fully hydrated preference; after that, native
 * state wins unless this renderer has an explicit local intent waiting to commit. Stale responses
 * and out-of-order broadcasts only advance the local authority snapshot and are retried/ignored.
 */
export function createNativeLocaleSyncController(options: NativeLocaleSyncOptions) {
  const {
    bridge,
    getLocalPreference,
    applyAuthoritativePreference,
    subscribeLocalIntent,
  } = options;
  let authority: NativeInterfaceLocaleState | undefined;
  let desired: RendererLocalePreference | undefined;
  let dirty = false;
  let initialized = false;
  let stopped = false;
  let started = false;
  let task: Promise<void> = Promise.resolve();
  let removeNativeListener = () => {};
  let removeLocalListener = () => {};

  const acceptAuthority = (incoming: unknown): boolean => {
    if (!isNativeInterfaceLocaleState(incoming)) return false;
    if (authority) {
      if (incoming.revision < authority.revision) return false;
      if (incoming.revision === authority.revision && !samePreference(incoming, authority)) {
        return false;
      }
    }
    authority = { ...incoming };
    return true;
  };

  const applyAuthority = () => {
    if (!authority || stopped) return;
    const local = getLocalPreference();
    if (!samePreference(local, authority)) {
      applyAuthoritativePreference({
        locale: authority.locale,
        localeChosen: authority.localeChosen,
      });
    }
  };

  const reconcile = async () => {
    while (!stopped && initialized && dirty && desired && authority) {
      const requested = { ...desired };
      if (samePreference(requested, authority)) {
        dirty = false;
        applyAuthority();
        return;
      }

      let result: NativeInterfaceLocaleUpdateResult;
      try {
        result = await bridge.setLocale({
          ...requested,
          expectedRevision: authority.revision,
        });
      } catch {
        // A closing/crashed native bridge cannot safely claim success. Keep the renderer's current
        // preference and let a future mount reconcile from main's durable process state.
        return;
      }
      if (stopped) return;
      const previousRevision = authority.revision;
      acceptAuthority(result.current);

      if (desired && samePreference(desired, authority)) {
        dirty = false;
        applyAuthority();
        return;
      }
      if (
        result.rejected === 'invalid-request'
        || !authority
        || (result.rejected === 'stale-revision' && authority.revision === previousRevision)
      ) {
        dirty = false;
        applyAuthority();
        return;
      }
      // A newer authority rejected this stale revision. Retry the latest explicit local intent
      // against the returned revision; this is deterministic regardless of IPC response ordering.
    }
  };

  const scheduleReconcile = () => {
    task = task.then(reconcile, reconcile);
  };

  const handleNativeChange = (incoming: NativeInterfaceLocaleState) => {
    if (stopped || !acceptAuthority(incoming) || !initialized || !authority) return;
    if (dirty && desired && !samePreference(desired, authority)) {
      scheduleReconcile();
      return;
    }
    dirty = false;
    applyAuthority();
  };

  const handleLocalIntent = (preference: RendererLocalePreference) => {
    if (stopped || !isPreference(preference)) return;
    desired = { ...preference };
    dirty = true;
    if (initialized) scheduleReconcile();
  };

  const start = async () => {
    if (started || stopped) return;
    started = true;
    // Subscribe first: another renderer can change the process authority while native state is in
    // flight. acceptAuthority's monotonic check makes a later stale startup response harmless.
    removeNativeListener = bridge.onInterfaceLocaleChanged(handleNativeChange);
    removeLocalListener = subscribeLocalIntent(handleLocalIntent);

    let state: { interfaceLocale?: NativeInterfaceLocaleState };
    try {
      state = await bridge.getNativeState();
    } catch {
      return;
    }
    acceptAuthority(state.interfaceLocale);
    if (stopped || !authority) return;
    initialized = true;

    if (authority?.revision === 0) {
      desired = { ...getLocalPreference() };
      dirty = !samePreference(desired, authority);
      if (dirty) scheduleReconcile();
      else applyAuthority();
    } else if (dirty && desired) {
      scheduleReconcile();
    } else {
      applyAuthority();
    }
    await whenIdle();
  };

  const whenIdle = async () => {
    let observed: Promise<void>;
    do {
      observed = task;
      await observed;
    } while (observed !== task);
  };

  const stop = () => {
    if (stopped) return;
    stopped = true;
    removeNativeListener();
    removeLocalListener();
  };

  return {
    start,
    stop,
    whenIdle,
    getAuthority: () => authority && { ...authority },
  };
}
