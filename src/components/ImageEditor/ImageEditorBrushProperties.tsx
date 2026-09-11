import { useSettingsStore } from '../../store/settingsStore';
import { AdvancedColorPicker } from '../Common/AdvancedColorPicker';
import { IMAGE_BRUSH_PRESETS } from './ImageBrushPresets';
import { BRUSH_TEXTURE_PRESETS, isBuiltInBrushTexture } from './ImageBrushTextures';
import { resolveActiveBrushState } from './brushActiveState';
import { detectBrushBackend } from '../../lib/brushEngine';
import { normalizeBrushSettings } from './ImageBrushEngine';
import { Slider } from './ImageEditorPropertyControls';
import { useImageEditorStore } from '../../store/imageEditorStore';
import type { EditorTool, RetouchSampleMode, RetouchToneRange } from '../../types/imageEditor';
import { getTiltmarkBrushPreset } from './tiltmark/TiltmarkCatalog';

const TONE_BRUSH_TOOLS = new Set<EditorTool>(['dodgeBrush', 'burnBrush']);
const SPONGE_BRUSH_TOOLS = new Set<EditorTool>(['spongeSaturateBrush', 'spongeDesaturateBrush']);
const SAMPLE_SOURCE_BRUSH_TOOLS = new Set<EditorTool>(['blurBrush', 'sharpenBrush']);
const FINISHING_BRUSH_TOOLS = new Set<EditorTool>([
  'blurBrush',
  'sharpenBrush',
  'smudgeBrush',
  'dodgeBrush',
  'burnBrush',
  'spongeSaturateBrush',
  'spongeDesaturateBrush',
]);

