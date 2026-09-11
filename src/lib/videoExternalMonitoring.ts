export const MAX_EXTERNAL_MONITORING_ADAPTERS = 16;
export const MAX_EXTERNAL_MONITORING_DEVICES = 64;
export const MAX_EXTERNAL_JOG_FRAMES = 120;

export type ExternalMonitoringTransport = 'sdi' | 'ndi' | 'hdmi' | 'vendor-control';
export type ExternalMonitoringDeviceKind = 'monitor' | 'control-surface' | 'combined';
export type ExternalMonitoringCapability = 'monitor-output' | 'transport' | 'jog' | 'shuttle';

export interface ExternalMonitoringDevice {
  id: string;
  label: string;
  kind: ExternalMonitoringDeviceKind;
  transport: ExternalMonitoringTransport;
  online: boolean;
  capabilities: readonly ExternalMonitoringCapability[];
  detail?: string;
}

export type ExternalMonitoringAction =
  | { kind: 'monitor'; enabled: boolean }
  | { kind: 'transport'; command: 'play' | 'pause' | 'stop' }
  | { kind: 'jog'; frames: number }
  | { kind: 'shuttle'; rate: number };

export interface ExternalMonitoringSession {
  send(action: ExternalMonitoringAction): Promise<void>;
  close(): Promise<void>;
}

export interface ExternalMonitoringAdapter {
  id: string;
  label: string;
  vendor: string;
  discover(): Promise<readonly ExternalMonitoringDevice[]>;
  connect(deviceId: string): Promise<ExternalMonitoringSession>;
}

const registeredAdapters = new Map<string, ExternalMonitoringAdapter>();

/**
 * Native hosts may register a licensed adapter at their integration boundary. The browser
 * build registers none, so callers must never infer hardware support from this registry alone.
 */
export function registerExternalMonitoringAdapter(adapter: ExternalMonitoringAdapter): () => void {
  if (!adapter.id.trim() || !adapter.label.trim() || !adapter.vendor.trim()) return () => undefined;
  if (!registeredAdapters.has(adapter.id) && registeredAdapters.size >= MAX_EXTERNAL_MONITORING_ADAPTERS) return () => undefined;
  registeredAdapters.set(adapter.id, adapter);
  return () => {
    if (registeredAdapters.get(adapter.id) === adapter) registeredAdapters.delete(adapter.id);
  };
}

export function getRegisteredExternalMonitoringAdapters(): readonly ExternalMonitoringAdapter[] {
  return [...registeredAdapters.values()];
}

export interface DiscoveredExternalMonitoringDevice extends ExternalMonitoringDevice {
  adapterId: string;
  adapterLabel: string;
  vendor: string;
}

export interface ExternalMonitoringDiscoveryResult {
  devices: readonly DiscoveredExternalMonitoringDevice[];
  errors: readonly string[];
}

const SHUTTLE_RATES = new Set([-8, -4, -2, -1, 0, 1, 2, 4, 8]);

export function normalizeExternalMonitoringDevices(
  devices: readonly ExternalMonitoringDevice[],
): ExternalMonitoringDevice[] {
  const seen = new Set<string>();
  const normalized: ExternalMonitoringDevice[] = [];
  for (const device of devices) {
    const id = device.id.trim();
    const label = device.label.trim();
    if (normalized.length >= MAX_EXTERNAL_MONITORING_DEVICES || seen.has(id)) continue;
    if (!id || !label) continue;
    const capabilities = [...new Set(device.capabilities)].filter((capability): capability is ExternalMonitoringCapability => (
      capability === 'monitor-output' || capability === 'transport' || capability === 'jog' || capability === 'shuttle'
    ));
    seen.add(id);
    normalized.push({
      ...device,
      id,
      label,
      capabilities,
      online: device.online === true,
    });
  }
  return normalized.sort((left, right) => left.label.localeCompare(right.label) || left.id.localeCompare(right.id));
}

export function validateExternalMonitoringAction(action: ExternalMonitoringAction): string | undefined {
  if (action.kind === 'jog') {
    if (!Number.isInteger(action.frames) || Math.abs(action.frames) > MAX_EXTERNAL_JOG_FRAMES || action.frames === 0) {
      return `Jog must be a non-zero integer between -${MAX_EXTERNAL_JOG_FRAMES} and ${MAX_EXTERNAL_JOG_FRAMES} frames.`;
    }
  }
  if (action.kind === 'shuttle' && (!Number.isFinite(action.rate) || !SHUTTLE_RATES.has(action.rate))) {
    return 'Shuttle rate must be one of -8, -4, -2, -1, 0, 1, 2, 4, or 8.';
  }
  return undefined;
}

export function externalMonitoringActionCapability(action: ExternalMonitoringAction): ExternalMonitoringCapability {
  if (action.kind === 'monitor') return 'monitor-output';
  return action.kind;
}

export function canDispatchExternalMonitoringAction(
  device: ExternalMonitoringDevice,
  action: ExternalMonitoringAction,
): boolean {
  return device.online
    && device.capabilities.includes(externalMonitoringActionCapability(action))
    && validateExternalMonitoringAction(action) === undefined;
}

export async function discoverExternalMonitoringDevices(
  adapters: readonly ExternalMonitoringAdapter[],
  signal?: AbortSignal,
): Promise<ExternalMonitoringDiscoveryResult> {
  const discovered: DiscoveredExternalMonitoringDevice[] = [];
  const errors: string[] = [];
  for (const adapter of adapters.slice(0, MAX_EXTERNAL_MONITORING_ADAPTERS)) {
    if (signal?.aborted) break;
    try {
      const devices = normalizeExternalMonitoringDevices(await adapter.discover());
      for (const device of devices) {
        if (discovered.length >= MAX_EXTERNAL_MONITORING_DEVICES) break;
        discovered.push({ ...device, adapterId: adapter.id, adapterLabel: adapter.label, vendor: adapter.vendor });
      }
    } catch (error) {
      errors.push(`${adapter.label}: ${error instanceof Error ? error.message : 'discovery failed'}`);
    }
  }
  return { devices: discovered, errors };
}
