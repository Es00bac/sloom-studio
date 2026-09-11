import { describe, expect, it } from 'vitest';
import {
  GAMEPAD_CONTROL_DEFINITIONS,
  GAMEPAD_WORKSPACE_SCOPES,
  createDefaultGamepadBindings,
  exportGamepadBindings,
  getDefaultGamepadActionMap,
  normalizeGamepadBindings,
  resolveGamepadCommandEvents,
  updateGamepadBinding,
  validateGamepadBindingsImport,
} from './gamepadBindings';

function gamepad(overrides: {
  buttons?: Array<{ pressed?: boolean; value?: number }>;
  axes?: number[];
} = {}): Gamepad {
  const buttons = Array.from({ length: 17 }, (_, index) => ({
    pressed: Boolean(overrides.buttons?.[index]?.pressed),
    touched: Boolean(overrides.buttons?.[index]?.pressed),
    value: overrides.buttons?.[index]?.value ?? (overrides.buttons?.[index]?.pressed ? 1 : 0),
  })) as GamepadButton[];

  return {
    axes: overrides.axes ?? [0, 0, 0, 0],
    buttons,
    connected: true,
    id: 'Test Controller',
    index: 0,
    mapping: 'standard',
    timestamp: 1,
  } as unknown as Gamepad;
}

