const INTERFACE_LOCALES = new Set(['en', 'ja']);

function isLocale(value) {
  return typeof value === 'string' && INTERFACE_LOCALES.has(value);
}

function copyState(state) {
  return {
    owner: 'electron-main',
    locale: state.locale,
    localeChosen: state.localeChosen,
    revision: state.revision,
  };
}

function samePreference(left, right) {
  return left.locale === right.locale && left.localeChosen === right.localeChosen;
}

/**
 * Process-owned interface-locale authority (FBL-033).
 *
 * Renderers may propose a hydrated/user-selected preference only against the revision they last
 * adopted. Accepted changes advance one monotonic revision and invoke `onChange`; stale changes are
 * returned the current value without changing menus. An identical preference is idempotent even
 * when its expected revision is old, which makes delayed duplicate IPC harmless.
 *
 * Ownership deliberately has no renderer/window identity. Closing or focusing a window cannot
 * revert the application locale; the Electron process owns it until process exit.
 */
function createInterfaceLocaleAuthority(options = {}) {
  const onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
  const initialLocale = isLocale(options.initialLocale) ? options.initialLocale : 'en';
  let current = {
    owner: 'electron-main',
    locale: initialLocale,
    localeChosen: options.initialLocaleChosen === true,
    revision: 0,
  };

  function getCurrent() {
    return copyState(current);
  }

  function update(request) {
    if (
      !request
      || !isLocale(request.locale)
      || typeof request.localeChosen !== 'boolean'
      || !Number.isSafeInteger(request.expectedRevision)
      || request.expectedRevision < 0
    ) {
      return {
        ok: false,
        changed: false,
        rejected: 'invalid-request',
        current: getCurrent(),
      };
    }

    const requested = {
      locale: request.locale,
      localeChosen: request.localeChosen,
    };
    if (samePreference(requested, current)) {
      return { ok: true, changed: false, current: getCurrent() };
    }
    if (request.expectedRevision !== current.revision) {
      return {
        ok: false,
        changed: false,
        rejected: 'stale-revision',
        current: getCurrent(),
      };
    }

    const localeChanged = requested.locale !== current.locale;
    current = {
      owner: 'electron-main',
      ...requested,
      revision: current.revision + 1,
    };
    const published = getCurrent();
    onChange(published, { localeChanged });
    return { ok: true, changed: true, current: published };
  }

  return { getCurrent, update };
}

module.exports = {
  createInterfaceLocaleAuthority,
  isLocale,
  samePreference,
};
