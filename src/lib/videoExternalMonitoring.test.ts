import { describe, expect, it, vi } from 'vitest';
import {
  canDispatchExternalMonitoringAction,
  discoverExternalMonitoringDevices,
  getRegisteredExternalMonitoringAdapters,
  normalizeExternalMonitoringDevices,
  registerExternalMonitoringAdapter,
  validateExternalMonitoringAction,
  type ExternalMonitoringAdapter,
  type ExternalMonitoringDevice,
} from './videoExternalMonitoring';

describe('external monitoring adapter boundary', () => {
  it('normalizes duplicate and malformed device records deterministically', () => {
    expect(normalizeExternalMonitoringDevices([
      { id: ' b ', label: ' Beta ', kind: 'monitor', transport: 'ndi', online: true, capabilities: ['monitor-output', 'monitor-output'] },
      { id: 'a', label: 'Alpha', kind: 'control-surface', transport: 'vendor-control', online: true, capabilities: ['jog', 'shuttle'] },
      { id: 'b', label: 'duplicate', kind: 'monitor', transport: 'sdi', online: true, capabilities: ['monitor-output'] },
      { id: ' ', label: 'missing id', kind: 'monitor', transport: 'sdi', online: true, capabilities: ['monitor-output'] },
    ])).toMatchObject([
      { id: 'a', label: 'Alpha', capabilities: ['jog', 'shuttle'] },
      { id: 'b', label: 'Beta', capabilities: ['monitor-output'] },
    ]);
  });

  it('bounds jog/shuttle actions and rejects unsafe commands before adapter dispatch', () => {
    expect(validateExternalMonitoringAction({ kind: 'jog', frames: 0 })).toMatch(/non-zero/);
    expect(validateExternalMonitoringAction({ kind: 'jog', frames: 121 })).toMatch(/between/);
    expect(validateExternalMonitoringAction({ kind: 'shuttle', rate: 3 })).toMatch(/one of/);
    const device = { id: 'deck', label: 'Deck', kind: 'combined' as const, transport: 'sdi' as const, online: true, capabilities: ['monitor-output', 'transport', 'jog', 'shuttle'] as const };
    expect(canDispatchExternalMonitoringAction(device, { kind: 'jog', frames: 120 })).toBe(true);
    expect(canDispatchExternalMonitoringAction(device, { kind: 'jog', frames: 121 })).toBe(false);
  });

  it('isolates adapter failures and caps the discovery surface', async () => {
    const working: ExternalMonitoringAdapter = {
      id: 'working', label: 'Working adapter', vendor: 'Test vendor',
      discover: vi.fn(async () => [{ id: 'monitor', label: 'Reference', kind: 'monitor', transport: 'hdmi', online: true, capabilities: ['monitor-output'] } as const satisfies ExternalMonitoringDevice]),
      connect: vi.fn(),
    };
    const failing: ExternalMonitoringAdapter = {
      id: 'failing', label: 'Failing adapter', vendor: 'Test vendor',
      discover: vi.fn(async () => { throw new Error('host denied'); }),
      connect: vi.fn(),
    };
    const result = await discoverExternalMonitoringDevices([working, failing]);
    expect(result.devices).toHaveLength(1);
    expect(result.devices[0]).toMatchObject({ adapterId: 'working', vendor: 'Test vendor' });
    expect(result.errors).toEqual(['Failing adapter: host denied']);
  });

  it('offers a bounded native-host registration seam without inventing a browser adapter', () => {
    const adapter: ExternalMonitoringAdapter = {
      id: 'registered-fixture', label: 'Registered fixture', vendor: 'Fixture',
      discover: vi.fn(async () => []), connect: vi.fn(),
    };
    const unregister = registerExternalMonitoringAdapter(adapter);
    expect(getRegisteredExternalMonitoringAdapters()).toContain(adapter);
    unregister();
    expect(getRegisteredExternalMonitoringAdapters()).not.toContain(adapter);
  });
});