describe('gamepadBindings', () => {
  it('creates a binding record for every workspace and every standard control', () => {
    const bindings = createDefaultGamepadBindings();
    const controlIds = GAMEPAD_CONTROL_DEFINITIONS.map((control) => control.id);

    expect(Object.keys(bindings)).toEqual(['flow', 'editor', 'image', 'paper']);
    expect(Object.keys(bindings.image)).toEqual(controlIds);
    expect(bindings.image.rightTrigger.threshold).toBeGreaterThan(0);
    expect(bindings.image.leftStickUp.deadzone).toBeGreaterThan(0);
  });

  it('sanitizes persisted bindings to workspace-valid commands', () => {
    const bindings = normalizeGamepadBindings({
      image: {
        buttonSouth: { command: 'paper:add-page' },
        buttonEast: { command: 'image:tool-brush' },
      },
    });

    expect(bindings.image.buttonSouth.command).toBe('');
    expect(bindings.image.buttonEast.command).toBe('image:tool-brush');
  });

  it('emits commands only when button and d-pad controls cross into active state', () => {
    const bindings = createDefaultGamepadBindings();
    const first = resolveGamepadCommandEvents({
      bindings,
      workspace: 'image',
      gamepad: gamepad({ buttons: [{ pressed: true }] }),
      previousActiveControls: new Set(),
    });
    const second = resolveGamepadCommandEvents({
      bindings,
      workspace: 'image',
      gamepad: gamepad({ buttons: [{ pressed: true }] }),
      previousActiveControls: first.activeControls,
    });

    expect(first.commands).toEqual(['image:tool-brush']);
    expect(second.commands).toEqual([]);
  });

  it('applies analog stick thresholds, deadzone, sensitivity, and inversion', () => {
    const bindings = normalizeGamepadBindings({
      flow: {
        leftStickUp: {
          command: 'view:command-palette',
          threshold: 0.5,
          deadzone: 0.1,
          sensitivity: 1,
          inverted: true,
        },
      },
    });

    const result = resolveGamepadCommandEvents({
      bindings,
      workspace: 'flow',
      gamepad: gamepad({ axes: [0, 0.75, 0, 0] }),
      previousActiveControls: new Set(),
    });

    expect(result.commands).toEqual(['view:command-palette']);
  });

  it('exposes workspace scope tabs and per-workspace action maps for flow, video, image, and paper', () => {
    expect(GAMEPAD_WORKSPACE_SCOPES.map((scope) => scope.id)).toEqual(['flow', 'video', 'image', 'paper']);
    expect(getDefaultGamepadActionMap('flow').buttonSouth).toBe('view:command-palette');
    expect(getDefaultGamepadActionMap('video').rightTrigger).toBe('timeline:add-keyframe');
    expect(getDefaultGamepadActionMap('image').buttonSouth).toBe('image:tool-brush');
    expect(getDefaultGamepadActionMap('paper').dpadLeft).toBe('paper:add-speech-bubble');
  });

  it('supports video scope imports and reports validation issues for invalid commands and analog fields', () => {
    const result = validateGamepadBindingsImport({
      video: {
        buttonSouth: { command: 'timeline:select' },
        rightTrigger: {
          command: 'timeline:add-keyframe',
          threshold: 0.55,
          triggerMin: 0.25,
          triggerMax: 0.8,
        },
      },
      image: {
        buttonSouth: { command: 'paper:add-page' },
        leftStickUp: {
          command: 'image:tool-brush',
          curve: 'invalid',
          triggerMin: 0.9,
          triggerMax: 0.2,
        },
      },
    });

    expect(result.bindings.editor.buttonSouth.command).toBe('timeline:select');
    expect(result.bindings.editor.rightTrigger.triggerMin).toBe(0.25);
    expect(result.bindings.editor.rightTrigger.triggerMax).toBe(0.8);
    expect(result.bindings.image.buttonSouth.command).toBe('');
    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'image.buttonSouth.command' }),
        expect.objectContaining({ path: 'image.leftStickUp.curve' }),
        expect.objectContaining({ path: 'image.leftStickUp.triggerRange' }),
      ]),
    );
  });

  it('updates bindings immutably through workspace scope aliases', () => {
    const base = createDefaultGamepadBindings();
    const updated = updateGamepadBinding(base, 'video', 'dpadLeft', {
      command: 'timeline:previous-keyframe',
      threshold: 0.7,
    });

    expect(updated).not.toBe(base);
    expect(updated.editor).not.toBe(base.editor);
    expect(updated.flow).toBe(base.flow);
    expect(updated.editor.dpadLeft.command).toBe('timeline:previous-keyframe');
    expect(updated.editor.dpadLeft.threshold).toBe(0.7);
    expect(base.editor.dpadLeft.command).toBe('timeline:previous-keyframe');
    expect(base.editor.dpadLeft.threshold).toBe(0.5);
  });

  it('applies analog stick curve, deadzone, inversion, and sensitivity for axis controls', () => {
    const linear = normalizeGamepadBindings({
      flow: {
        leftStickUp: {
          command: 'view:command-palette',
          threshold: 0.7,
          deadzone: 0.1,
          sensitivity: 1,
          inverted: true,
          curve: 'linear',
        },
      },
    });
    const cubic = normalizeGamepadBindings({
      flow: {
        leftStickUp: {
          command: 'view:command-palette',
          threshold: 0.7,
          deadzone: 0.1,
          sensitivity: 1,
          inverted: true,
          curve: 'cubic',
        },
      },
    });

    const axisState = gamepad({ axes: [0, 0.85, 0, 0] });

    expect(resolveGamepadCommandEvents({
      bindings: linear,
      workspace: 'flow',
      gamepad: axisState,
      previousActiveControls: new Set(),
    }).commands).toEqual(['view:command-palette']);

    expect(resolveGamepadCommandEvents({
      bindings: cubic,
      workspace: 'flow',
      gamepad: axisState,
      previousActiveControls: new Set(),
    }).commands).toEqual([]);
  });

  it('applies trigger threshold and range controls without relying on device APIs', () => {
    const bindings = normalizeGamepadBindings({
      editor: {
        rightTrigger: {
          command: 'timeline:add-keyframe',
          threshold: 0.5,
          triggerMin: 0.25,
          triggerMax: 0.75,
        },
      },
    });

    const below = resolveGamepadCommandEvents({
      bindings,
      workspace: 'video',
      gamepad: gamepad({ buttons: Array.from({ length: 8 }, (_, index) => index === 7 ? { value: 0.3 } : {}) }),
      previousActiveControls: new Set(),
    });
    const above = resolveGamepadCommandEvents({
      bindings,
      workspace: 'video',
      gamepad: gamepad({ buttons: Array.from({ length: 8 }, (_, index) => index === 7 ? { value: 0.65 } : {}) }),
      previousActiveControls: new Set(),
    });

    expect(below.commands).toEqual([]);
    expect(above.commands).toEqual(['timeline:add-keyframe']);
  });

  it('exports sanitized bindings as workspace scopes without mutating the source profile', () => {
    const profile = normalizeGamepadBindings({
      video: {
        buttonSouth: { command: 'timeline:select' },
      },
      paper: {
        dpadUp: { command: 'paper:add-page' },
      },
    });

    const exported = exportGamepadBindings(profile);

    expect(Object.keys(exported)).toEqual(['flow', 'video', 'image', 'paper']);
    expect(exported.video.buttonSouth.command).toBe('timeline:select');
    expect(exported.paper.dpadUp.command).toBe('paper:add-page');

    exported.video.buttonSouth.command = '';

    expect(profile.editor.buttonSouth.command).toBe('timeline:select');
  });
});
