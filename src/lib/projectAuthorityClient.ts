import type {
  NativeProjectAdoptResult,
  NativeProjectAdoptionConfirmation,
  NativeProjectAuthorityChangedEvent,
  NativeProjectAuthorityDescriptor,
  NativeProjectFileResult,
  NativeProjectSaveRejection,
} from './nativeApp';

export type ProjectAuthorityStaleReason =
  /** Another window saved a newer version of this project; reload to continue saving here. */
  | 'saved-elsewhere'
  /** The app switched to a different project (or blank project) from another window. */
  | 'switched-elsewhere'
  /** Adopting the canonical snapshot failed (e.g. a dirty Image document blocked replacement). */
  | 'adoption-failed'
  /** The main process rejected this window's save; local state no longer matches authority. */
  | 'save-rejected';

export interface ProjectAuthorityClientState {
  /** The authority this window last successfully adopted; undefined until first adoption. */
  claim?: NativeProjectAuthorityDescriptor;
  filePath?: string;
  /**
   * True when this window's stores are known not to match the authoritative project. A stale
   * window is read-only for project saves until adoption succeeds — the title/path alone never
   * grants write access.
   */
  stale: boolean;
  staleReason?: ProjectAuthorityStaleReason;
  lastRejection?: NativeProjectSaveRejection;
  lastError?: string;
}

export interface ProjectAuthoritySaveBlock {
  reason: ProjectAuthorityStaleReason;
  rejection?: NativeProjectSaveRejection;
}

export interface ProjectAuthorityClientOptions {
  /** This window's webContents id (or a getter for it), used to ignore self-initiated broadcast echoes. */
  selfWebContentsId?: number | (() => number | undefined);
  bridge: {
    adoptProject?: () => Promise<NativeProjectAdoptResult>;
    confirmProjectAdoption?: (
      claim: NativeProjectAuthorityDescriptor,
    ) => Promise<NativeProjectAdoptionConfirmation>;
  };
  /** Hydrate all workspace stores from a canonical snapshot (must preserve dirty-document guards). */
  restoreSnapshot: (result: NativeProjectAdoptResult) => Promise<void>;
  /** Reset all workspace stores to a blank project (must preserve dirty-document guards). */
  resetSnapshot: () => Promise<void>;
  onStateChanged?: (state: ProjectAuthorityClientState) => void;
}

export interface ProjectAuthorityAdoptionOutcome {
  ok: boolean;
  error?: string;
}

/**
 * Renderer-side half of the AUD-001 desktop project authority contract. Tracks which immutable
 * project identity/version this window has adopted, drives canonical snapshot adoption when
 * another window opens/saves/switches projects, and gates saves while the window is stale so a
 * stale renderer can never silently overwrite newer or unrelated project state.
 */
export class ProjectAuthorityClient {
  private readonly options: ProjectAuthorityClientOptions;
  private state: ProjectAuthorityClientState = { stale: false };
  /** Serializes adoption work so authority events are applied in arrival order. */
  private adoptionChain: Promise<void> = Promise.resolve();

  constructor(options: ProjectAuthorityClientOptions) {
    this.options = options;
  }

  getState(): ProjectAuthorityClientState {
    return { ...this.state };
  }

  getClaim(): NativeProjectAuthorityDescriptor | undefined {
    return this.state.claim ? { ...this.state.claim } : undefined;
  }

  isStale(): boolean {
    return this.state.stale;
  }

  /** Returns the reason saving is currently forbidden in this window, if any. */
  getSaveBlock(): ProjectAuthoritySaveBlock | undefined {
    if (!this.state.stale) {
      return undefined;
    }
    return {
      reason: this.state.staleReason ?? 'switched-elsewhere',
      rejection: this.state.lastRejection,
    };
  }

  /**
   * Hydrate this window from a committed snapshot (boot startup project, an open/clear this
   * window initiated, or a post-save canonical rehydration) and confirm adoption of its
   * authority. Runs on the client's adoption queue so it can never interleave with a
   * broadcast-driven adoption replacing the same stores. A hydration failure propagates to
   * the caller (which should mark the window stale) without recording any adoption.
   */
  async adoptSnapshot(
    target: { authority?: NativeProjectAuthorityDescriptor; filePath?: string },
    hydrate?: () => Promise<void>,
  ): Promise<void> {
    return this.enqueue(async () => {
      if (hydrate) {
        await hydrate();
      }
      if (target.authority) {
        await this.confirmAdoption({ ...target.authority, filePath: target.filePath });
      }
    });
  }

