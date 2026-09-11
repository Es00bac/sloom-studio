'use strict';

// Desktop project authority arbitration (AUD-001).
//
// The Electron main process holds one authoritative project at a time. Every open/switch/
// Save As/first-save mints an IMMUTABLE identity token (`authorityId`) bound to the native
// file path, and every accepted save advances a MONOTONIC content version. Renderers must
// pull and hydrate the canonical snapshot, then confirm adoption, before their saves
// authorize — so a renderer that still holds another project's stores (or an older version
// of this one) can never overwrite newer or unrelated state on disk. Rejections never touch
// disk, never move the current path, and never advance the version.
//
// This module is pure (no Electron imports): main.mjs injects the dialog/disk/broadcast IO,
// which keeps the complete arbitration testable from vitest with simulated renderer clients.

/**
 * Accepts both the authority-aware save payload ({ document, claim }) and the legacy shape
 * where the renderer sent the raw project document. Legacy payloads carry no claim, so they
 * are rejected as 'unopened' rather than being written blindly.
 */
function normalizeProjectSavePayload(payload) {
  if (payload && typeof payload === 'object' && 'document' in payload) {
    const wrapped = payload;
    return {
      document: wrapped.document,
      claim: wrapped.claim && typeof wrapped.claim === 'object' ? wrapped.claim : undefined,
    };
  }
  return { document: payload, claim: undefined };
}

function isClaimShape(claim) {
  return Boolean(
    claim
    && typeof claim === 'object'
    && typeof claim.authorityId === 'string'
    && claim.authorityId.length > 0
    && Number.isInteger(claim.version),
  );
}

