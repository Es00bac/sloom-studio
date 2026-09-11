# Settings

> Current manual baseline: **Sloom Studio source 0.9.16-b**, verified August 27, 2026. The exact controls shown depend on platform and window size; native-only controls are omitted when the bridge is unavailable.

Settings covers provider/model configuration, interface preferences, encrypted backup, self-hosted project authority, local crash reports, runtime routes, shortcuts, gamepad bindings, managed fonts, and the Sloom Studio Pro license.

Open the settings surface from the application menu or the Settings/gear control. On phones, its primary areas appear as compact tabs. On desktop, the main areas are buttons across the top:

- **Providers** — provider packs, interface, keys, backup, synchronization, diagnostics, routes, and defaults.
- **Shortcuts** — conflict-checked command bindings.
- **Gamepad** — per-workspace controller profiles.
- **Fonts** — managed open-font library.
- **License** — Community/Pro status and key activation.

## Provider packs and model cards

The Provider Pack Library appears before individual credentials. A pack describes provider routes and production model cards without containing credentials. Bundled, local, community, and project-embedded packs use the same validated schema.

Use it to:

1. Review installed packs and the models/routes each pack declares.
2. Import a `.sloom-provider.json` pack.
3. Inspect permissions, endpoints, model capabilities, controls, and output contracts before activation.
4. Open the Model Card Builder to create or edit a pack visually.
5. Export a credential-free pack for another project or user.

An imported pack cannot silently read existing keys, weaken an endpoint policy, or claim a model capability that fails schema validation. See the dedicated [provider-pack and Model Card guide](../../userguide/14-provider-packs-model-cards.md) for authoring and trust boundaries.

## Interface and startup

The Interface section includes:

- **Language** — English or Japanese. This changes application labels and relevant defaults, not existing document text.
- **Reopen last project on startup** — desktop-only preference. Startup still uses the recovery/dirty-document safeguards; it does not silently discard an unreadable project.
- **Theme** — one of the current dark, high-contrast, and colored interface palettes.
- **Density** — `Compact` or `Comfortable`.
- **Application menu style** — where exposed, `Compact` or `Menubar`.

Theme and density apply through shared interface tokens so all four workspaces follow the same choice. A named workspace layout separately stores dock/panel geometry.

## API keys

The current key fields are:

| Provider | Field is used for |
| --- | --- |
| Google Gemini / Veo | Gemini text/image/audio and Veo routes using API-key mode. |
| OpenAI / Compatible | OpenAI routes and an explicitly configured compatible base URL. |
| Atlas | Atlas media gateway routes. |
| BytePlus (Seedream) | BytePlus ModelArk/Seedream routes. |
| Hugging Face | Hugging Face inference routes. |
| Black Forest Labs | FLUX-family routes exposed by BFL. |
| Stability AI | Supported Stability image/edit routes. |
| ElevenLabs | Speech, SFX, music, voice conversion, transcription/alignment, and voice-isolation routes exposed by Sloom Studio. |

No key is required for ordinary non-AI editing or for a credential-free/local route that is already installed and selected.

### Storage status and security

Read the storage status displayed at the top of Settings; do not assume every platform has the same protection.

- Desktop uses the native secure-storage envelope when available.
- Supported web/mobile contexts use a WebCrypto envelope.
- If secure persistence is unavailable, Settings explicitly reports a local-storage or memory-only caveat.
- Decrypted credentials exist in memory while the application is open.
- A provider key is sent only to its configured route for an action that you initiate.

Never paste a key into a project, prompt, provider pack, exported node pack, support report, or screenshot. Clear credentials before sharing a browser profile.

## Encrypted settings backup

Settings Backup exports a passphrase-encrypted envelope rather than plaintext JSON. The declared portable schema includes credentials, provider settings/defaults, interface preferences, menu style, locale, keyboard and gamepad bindings, custom brush presets, font-library state, license key, and provider-pack settings.

To export:

1. Open **Providers → Settings Backup**.
2. Choose and confirm a strong passphrase.
3. Save the encrypted backup file.
4. Store the passphrase separately; Sloom Studio cannot recover it.

To restore:

1. Select the encrypted backup file.
2. Enter its passphrase.
3. Review the result. Invalid, unsupported, or undecryptable data fails closed.
4. Re-test provider and Vertex connections after moving between platforms.

The backup leaves the device only when you explicitly save/copy it. It contains sensitive credentials even though it is encrypted.

## Vertex AI authentication

Set **Gemini credential mode** to Vertex ADC to expose Vertex authentication. The current panel supports:

- Desktop Google browser sign-in through the installed Google tooling.
- Detecting existing Application Default Credentials.
- Importing ADC authorized-user, workload-identity, or service-account JSON without a terminal.
- Pasting credential JSON when file import is not practical.
- Choosing or manually entering the project.
- Selecting a known or custom region.
- Setting an optional quota/billing project override.
- Testing the configured connection.

Desktop can report `gcloud`, imported ADC, service-account, or environment credentials as the active source. Mobile imports supported credential JSON directly. Credential material is handled by the same protected settings store; never commit a service-account file to the repository or include it in a project.

Vertex is used only when a Vertex-capable model/route is selected. API-key Gemini remains a separate credential mode.

## Runtime options

Runtime controls are intentionally explicit. They currently include, where supported:

- OpenAI-compatible and Atlas base URLs.
- Gemini credential mode and Vertex configuration.
- Paper print-upscale method and PDF raster preset.
- Batch retry count and base delay.
- Local render-backend preference and export-compositor preference.
- Native-render service URL/token.
- Optional backend-proxy URL and enable switch.
- Local/open image endpoint and its authorization header.
- Android accelerator host, models, and self-test controls.
- Android LAN-server controls.

Changing a route does not prove that the service is healthy or that a model implements every declared capability. Use the adjacent test/status controls, then run a small representative task. A failed configured route remains failed; Sloom Studio does not silently spend through another provider.

## Default models

Separate default-model tables exist for text, image, video, and audio providers. Defaults prefill new/unspecified operations. A node or tool can keep an explicit model selection, which takes precedence.

Model catalogs can change at the provider. Use **Refresh catalogs** after credentials or endpoint changes. If a saved model is no longer available, select a current compatible model deliberately; do not interpret a provider fallback as equivalent.

## Spend controls and pricing information

Provider help cards describe required setup and supported routes. The model-cost table is an estimate for planning, not a bill. Provider prices and availability can change; the provider account/console is authoritative.

Flow's enforced spend cap is the safety boundary for paid graph execution. Set a finite cap before running a paid batch. An unknown-cost or over-cap request must be resolved explicitly rather than passing because an estimate is absent.

## Self-hosted project authority

This section configures an optional service that **you operate**. Enter its endpoint, check health, and register/sign in to that authority.

The authority stores account sessions, revisioned project blobs, and a bounded recovery log on that server. It is not Sloom-hosted cloud storage, an external identity provider, an internet continuity guarantee, or end-to-end encryption. Remote writes are explicit and revision checked; stale or offline clients cannot silently overwrite the authority's newer revision. The browser keeps only the endpoint and a bounded retry journal persistently; its bearer session is session-scoped.

If the authority is unavailable, the local project remains unchanged and remote operations fail closed. Do not point this setting at a service you do not trust.

## Crash reports

Crash capture is opt-in and local. When enabled, Sloom Studio keeps a bounded queue of structurally redacted renderer/main-process reports and desktop minidumps. Reports are never automatically transmitted and no third-party crash service is used.

You can:

- Enable or disable new local captures.
- Inspect the retained report summaries.
- Export the current reports as JSON for deliberate sharing.
- Permanently delete local reports and pending minidumps after confirmation.

Review an exported report before sending it. Structural redaction reduces credential exposure; it does not make arbitrary project context appropriate to publish.

## Keyboard shortcuts

The Shortcuts area lists the shared native-menu command registry. Choose a command, enter a supported key chord, and review any conflict. Bindings can be global or workspace-specific. A shortcut does not fire while the same keystroke belongs to an active text field.

Use **Reset defaults** to discard custom bindings. Encrypted Settings Backup is the portable export/import route for the shortcut map.

## Gamepad bindings

Gamepad profiles are stored per workspace: Flow, Image, Paper, and Video can assign the same physical control to different commands. Select a workspace and control, then configure the command plus advanced axis/dead-zone/sensitivity/response options where applicable. Reset defaults is scoped to the stored profile.

## Font Library

The Fonts area installs/removes the supported open-font catalog into the managed library. Font identity and bytes matter for editable Paper documents and strict print output. A system font with the same family name is not automatically an exact substitute for a document-managed face.

Downloaded faces retain source/license metadata. Only package or redistribute a font when its license allows it.

## License

The License area shows either **Community edition** or the licensed identity. To activate Sloom Studio Pro:

1. Obtain the permanent license through an authorized Sloom purchase route.
2. Open **Settings → License**.
3. Paste the complete key and choose **Activate license**.
4. Confirm that the licensed identity is displayed.

Verification is local and fail-closed. An invalid, truncated, superseded, or unverifiable key leaves the application in Community edition. Removing a valid key returns to Community behavior.

Sloom Studio Pro currently unlocks Tiltmark V3 and professional print-production exports, marks output metadata as licensed, removes the startup notice, and supplies the commercial-use license. Community keeps all four workspaces and Studio Brush. See the purchase terms and repository license for the authoritative legal scope.

## OSS licenses

The Providers surface includes the third-party notices/licenses generated for the packaged application. Review them before redistributing Sloom Studio or bundling components into another product. The presence of a component in a development checkout does not by itself prove that it is included in a particular package.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| A key appears not to persist | Read the displayed secure-storage status. Memory-only mode intentionally does not persist it. |
| Provider returns unauthorized | Recheck key, base URL, organization/project, region, and selected credential mode; then run the connection test. |
| Requested model is missing | Refresh catalogs and inspect the provider/model card. Select a compatible model explicitly. |
| Vertex cannot run | Resolve every blocker in the Vertex status badge, confirm project/region/quota project, and use Test connection. |
| Local render fails | Confirm the native service URL/token and project scratch folder, then inspect the Video render job's semantic error. |
| Self-hosted sync refuses a write | Sign in again and reconcile the remote revision; do not bypass the revision check. |
| Backup restore fails | Verify the file, exact passphrase, and source version. The original settings remain unchanged on a failed import. |
| Shortcut does nothing | Check conflicts, current workspace, text-input focus, and OS-reserved chords. |
| A managed font is unavailable | Reinstall the exact authorized face or relink the document's managed font; do not accept a family-name substitute for strict output. |

For provider-pack authoring, see the [provider-pack guide](../../userguide/14-provider-packs-model-cards.md). For recovery and support evidence, see [Troubleshooting & recovery](../../userguide/12-troubleshooting-and-recovery.md).