  /** Fold a save result back into authority state (writer auto-adoption or honest rejection). */
  applySaveResult(result: NativeProjectFileResult): void {
    if (result.canceled) {
      return;
    }
    if (result.rejected) {
      this.setState({
        ...this.state,
        stale: true,
        staleReason: 'save-rejected',
        lastRejection: result.rejected,
      });
      return;
    }
    if (result.authority) {
      this.setState({
        claim: { ...result.authority },
        filePath: result.filePath ?? result.authority.filePath,
        stale: false,
        staleReason: undefined,
        lastRejection: undefined,
        lastError: undefined,
      });
    }
  }

  /** Apply a broadcast authority change from another window, in arrival order. */
  handleAuthorityChanged(event: NativeProjectAuthorityChangedEvent): Promise<void> {
    return this.enqueue(async () => {
      const selfWebContentsId = typeof this.options.selfWebContentsId === 'function'
        ? this.options.selfWebContentsId()
        : this.options.selfWebContentsId;
      if (
        selfWebContentsId !== undefined
        && event.initiatorWebContentsId !== undefined
        && event.initiatorWebContentsId === selfWebContentsId
      ) {
        // Our own commit: the open/save result flow already adopted (or will).
        return;
      }
      if (this.claimMatches(event.authority)) {
        return;
      }
      if (event.reason === 'open' || event.reason === 'clear') {
        // A wholesale project switch: adopt the canonical snapshot in this window too, or
        // become explicitly stale/read-only if adoption is blocked (e.g. dirty documents).
        await this.pullAdoptUnlocked();
        return;
      }
      // 'save' / 'save-as': another window advanced the project on disk. Keep this window's
      // unsaved work, but mark it stale so it cannot silently overwrite the newer version.
      this.setState({
        ...this.state,
        stale: true,
        staleReason: 'saved-elsewhere',
      });
    });
  }

  /**
   * Pull and adopt the canonical current-project snapshot (the banner's "Reload from disk").
   * Restores every workspace store from authority state, then confirms adoption.
   */
  reloadFromDisk(): Promise<ProjectAuthorityAdoptionOutcome> {
    return this.enqueue(() => this.pullAdoptUnlocked());
  }

  /** Record that adoption failed outside the client (e.g. the boot or open restore threw). */
  noteAdoptionFailure(error?: string): void {
    this.setState({
      ...this.state,
      stale: true,
      staleReason: 'adoption-failed',
      lastError: error,
    });
  }

  private claimMatches(authority: NativeProjectAuthorityDescriptor): boolean {
    return Boolean(
      this.state.claim
      && this.state.claim.authorityId === authority.authorityId
      && this.state.claim.version === authority.version,
    );
  }

  private async pullAdoptUnlocked(): Promise<ProjectAuthorityAdoptionOutcome> {
    const { adoptProject } = this.options.bridge;
    if (!adoptProject) {
      this.noteAdoptionFailure('This desktop shell does not expose project adoption.');
      return { ok: false, error: 'This desktop shell does not expose project adoption.' };
    }
    try {
      const result = await adoptProject();
      if (result.document) {
        await this.options.restoreSnapshot(result);
      } else {
        await this.options.resetSnapshot();
      }
      const confirmed = await this.confirmAdoption({ ...result.authority, filePath: result.filePath });
      return confirmed
        ? { ok: true }
        : { ok: false, error: 'The project changed again while this window was adopting it.' };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The project snapshot could not be adopted.';
      this.noteAdoptionFailure(message);
      return { ok: false, error: message };
    }
  }

  private async confirmAdoption(claim: NativeProjectAuthorityDescriptor): Promise<boolean> {
    const { confirmProjectAdoption } = this.options.bridge;
    if (!confirmProjectAdoption) {
      // Legacy shell without the authority bridge: track the claim locally so the title stays
      // honest; main-side arbitration (when present) remains the actual gate.
      this.setState({
        claim: { ...claim },
        filePath: claim.filePath,
        stale: false,
        staleReason: undefined,
        lastRejection: undefined,
        lastError: undefined,
      });
      return true;
    }
    const confirmation = await confirmProjectAdoption(claim);
    if (!confirmation.ok) {
      // The authority moved on while we were adopting; a newer broadcast will re-drive us.
      this.setState({
        ...this.state,
        stale: true,
        staleReason: 'switched-elsewhere',
      });
      return false;
    }
    this.setState({
      claim: { ...claim },
      filePath: claim.filePath,
      stale: false,
      staleReason: undefined,
      lastRejection: undefined,
      lastError: undefined,
    });
    return true;
  }

  private setState(state: ProjectAuthorityClientState): void {
    this.state = state;
    this.options.onStateChanged?.(this.getState());
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const next = this.adoptionChain.then(run, run);
    this.adoptionChain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

export function createProjectAuthorityClient(
  options: ProjectAuthorityClientOptions,
): ProjectAuthorityClient {
  return new ProjectAuthorityClient(options);
}
