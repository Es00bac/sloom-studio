# ElevenLabs feature support in Sloom Studio

Reference for every ElevenLabs capability this application integrates: what it does, where it
lives in the UI, how to use it, the parameters it accepts, and what it produces. Scope is the
**app's** integration surface (not the full ElevenLabs product line). Sources are cited per
section; the authoritative design/audit doc is
`docs/audits/elevenlabs-creative-workflows-design-2026-08-02.md`.

> **Current-source baseline:** `0.9.16-b`, verified August 27, 2026. This is a reference to
> Sloom Studio's implemented request paths and UI. It is not a substitute for ElevenLabs' live
> account catalog, model lifecycle notices, terms, limits, or bill. The app refreshes available
> models and voices from the configured account where the provider permits it.

## Overview

ElevenLabs is one of the built-in Audio-node provider paths (`gemini`, `elevenlabs`, and
`huggingface`). The shipped default model selection is Eleven Multilingual v2; it is not a promise
that a particular ElevenLabs account can use that model. Integration points:

| Surface | What it exposes |
| --- | --- |
| Flow → Audio node (`audioGen`) | Text-to-Speech, Sound Effects, Voice Changer (speech-to-speech), Music |
| Flow → Transcription node (`transcriptionNode`) | Scribe v2 speech-to-text, Forced Alignment |
| Flow → Audio Process node (`audioProcessNode`) | Voice Isolation (dialogue cleanup) |
| Video workspace | Auto Captions, Clean Dialogue, alignment-script commands, text-clip Narration |
| Settings | API key, default voice, live voice/model discovery |

**Auth.** Enter one API key in **Settings → Providers → ElevenLabs**. It is used only for that
provider's direct request route. Nodes that need it show "Configure ElevenLabs in Settings before
running this node." when the key is blank. Behind an explicitly configured backend proxy, the
provider's default-voice setting may be forwarded, but the user's credential is not forwarded as a
proxy setting. Keep keys out of projects, provider packs, screenshots, and source control.

**Discovery.** With a key configured, catalog refresh calls the provider's voices and models
endpoints. Voice picker values are sorted account-visible records; the app filters model choices
by the operation contract and hides the legacy/deprecated IDs that its runtime does not support.
Live discovery can return a different list as ElevenLabs changes account access or retires models.

**Default voice.** Settings → Runtime options → Default ElevenLabs voice
(`providerSettings.elevenlabsVoiceId`) is used by any speech/voice node that has no explicit
voice picked.

---

## 1. Text to Speech (Audio node → Speech mode)

**What it does.** Turns the connected text prompt into spoken audio with a chosen account
voice. Endpoint: `POST /v1/text-to-speech/{voice_id}?output_format=...`
(`src/lib/flowExecution.ts:5363-5404`).

**How to use.** Add an Audio node, keep mode **Speech**, pick ElevenLabs, pick a model and a
voice (live list from the account; falls back to the Settings default voice, then the first
available voice). Connect a Text node or type the prompt upstream, then Run.

**Models** (`src/lib/providerCatalog.ts:360`, contracts in
`src/lib/modelContracts/audioModelContracts.ts:288-291`):

| Model | Per-request character limit | Intended use |
| --- | --- | --- |
| `eleven_v3` | 5,000 | Emotionally rich delivery, audio tags, dialogue, multilingual character work |
| `eleven_multilingual_v2` (default) | 10,000 | Stable long-form narration in 29 languages |
| `eleven_flash_v2_5` | 40,000 | Low-latency multilingual, lower cost |
| `eleven_flash_v2` | 30,000 | Low-latency English-only |

**Parameters** (node field → API field):

| Node field | API field | Range / notes |
| --- | --- | --- |
| upstream prompt | `text` | Required; whole prompt is the transcript |
| Voice picker | `voice_id` (path) | Required (node, else Settings default) |
| Model picker | `model_id` | One of the four above |
| Output format | `output_format` (query) | `mp3_48000_192`, `mp3_44100_128` (default), `mp3_44100_64`, `pcm_44100` |
| Stability | `voice_settings.stability` | 0–1; blank = the voice's own saved default |
| Similarity | `voice_settings.similarity_boost` | 0–1; blank = voice default |
| Style | `voice_settings.style` | 0–1; high values can reduce stability |
| Speed | `voice_settings.speed` | 0.7–1.2 |
| Seed | `seed` | integer 0–4,294,967,295; best-effort repeatability, not guaranteed |

