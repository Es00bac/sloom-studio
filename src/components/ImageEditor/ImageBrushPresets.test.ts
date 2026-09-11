import { describe, expect, it } from 'vitest';
import * as BrushPresets from './ImageBrushPresets';
import {
  BRUSH_PRESET_GROUPS,
  IMAGE_BRUSH_PRESETS,
  applyBrushPreset,
  describeUserBrushPresetPackSerialization,
  getBrushPreset,
  validateImageBrushPresetPack,
} from './ImageBrushPresets';
import { DEFAULT_BRUSH_SETTINGS } from '../../types/imageEditor';

describe('ImageBrushPresets', () => {
  it('indexes built-in brush presets by category and compatibility for deterministic parity lookup', () => {
    const basicRound = BrushPresets.findBrushPresetsByCategory('basic-round');
    const softRound = BrushPresets.findBrushPresetsByCategory('soft-round');
    const hardRound = BrushPresets.findBrushPresetsByCategory('hard-round');
    const inking = BrushPresets.findBrushPresetsByCategory('pencil-inking');
    const airbrush = BrushPresets.findBrushPresetsByCategory('airbrush');
    const texture = BrushPresets.findBrushPresetsByCategory('texture');
    const smudgeRetouch = BrushPresets.findBrushPresetsByCategory('smudge-retouch');
    const erasers = BrushPresets.findBrushPresetsByCategory('eraser');

    const byId = (categories: string[]) => categories.sort();

    expect(byId(basicRound.map((preset) => preset.id))).toEqual(expect.arrayContaining(['hardRound', 'softRound']));
    expect(softRound.map((preset) => preset.id)).toContain('softRound');
    expect(hardRound.map((preset) => preset.id)).toContain('hardRound');
    expect(byId(inking.map((preset) => preset.id))).toEqual(expect.arrayContaining(['pencil', 'inker', 'brushPen', 'calligraphyChisel', 'technicalLiner']));
    expect(byId(airbrush.map((preset) => preset.id))).toContain('airbrush');
    expect(byId(texture.map((preset) => preset.id))).toEqual(expect.arrayContaining(['textureStipple', 'screentoneDots', 'dryBrush']));
    expect(byId(smudgeRetouch.map((preset) => preset.id))).toEqual(expect.arrayContaining(['airbrush', 'watercolorWash', 'gouacheFlat']));
    expect(byId(erasers.map((preset) => preset.id))).toEqual(expect.arrayContaining(['softEraser', 'hardEraser']));

    expect(BrushPresets.filterBrushPresetsByCompatibility({ erase: true }).map((preset) => preset.id)).toEqual(
      expect.arrayContaining(['softEraser', 'hardEraser']),
    );
    expect(
      BrushPresets.filterBrushPresetsByCompatibility({ paint: false, erase: true }).map((preset) => preset.id),
    ).toEqual(expect.arrayContaining(['softEraser', 'hardEraser']));
    expect(
      BrushPresets.filterBrushPresetsByCompatibility({ retouch: true }).length,
    ).toBeGreaterThanOrEqual(5);
    expect(BrushPresets.filterBrushPresetsByCompatibility({ mask: true }).every((preset) => preset.compatibility.mask)).toBe(true);
  });

  it('describes built-in brush presets with stable IDs, names, categories, and workflow compatibility', () => {
    const round = BrushPresets.describeImageBrushPreset(getBrushPreset('hardRound')!, 'built-in');
    const ink = BrushPresets.describeImageBrushPreset(getBrushPreset('brushPen')!, 'built-in');
    const retouch = BrushPresets.describeImageBrushPreset(getBrushPreset('airbrush')!, 'built-in');
    const eraser = BrushPresets.describeImageBrushPreset(getBrushPreset('softEraser')!, 'built-in');

    expect(round).toMatchObject({
      id: 'hardRound',
      label: 'Hard Round',
      category: 'hard-round',
      categories: expect.arrayContaining(['basic-round', 'hard-round']),
      useCases: expect.arrayContaining(['paint', 'linework']),
      compatibility: {
        paint: true,
        erase: false,
        mask: true,
        retouch: false,
      },
      settings: expect.objectContaining({
        size: expect.any(Number),
        hardness: expect.any(Number),
        spacing: expect.any(Number),
        opacity: expect.any(Number),
        flow: expect.any(Number),
        smoothing: expect.any(Number),
      }),
    });

    expect(ink).toMatchObject({
      id: 'brushPen',
      category: 'pencil-inking',
      compatibility: {
        paint: true,
        erase: false,
        mask: true,
        retouch: true,
      },
      tags: expect.arrayContaining([
        expect.stringContaining('origin:built-in'),
        expect.stringContaining('workflow:ink'),
        'group:ink',
      ]),
    });

    expect(retouch).toMatchObject({
      id: 'airbrush',
      category: 'airbrush',
      compatibility: {
        paint: true,
        erase: false,
        mask: true,
        retouch: true,
      },
    });

    expect(eraser).toMatchObject({
      id: 'softEraser',
      category: 'eraser',
      compatibility: {
        paint: false,
        erase: true,
        mask: true,
        retouch: false,
      },
    });
  });

  it('provides a broader standard brush library for painting, inking, manga, effects, and erasing', () => {
    expect(IMAGE_BRUSH_PRESETS).toHaveLength(173);
    expect(IMAGE_BRUSH_PRESETS.map((preset) => preset.id)).toEqual(expect.arrayContaining([
      'pencil',
      'hardRound',
      'softRound',
      'marker',
      'airbrush',
      'inker',
      'mangaInker',
      'brushPen',
      'dryBrush',
      'charcoal',
      'watercolorWash',
      'gouacheFlat',
      'screentoneDots',
      'speedLine',
      'storyboardBlue',
      'softEraser',
      'hardEraser',
      'calligraphyChisel',
      'halftoneBlock',
      'oilBristle',
      'cloudGlaze',
      'fxSpark',
      'rimLight',
      'textureStipple',
    ]));
    expect(BRUSH_PRESET_GROUPS).toEqual(expect.arrayContaining([
      'Sketch',
      'Ink',
      'Paint',
      'Comic / Manga',
      'FX',
      'Utility',
      'Graphite & Pencil',
      'Charcoal & Conté',
      'Pastel & Chalk',
      'Watercolor',
      'Oils & Acrylics',
      'Digital Paint',
      'Texture & Stamps',
      'FX & Light',
      'Blend & Smudge',
    ]));
    expect(IMAGE_BRUSH_PRESETS.filter((preset) => preset.id.startsWith('media-'))).toHaveLength(144);
    expect(IMAGE_BRUSH_PRESETS.some((preset) => (preset.settings.pressureColor ?? 0) > 0)).toBe(true);
    expect(IMAGE_BRUSH_PRESETS.some((preset) => (preset.settings.tiltColor ?? 0) > 0)).toBe(true);
    expect(IMAGE_BRUSH_PRESETS.some((preset) => preset.settings.rotationFollowsTwist)).toBe(true);
    expect(IMAGE_BRUSH_PRESETS.some((preset) => (preset.settings.angleJitter ?? 0) > 0)).toBe(true);
    expect(IMAGE_BRUSH_PRESETS.some((preset) => preset.settings.wetMedia)).toBe(true);
    expect(IMAGE_BRUSH_PRESETS.some((preset) => preset.settings.mixerEnabled)).toBe(true);
  });

  it('applies a preset without discarding the current color unless preset supplies one', () => {
    const current = { ...DEFAULT_BRUSH_SETTINGS, color: '#ff00ff' };

    expect(applyBrushPreset(current, getBrushPreset('marker')!)).toMatchObject({
      presetId: 'marker',
      size: 24,
      opacity: 0.76,
      hardness: 0.74,
      flow: 0.62,
      spacing: 0.055,
      roundness: 0.7,
      color: '#ff00ff',
    });
    expect(applyBrushPreset(current, getBrushPreset('storyboardBlue')!).color).toBe('#38bdf8');
  });

  it('does not leak the previous brush engine into the newly selected tool', () => {
    const current = {
      ...DEFAULT_BRUSH_SETTINGS,
      color: '#31c48d',
      mixerEnabled: true,
      wetMedia: true,
      wetEdges: true,
      wetMix: 0.9,
      wetPull: 0.8,
      texture: 'spatter',
      textureDepth: 0.9,
      dualBrush: true,
      scatter: 1.5,
      sizeJitter: 0.8,
      velocitySize: 0.7,
    };
    const pencil = getBrushPreset('media-graphite-2b-sketch');

    expect(pencil).toBeDefined();
    const applied = applyBrushPreset(current, pencil!);

    expect(applied.color).toBe('#31c48d');
    expect(applied.mixerEnabled).toBe(false);
    expect(applied.wetMedia).toBe(false);
    expect(applied.wetEdges).toBe(false);
    expect(applied.dualBrush).toBe(false);
    expect(applied.velocitySize).toBe(0);
    expect(applied.scatter).toBe(pencil!.settings.scatter ?? 0);
    expect(applied.texture).toBe(pencil!.settings.texture);
  });

  it('round-trips user preset packs through JSON export and import helpers', () => {
    const api = BrushPresets as typeof BrushPresets & {
      exportUserBrushPresetPack?: (presets: unknown[]) => string;
      importUserBrushPresetPack?: (json: string) => Array<{ label: string; group: string; settings: Record<string, unknown> }>;
    };

    expect(typeof api.exportUserBrushPresetPack).toBe('function');
    expect(typeof api.importUserBrushPresetPack).toBe('function');

    const json = api.exportUserBrushPresetPack?.([
      {
        id: 'user-soft-shader',
        label: 'Soft Shader',
        group: 'User',
        settings: {
          size: 72,
          opacity: 0.34,
          hardness: 0.12,
          flow: 0.45,
          spacing: 0.1,
          roundness: 1,
          angleDeg: 0,
          scatter: 0.08,
          smoothing: 0.4,
          pressureSize: 0.55,
          pressureOpacity: 0.15,
          pressureFlow: 0.65,
          tipShape: 'round',
          color: '#ffffff',
        },
      },
    ]);
    const imported = api.importUserBrushPresetPack?.(json ?? '');

    expect(imported?.[0]).toMatchObject({
      label: 'Soft Shader',
      group: 'User',
      settings: {
        size: 72,
        tipShape: 'round',
      },
    });
  });

  it('builds deterministic library descriptors for built-in and user presets', () => {
    const api = BrushPresets as typeof BrushPresets & {
      describeImageBrushPresetLibrary?: (userPresets?: unknown[]) => {
        descriptorId: string;
        counts: { builtIn: number; user: number; total: number };
        groups: Record<string, number>;
        tags: string[];
        presets: Array<{
          id: string;
          label: string;
          origin: string;
          tags: string[];
          preview: {
            deterministic: boolean;
            signature: string;
            tileViewBox: string;
            sampleDabCount: number;
          };
          importExport: {
            storage: string;
            importableFromPack: boolean;
            exportableToPack: boolean;
            packVersion: number;
          };
          unsupportedWarnings: Array<{ field: string; category: string }>;
        }>;
        importExport: {
          packVersion: number;
          exportableUserPresets: number;
          importableUserPresets: number;
          builtInsBundled: number;
          ready: boolean;
        };
        unsupportedWarnings: Array<{ presetId?: string; field: string; category: string }>;
      };
    };

    expect(typeof api.describeImageBrushPresetLibrary).toBe('function');

    const userPresets = [
      {
        id: 'user-imported-mixer',
        label: 'Imported Mixer',
        group: 'User',
        settings: {
          size: 64,
          opacity: 0.8,
          hardness: 0.33,
          flow: 0.5,
          spacing: 0.42,
          scatter: 0.4,
          tipShape: 'square',
          pressureSize: 0.2,
          pressureAngle: 0.5,
          colorJitter: 0.7,
        },
      },
    ];

    const descriptor = api.describeImageBrushPresetLibrary?.(userPresets);
    const secondDescriptor = api.describeImageBrushPresetLibrary?.(userPresets);

    expect(secondDescriptor).toEqual(descriptor);
    expect(descriptor).toMatchObject({
      descriptorId: 'image-brush-preset-library:v1',
      counts: {
        builtIn: IMAGE_BRUSH_PRESETS.length,
        user: 1,
        total: IMAGE_BRUSH_PRESETS.length + 1,
      },
      importExport: {
        packVersion: 1,
        exportableUserPresets: 1,
        importableUserPresets: 1,
        builtInsBundled: IMAGE_BRUSH_PRESETS.length,
        ready: true,
      },
    });
    expect(descriptor?.groups).toMatchObject({
      Sketch: 4,
      User: 1,
    });
    expect(descriptor?.tags).toEqual(expect.arrayContaining([
      'origin:built-in',
      'origin:user',
      'workflow:sketch',
      'workflow:texture',
      'dynamic:pressure',
      'dynamic:scatter',
      'readiness:exportable',
    ]));

    const pencil = descriptor?.presets.find((preset) => preset.id === 'pencil');
    expect(pencil).toMatchObject({
      label: 'HB / No. 2 Pencil',
      origin: 'built-in',
      tags: expect.arrayContaining(['origin:built-in', 'group:sketch', 'workflow:sketch', 'dynamic:pressure']),
      preview: {
        deterministic: true,
        tileViewBox: '0 0 72 18',
        sampleDabCount: 6,
      },
      importExport: {
        storage: 'bundled',
        importableFromPack: false,
        exportableToPack: false,
        packVersion: 1,
      },
      unsupportedWarnings: [],
    });
    expect(pencil?.preview.signature).toBe('4:0.04:0.72:0.18:17:6,9->66,9:61');

    const user = descriptor?.presets.find((preset) => preset.id === 'user-imported-mixer');
    expect(user?.tags).toEqual(expect.arrayContaining([
      'origin:user',
      'group:user',
      'workflow:texture',
      'dynamic:scatter',
      'tip:square',
      'readiness:importable',
      'readiness:exportable',
    ]));
    expect(user?.unsupportedWarnings.map((warning) => `${warning.field}:${warning.category}`)).toEqual([
      'pressureAngle:pressure',
      'colorJitter:randomization',
    ]);
    expect(descriptor?.unsupportedWarnings.map((warning) => `${warning.presetId}:${warning.field}`)).toEqual([
      'user-imported-mixer:pressureAngle',
      'user-imported-mixer:colorJitter',
    ]);
  });

  it('exports user preset packs with deterministic descriptor metadata for import readiness', () => {
    const json = BrushPresets.exportUserBrushPresetPack([
      {
        id: 'user-soft-shader',
        label: 'Soft Shader',
        group: 'User',
        settings: {
          size: 72,
          opacity: 0.34,
          hardness: 0.12,
          flow: 0.45,
          spacing: 0.1,
          roundness: 1,
          angleDeg: 0,
          scatter: 0.08,
          smoothing: 0.4,
          pressureSize: 0.55,
          pressureOpacity: 0.15,
          pressureFlow: 0.65,
          tipShape: 'round',
          color: '#ffffff',
        },
      },
    ]);
    const parsed = JSON.parse(json) as {
      metadata?: {
        descriptorId: string;
        importExport: {
          packVersion: number;
          exportableUserPresets: number;
          importableUserPresets: number;
          ready: boolean;
        };
        tags: string[];
        unsupportedWarnings: unknown[];
      };
      presets: Array<{
        metadata?: {
          origin: string;
          tags: string[];
          preview: { deterministic: boolean; signature: string; sampleDabCount: number };
          importExport: { storage: string; importableFromPack: boolean; exportableToPack: boolean };
          unsupportedWarnings: unknown[];
        };
      }>;
    };

    expect(parsed.metadata).toMatchObject({
      descriptorId: 'image-brush-preset-pack:v1',
      importExport: {
        packVersion: 1,
        exportableUserPresets: 1,
        importableUserPresets: 1,
        ready: true,
      },
      unsupportedWarnings: [],
    });
    expect(parsed.metadata?.tags).toEqual(expect.arrayContaining([
      'origin:user',
      'workflow:utility',
      'dynamic:pressure',
      'readiness:importable',
      'readiness:exportable',
    ]));
    expect(parsed.presets[0].metadata).toMatchObject({
      origin: 'user',
      tags: expect.arrayContaining(['origin:user', 'group:user', 'dynamic:pressure']),
      preview: {
        deterministic: true,
        sampleDabCount: 6,
      },
      importExport: {
        storage: 'localStorage',
        importableFromPack: true,
        exportableToPack: true,
      },
      unsupportedWarnings: [],
    });
    expect(parsed.presets[0].metadata?.preview.signature).toBe('72:0.1:0.72:0.4:17:6,9->66,9:10');
  });

  it('plans user preset pack serialization with portable warnings and stable signatures', () => {
    const plan = describeUserBrushPresetPackSerialization([
      {
        id: 'user-calligraphy-port',
        label: 'Calligraphy Port',
        group: 'User',
        settings: {
          size: 40,
          opacity: 0.8,
          hardness: 0.6,
          flow: 0.7,
          spacing: 0.2,
          smoothing: 0.3,
          pressureSize: 0.45,
          pressureAngle: 0.8,
          colorJitter: 0.5,
          symmetryMode: 'vertical',
          color: '#ffcc00',
        },
      },
    ]);
    const secondPlan = describeUserBrushPresetPackSerialization([
      {
        id: 'user-calligraphy-port',
        label: 'Calligraphy Port',
        group: 'User',
        settings: {
          size: 40,
          opacity: 0.8,
          hardness: 0.6,
          flow: 0.7,
          spacing: 0.2,
          smoothing: 0.3,
          pressureSize: 0.45,
          pressureAngle: 0.8,
          colorJitter: 0.5,
          symmetryMode: 'vertical',
          color: '#ffcc00',
        },
      },
    ]);

    expect(secondPlan).toEqual(plan);
    expect(plan).toMatchObject({
      descriptorId: 'image-brush-preset-pack-serialization:v1',
      version: 1,
      packVersion: 1,
      presetCount: 1,
      portable: false,
      previewSignatures: ['40:0.2:0.72:0.3:17:6,9->66,9:9'],
      symmetryModes: ['vertical'],
      unsupportedWarnings: [
        expect.objectContaining({ field: 'pressureAngle', category: 'pressure', presetId: 'user-calligraphy-port' }),
        expect.objectContaining({ field: 'colorJitter', category: 'randomization', presetId: 'user-calligraphy-port' }),
      ],
    });
    expect(plan.portabilityWarnings).toEqual([
      'Calligraphy Port uses fixed color #ffcc00; importing keeps the swatch but may not match the target foreground color.',
      'Calligraphy Port uses unsupported pressureAngle dynamics; the preset imports with fallback brush dynamics.',
      'Calligraphy Port uses unsupported colorJitter dynamics; the preset imports with fallback brush dynamics.',
    ]);
    expect(plan.signature).toBe('brush-pack:v1:1:user-calligraphy-port:40:0.2:0.72:0.3:17:6,9->66,9:9:vertical:pressureAngle,colorJitter');
  });

  it('describes preset dynamics readiness for imported texture and scattering fallbacks', () => {
    const settings = {
      ...DEFAULT_BRUSH_SETTINGS,
      size: 36,
      spacing: 0.24,
      scatter: 0.5,
      texture: 'paper-grain',
      dualBrush: true,
      colorJitter: 0.35,
    };
    const descriptor = BrushPresets.describeImageBrushPreset({
      id: 'user-imported-grain',
      label: 'Imported Grain',
      group: 'User',
      settings,
    }, 'user');

    expect(descriptor.dynamics).toMatchObject({
      implemented: {
        brushDabs: true,
        smoothing: true,
        pressureAffects: ['size', 'flow'],
        tiltAffects: ['angle'],
        symmetryMode: 'none',
      },
      texture: {
        supported: true,
        requested: true,
        requestedFields: ['texture', 'textureScale', 'dualBrush'],
        fallback: 'flat-brush-tip',
      },
      scattering: {
        supported: true,
        deterministicOnly: true,
        value: 0.5,
        state: 'deterministic-scatter-with-jitter-fallback',
        unsupportedJitterFields: ['colorJitter'],
      },
    });
    expect(descriptor.dynamics.previewSignature).toBe(descriptor.preview.signature);
    expect(descriptor.dynamics.unsupportedWarnings.map((warning) => `${warning.field}:${warning.category}`)).toEqual([
      'colorJitter:randomization',
    ]);
    expect(descriptor.tags).toEqual(expect.arrayContaining([
      'warning:unsupported-dynamics',
      'fallback:scatter-jitter',
    ]));
  });

  it('validates preset pack import/export readiness with stable signatures', () => {
    const pack = JSON.stringify({
      version: 1,
      presets: [
        {
          label: 'Imported Wash',
          settings: {
            size: 44,
            spacing: 0.18,
            smoothing: 0.25,
            pressureFlow: 0.8,
            dualBrush: true,
          },
        },
        {
          label: '',
          settings: null,
        },
      ],
    });

    const descriptor = validateImageBrushPresetPack(pack, ['user-imported-wash']);
    const secondDescriptor = validateImageBrushPresetPack(pack, ['user-imported-wash']);

    expect(secondDescriptor).toEqual(descriptor);
    expect(descriptor).toMatchObject({
      descriptorId: 'image-brush-preset-pack-validation:v1',
      version: 1,
      packVersion: 1,
      parseable: true,
      importable: true,
      exportableAfterImport: true,
      presetCount: 2,
      acceptedPresetCount: 1,
      rejectedPresetCount: 1,
      rejectedReasons: ['preset-2:missing-label', 'preset-2:missing-settings'],
      importedPresetIds: ['user-imported-wash-2'],
      previewSignatures: ['44:0.18:0.72:0.25:17:6,9->66,9:10'],
    });
    expect(descriptor.unsupportedWarnings.map((warning) => `${warning.presetId}:${warning.field}`)).toEqual([]);
    expect(descriptor.signature).toBe(
      'brush-pack-validation:v1:parseable=true:version=1:accepted=1:rejected=1:ids=user-imported-wash-2:previews=44:0.18:0.72:0.25:17:6,9->66,9:10:warnings=none:reasons=preset-2:missing-label,preset-2:missing-settings',
    );
  });
});
