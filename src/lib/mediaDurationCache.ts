export type MediaDurationKind = 'audio' | 'video';
export type MediaDurationLoader = (url: string, kind: MediaDurationKind) => Promise<number>;

export function createMediaDurationResolver(loader: MediaDurationLoader): MediaDurationLoader {
  const durationByKey = new Map<string, Promise<number>>();

  return (url, kind) => {
    const key = `${kind}:${url}`;
    const cached = durationByKey.get(key);

    if (cached) {
      return cached;
    }

    const next = loader(url, kind).catch((error) => {
      durationByKey.delete(key);
      throw error;
    });
    durationByKey.set(key, next);
    return next;
  };
}
