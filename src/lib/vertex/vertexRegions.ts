export interface VertexRegionOption {
  value: string;
  label: string;
}

export const VERTEX_REGIONS: VertexRegionOption[] = [
  { value: 'global', label: 'Global (multi-region)' },
  { value: 'us-central1', label: 'us-central1 (Iowa)' },
  { value: 'us-east1', label: 'us-east1 (South Carolina)' },
  { value: 'us-east4', label: 'us-east4 (N. Virginia)' },
  { value: 'us-east5', label: 'us-east5 (Columbus)' },
  { value: 'us-south1', label: 'us-south1 (Dallas)' },
  { value: 'us-west1', label: 'us-west1 (Oregon)' },
  { value: 'us-west4', label: 'us-west4 (Las Vegas)' },
  { value: 'northamerica-northeast1', label: 'northamerica-northeast1 (Montreal)' },
  { value: 'southamerica-east1', label: 'southamerica-east1 (Sao Paulo)' },
  { value: 'europe-west1', label: 'europe-west1 (Belgium)' },
  { value: 'europe-west2', label: 'europe-west2 (London)' },
  { value: 'europe-west3', label: 'europe-west3 (Frankfurt)' },
  { value: 'europe-west4', label: 'europe-west4 (Netherlands)' },
  { value: 'europe-west9', label: 'europe-west9 (Paris)' },
  { value: 'europe-southwest1', label: 'europe-southwest1 (Madrid)' },
  { value: 'asia-east1', label: 'asia-east1 (Taiwan)' },
  { value: 'asia-east2', label: 'asia-east2 (Hong Kong)' },
  { value: 'asia-northeast1', label: 'asia-northeast1 (Tokyo)' },
  { value: 'asia-northeast3', label: 'asia-northeast3 (Seoul)' },
  { value: 'asia-south1', label: 'asia-south1 (Mumbai)' },
  { value: 'asia-southeast1', label: 'asia-southeast1 (Singapore)' },
  { value: 'australia-southeast1', label: 'australia-southeast1 (Sydney)' },
];

export const VERTEX_REGION_CUSTOM_VALUE = '__custom__';

export function isKnownVertexRegion(value: string): boolean {
  return VERTEX_REGIONS.some((region) => region.value === value);
}
