export interface SourceAssetHandlePool {
  acquire: (id: string, url: string) => string;
  replace: (id: string, url: string) => string;
  release: (id: string) => void;
  get: (id: string) => string | undefined;
  has: (id: string) => boolean;
}

interface SourceAssetHandleRecord {
  url: string;
  refCount: number;
}

export function createSourceAssetHandlePool(
  releaseUrl: (url: string) => void = () => {},
): SourceAssetHandlePool {
  const handles = new Map<string, SourceAssetHandleRecord>();
  const urlRefCounts = new Map<string, number>();

  const retainUrl = (url: string, count = 1) => {
    urlRefCounts.set(url, (urlRefCounts.get(url) ?? 0) + count);
  };

  const releaseUrlReference = (url: string, count = 1) => {
    const nextRefCount = (urlRefCounts.get(url) ?? 0) - count;
    if (nextRefCount > 0) {
      urlRefCounts.set(url, nextRefCount);
      return;
    }
    urlRefCounts.delete(url);
    releaseUrl(url);
  };

  return {
    acquire(id, url) {
      const existing = handles.get(id);
      if (!existing) {
        handles.set(id, { url, refCount: 1 });
        retainUrl(url);
        return url;
      }

      if (existing.url !== url) {
        releaseUrlReference(existing.url, existing.refCount);
        handles.set(id, { url, refCount: 1 });
        retainUrl(url);
        return url;
      }

      existing.refCount += 1;
      retainUrl(url);
      return existing.url;
    },
    replace(id, url) {
      const existing = handles.get(id);
      if (!existing) {
        handles.set(id, { url, refCount: 1 });
        retainUrl(url);
        return url;
      }

      if (existing.url === url) {
        return existing.url;
      }

      releaseUrlReference(existing.url, existing.refCount);
      handles.set(id, { url, refCount: 1 });
      retainUrl(url);
      return url;
    },
    release(id) {
      const existing = handles.get(id);
      if (!existing) {
        return;
      }

      const nextRefCount = existing.refCount - 1;
      if (nextRefCount > 0) {
        handles.set(id, { ...existing, refCount: nextRefCount });
        releaseUrlReference(existing.url);
        return;
      }

      handles.delete(id);
      releaseUrlReference(existing.url);
    },
    get(id) {
      return handles.get(id)?.url;
    },
    has(id) {
      return handles.has(id);
    },
  };
}
