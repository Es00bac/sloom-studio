import { useEffect, useMemo, useRef, useState } from 'react';
import type { NativeMenuCommand } from '../../lib/nativeApp';
import {
  GAMEPAD_CONTROL_DEFINITIONS,
  GAMEPAD_WORKSPACE_SCOPES,
  getGamepadCommandOptionsForWorkspace,
  resolveGamepadCommandEvents,
  updateGamepadBinding,
  type GamepadAnalogCurve,
  type GamepadBindingProfile,
  type GamepadControlBinding,
  type GamepadControlId,
  type GamepadWorkspace,
  type GamepadWorkspaceScope,
} from '../../lib/gamepadBindings';

const BINDING_TAB_ORDER: GamepadWorkspaceScope[] = ['flow', 'image', 'paper', 'video'];
const ANALOG_CURVES: GamepadAnalogCurve[] = ['linear', 'quadratic', 'cubic'];
type GamepadControlEntry = (typeof GAMEPAD_CONTROL_DEFINITIONS)[number];

interface GamepadInputManagerProps {
  activeWorkspace: GamepadWorkspace;
  bindings: GamepadBindingProfile;
  onCommand: (command: NativeMenuCommand) => void;
  renderBindingScaffold?: boolean;
  onBindingProfileChange?: (profile: GamepadBindingProfile) => void;
  onBindingRebind?: (event: {
    workspace: GamepadWorkspaceScope;
    controlId: GamepadControlId;
    patch: Partial<GamepadControlBinding>;
    nextProfile: GamepadBindingProfile;
  }) => void;
}

export function GamepadInputManager({
  activeWorkspace,
  bindings,
  onCommand,
  renderBindingScaffold = false,
  onBindingProfileChange,
  onBindingRebind,
}: GamepadInputManagerProps) {
  const activeControlsRef = useRef<Set<GamepadControlId>>(new Set());
  const [activeBindingWorkspace, setActiveBindingWorkspace] = useState<GamepadWorkspaceScope>(
    toWorkspaceScope(activeWorkspace),
  );

  useEffect(() => {
    setActiveBindingWorkspace(toWorkspaceScope(activeWorkspace));
  }, [activeWorkspace]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return;
    }

    let animationFrame = 0;
    let mounted = true;

    const tick = () => {
      if (!mounted) return;
      // On desktop each workspace is its own Electron window, and every window mounts its own
      // GamepadInputManager polling the same physical controller. Only the focused window may act
      // on it — otherwise one button press fires in every open workspace at once.
      if (
        typeof document !== 'undefined' &&
        typeof document.hasFocus === 'function' &&
        !document.hasFocus()
      ) {
        activeControlsRef.current = new Set();
        animationFrame = window.requestAnimationFrame(tick);
        return;
      }
      const gamepad = findActiveGamepad(navigator.getGamepads());
      if (!gamepad) {
        activeControlsRef.current = new Set();
        animationFrame = window.requestAnimationFrame(tick);
        return;
      }

      const result = resolveGamepadCommandEvents({
        bindings,
        workspace: activeWorkspace,
        gamepad,
        previousActiveControls: activeControlsRef.current,
      });
      activeControlsRef.current = result.activeControls;
      result.commands.forEach(onCommand);
      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);
    return () => {
      mounted = false;
      window.cancelAnimationFrame(animationFrame);
    };
  }, [activeWorkspace, bindings, onCommand]);

  if (!renderBindingScaffold) {
    return null;
  }

  return (
    <GamepadBindingScaffold
      activeWorkspace={activeBindingWorkspace}
      bindings={bindings}
      onBindingProfileChange={onBindingProfileChange}
      onBindingRebind={onBindingRebind}
      onWorkspaceChange={setActiveBindingWorkspace}
    />
  );
}

