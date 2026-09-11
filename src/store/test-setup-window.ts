if (typeof window === 'undefined') {
  const store: Record<string, string> = {};
  const localStorageStub: Storage = {
    get length() {
      return Object.keys(store).length;
    },
    clear: () => {
      for (const key in store) {
        delete store[key];
      }
    },
    getItem: (key: string) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    key: (index: number) => Object.keys(store)[index] ?? null,
    removeItem: (key: string) => {
      delete store[key];
    },
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: localStorageStub,
    } satisfies Pick<Window, 'localStorage'>,
  });
}