Voice settings are only sent when at least one slider is set — a partial object would override
the voice's provider-side defaults with API defaults
(`buildElevenLabsVoiceSettings`, `src/lib/flowExecution.ts:6418`).

**Output.** One audio artifact, published as a durable Source Bin asset with truthful metadata
(`container`, `codec`, `sampleRateHz`, `bitRateKbps`). `pcm_44100` is headerless 16-bit
little-endian mono; the app wraps it in a RIFF/WAVE container at the response boundary and
reports `audio/wav` (`src/lib/elevenLabsAudioResult.ts`).

**Cost.** The local estimator currently maps `eleven_v3`/`eleven_multilingual_v2` at $0.10 per
1,000 characters and Flash models at $0.05 per 1,000 characters
(`ELEVENLABS_CHARACTER_PRICING`, `src/lib/costEstimation.ts`). Those are application estimates,
not a provider quote or final charge; check the live ElevenLabs plan and invoice.

---

## 2. Voice Changer / Speech-to-Speech (Audio node → Voice mode)

**What it does.** Re-performs an existing audio performance in a target voice, preserving
timing and emotional delivery. Endpoint: `POST /v1/speech-to-speech/{voice_id}` (multipart)
(`src/lib/flowExecution.ts:5494-5549`).

**How to use.** Audio node → mode **Voice**. Connect an upstream audio node or imported audio
asset to the left input handle, pick the target voice, Run.

**Models.** `eleven_multilingual_sts_v2` (29 languages), `eleven_english_sts_v2` (English
only).

**Parameters:**

| Node field | API field | Range / notes |
| --- | --- | --- |
| Left input handle | `audio` (file) | Required; source clips limited to 5 minutes — split longer audio |
| Voice picker | `voice_id` (path) | Required |
| Model picker | `model_id` | One of the two STS models |
| Remove background noise | `remove_background_noise` | boolean checkbox |
| Seed | `seed` | integer 0–4,294,967,295, optional |
| Output format | `output_format` (query) | Same four formats as TTS |

**Output.** Transformed speech audio (same formats/metadata handling as TTS). Cost is **not
mapped** — usage records provider/model with "unknown" confidence.

---

## 3. Sound Effects (Audio node → SFX mode)

**What it does.** Generates foley, ambience, transitions, impacts, and loops from a text
description. Endpoint: `POST /v1/sound-generation?output_format=...`
(`src/lib/flowExecution.ts:5407-5446`).

**Model.** `eleven_text_to_sound_v2` (only model; selecting a TTS/STS model in this mode shows
a compatibility warning — see §9).

**Parameters:**

| Node field | API field | Range / notes |
| --- | --- | --- |
| upstream prompt | `text` | Required; concise description of the sound and context |
| Duration seconds | `duration_seconds` | 0.5–30; blank = model chooses |
| Prompt influence | `prompt_influence` | 0–1, default 0.3 |
| Seamless looping | `loop` | boolean checkbox (v2 feature) |
| Output format | `output_format` (query) | Same four formats |

**Output.** One sound-effect audio artifact. Cost **not mapped**.

---

## 4. Music (Audio node → Music mode)

**What it does.** Composes a complete track (song or instrumental) from a natural-language
brief. Endpoint: `POST /v1/music?output_format=...`
(`src/lib/flowExecution.ts:5448-5492`). **Requires a paid ElevenLabs plan.**

**Model.** `music_v2`.

**Parameters:**

| Node field | API field | Range / notes |
| --- | --- | --- |
| upstream prompt | `prompt` | Required, hard limit 4,100 characters (node throws if longer); describe genre, instruments, energy, structure, lyrics |
| Track duration | `music_length_ms` | 3–600 seconds; blank = model chooses |
| Force instrumental | `force_instrumental` | boolean checkbox |
| Output format | `output_format` (query) | Defaults to `mp3_48000_192` in this mode |
| ~~Seed~~ | — | Disabled in the UI: the simple-prompt route cannot combine `seed` with `prompt`; composition-plan mode is not exposed yet |

**Output.** One music audio artifact. Cost **not mapped**.

---