export function BrushPanel() {
  const settings = normalizeBrushSettings(useImageEditorStore((s) => s.brushSettings));
  const set = useImageEditorStore((s) => s.setBrushSettings);
  const tool = useImageEditorStore((s) => s.tool);
  const retouchToolSettings = useImageEditorStore((s) => s.retouchToolSettings);
  const setRetouchToolSettings = useImageEditorStore((s) => s.setRetouchToolSettings);
  const customBrushPresets = useSettingsStore((s) => s.customBrushPresets);
  const activeBrush = resolveActiveBrushState(settings, [...IMAGE_BRUSH_PRESETS, ...customBrushPresets]);
  const tiltmarkPreset = getTiltmarkBrushPreset(settings.tiltmarkPresetId);
  const brushBackend = detectBrushBackend(settings.gpuBrushEngine ? 'auto' : 'cpu').id;
  const brushBackendLabel = brushBackend === 'cpu' ? 'CPU · region-bounded' : brushBackend === 'webgl2' ? 'WebGL2' : 'WebGPU';

  return (
    <div className="space-y-3 text-xs text-cyan-100/60">
      <div className="text-[10px] uppercase tracking-[0.14em] text-cyan-100/35">
        {settings.brushEngine === 'tiltmark'
          ? `${tiltmarkPreset.name} · Tiltmark`
          : `${activeBrush.label}${activeBrush.modified ? ' · modified' : ''}`}
      </div>
      <Slider
        label="Size"
        value={settings.size}
        max={256}
        min={1}
        step={1}
        onChange={(v) => set({ size: v })}
        format={(v) => `${Math.round(v)}px`}
      />
      <Slider
        label="Opacity"
        value={settings.opacity}
        max={1}
        min={0}
        step={0.01}
        onChange={(v) => set({ opacity: v })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <Slider
        label="Hardness"
        value={settings.hardness}
        max={1}
        min={0}
        step={0.01}
        onChange={(v) => set({ hardness: v })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <Slider
        label="Flow"
        value={settings.flow}
        max={1}
        min={0}
        step={0.01}
        onChange={(v) => set({ flow: v })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      {settings.brushEngine === 'tiltmark' ? (
        <>
          <Slider
            ariaLabel="Wetness"
            label="Wetness"
            value={settings.tiltmarkWetness ?? tiltmarkPreset.wetness}
            max={1}
            min={0}
            step={0.01}
            onChange={(v) => set({ tiltmarkWetness: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <Slider
            ariaLabel="Solvent"
            label="Solvent"
            value={settings.tiltmarkSolvent ?? tiltmarkPreset.solvent}
            max={1}
            min={0}
            step={0.01}
            onChange={(v) => set({ tiltmarkSolvent: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <Slider
            ariaLabel="Pickup"
            label="Pickup"
            value={settings.tiltmarkPickup ?? tiltmarkPreset.pickup}
            max={1}
            min={0}
            step={0.01}
            onChange={(v) => set({ tiltmarkPickup: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <Slider
            ariaLabel="Grain"
            label="Grain"
            value={settings.tiltmarkGrain ?? tiltmarkPreset.grain}
            max={1}
            min={0}
            step={0.01}
            onChange={(v) => set({ tiltmarkGrain: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <div>
            <label className="mb-1 flex items-center justify-between">
              <span>Interaction</span>
              <span className="capitalize text-cyan-100/40">
                {settings.tiltmarkInteraction ?? tiltmarkPreset.interaction}
              </span>
            </label>
            <div className="grid grid-cols-4 gap-1" role="group" aria-label="Tiltmark interaction">
              {(['paint', 'smudge', 'mix', 'lift'] as const).map((interaction) => (
                <button
                  aria-pressed={(settings.tiltmarkInteraction ?? tiltmarkPreset.interaction) === interaction}
                  className={`rounded border px-1 py-1.5 text-[10px] font-semibold capitalize transition-colors ${
                    (settings.tiltmarkInteraction ?? tiltmarkPreset.interaction) === interaction
                      ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-50'
                      : 'border-cyan-300/10 bg-[#252630] text-cyan-100/60 hover:border-cyan-300/35'
                  }`}
                  key={interaction}
                  onClick={() => set({ tiltmarkInteraction: interaction })}
                  title={`${interaction[0].toUpperCase()}${interaction.slice(1)} interaction`}
                  type="button"
                >
                  {interaction}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}
      <Slider
        label="Spacing"
        value={settings.spacing}
        max={1.5}
        min={0.02}
        step={0.01}
        onChange={(v) => set({ spacing: v })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <Slider
        label="Roundness"
        value={settings.roundness}
        max={1}
        min={0.05}
        step={0.01}
        onChange={(v) => set({ roundness: v })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <Slider
        label="Angle"
        value={settings.angleDeg}
        max={359}
        min={0}
        step={1}
        onChange={(v) => set({ angleDeg: v })}
        format={(v) => `${Math.round(v)}°`}
      />
      <Slider
        label="Scatter"
        value={settings.scatter}
        max={2}
        min={0}
        step={0.01}
        onChange={(v) => set({ scatter: v })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <Slider
        label="Smoothing"
        value={settings.smoothing}
        max={1}
        min={0}
        step={0.01}
        onChange={(v) => set({ smoothing: v })}
        format={(v) => `${Math.round(v * 100)}%`}
      />
      <div className="rounded border border-cyan-300/10 bg-[#10131b] p-2">
        <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-cyan-100/35">Symmetry</div>
        <div className="grid grid-cols-2 gap-1">
          {[
            { label: 'Off', value: 'none' },
            { label: 'Vertical', value: 'vertical' },
            { label: 'Horizontal', value: 'horizontal' },
            { label: 'Four-Way', value: 'both' },
          ].map((option) => (
            <button
              className={`rounded border px-2 py-1 text-left text-[11px] hover:border-cyan-400/40 hover:text-white ${
                settings.symmetryMode === option.value
                  ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-50'
                  : 'border-cyan-300/10 bg-[#252630] text-cyan-100/65'
              }`}
              key={option.value}
              onClick={() => set({ symmetryMode: option.value as typeof settings.symmetryMode })}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-cyan-100/35">Centered on the active document.</p>
      </div>
      <div className="flex items-center gap-2">
        <label className="w-16">Tip</label>
        <select
          className="flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-0.5 text-xs text-cyan-100/80"
          onChange={(event) => set({ tipShape: event.target.value as typeof settings.tipShape })}
          value={settings.tipShape}
        >
          <option value="round">Round</option>
          <option value="square">Square</option>
        </select>
      </div>
      <div className="rounded border border-cyan-300/10 bg-[#10131b] p-2">
        <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-cyan-100/35">Pressure</div>
        <Slider
          label="Size"
          value={settings.pressureSize}
          max={1}
          min={0}
          step={0.01}
          onChange={(v) => set({ pressureSize: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Opacity"
          value={settings.pressureOpacity}
          max={1}
          min={0}
          step={0.01}
          onChange={(v) => set({ pressureOpacity: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Flow"
          value={settings.pressureFlow}
          max={1}
          min={0}
          step={0.01}
          onChange={(v) => set({ pressureFlow: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Roundness"
          ariaLabel="Pressure roundness"
          value={settings.pressureRoundness ?? 0}
          max={1}
          min={0}
          step={0.01}
          onChange={(v) => set({ pressureRoundness: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Hardness"
          ariaLabel="Pressure hardness"
          value={settings.pressureHardness ?? 0}
          max={1}
          min={0}
          step={0.01}
          onChange={(v) => set({ pressureHardness: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <div className="mt-2">
          <label className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-cyan-100/35">Curve</label>
          <div className="grid grid-cols-4 gap-1">
            {([
              { label: 'Linear', value: 'linear' },
              { label: 'Soft', value: 'soft' },
              { label: 'Hard', value: 'hard' },
              { label: 'S-Curve', value: 'sshape' },
            ] as const).map((option) => (
              <button
                aria-label={`Pressure curve ${option.label}`}
                className={`rounded border px-2 py-1 text-center text-[11px] hover:border-cyan-400/40 hover:text-white ${
                  (typeof settings.pressureCurve === 'string' ? settings.pressureCurve : 'linear') === option.value
                    ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-50'
                    : 'border-cyan-300/10 bg-[#252630] text-cyan-100/65'
                }`}
                key={option.value}
                onClick={() => set({ pressureCurve: option.value })}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="rounded border border-cyan-300/10 bg-[#10131b] p-2">
        <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-cyan-100/35">Tilt &amp; Rotation</div>
        <Slider
          label="Tilt Angle"
          value={settings.tiltAngle ?? 0.7}
          max={1}
          min={0}
          step={0.01}
          onChange={(v) => set({ tiltAngle: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Tilt Squash"
          value={settings.tiltRoundness ?? 0.6}
          max={1}
          min={0}
          step={0.01}
          onChange={(v) => set({ tiltRoundness: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Tilt Size"
          value={settings.tiltSize ?? 0.2}
          max={1}
          min={0}
          step={0.01}
          onChange={(v) => set({ tiltSize: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Tilt Opacity"
          ariaLabel="Tilt opacity"
          value={settings.tiltOpacity ?? 0}
          max={1}
          min={0}
          step={0.01}
          onChange={(v) => set({ tiltOpacity: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Tilt Flow"
          ariaLabel="Tilt flow"
          value={settings.tiltFlow ?? 0}
          max={1}
          min={0}
          step={0.01}
          onChange={(v) => set({ tiltFlow: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <label className="mt-2 flex items-center gap-2 text-xs text-cyan-100/80">
          <input
            type="checkbox"
            aria-label="Rotate tip with barrel twist"
            checked={settings.rotationFollowsTwist ?? true}
            onChange={(event) => set({ rotationFollowsTwist: event.target.checked })}
          />
          Rotate tip with barrel twist
        </label>
      </div>
      <div className="rounded border border-cyan-300/10 bg-[#10131b] p-2">
        <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-cyan-100/35">Jitter (Randomization)</div>
        <Slider
          label="Size jitter"
          ariaLabel="Size jitter"
          value={settings.sizeJitter ?? 0}
          max={1}
          min={0}
          step={0.01}
          onChange={(v) => set({ sizeJitter: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Opacity jitter"
          ariaLabel="Opacity jitter"
          value={settings.opacityJitter ?? 0}
          max={1}
          min={0}
          step={0.01}
          onChange={(v) => set({ opacityJitter: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Flow jitter"
          ariaLabel="Flow jitter"
          value={settings.flowJitter ?? 0}
          max={1}
          min={0}
          step={0.01}
          onChange={(v) => set({ flowJitter: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Roundness jitter"
          ariaLabel="Roundness jitter"
          value={settings.roundnessJitter ?? 0}
          max={1}
          min={0}
          step={0.01}
          onChange={(v) => set({ roundnessJitter: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Angle jitter"
          ariaLabel="Angle jitter"
          value={settings.angleJitter ?? 0}
          max={1}
          min={0}
          step={0.01}
          onChange={(v) => set({ angleJitter: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </div>
      <div className="rounded border border-cyan-300/10 bg-[#10131b] p-2">
        <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-cyan-100/35">Color Dynamics</div>
        <Slider
          label="Pressure → Color"
          value={settings.pressureColor ?? 0}
          max={1}
          min={0}
          step={0.01}
          onChange={(v) => set({ pressureColor: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          label="Tilt → Color"
          value={settings.tiltColor ?? 0}
          max={1}
          min={0}
          step={0.01}
          onChange={(v) => set({ tiltColor: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <div className="mt-1 text-[10px] leading-snug text-cyan-100/35">
          Blends each dab from the foreground toward the background colour as pressure/tilt increases.
        </div>
      </div>
      <div className="rounded border border-cyan-300/10 bg-[#10131b] p-2">
        <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-cyan-100/35">Advanced Dynamics</div>
        <Slider
          ariaLabel="Velocity size"
          label="Velocity Size"
          value={settings.velocitySize ?? 0}
          max={1}
          min={0}
          step={0.01}
          onChange={(v) => set({ velocitySize: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          ariaLabel="Velocity opacity"
          label="Velocity Opacity"
          value={settings.velocityOpacity ?? 0}
          max={1}
          min={0}
          step={0.01}
          onChange={(v) => set({ velocityOpacity: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          ariaLabel="Velocity flow"
          label="Velocity Flow"
          value={settings.velocityFlow ?? 0}
          max={1}
          min={0}
          step={0.01}
          onChange={(v) => set({ velocityFlow: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          ariaLabel="Velocity spacing"
          label="Velocity Spacing"
          value={settings.velocitySpacing ?? 0}
          max={1}
          min={0}
          step={0.01}
          onChange={(v) => set({ velocitySpacing: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <div className="mt-2 space-y-2">
          <label className="block text-[10px] uppercase tracking-[0.14em] text-cyan-100/35">Texture</label>
          <select
            aria-label="Brush texture"
            className="w-full rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-xs text-cyan-100/80"
            onChange={(event) => set({ texture: event.target.value || undefined })}
            value={settings.texture ?? ''}
          >
            <option value="">None</option>
            {BRUSH_TEXTURE_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.label}
              </option>
            ))}
            {settings.texture && !isBuiltInBrushTexture(settings.texture) ? (
              <option value={settings.texture}>{`Custom: ${settings.texture}`}</option>
            ) : null}
          </select>
          <Slider
            ariaLabel="Texture scale"
            label="Scale"
            value={settings.textureScale ?? 1}
            max={4}
            min={0.05}
            step={0.05}
            onChange={(v) => set({ textureScale: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <Slider
            ariaLabel="Texture depth"
            label="Depth"
            value={settings.textureDepth ?? 0}
            max={1}
            min={0}
            step={0.01}
            onChange={(v) => set({ textureDepth: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <label className="flex items-center gap-2 text-[11px] text-cyan-100/55">
            <input
              aria-label="Dual-brush composition"
              checked={Boolean(settings.dualBrush)}
              className="h-3.5 w-3.5 accent-cyan-300"
              onChange={(event) => set({ dualBrush: event.target.checked })}
              type="checkbox"
            />
            Dual-brush composition
          </label>
        </div>
        <div className="mt-2 space-y-2">
          <label className="flex items-center gap-2 text-[11px] text-cyan-100/55">
            <input
              aria-label="Wet media"
              checked={Boolean(settings.wetMedia)}
              className="h-3.5 w-3.5 accent-cyan-300"
              onChange={(event) => set({ wetMedia: event.target.checked, wetEdges: event.target.checked })}
              type="checkbox"
            />
            Wet media
          </label>
          <Slider
            ariaLabel="Wet media mix"
            label="Mix"
            value={settings.wetMix ?? 0}
            max={1}
            min={0}
            step={0.01}
            onChange={(v) => set({ wetMix: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <Slider
            ariaLabel="Wet media load"
            label="Load"
            value={settings.wetLoad ?? 1}
            max={1}
            min={0}
            step={0.01}
            onChange={(v) => set({ wetLoad: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
          <Slider
            ariaLabel="Wet media pull"
            label="Pull"
            value={settings.wetPull ?? 0}
            max={1}
            min={0}
            step={0.01}
            onChange={(v) => set({ wetPull: v })}
            format={(v) => `${Math.round(v * 100)}%`}
          />
        </div>
        <div className="mt-2 grid grid-cols-1 gap-1">
          <label className="flex items-center gap-2 text-[11px] text-cyan-100/55">
            <input
              aria-label="GPU brush engine"
              checked={Boolean(settings.gpuBrushEngine)}
              className="h-3.5 w-3.5 accent-cyan-300"
              onChange={(event) => set({ gpuBrushEngine: event.target.checked, gpuAcceleration: event.target.checked })}
              type="checkbox"
            />
            GPU acceleration ({brushBackendLabel})
          </label>
          <label className="flex items-center gap-2 text-[11px] text-cyan-100/55">
            <input
              aria-label="Android brush controls"
              checked={Boolean(settings.androidBrushControls)}
              className="h-3.5 w-3.5 accent-cyan-300"
              onChange={(event) => set({ androidBrushControls: event.target.checked, androidStylusControls: event.target.checked })}
              type="checkbox"
            />
            Android brush controls
          </label>
          <label className="flex items-center gap-2 text-[11px] text-cyan-100/55">
            <input
              aria-label="Gamepad brush controls"
              checked={Boolean(settings.gamepadBrushControls)}
              className="h-3.5 w-3.5 accent-cyan-300"
              onChange={(event) => set({ gamepadBrushControls: event.target.checked, gamepadPressure: event.target.checked })}
              type="checkbox"
            />
            Gamepad brush controls
          </label>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <input
            aria-label="ABR preset id"
            className="min-w-0 rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-xs text-cyan-100/80"
            onChange={(event) => set({ abrPresetId: event.target.value || undefined })}
            placeholder="ABR preset id"
            type="text"
            value={settings.abrPresetId ?? ''}
          />
          <input
            aria-label="ABR version"
            className="min-w-0 rounded border border-cyan-300/10 bg-[#252630] px-2 py-1 text-xs text-cyan-100/80"
            min={0}
            onChange={(event) => set({ abrVersion: Number.parseInt(event.target.value, 10) || undefined })}
            placeholder="ABR version"
            type="number"
            value={settings.abrVersion ?? ''}
          />
        </div>
      </div>
      <div className="rounded border border-cyan-300/10 bg-[#10131b] p-2">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-[0.14em] text-cyan-100/35">Mixer</div>
          <label className="flex items-center gap-1.5 text-[11px] text-cyan-100/55">
            <input
              aria-label="Mixer enabled"
              checked={settings.mixerEnabled ?? false}
              className="h-3.5 w-3.5 accent-cyan-300"
              onChange={(event) => set({ mixerEnabled: event.target.checked })}
              type="checkbox"
            />
            Enable
          </label>
        </div>
        <Slider
          ariaLabel="Mixer smudge length"
          label="Smudge Len"
          value={settings.smudgeLength ?? 0.5}
          max={1}
          min={0}
          step={0.01}
          onChange={(v) => set({ smudgeLength: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          ariaLabel="Mixer smudge radius"
          label="Smudge Rad"
          value={settings.smudgeRadius ?? 12}
          max={64}
          min={1}
          step={1}
          onChange={(v) => set({ smudgeRadius: v })}
          format={(v) => `${Math.round(v)}px`}
        />
        <Slider
          ariaLabel="Mixer color rate"
          label="Color Rate"
          value={settings.colorRate ?? 0.5}
          max={1}
          min={0}
          step={0.01}
          onChange={(v) => set({ colorRate: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <div className="mt-2">
          <label className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-cyan-100/35">Mix Mode</label>
          <div className="grid grid-cols-2 gap-1">
            {([{ label: 'RGB', value: 'rgb' }, { label: 'Spectral', value: 'spectral' }] as const).map((option) => (
              <button
                className={`rounded border px-2 py-1 text-left text-[11px] hover:border-cyan-400/40 hover:text-white ${
                  (settings.mixMode ?? 'rgb') === option.value
                    ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-50'
                    : 'border-cyan-300/10 bg-[#252630] text-cyan-100/65'
                }`}
                key={option.value}
                onClick={() => set({ mixMode: option.value })}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-2">
          <label className="mb-1 block text-[10px] uppercase tracking-[0.14em] text-cyan-100/35">Smudge Mode</label>
          <div className="grid grid-cols-2 gap-1">
            {([{ label: 'Dulling', value: 'dulling' }, { label: 'Smearing', value: 'smearing' }] as const).map((option) => (
              <button
                className={`rounded border px-2 py-1 text-left text-[11px] hover:border-cyan-400/40 hover:text-white ${
                  (settings.smudgeMode ?? 'dulling') === option.value
                    ? 'border-cyan-300/60 bg-cyan-400/15 text-cyan-50'
                    : 'border-cyan-300/10 bg-[#252630] text-cyan-100/65'
                }`}
                key={option.value}
                onClick={() => set({ smudgeMode: option.value })}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="rounded border border-cyan-300/10 bg-[#10131b] p-2">
        <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-cyan-100/35">Dry Brush</div>
        <Slider
          ariaLabel="Dry brush fade length"
          label="Fade Length"
          value={settings.fadeLength ?? 0}
          max={40}
          min={0}
          step={1}
          onChange={(v) => set({ fadeLength: v })}
          format={(v) => `${Math.round(v)} dabs`}
        />
        <Slider
          ariaLabel="Dry brush paint load"
          label="Paint Load"
          value={settings.paintLoad ?? 1}
          max={1}
          min={0}
          step={0.01}
          onChange={(v) => set({ paintLoad: v })}
          format={(v) => `${Math.round(v * 100)}%`}
        />
        <Slider
          ariaLabel="Dry brush load falloff"
          label="Load Falloff"
          value={settings.loadFalloff ?? 0}
          max={0.02}
          min={0}
          step={0.001}
          onChange={(v) => set({ loadFalloff: v })}
          format={(v) => v.toFixed(3)}
        />
      </div>
      <div className="flex items-center gap-2">
        <label className="w-16">Color</label>
        <AdvancedColorPicker
          className="h-6 w-12"
          buttonClassName="rounded border border-cyan-300/10"
          label="Brush color"
          onChange={(color) => set({ color })}
          value={settings.color}
        />
        <input
          className="flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-0.5 text-xs text-cyan-100/80"
          onChange={(e) => set({ color: e.target.value })}
          type="text"
          value={settings.color}
        />
      </div>
      <CloneStampHint />
      <SpotHealHint />
      {tool === 'cloneStamp' || tool === 'spotHeal' ? (
        <div className="rounded border border-cyan-300/10 bg-[#10131b] p-2">
          <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-cyan-100/35">Retouch Source</div>
          <div className="mb-2 flex items-center gap-2">
            <label className="w-16">Sample</label>
            <select
              aria-label="Retouch sample mode"
              className="flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-0.5 text-xs text-cyan-100/80"
              onChange={(event) => setRetouchToolSettings({ sampleMode: event.target.value as typeof retouchToolSettings.sampleMode })}
              value={retouchToolSettings.sampleMode}
            >
              <option value="currentLayer">Current Layer</option>
              <option value="currentAndBelow">Current & Below</option>
              <option value="allLayers">All Layers</option>
            </select>
          </div>
          {tool === 'cloneStamp' ? (
            <label className="flex items-center gap-2 text-[11px] text-cyan-100/55">
              <input
                aria-label="Aligned clone stamp"
                checked={retouchToolSettings.aligned}
                className="h-3.5 w-3.5 accent-cyan-300"
                onChange={(event) => setRetouchToolSettings({ aligned: event.target.checked })}
                type="checkbox"
              />
              Aligned
            </label>
          ) : null}
        </div>
      ) : null}
      <FinishingBrushOptions />
      <BlurBrushHint />
      <SharpenBrushHint />
      <SmudgeBrushHint />
      <DodgeBurnHint />
      <SpongeBrushHint />
    </div>
  );
}

function FinishingBrushOptions() {
  const tool = useImageEditorStore((s) => s.tool);
  const retouchToolSettings = useImageEditorStore((s) => s.retouchToolSettings);
  const setRetouchToolSettings = useImageEditorStore((s) => s.setRetouchToolSettings);
  if (!FINISHING_BRUSH_TOOLS.has(tool)) return null;
  const isToneBrush = TONE_BRUSH_TOOLS.has(tool);
  const rateLabel = isToneBrush ? 'Dodge and burn rate' : 'Sponge rate';
  const rateFormatLabel = `${Math.round(retouchToolSettings.rate * 100)}%`;

  return (
    <div className="rounded border border-cyan-300/10 bg-[#10131b] p-2">
      <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-cyan-100/35">Finishing Brush</div>
      <div className="mb-2 grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[11px]">
        <span className="text-cyan-100/40">Source</span>
        <span className="text-cyan-100/65">{finishingBrushSourceLabel(tool)}</span>
        <span className="text-cyan-100/40">Strength</span>
        <span className="text-cyan-100/65">Brush opacity</span>
      </div>
      {(TONE_BRUSH_TOOLS.has(tool) || SPONGE_BRUSH_TOOLS.has(tool)) ? (
        <div className="mb-2 flex items-center gap-2">
          <label className="w-16">Output</label>
          <select
            aria-label="Retouch output mode"
            className="flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-0.5 text-xs text-cyan-100/80"
            onChange={(event) => setRetouchToolSettings({ outputMode: event.target.value as typeof retouchToolSettings.outputMode })}
            value={retouchToolSettings.outputMode}
          >
            <option value="activeLayer">Active Layer</option>
            <option value="newLayer">New Retouch Layer</option>
          </select>
        </div>
      ) : null}
      {SAMPLE_SOURCE_BRUSH_TOOLS.has(tool) ? (
        <div className="mb-2 flex items-center gap-2">
          <label className="w-16">Sample</label>
          <select
            aria-label="Finishing brush sample mode"
            className="flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-0.5 text-xs text-cyan-100/80"
            onChange={(event) => setRetouchToolSettings({ sampleMode: event.target.value as RetouchSampleMode })}
            value={retouchToolSettings.sampleMode}
          >
            <option value="currentLayer">Current Layer</option>
            <option value="currentAndBelow">Current & Below</option>
            <option value="allLayers">All Layers</option>
          </select>
        </div>
      ) : null}
      {TONE_BRUSH_TOOLS.has(tool) ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <label className="w-16">Range</label>
            <select
              aria-label="Dodge and burn tonal range"
              className="flex-1 rounded border border-cyan-300/10 bg-[#252630] px-1.5 py-0.5 text-xs text-cyan-100/80"
              onChange={(event) => setRetouchToolSettings({ toneRange: event.target.value as RetouchToneRange })}
              value={retouchToolSettings.toneRange}
            >
              <option value="all">All Tones</option>
              <option value="shadows">Shadows</option>
              <option value="midtones">Midtones</option>
              <option value="highlights">Highlights</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-cyan-100/55">
            <input
              aria-label="Protect tones"
              checked={retouchToolSettings.protectTones}
              className="h-3.5 w-3.5 accent-cyan-300"
              onChange={(event) => setRetouchToolSettings({ protectTones: event.target.checked })}
              type="checkbox"
            />
            Protect tones
          </label>
        </div>
      ) : null}
      {(TONE_BRUSH_TOOLS.has(tool) || SPONGE_BRUSH_TOOLS.has(tool)) ? (
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-[11px] text-cyan-100/55">
            <input
              aria-label="Airbrush"
              checked={retouchToolSettings.airbrush}
              className="h-3.5 w-3.5 accent-cyan-300"
              onChange={(event) => setRetouchToolSettings({ airbrush: event.target.checked })}
              type="checkbox"
            />
            Airbrush
          </label>
          <Slider
            ariaLabel={rateLabel}
            label="Rate"
            value={retouchToolSettings.rate}
            max={1}
            min={0}
            step={0.01}
            onChange={(value) => setRetouchToolSettings({ rate: value })}
            format={() => rateFormatLabel}
          />
        </div>
      ) : null}
      {SPONGE_BRUSH_TOOLS.has(tool) ? (
        <div className="space-y-2">
          <Slider
            ariaLabel="Sponge vibrance"
            label="Vibrance"
            value={retouchToolSettings.spongeVibrance}
            max={1}
            min={0}
            step={0.01}
            onChange={(value) => setRetouchToolSettings({ spongeVibrance: value })}
            format={(value) => `${Math.round(value * 100)}%`}
          />
          <label className="flex items-center gap-2 text-[11px] text-cyan-100/55">
            <input
              aria-label="Preserve sponge luminosity"
              checked={retouchToolSettings.spongePreserveLuminosity}
              className="h-3.5 w-3.5 accent-cyan-300"
              onChange={(event) => setRetouchToolSettings({ spongePreserveLuminosity: event.target.checked })}
              type="checkbox"
            />
            Preserve luminosity
          </label>
        </div>
      ) : null}
    </div>
  );
}

function finishingBrushSourceLabel(tool: EditorTool): string {
  if (tool === 'smudgeBrush') return 'Previous stroke point';
  if (tool === 'blurBrush' || tool === 'sharpenBrush') return 'Selectable layer/composite snapshot';
  return 'Active layer pixels';
}

export function CloneStampHint() {
  const tool = useImageEditorStore((s) => s.tool);
  if (tool !== 'cloneStamp') return null;
  return (
    <p className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1.5 text-[11px] text-cyan-100/45">
      Alt-click a source point, then paint to clone sampled pixels. Size and opacity use the brush controls above.
    </p>
  );
}

export function SpongeBrushHint() {
  const tool = useImageEditorStore((s) => s.tool);
  if (tool !== 'spongeSaturateBrush' && tool !== 'spongeDesaturateBrush') return null;
  return (
    <p className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1.5 text-[11px] text-cyan-100/45">
      Paint to {tool === 'spongeSaturateBrush' ? 'increase' : 'reduce'} local saturation. Opacity controls strength; Vibrance and Preserve luminosity refine color response.
    </p>
  );
}

export function DodgeBurnHint() {
  const tool = useImageEditorStore((s) => s.tool);
  if (tool !== 'dodgeBrush' && tool !== 'burnBrush') return null;
  return (
    <p className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1.5 text-[11px] text-cyan-100/45">
      Paint to {tool === 'dodgeBrush' ? 'brighten' : 'darken'} local tones. Size controls the affected area; opacity controls exposure strength.
    </p>
  );
}

export function SmudgeBrushHint() {
  const tool = useImageEditorStore((s) => s.tool);
  if (tool !== 'smudgeBrush') return null;
  return (
    <p className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1.5 text-[11px] text-cyan-100/45">
      Drag to smear pixels along the stroke. Size controls the affected area; opacity controls smudge strength.
    </p>
  );
}

export function SharpenBrushHint() {
  const tool = useImageEditorStore((s) => s.tool);
  if (tool !== 'sharpenBrush') return null;
  return (
    <p className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1.5 text-[11px] text-cyan-100/45">
      Paint to add local contrast. Size controls the affected area; opacity controls sharpening strength.
    </p>
  );
}

export function BlurBrushHint() {
  const tool = useImageEditorStore((s) => s.tool);
  if (tool !== 'blurBrush') return null;
  return (
    <p className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1.5 text-[11px] text-cyan-100/45">
      Paint to soften local detail. Size controls the affected area; opacity controls blur strength.
    </p>
  );
}

export function SpotHealHint() {
  const tool = useImageEditorStore((s) => s.tool);
  if (tool !== 'spotHeal') return null;
  return (
    <p className="rounded border border-cyan-300/10 bg-[#10131b] px-2 py-1.5 text-[11px] text-cyan-100/45">
      Paint over small blemishes to blend them from nearby pixels. Size and opacity use the brush controls above.
    </p>
  );
}
