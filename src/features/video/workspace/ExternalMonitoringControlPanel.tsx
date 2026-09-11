import { useEffect, useMemo, useRef, useState } from 'react';
import {
  canDispatchExternalMonitoringAction,
  discoverExternalMonitoringDevices,
  getRegisteredExternalMonitoringAdapters,
  type DiscoveredExternalMonitoringDevice,
  type ExternalMonitoringAction,
  type ExternalMonitoringAdapter,
  type ExternalMonitoringSession,
} from '../../../lib/videoExternalMonitoring';

export interface ExternalMonitoringControlPanelProps {
  adapters?: readonly ExternalMonitoringAdapter[];
}

const buttonClassName = 'inline-flex items-center justify-center rounded-md border border-cyan-300/25 bg-cyan-400/10 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-50 transition-colors hover:bg-cyan-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 disabled:cursor-not-allowed disabled:border-gray-700 disabled:bg-gray-800/40 disabled:text-gray-600';
const selectClassName = 'w-full rounded-md border border-gray-700 bg-[#090e15] px-2 py-1.5 text-[11px] text-gray-100 outline-none focus:border-cyan-300/60';

export function ExternalMonitoringControlPanel({ adapters: suppliedAdapters }: ExternalMonitoringControlPanelProps) {
  const adapters = suppliedAdapters ?? getRegisteredExternalMonitoringAdapters();
  const [devices, setDevices] = useState<readonly DiscoveredExternalMonitoringDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState('');
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('No native external adapter is installed in this browser session.');
  const sessionRef = useRef<ExternalMonitoringSession | undefined>(undefined);
  const discoveryControllerRef = useRef<AbortController | undefined>(undefined);
  const mountedRef = useRef(true);
  const connectionGenerationRef = useRef(0);
  const selectedDevice = devices.find((device) => `${device.adapterId}:${device.id}` === selectedDeviceId);
  const adapterById = useMemo(() => new Map(adapters.map((adapter) => [adapter.id, adapter])), [adapters]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      connectionGenerationRef.current += 1;
      discoveryControllerRef.current?.abort();
      const session = sessionRef.current;
      sessionRef.current = undefined;
      void session?.close().catch(() => undefined);
    };
  }, []);

  const disconnect = async () => {
    connectionGenerationRef.current += 1;
    const session = sessionRef.current;
    sessionRef.current = undefined;
    setConnected(false);
    if (session) await session.close().catch(() => undefined);
  };

  const discover = async () => {
    await disconnect();
    discoveryControllerRef.current?.abort();
    const controller = new AbortController();
    discoveryControllerRef.current = controller;
    setBusy(true);
    setStatus('Discovering through explicitly supplied adapters…');
    try {
      const result = await discoverExternalMonitoringDevices(adapters, controller.signal);
      if (controller.signal.aborted) return;
      setDevices(result.devices);
      setSelectedDeviceId(result.devices[0] ? `${result.devices[0].adapterId}:${result.devices[0].id}` : '');
      setStatus(result.devices.length
        ? `Found ${result.devices.length} device${result.devices.length === 1 ? '' : 's'} through ${adapters.length} adapter${adapters.length === 1 ? '' : 's'}.`
        : result.errors.length
          ? `No devices found. ${result.errors.join(' ')}`
          : 'No devices found. Install and supply a licensed native adapter to enable hardware I/O.');
    } finally {
      if (discoveryControllerRef.current === controller) setBusy(false);
    }
  };

  const connect = async () => {
    if (!selectedDevice) return;
    const adapter = adapterById.get(selectedDevice.adapterId);
    if (!adapter) {
      setStatus('The selected adapter is no longer available; no connection was attempted.');
      return;
    }
    await disconnect();
    if (!mountedRef.current) return;
    const connectionGeneration = ++connectionGenerationRef.current;
    setBusy(true);
    try {
      const session = await adapter.connect(selectedDevice.id);
      if (!mountedRef.current || connectionGenerationRef.current !== connectionGeneration) {
        await session.close().catch(() => undefined);
        return;
      }
      sessionRef.current = session;
      setConnected(true);
      setStatus(`Connected to ${selectedDevice.label}. Commands are sent only through this adapter.`);
    } catch (error) {
      if (mountedRef.current && connectionGenerationRef.current === connectionGeneration) {
        setStatus(error instanceof Error ? `Connection refused: ${error.message}` : 'Connection refused by adapter.');
      }
    } finally {
      if (mountedRef.current && connectionGenerationRef.current === connectionGeneration) setBusy(false);
    }
  };

  const dispatch = async (action: ExternalMonitoringAction) => {
    if (!selectedDevice || !sessionRef.current) {
      setStatus('Connect an online device before sending a control command.');
      return;
    }
    if (!canDispatchExternalMonitoringAction(selectedDevice, action)) {
      setStatus('The selected device does not advertise this bounded command; nothing was sent.');
      return;
    }
    setBusy(true);
    try {
      await sessionRef.current.send(action);
      setStatus(`Sent ${action.kind} command to ${selectedDevice.label}.`);
    } catch (error) {
      setStatus(error instanceof Error ? `Command refused: ${error.message}` : 'Command refused by adapter.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-3 p-3" aria-label="External monitoring and control surfaces" data-external-monitoring-panel="true">
      <div>
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-cyan-200">External Monitoring &amp; Control</div>
        <p className="mt-1 text-[10px] leading-4 text-gray-400">Use an explicitly installed vendor adapter for SDI, NDI, HDMI, or a control surface. The browser fallback never claims hardware output.</p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button className={buttonClassName} disabled={busy} onClick={() => void discover()} type="button">{busy ? 'Working…' : 'Discover devices'}</button>
        <button className={buttonClassName} disabled={busy || !selectedDevice} onClick={() => void connect()} type="button">Connect</button>
        <button className={buttonClassName} disabled={busy || !connected} onClick={() => void disconnect().then(() => setStatus('Disconnected; no command is active.'))} type="button">Disconnect</button>
      </div>
      <label className="block text-[10px] uppercase tracking-wider text-gray-500">Discovered device
        <select aria-label="Discovered external device" className={`${selectClassName} mt-1`} disabled={!devices.length || busy} onChange={(event) => { void disconnect(); setSelectedDeviceId(event.target.value); }} value={selectedDeviceId}>
          <option value="">No device selected</option>
          {devices.map((device) => <option key={`${device.adapterId}:${device.id}`} value={`${device.adapterId}:${device.id}`}>{device.label} · {device.transport.toUpperCase()} · {device.vendor}</option>)}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-1.5">
        <button className={buttonClassName} disabled={!connected || !selectedDevice || !canDispatchExternalMonitoringAction(selectedDevice, { kind: 'monitor', enabled: true })} onClick={() => void dispatch({ kind: 'monitor', enabled: true })} type="button">Enable monitor output</button>
        <button className={buttonClassName} disabled={!connected || !selectedDevice || !canDispatchExternalMonitoringAction(selectedDevice, { kind: 'monitor', enabled: false })} onClick={() => void dispatch({ kind: 'monitor', enabled: false })} type="button">Disable monitor output</button>
        <button className={buttonClassName} disabled={!connected || !selectedDevice || !canDispatchExternalMonitoringAction(selectedDevice, { kind: 'transport', command: 'play' })} onClick={() => void dispatch({ kind: 'transport', command: 'play' })} type="button">Play</button>
        <button className={buttonClassName} disabled={!connected || !selectedDevice || !canDispatchExternalMonitoringAction(selectedDevice, { kind: 'transport', command: 'pause' })} onClick={() => void dispatch({ kind: 'transport', command: 'pause' })} type="button">Pause</button>
        <button className={buttonClassName} disabled={!connected || !selectedDevice || !canDispatchExternalMonitoringAction(selectedDevice, { kind: 'jog', frames: -10 })} onClick={() => void dispatch({ kind: 'jog', frames: -10 })} type="button">Jog −10 frames</button>
        <button className={buttonClassName} disabled={!connected || !selectedDevice || !canDispatchExternalMonitoringAction(selectedDevice, { kind: 'jog', frames: 10 })} onClick={() => void dispatch({ kind: 'jog', frames: 10 })} type="button">Jog +10 frames</button>
        <button className={buttonClassName} disabled={!connected || !selectedDevice || !canDispatchExternalMonitoringAction(selectedDevice, { kind: 'shuttle', rate: -2 })} onClick={() => void dispatch({ kind: 'shuttle', rate: -2 })} type="button">Shuttle −2×</button>
        <button className={buttonClassName} disabled={!connected || !selectedDevice || !canDispatchExternalMonitoringAction(selectedDevice, { kind: 'shuttle', rate: 2 })} onClick={() => void dispatch({ kind: 'shuttle', rate: 2 })} type="button">Shuttle +2×</button>
      </div>
      <p aria-live="polite" className="rounded-md border border-gray-700/60 bg-black/20 px-2.5 py-2 text-[10px] leading-4 text-gray-400">{status}</p>
      <p className="text-[10px] leading-4 text-gray-500">No device discovery, SDK licensing, signal transport, or broadcast certification is provided by this browser-only fallback. Unsupported commands are refused without changing the authored composition.</p>
    </section>
  );
}