## 5. Speech to Text — Scribe v2 (Transcription node → Transcribe)

**What it does.** Transcribes one connected audio **or video** source with word-level
timestamps, speaker diarization, and audio-event tagging. Endpoint:
`POST /v1/speech-to-text` (multipart, `model_id=scribe_v2` fixed)
(`src/lib/flowExecution.ts:4999-5096`; UI `src/components/Nodes/TranscriptionNode.tsx`).

**How to use.** Add a Transcription node, keep operation **Transcribe with Scribe v2**, connect
an audio or video source to the Media handle, Run. Inputs are materialized through the bounded
downstream-media path; the response is capped at 64 MB.

**Parameters:**

| Node field | API field | Default / range |
| --- | --- | --- |
| Media handle | `file` | Required — audio or video |
| — | `model_id` | `scribe_v2` (fixed) |
| — | `timestamps_granularity` | `word` (node data default) |
| Speakers | `diarize` | on |
| Audio events | `tag_audio_events` | on |
| Clean speech | `no_verbatim` | off |
| Language | `language_code` | `auto`/blank = auto-detect; otherwise ISO code (`en`, `ja`, …) |
| Speaker count | `num_speakers` | 1–32, blank = unknown |
| Key terms | `keyterms` (repeated) | Comma-separated names/specialized terms to bias recognition |

**Outputs — four named handles** (`TRANSCRIPTION_OUTPUT_HANDLES`, `src/lib/timedTranscript.ts:3`):