function createProjectAuthority({ mintAuthorityId, broadcast } = {}) {
  let mintCounter = 0;
  const mint = typeof mintAuthorityId === 'function'
    ? mintAuthorityId
    : () => `project-authority-${(mintCounter += 1)}-${Math.random().toString(36).slice(2, 10)}`;
  const emit = typeof broadcast === 'function' ? broadcast : () => undefined;

  /** The one authoritative project: immutable identity + monotonic accepted-save version. */
  let current = { authorityId: mint(), version: 1, filePath: undefined };
  /** Canonical snapshot is coupled to `current`; adoption never reads main globals separately. */
  let canonical = { filePath: undefined, scratchDirectoryPath: undefined, document: undefined };
  /** senderId (webContents id) -> the authority descriptor that renderer confirmed adopting. */
  const adoptions = new Map();
  /** Serializes every project mutation so validation and disk writes are atomic. */
  let mutationChain = Promise.resolve();
  let preparedSwitchCounter = 0;
  /**
   * A prepared Open/New keeps the mutation lease until its initiating renderer either commits
   * or cancels. Native authority therefore remains on A while the renderer performs every
   * fallible decode/migration/hydration step for B. The token never grants authority by itself:
   * it is bound to the sender id, renderer epoch, and exact pre-switch claim.
   */
  const preparedSwitches = new Map();

  async function acquireMutationLease() {
    const previous = mutationChain;
    let release;
    mutationChain = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      release();
    };
  }

  async function runExclusive(task) {
    const release = await acquireMutationLease();
    try {
      return await task();
    } finally {
      release();
    }
  }

  function getCurrent() {
    return { ...current };
  }

  function describeCurrentFile() {
    return current.filePath ? `"${current.filePath}"` : 'an unsaved blank project';
  }

  function buildRejection(code, message) {
    return {
      ok: false,
      rejected: { code, message, current: getCurrent() },
    };
  }

  function senderIsLive(isSenderLive) {
    return typeof isSenderLive !== 'function' || isSenderLive();
  }

  function authorizeSave(senderId, claim, rendererEpoch = 0, isSenderLive) {
    if (!senderIsLive(isSenderLive)) {
      return buildRejection(
        'sender-gone',
        'This window was reloaded, navigated, or closed before its request completed, so saving was stopped.',
      );
    }
    if (!isClaimShape(claim)) {
      return buildRejection(
        'unopened',
        'This window has not finished adopting the current project, so saving was stopped before anything was written. '
        + 'Wait for the project to finish loading, or reload the project from disk.',
      );
    }
    if (claim.authorityId !== current.authorityId) {
      return buildRejection(
        'switched',
        `The application project changed to ${describeCurrentFile()} after this window last loaded its project. `
        + 'Saving was stopped so this window\'s older workspace state could not overwrite it. '
        + 'Reload the project from disk to continue working here.',
      );
    }
    if (claim.version !== current.version) {
      return buildRejection(
        'stale',
        'This project was saved from another window after this window last loaded it. '
        + 'Saving was stopped so those newer changes were not overwritten. '
        + 'Reload the project from disk to continue working here.',
      );
    }
    const adopted = adoptions.get(senderId);
    if (!adopted || adopted.authorityId !== current.authorityId || adopted.version !== current.version || adopted.rendererEpoch !== rendererEpoch) {
      return buildRejection(
        'unauthorized',
        'This window has not confirmed adopting the current project state, so saving was stopped. '
        + 'Reload the project from disk to continue working here.',
      );
    }
    return { ok: true };
  }

  function recordAdoption(senderId, rendererEpoch = 0) {
    adoptions.set(senderId, { authorityId: current.authorityId, version: current.version, rendererEpoch });
  }

  // A project operation may prepare arbitrary asynchronous I/O, but its externally visible
  // effects must not begin until this closed commit section.  Main supplies staged operations
  // whose commit/rollback methods are synchronous (rename/write only); that leaves no event-loop
  // turn in which a renderer can die after the target changed but before authority advances.
  function asStagedResult(result) {
    if (result && typeof result === 'object' && typeof result.commit === 'function') {
      return result;
    }
    return { result, commit: () => result, rollback: () => undefined };
  }

  function safelyEmit(event) {
    try {
      emit(event);
    } catch {
      // Observers are never part of authority publication. A bad BrowserWindow listener must
      // not reject an operation that has already committed its canonical snapshot.
    }
  }

  function publishAtomically(snapshot, previous, publish, restorePublish) {
    try {
      if (publish) publish(snapshot);
      return true;
    } catch (error) {
      try {
        if (restorePublish) restorePublish(previous);
      } catch {
        // Best effort only; the gateway itself is restored by the caller below.
      }
      return false;
    }
  }

  function publicPreparedResult(transactionId, staged, kind) {
    const result = staged.result && typeof staged.result === 'object' ? staged.result : {};
    const { preparedPublication: _preparedPublication, ...publicResult } = result;
    return {
      ...publicResult,
      transactionId,
      kind,
      baseAuthority: getCurrent(),
    };
  }

  async function rollbackPreparedSwitch(transactionId, prepared) {
    preparedSwitches.delete(transactionId);
    try {
      await prepared.staged.rollback();
    } catch {
      // The reservation still has to release: rollback journals are best-effort after their
      // own exact-byte restoration attempts, and may not strand every future project mutation.
    } finally {
      prepared.release();
    }
  }

  async function prepareSwitch({
    kind,
    senderId,
    rendererEpoch = 0,
    isSenderLive,
    claim,
    prepare,
  }) {
    const release = await acquireMutationLease();
    let staged;
    try {
      const authorization = authorizeSave(senderId, claim, rendererEpoch, isSenderLive);
      if (!authorization.ok) {
        release();
        return { canceled: false, rejected: authorization.rejected };
      }
      staged = asStagedResult(await prepare());
      const recheck = authorizeSave(senderId, claim, rendererEpoch, isSenderLive);
      if (!recheck.ok) {
        try { await staged.rollback(); } catch {}
        release();
        return { canceled: false, rejected: recheck.rejected };
      }
      const transactionId = `project-switch-${++preparedSwitchCounter}-${Math.random().toString(36).slice(2, 10)}`;
      preparedSwitches.set(transactionId, {
        kind,
        senderId,
        rendererEpoch,
        isSenderLive,
        claim: { ...claim },
        staged,
        release,
      });
      return publicPreparedResult(transactionId, staged, kind);
    } catch (error) {
      if (staged) {
        try { await staged.rollback(); } catch {}
      }
      release();
      return {
        canceled: false,
        rejected: buildRejection(
          'prepare-failed',
          error instanceof Error ? error.message : 'Project preparation failed.',
        ).rejected,
      };
    }
  }

  async function commitPreparedSwitch({ transactionId, senderId, rendererEpoch = 0, publish, restorePublish }) {
    const prepared = preparedSwitches.get(transactionId);
    if (!prepared || prepared.senderId !== senderId || prepared.rendererEpoch !== rendererEpoch) {
      return {
        canceled: false,
        rejected: buildRejection('invalid-transaction', 'This prepared project switch is missing, stale, or belongs to another window.').rejected,
      };
    }
    const authorization = authorizeSave(
      senderId,
      prepared.claim,
      rendererEpoch,
      prepared.isSenderLive,
    );
    if (!authorization.ok) {
      await rollbackPreparedSwitch(transactionId, prepared);
      return { canceled: false, rejected: authorization.rejected };
    }

    const previous = { current, canonical };
    try {
      const committed = prepared.staged.commit();
      if (prepared.kind === 'open') {
        current = { authorityId: mint(), version: 1, filePath: committed.filePath };
        canonical = {
          filePath: committed.filePath,
          scratchDirectoryPath: committed.scratchDirectoryPath,
          document: committed.document,
        };
      } else {
        current = { authorityId: mint(), version: 1, filePath: undefined };
        canonical = { filePath: undefined, scratchDirectoryPath: undefined, document: undefined };
      }
      const snapshot = { ...canonical, authority: getCurrent(), preparedPublication: committed?.preparedPublication };
      if (!publishAtomically(snapshot, { ...previous.canonical, authority: { ...previous.current } }, publish, restorePublish)) {
        throw new Error('Project publication failed.');
      }
      preparedSwitches.delete(transactionId);
      prepared.release();
      safelyEmit({
        authority: getCurrent(),
        reason: prepared.kind === 'open' ? 'open' : 'clear',
        initiatorWebContentsId: senderId,
      });
      return {
        canceled: false,
        ...(committed && typeof committed === 'object'
          ? Object.fromEntries(Object.entries(committed).filter(([key]) => key !== 'preparedPublication'))
          : {}),
        ok: true,
        authority: getCurrent(),
      };
    } catch (error) {
      current = previous.current;
      canonical = previous.canonical;
      await rollbackPreparedSwitch(transactionId, prepared);
      return {
        canceled: false,
        ok: false,
        rejected: buildRejection(
          'commit-failed',
          error instanceof Error ? error.message : 'Project commit failed.',
        ).rejected,
      };
    }
  }

  return {
    getCurrent,
    authorizeSave,

    prepareOpenProject(request) {
      return prepareSwitch({ ...request, kind: 'open', prepare: request.load });
    },

    prepareClearProject(request) {
      return prepareSwitch({
        ...request,
        kind: 'clear',
        prepare: request.reset ?? (() => undefined),
      });
    },

    commitPreparedProject: commitPreparedSwitch,

    async cancelPreparedProject({ transactionId, senderId, rendererEpoch = 0 }) {
      const prepared = preparedSwitches.get(transactionId);
      if (!prepared || prepared.senderId !== senderId || prepared.rendererEpoch !== rendererEpoch) {
        return { ok: false };
      }
      await rollbackPreparedSwitch(transactionId, prepared);
      return { ok: true };
    },

    runAuthorizedMutation({ senderId, rendererEpoch = 0, isSenderLive, claim, prepare, commit, rollback }) {
      return runExclusive(async () => {
        const authorization = authorizeSave(senderId, claim, rendererEpoch, isSenderLive);
        if (!authorization.ok) return { ok: false, rejected: authorization.rejected, error: authorization.rejected.message };
        let prepared;
        try {
          prepared = await prepare();
          const recheck = authorizeSave(senderId, claim, rendererEpoch, isSenderLive);
          if (!recheck.ok) {
            try { if (rollback) await rollback(prepared); } catch {}
            return { ok: false, rejected: recheck.rejected, error: recheck.rejected.message };
          }
          return commit(prepared);
        } catch (error) {
          try { if (rollback && prepared !== undefined) await rollback(prepared); } catch {}
          return { ok: false, error: error instanceof Error ? error.message : 'Project mutation failed.' };
        }
      });
    },

    replaceCanonicalSourceSnapshot(sourceBin) {
      if (canonical.document && typeof canonical.document === 'object') {
        canonical = { ...canonical, document: { ...canonical.document, sourceBin } };
      }
    },

    /** Bind the remembered startup project before any window exists (no broadcast needed). */
    commitStartup(snapshot = {}) {
      if (typeof snapshot === 'string') snapshot = { filePath: snapshot };
      current = { authorityId: mint(), version: 1, filePath: snapshot.filePath };
      canonical = { ...canonical, ...snapshot, filePath: snapshot.filePath };
      return getCurrent();
    },

    /**
     * Open/switch to a project. `load` performs the read/prepare IO and runs inside the
     * mutation lock so an in-flight save cannot interleave with the switch. The initiating
     * renderer is NOT auto-adopted: it must hydrate the returned document and confirm, the
     * same as every other window.
     */
    async openProject({ senderId, rendererEpoch = 0, isSenderLive, load, publish, restorePublish }) {
      const claim = getCurrent();
      recordAdoption(senderId, rendererEpoch);
      const prepared = await prepareSwitch({ kind: 'open', senderId, rendererEpoch, isSenderLive, claim, prepare: load });
      if (!prepared.transactionId) return prepared;
      return commitPreparedSwitch({ transactionId: prepared.transactionId, senderId, rendererEpoch, publish, restorePublish });
    },

    /**
     * Save the current project. The claim is validated twice: once up front (so a doomed
     * save never opens a destination dialog) and again inside the mutation lock immediately
     * before the disk write (so a dialog resolving after a project switch is refused).
     * A same-path save advances the version; a path rebind (first save of a blank project,
     * or Save As) mints a fresh identity at version 1. Only the writer is auto-adopted.
     */
    async saveProject({ senderId, rendererEpoch = 0, isSenderLive, claim, resolveFilePath, write, publish, restorePublish }) {
      const precheck = authorizeSave(senderId, claim, rendererEpoch, isSenderLive);
      if (!precheck.ok) {
        return { canceled: false, rejected: precheck.rejected };
      }

      const filePath = await resolveFilePath(current.filePath);
      if (!filePath) {
        return { canceled: true };
      }
      if (!senderIsLive(isSenderLive)) {
        const rejected = buildRejection('sender-gone', 'The requesting window is no longer live.');
        return { canceled: false, rejected: rejected.rejected };
      }

      return runExclusive(async () => {
        const recheck = authorizeSave(senderId, claim, rendererEpoch, isSenderLive);
        if (!recheck.ok) {
          return { canceled: false, rejected: recheck.rejected };
        }

        const staged = asStagedResult(await write(filePath, () => senderIsLive(isSenderLive)));
        if (!senderIsLive(isSenderLive)) {
          try { await staged.rollback(); } catch {}
          const rejected = buildRejection('sender-gone', 'The requesting window is no longer live.');
          return { canceled: false, rejected: rejected.rejected };
        }
        const previous = { current, canonical };
        try {
          // No liveness probe is permitted after commit(): it would turn a successful atomic
          // target replacement into a rejected IPC with old authority.
          const written = staged.commit();
          const rebinding = filePath !== current.filePath;
          current = rebinding ? { authorityId: mint(), version: 1, filePath } : { ...current, version: current.version + 1 };
          canonical = { filePath, scratchDirectoryPath: written.scratchDirectoryPath, document: written.document };
          const snapshot = {
            ...canonical,
            authority: getCurrent(),
            preparedPublication: written?.preparedPublication,
          };
          if (!publishAtomically(snapshot, { ...previous.canonical, authority: { ...previous.current } }, publish, restorePublish)) {
            throw new Error('Project publication failed.');
          }
          recordAdoption(senderId, rendererEpoch);
          safelyEmit({ authority: getCurrent(), reason: rebinding ? 'save-as' : 'save', initiatorWebContentsId: senderId });
          return { ...written, authority: getCurrent() };
        } catch (error) {
          current = previous.current;
          canonical = previous.canonical;
          try { await staged.rollback(); } catch {}
          return { canceled: false, rejected: buildRejection('commit-failed', error instanceof Error ? error.message : 'Project commit failed.').rejected };
        }
      });
    },

    /**
     * File > New: reset to a blank project under a fresh identity. The initiator resets its
     * own stores before invoking this, so its state IS the new canonical blank snapshot and
     * it is adopted directly.
     */
    async clearProject({ senderId, rendererEpoch = 0, isSenderLive, reset, publish, restorePublish }) {
      const claim = getCurrent();
      recordAdoption(senderId, rendererEpoch);
      const prepared = await prepareSwitch({ kind: 'clear', senderId, rendererEpoch, isSenderLive, claim, prepare: reset ?? (() => undefined) });
      if (!prepared.transactionId) return prepared;
      return commitPreparedSwitch({ transactionId: prepared.transactionId, senderId, rendererEpoch, publish, restorePublish });
    },

    /**
     * A renderer confirms it hydrated the claimed authority's canonical snapshot. Delayed
     * confirmations from before a switch/save are reported stale and grant nothing.
     */
    confirmAdoption(senderId, claim, rendererEpoch = 0, isSenderLive) {
      if (!senderIsLive(isSenderLive)) return { ok: false, stale: true, current: getCurrent() };
      if (!isClaimShape(claim) || claim.authorityId !== current.authorityId || claim.version !== current.version) {
        return { ok: false, stale: true, current: getCurrent() };
      }
      recordAdoption(senderId, rendererEpoch);
      return { ok: true, current: getCurrent() };
    },

    /** Canonical snapshot + authority for pull-based adoption after a change broadcast. */
    buildAdoptResponse() {
      return { authority: getCurrent(), ...canonical };
    },

    /** Forget a destroyed renderer's adoption record. */
    dropRenderer(senderId) {
      adoptions.delete(senderId);
    },

    /** Reload/navigation/crash invalidates a claim even when Electron retains webContents.id. */
    invalidateRenderer(senderId) {
      adoptions.delete(senderId);
      for (const [transactionId, prepared] of preparedSwitches) {
        if (prepared.senderId === senderId) {
          void rollbackPreparedSwitch(transactionId, prepared);
        }
      }
    },
  };
}

module.exports = {
  createProjectAuthority,
  normalizeProjectSavePayload,
};