function GamepadBindingScaffold({
  activeWorkspace,
  bindings,
  onWorkspaceChange,
  onBindingProfileChange,
  onBindingRebind,
}: {
  activeWorkspace: GamepadWorkspaceScope;
  bindings: GamepadBindingProfile;
  onWorkspaceChange: (workspace: GamepadWorkspaceScope) => void;
  onBindingProfileChange?: (profile: GamepadBindingProfile) => void;
  onBindingRebind?: (event: {
    workspace: GamepadWorkspaceScope;
    controlId: GamepadControlId;
    patch: Partial<GamepadControlBinding>;
    nextProfile: GamepadBindingProfile;
  }) => void;
}) {
  const tabs = useMemo(
    () => BINDING_TAB_ORDER.map((id) => GAMEPAD_WORKSPACE_SCOPES.find((workspace) => workspace.id === id)).filter(Boolean),
    [],
  );
  const workspaceLabel = tabs.find((workspace) => workspace?.id === activeWorkspace)?.label ?? activeWorkspace;
  const workspaceBindings = bindings[activeWorkspace];
  const commandOptions = getGamepadCommandOptionsForWorkspace(activeWorkspace);

  const applyPatch = (controlId: GamepadControlId, patch: Partial<GamepadControlBinding>) => {
    const nextProfile = updateGamepadBinding(bindings, activeWorkspace, controlId, patch);
    onBindingProfileChange?.(nextProfile);
    onBindingRebind?.({
      workspace: activeWorkspace,
      controlId,
      patch,
      nextProfile,
    });
  };

  return (
    <section
      className="rounded-xl border border-gray-800 bg-[#0b1018]/95 p-3 text-gray-100 shadow-2xl shadow-black/20"
      data-gamepad-binding-scaffold="true"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-100">Gamepad bindings</h2>
          <p className="text-xs text-gray-400">Bounded scaffold for workspace-specific controller routing.</p>
        </div>
        <div className="rounded-full border border-gray-800 bg-[#111217] px-2 py-1 text-[11px] uppercase tracking-[0.18em] text-gray-400">
          {workspaceLabel}
        </div>
      </div>
      <div className="mb-3 flex flex-wrap gap-2" role="tablist">
        {tabs.map((workspace) => {
          if (!workspace) return null;
          const selected = workspace.id === activeWorkspace;
          return (
            <button
              aria-label={`${workspace.label} gamepad bindings`}
              aria-selected={selected}
              className={`rounded-md border px-3 py-1.5 text-sm font-medium transition-colors ${
                selected
                  ? 'border-blue-500/50 bg-blue-500/15 text-blue-100'
                  : 'border-gray-800 bg-[#111217] text-gray-300 hover:border-gray-700 hover:text-white'
              }`}
              key={workspace.id}
              onClick={() => onWorkspaceChange(workspace.id)}
              role="tab"
              type="button"
            >
              {workspace.label}
            </button>
          );
        })}
      </div>
      <div className="max-h-[min(70vh,42rem)] space-y-4 overflow-y-auto pr-1">
        <BindingGroup
          commandOptions={commandOptions}
          controls={GAMEPAD_CONTROL_DEFINITIONS.filter((control) => control.kind === 'button')}
          label="Buttons"
          onBindingChange={applyPatch}
          workspaceBindings={workspaceBindings}
          workspaceLabel={workspaceLabel}
        />
        <BindingGroup
          commandOptions={commandOptions}
          controls={GAMEPAD_CONTROL_DEFINITIONS.filter((control) => control.kind === 'dpad')}
          label="D-pad"
          onBindingChange={applyPatch}
          workspaceBindings={workspaceBindings}
          workspaceLabel={workspaceLabel}
        />
        <BindingGroup
          commandOptions={commandOptions}
          controls={GAMEPAD_CONTROL_DEFINITIONS.filter((control) => control.kind === 'axis')}
          label="Analog sticks"
          onBindingChange={applyPatch}
          workspaceBindings={workspaceBindings}
          workspaceLabel={workspaceLabel}
        />
        <BindingGroup
          commandOptions={commandOptions}
          controls={GAMEPAD_CONTROL_DEFINITIONS.filter((control) => control.kind === 'trigger')}
          label="Triggers"
          onBindingChange={applyPatch}
          workspaceBindings={workspaceBindings}
          workspaceLabel={workspaceLabel}
        />
      </div>
    </section>
  );
}

