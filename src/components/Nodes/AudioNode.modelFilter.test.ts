import { describe, expect, it } from 'vitest';
import { describeAudioModelCompatibility } from '../../lib/modelContracts/audioModelContracts';
import { FALLBACK_MODEL_OPTIONS } from '../../lib/providerCatalog';

describe('AudioNode ElevenLabs model compatibility', () => {
  const options = FALLBACK_MODEL_OPTIONS.audio.elevenlabs;

  it('keeps every curated endpoint model selectable instead of silently replacing it', () => {
    expect(options.map((option) => option.value)).toEqual(expect.arrayContaining([
      'eleven_v3',
      'eleven_multilingual_sts_v2',
      'eleven_text_to_sound_v2',
      'music_v2',
    ]));
  });

  it('warns for a selected model that cannot run the current mode', () => {
    expect(describeAudioModelCompatibility('elevenlabs', 'eleven_v3', 'soundEffect')).toContain(
      'does not support sound effect generation',
    );
    expect(describeAudioModelCompatibility('elevenlabs', 'eleven_text_to_sound_v2', 'soundEffect')).toBeUndefined();
  });
});
