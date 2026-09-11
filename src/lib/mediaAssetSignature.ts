const SHORT_ASSET_SIGNATURE_LIMIT = 240;
const ASSET_SIGNATURE_EDGE_SAMPLE = 96;

export function buildMediaAssetSignaturePart(url: string): string {
  if (url.length <= SHORT_ASSET_SIGNATURE_LIMIT) {
    return url;
  }

  const head = url.slice(0, ASSET_SIGNATURE_EDGE_SAMPLE);
  const tail = url.slice(-ASSET_SIGNATURE_EDGE_SAMPLE);
  const hash = hashSignatureSample(`${head}:${tail}:${url.length}`);

  return `${head}...${tail}:len=${url.length}:hash=${hash}`;
}

function hashSignatureSample(value: string): string {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash).toString(36);
}