function BindingGroup({
  label,
  controls,
  workspaceLabel,
  workspaceBindings,
  commandOptions,
  onBindingChange,
}: {
  label: string;
  controls: GamepadControlEntry[];
  workspaceLabel: string;
  workspaceBindings: GamepadBindingProfile[GamepadWorkspaceScope];
  commandOptions: NativeMenuCommand[];
  onBindingChange: (controlId: GamepadControlId, patch: Partial<GamepadControlBinding>) => void;
}) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">{label}</h3>
      <div className="grid gap-2">
        {controls.map((control) => (
          <BindingRow
            binding={workspaceBindings[control.id]}
            commandOptions={commandOptions}
            control={control}
            key={control.id}
            onBindingChange={onBindingChange}
            workspaceLabel={workspaceLabel}
          />
        ))}
      </div>
    </div>
  );
}

function BindingRow({
  control,
  binding,
  workspaceLabel,
  commandOptions,
  onBindingChange,
}: {
  control: GamepadControlEntry;
  binding: GamepadControlBinding;
  workspaceLabel: string;
  commandOptions: NativeMenuCommand[];
  onBindingChange: (controlId: GamepadControlId, patch: Partial<GamepadControlBinding>) => void;
}) {
  return (
    <article className="grid gap-3 rounded-lg border border-gray-800 bg-[#111217] px-3 py-2 lg:grid-cols-[11rem_minmax(14rem,1fr)_minmax(18rem,30rem)]">
      <div>
        <div className="text-sm font-medium text-gray-100">{control.label}</div>
        <div className="text-xs capitalize text-gray-500">{control.kind}</div>
      </div>
      <select
        aria-label={`${workspaceLabel} ${control.label} command`}
        className="w-full rounded-lg border border-gray-700 bg-[#0b1018] px-2.5 py-2 text-sm text-gray-100 outline-none focus:border-blue-500"
        onChange={(event) => onBindingChange(control.id, { command: event.target.value as NativeMenuCommand | '' })}
        value={binding.command}
      >
        <option value="">None</option>
        {commandOptions.map((command) => (
          <option key={command} value={command}>
            {formatCommandLabel(command)}
          </option>
        ))}
      </select>
      {control.kind === 'axis' ? (
        <AxisAdvancedControls
          binding={binding}
          control={control}
          onChange={(patch) => onBindingChange(control.id, patch)}
          workspaceLabel={workspaceLabel}
        />
      ) : control.kind === 'trigger' ? (
        <TriggerAdvancedControls
          binding={binding}
          control={control}
          onChange={(patch) => onBindingChange(control.id, patch)}
          workspaceLabel={workspaceLabel}
        />
      ) : (
        <div
          aria-label={`${workspaceLabel} ${control.label} digital mode`}
          className="rounded-lg border border-dashed border-gray-800 bg-[#0b1018] px-3 py-2 text-xs text-gray-500"
        >
          Digital press
        </div>
      )}
    </article>
  );
}

function AxisAdvancedControls({
  binding,
  control,
  workspaceLabel,
  onChange,
}: {
  binding: GamepadControlBinding;
  control: GamepadControlEntry;
  workspaceLabel: string;
  onChange: (patch: Partial<GamepadControlBinding>) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <NumberSetting
        ariaLabel={`${workspaceLabel} ${control.label} threshold`}
        label="Threshold"
        max={1}
        min={0.05}
        onChange={(threshold) => onChange({ threshold })}
        step={0.05}
        value={binding.threshold}
      />
      <NumberSetting
        ariaLabel={`${workspaceLabel} ${control.label} deadzone`}
        label="Deadzone"
        max={0.95}
        min={0}
        onChange={(deadzone) => onChange({ deadzone })}
        step={0.05}
        value={binding.deadzone}
      />
      <NumberSetting
        ariaLabel={`${workspaceLabel} ${control.label} sensitivity`}
        label="Sensitivity"
        max={3}
        min={0.1}
        onChange={(sensitivity) => onChange({ sensitivity })}
        step={0.1}
        value={binding.sensitivity}
      />
      <CurveSetting
        ariaLabel={`${workspaceLabel} ${control.label} curve`}
        onChange={(curve) => onChange({ curve })}
        value={binding.curve}
      />
      <label className="flex items-center gap-2 rounded-lg border border-gray-800 bg-[#0b1018] px-3 py-2 text-xs text-gray-300 sm:col-span-2">
        <input
          aria-label={`${workspaceLabel} ${control.label} invert`}
          checked={binding.inverted}
          onChange={(event) => onChange({ inverted: event.target.checked })}
          type="checkbox"
        />
        Invert axis
      </label>
    </div>
  );
}