| Handle | Artifact | Contents |
| --- | --- | --- |
| Text | `transcript.txt` | Plain transcript (also the node's primary result + preview) |
| Timed JSON | `timed-transcript.json` | Canonical `TimedTranscriptV1`: words with `startMs`/`endMs`, type (`word`/`spacing`/`audio_event`), `speakerId`, `channelIndex`, `logprob`, plus `languageCode` and `languageProbability` |
| VTT | `captions.vtt` | WebVTT cues derived from the timed JSON; durable `subtitle` Source Bin asset |
| SRT | `captions.srt` | SubRip cues; durable `subtitle` Source Bin asset |

The JSON is the source of truth; VTT/SRT are deterministic derivations. VTT/SRT have in-node
download buttons and feed Video's caption import directly. Cost **not mapped** (billed by
source duration; the app can't inspect duration before materializing).

---

## 6. Forced Alignment (Transcription node → Align)

**What it does.** Aligns a **known, exact** transcript with its audio/video, producing
character/word timings and a numeric alignment loss — without changing the supplied text.
Endpoint: `POST /v1/forced-alignment` (`src/lib/flowExecution.ts:5025-5038`).

**How to use.** Switch the Transcription node's operation to **Align known transcript**. Paste
the exact spoken text into the node's textarea (max 675,000 characters) **or** connect a Text
node to the Transcript handle (connected text wins when non-empty). Connect the media, Run.

**Parameters:** `file` (media, required) and `text` (exact transcript, required). No other
knobs.

**Outputs.** Same four named handles as Scribe (file names `aligned-captions.vtt/.srt`);
`modelId: 'forced_alignment'` and per-word `alignmentLoss` in the timed JSON. Cost **not
mapped**.

---

## 7. Voice Isolation (Audio Process node)

**What it does.** Removes music, room noise, and ambience while preserving spoken dialogue.
Endpoint: `POST /v1/audio-isolation` (multipart, `file_format=other`)
(`src/lib/flowExecution.ts:5173-5233`; UI `src/components/Nodes/AudioProcessNode.tsx`).

**How to use.** Add an Audio Process node, connect one audio or video source to the Media
handle, Run. The provider requires **at least 4.6 seconds** of source audio (stated in the
node). No selectable model or parameters — one "Isolate Voice" operation.

**Output.** One named handle (Dialogue): `isolated-dialogue.<ext>` audio artifact, in the
node's configured output format, with an in-node player and download button. The original
source is never modified. Cost **not mapped** (billed by source duration).

---

## 8. Video workspace commands (ElevenLabs-powered)

From the Video workspace Source Bin / timeline (`docs/notes/985`, `986`; design doc §Implementation status):

- **Auto Captions** — creates an auditable media-source → Transcription flow pair, runs Scribe
  v2 (with normal spend confirmation), and applies the resulting WebVTT cues to a separate
  overlay track.
- **Clean Dialogue** — runs Voice Isolation on the selected media, always keeps the generated
  asset in the Source Library, and when one timeline occurrence and an open unlocked lane are
  unambiguous, places the clean clip in one undoable edit and **disables** (never deletes) the
  original audio clip. Placement is withheld for retimed or reversed visual occurrences (the
  audio clip model can't time-stretch/reverse).
- **Use As Alignment Script / Align Captions** — feeds a text clip's exact text into Forced
  Alignment to retime captions.
- **Speech level match** — local (no credits) browser measurement that matches the clean clip
  to the original's active-speech level (±12 dB bounds, −3 dBFS peak cap); persisted as its own
  gain stage. Explicitly not LUFS normalization.
- **Audition modes** — `Original · dry`, `Clean · dry`, `Processed · approx.` for A/B of
  isolated dialogue; processed audition is a labeled browser approximation, not export-accurate.
- **Clip DSP** — per-clip high-pass/low-pass, gate/expander, compressor, and clip limiter with a
  Dialogue preset; one shared FFmpeg filter contract for browser and native export.
- **Narration from text clips** — Inspector turns a selected text clip into speech by running a
  synthetic Audio node (Speech mode). Provider order: backend proxy → Gemini; else ElevenLabs
  if its key is configured (using the Settings default voice); else Gemini; else Hugging Face
  (`resolveEditorNarrationProvider`, `src/features/video/workspace/VideoWorkspace.tsx:9928`).

---

## 9. Cross-cutting behavior

- **Compatibility warnings.** Each model contract declares its operations; picking a model that
  doesn't support the node's mode shows "`<model>` does not support <operation> generation." in
  the node (`describeAudioModelCompatibility`, `src/lib/modelContracts/audioModelContracts.ts:366`).
- **Output formats everywhere.** All four generation routes share the format picker
  (`AUDIO_OUTPUT_FORMAT_OPTIONS`: MP3 48k/192, MP3 44.1k/128, MP3 44.1k/64, PCM 44.1k→WAV) and
  the same response-boundary materialization — PCM payloads are wrapped to WAV, MP3 payloads get
  `audio/mpeg`, unknown formats keep the provider's Content-Type honestly
  (`src/lib/elevenLabsAudioResult.ts`).
- **Billing boundary.** A successful provider response is the irreversible charge point; usage
  telemetry is carried through any later local materialization failure or cancellation so a run
  is ledgered exactly once without republishing
  (`materializeAcceptedElevenLabsExecutionAudio`, `src/lib/flowExecution.ts:5577`).
- **Usage telemetry.** Only TTS has a locally mapped estimate ($0.10/1k characters for v3 and
  Multilingual v2; $0.05/1k for Flash). SFX, music, voice change, Scribe, alignment, and
  isolation record provider/model with explicit "pricing not currently mapped" notes. A recorded
  estimate does not replace the provider's bill.
- **Retry classification.** Client-correctable failures (missing voice, prompt over limit,
  invalid provider JSON, empty payload) throw typed `NonRetryableError` so the retry scheduler
  fails closed instead of re-billing.
- **Cancellation.** Every ElevenLabs call takes the run's `AbortSignal`; aborts during/after an
  accepted response still carry the usage record.

---

## 10. Explicitly not supported (yet)

Per the design doc's capability disposition
(`docs/audits/elevenlabs-creative-workflows-design-2026-08-02.md`), these have **no request
path or UI** in the current build:

- Text to Dialogue (multi-speaker `eleven_v3` dialogue)
- TTS with timestamps (alignment output on TTS)
- Dubbing (`/v1/dubbing` job family) and Dubbing v2/Project editing
- Music composition plans, music upload/inpainting, video-to-music, stem separation
- Voice Design/Remix, Instant/Professional Voice Cloning, pronunciation dictionaries
- Realtime Scribe (`scribe_v2_realtime`, WebSocket)
- ElevenAgents / Speech Engine / Audio Native / Studio / Productions (excluded by product
  decision)

Blocking infrastructure for the large-media operations (Dubbing, video-to-music, long
isolation): streaming managed-asset transport — current inputs materialize fully in the
renderer, and proxy/provider-pack envelopes cap at 50–64 MiB.