function TriggerAdvancedControls({
  binding,
  control,
  workspaceLabel,
  onChange,
}: {
  binding: GamepadControlBinding;
  control: GamepadControlEntry;
  workspaceLabel: string;
  onChange: (patch: Partial<GamepadControlBinding>) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <NumberSetting
        ariaLabel={`${workspaceLabel} ${control.label} threshold`}
        label="Threshold"
        max={1}
        min={0.05}
        onChange={(threshold) => onChange({ threshold })}
        step={0.05}
        value={binding.threshold}
      />
      <CurveSetting
        ariaLabel={`${workspaceLabel} ${control.label} curve`}
        onChange={(curve) => onChange({ curve })}
        value={binding.curve}
      />
      <NumberSetting
        ariaLabel={`${workspaceLabel} ${control.label} trigger minimum`}
        label="Min"
        max={1}
        min={0}
        onChange={(triggerMin) => onChange({ triggerMin })}
        step={0.05}
        value={binding.triggerMin}
      />
      <NumberSetting
        ariaLabel={`${workspaceLabel} ${control.label} trigger maximum`}
        label="Max"
        max={1}
        min={0}
        onChange={(triggerMax) => onChange({ triggerMax })}
        step={0.05}
        value={binding.triggerMax}
      />
    </div>
  );
}

function CurveSetting({
  value,
  onChange,
  ariaLabel,
}: {
  value: GamepadAnalogCurve;
  onChange: (curve: GamepadAnalogCurve) => void;
  ariaLabel: string;
}) {
  return (
    <label className="grid grid-cols-[4.5rem_1fr] items-center gap-2 rounded-lg border border-gray-800 bg-[#0b1018] px-2 py-1.5 text-xs text-gray-400">
      <span>Curve</span>
      <select
        aria-label={ariaLabel}
        className="min-w-0 rounded border border-gray-700 bg-[#111217] px-2 py-1 text-xs text-gray-100"
        onChange={(event) => onChange(event.target.value as GamepadAnalogCurve)}
        value={value}
      >
        {ANALOG_CURVES.map((curve) => (
          <option key={curve} value={curve}>
            {curve}
          </option>
        ))}
      </select>
    </label>
  );
}

function NumberSetting({
  label,
  value,
  min,
  max,
  step,
  onChange,
  ariaLabel,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  ariaLabel: string;
}) {
  return (
    <label className="grid grid-cols-[4.5rem_1fr] items-center gap-2 rounded-lg border border-gray-800 bg-[#0b1018] px-2 py-1.5 text-xs text-gray-400">
      <span>{label}</span>
      <input
        aria-label={ariaLabel}
        className="min-w-0 rounded border border-gray-700 bg-[#111217] px-2 py-1 font-mono text-xs text-gray-100"
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        type="number"
        value={Number(value.toFixed(2))}
      />
    </label>
  );
}

function formatCommandLabel(command: NativeMenuCommand): string {
  return command
    .replace(/^[^:]+:/, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function findActiveGamepad(gamepads: readonly (Gamepad | null)[]): Gamepad | undefined {
  return gamepads.find((gamepad) => gamepad?.connected && gamepad.mapping === 'standard') ?? gamepads.find((gamepad) => gamepad?.connected) ?? undefined;
}

function toWorkspaceScope(workspace: GamepadWorkspace): GamepadWorkspaceScope {
  return workspace === 'editor' ? 'video' : workspace;
}
