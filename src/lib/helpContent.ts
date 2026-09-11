export type HelpSectionId =
  | 'project-documentation'
  | 'tutorial'
  | 'feature-help'
  | 'keyboard-shortcuts';

export interface HelpContentGroup {
  title: string;
  items: string[];
}

export interface HelpContentSection {
  id: HelpSectionId;
  title: string;
  summary: string;
  groups: HelpContentGroup[];
}

export const HELP_SECTIONS: HelpContentSection[] = [
  {
    id: 'project-documentation',
    title: 'Project Documentation',
    summary: 'Sloom Studio is a local-first creative suite: Flow orchestration, layered Image editing, Video finishing, and Paper publishing share one project and source library.',
    groups: [
      {
        title: 'Core Workspaces',
        items: [
          'Flow workspace: build generation and automation graphs with typed connections, local operations, provider-backed media nodes, caching, spend caps, starter recipes, schedules, batches, and shareable node packs.',
          'Video workspace: ingest or link media, assemble a multitrack sequence, keyframe and finish it, then render through the available native/GPU or browser route.',
          'Image workspace: edit layered raster, vector, text, high-bit, and CMYK documents with masks, adjustments, effects, a full brush engine, and optional model-in-the-loop tools.',
          'Paper workspace: page layout and comics DTP with frames, threaded text, styles, swatches, print production (PDF/X), and book/webcomic export.',
          'Source bin: keep project-owned media, generated assets, text, shapes, and imported files available for reuse across all four workspaces.',
        ],
      },
      {
        title: 'Project Storage',
        items: [
          'Use File > Save or Save As in Electron for native .sloom project files.',
          'Electron projects automatically use a sibling per-project scratch folder so source-bin media reopens with the project.',
          'Project spend history is saved inside the .sloom file as a usage ledger, so reopening the project restores known costs and provider/model/operation breakdowns.',
          'Use File > Set Scratch Folder only when you need to redirect unsaved-project imports before the project has its own .sloom file.',
          'Browser mode keeps the integrated menu and downloads portable .sloom project files where native file access is not available.',
          'Autosave captures a bounded recovery snapshot after settled changes and lifecycle boundaries. Project Library can recover or export it; named snapshots and retained history are separate deliberate checkpoints.',
          'Optional collaboration and sync use only the self-hosted service you configure. Sloom does not silently upload project media to a hosted content service.',
        ],
      },
      {
        title: 'Rendering',
        items: [
          'The Program Monitor and final render use shared timeline, transform, crop, filter, opacity, and keyframe semantics.',
          'A simple unmodified one-video sequence can use direct native FFmpeg with VA-API GPU acceleration when available; unsupported hardware falls back to native CPU.',
          'Effects, overlays, transforms, multi-clip composites, and other complex edits use the general compositor/render plan. Browser rendering is a bounded fallback, not a feature-length export route.',
          'The durable render queue retains queued, active, completed, failed, and cancelled job state across restart.',
        ],
      },
    ],
  },
  {
    id: 'tutorial',
    title: 'Tutorial',
    summary: 'A quick path from imported media to a rendered edit.',
    groups: [
      {
        title: '1. Create or Open a Project',
        items: [
          'Start from File > New Project or File > Open.',
          'In Electron, save the project as a .sloom file before large imports so Sloom Studio creates and uses that project’s scratch folder.',
          'Switch to the Editor workspace from the titlebar or View menu.',
        ],
      },
      {
        title: '2. Add Media',
        items: [
          'Import images, video, or audio into the source bin.',
          'Create text or shape editor assets from the editor asset tab.',
          'Drag source-bin items into visual or audio lanes.',
        ],
      },
      {
        title: '3. Edit the Timeline',
        items: [
          'Select a clip, move the red playhead, then press Cut or C to split the selected visual clip at the playhead.',
          'Drag clip edges to trim non-destructively; hidden source media remains recoverable by dragging the edge back out.',
          'Hold Shift while scrubbing, cutting, snapping, or trimming to use whole-second steps.',
        ],
      },
      {
        title: '4. Animate and Finish',
        items: [
          'Use K or Add Key to keyframe transform, opacity, or volume at the playhead.',
          'Use the inspector for crop, filters, blend modes, volume, and precise transform values.',
          'Render the composition once the program monitor matches the intended result.',
        ],
      },
    ],
  },
  {
    id: 'feature-help',
    title: 'Feature Help',
    summary: 'Reference for the major Sloom Studio tools and editor features.',
    groups: [
      {
        title: 'Timeline Tools',
        items: [
          'Select moves clips and chooses the active clip for inspector edits.',
          'Cut splits the selected visual clip at the playhead; clicking a clip in cut mode also cuts at the playhead.',
          'Slip shifts source content inside a clip without moving the clip timing.',
          'Hand pans the timeline viewport when zoomed in.',
          'Snap adds custom snap points on the time ruler.',
        ],
      },
      {
        title: 'Project Spend Tracker',
        items: [
          'The Usage Bar shows canvas pre-run estimates, actual usage for the current session, and the saved project total from the .sloom usage ledger.',
          'Click Project Total to open provider, model, operation, and workspace breakdowns.',
          'The Balances button checks supported provider credit endpoints when API keys are configured. BFL and Stability credit checks are supported; Gemini/Vertex, OpenAI, and Hugging Face show explicit unsupported explanations because they do not expose a simple browser-safe remaining-credit endpoint for this app.',
          'Known dollar totals only include runs with mapped, measured, fixed, or estimated prices. Provider-defined rows remain visible as unknown so they are not silently counted as free.',
        ],
      },
      {
        title: 'Text and Shapes',
        items: [
          'Text is a natural text-sized layer, not a visible rectangle; select it to show transform handles.',
          'In the Image workspace, select a retained text layer and use the in-canvas Edit Text button or double-click the text to edit wording directly on the artwork.',
          'Image text presets cover title, subtitle, cover-title, caption, and comic SFX looks; presets apply text settings and layer effects such as strokes, shadows, and glows.',
          'Shape assets are separate timeline-backed rectangle layers.',
          'Right-click text assets or text clips to edit wording, font, color, size, and text effects.',
        ],
      },
      {
        title: 'Comic SFX Designer',
        items: [
          'In the Paper workspace, click any SFX button or right-click a page and choose a Comic SFX entry to open the designer before placing it. In the Image workspace, use the Comic / Manga panel and choose SFX Designer.',
          'Customize the lettering text, preset, font, fill, stroke, shadow, rotation, skew, scale, echo trails, burst backing, speed lines, and halftone dots while watching the live preview.',
          'Place on Page inserts one embedded vector decal frame that can be moved and resized as a single object, then reopened from the Paper context menu or Inspector for designer edits. In Image, the same design is rasterized as a movable layer.',
          'Use Reusable Styles to save SFX looks such as heavy impact, electrical buzz, or trailing motion. Saved styles and the last design persist across app restarts.',
        ],
      },
      {
        title: 'Image Region Editing',
        items: [
          'Use marquee, lasso, magic wand, brush-limited painting, and layer masks to isolate the part of the image that should change.',
          'When a selection is active, the floating generative edit bar exposes provider/model-aware operations such as inpaint, outpaint, search replace, search recolor, background removal, relight, and provider upscaling where supported.',
          'Reference descriptions and reference image URLs can be attached to supported models, and the Blend Edge control feathers the generated layer mask so selected-region edits integrate with the surrounding image.',
          'Image Size, Canvas Size, and Upscale controls live in the Image properties panel and create undoable document-size changes without requiring provider credentials.',
        ],
      },
      {
        title: 'Crop, Filters, and Transforms',
        items: [
          'Crop is non-destructive and changes how a source appears in the editor monitor and render.',
          'Pan and rotate the media inside the crop boundary without changing the original source asset.',
          'Image, video, and text clips can use filter stacks, opacity, blend modes, and keyframed transforms.',
        ],
      },
      {
        title: 'Audio',
        items: [
          'Audio lanes support clip volume, per-track volume, waveform previews, and volume keyframes.',
          'Video assets can also be placed on audio lanes when their audio is needed separately.',
        ],
      },
      {
        title: 'Gaps and Snapping',
        items: [
          'Cutting leaves timeline gaps in place.',
          'Select a gap and right-click it to fill that gap.',
          'Hold Shift during timeline operations to snap to whole seconds.',
        ],
      },
      {
        title: 'Cloud Image Models',
        items: [
          'Settings > Providers contains signup, API key, pricing, configuration, and usage notes for Google Gemini/Vertex, OpenAI, Hugging Face, Black Forest Labs, Stability AI, and Local/Open endpoints.',
          'The Flow toolbar Image chevron opens provider-specific node templates for Gemini reference edits, OpenAI mask edits, Hugging Face open-model generation, FLUX.2 multi-reference edits, Stability inpaint/outpaint/search/background tools, and Local/Open Qwen-compatible endpoints.',
          'Each image provider card includes supported operations, spend-control notes, troubleshooting, and a pricing last-verified date so the setup page behaves like a built-in wiki instead of a bare key form.',
          'The Settings image cost table lists every visible model/operation with exact, estimated, token-priced, or provider-defined confidence before users run a node.',
          'Image nodes expose controls based on the selected model: BFL FLUX.2 shows multi-reference, seed, exact color, text-edit, format, and size controls; Stability edit models show mask, search prompt, outpaint margin, background, or relight controls as applicable. The node summary shows all supported operation costs for the selected model.',
          'Cost previews use the published provider prices where available. Local/Open endpoints are marked provider-defined because the cost depends on your own machine, rented cloud GPU, or hosted wrapper.',
          'For cloud-only workstations, configure BFL or Stability keys for pay-as-you-go edits, or configure a Local/Open endpoint hosted on a rented GPU so your local RX 5700 XT is not responsible for model inference.',
        ],
      },
      {
        title: 'Paper Print And KDP Export',
        items: [
          'Paper webcomic export creates named PNG/JPEG page-image archives with resolution, DPI reference, quality, and bleed controls.',
          'Paper KDP export creates a ZIP asset package with KDP-sized interior PNGs, front/back cover reference PNGs, a full wrap cover PNG, manifest, and preflight report.',
          'KDP export maps page 1 and the last page as exterior cover art, keeps page 2 and the next-to-last page as inside cover interior pages, and labels source page 3 as story page 1 in the manifest.',
          'The KDP wizard uses the official 0.125 inch bleed requirement, cover-wrap formula, paper/interior spine-thickness values, 300 DPI image threshold, and spine-text page-count warning.',
          'KDP export blocks while placed images still need print-resolution replacement. Run Finalize Print first so low-resolution frame assets are replaced before the package is rasterized.',
        ],
      },
      {
        title: 'Android Accelerator Setup',
        items: [
          'Install the Sloom Studio Android Accelerator companion on a Snapdragon Android device, keep the phone on the same trusted Wi-Fi network as the desktop, and start the foreground server from the app.',
          'The companion exposes /v1/capabilities, /v1/generate, and /v1/upscale over the local network with bearer-token pairing. Paste the shown URL and token into Settings > Providers.',
          'For Local Dream based builds, SD1.5/SDXL generation and Real-ESRGAN/UltraSharp-style 4x upscaling run through the phone-side runtime; Sloom Studio treats those jobs as local/provider-free and records $0 provider spend.',
          'Image nodes can select Android Accelerator for phone-side generation, and the node Auto-upscale toggle uses the currently configured upscaler while adding any paid upscale cost to the pre-run estimate.',
          'Paper Auto print upscaling, Image/Photos Upscale 2x, and Flow node Auto-upscale use the paired Android accelerator first when configured, then fall back through the configured cloud/local methods. Paper still performs the final exact document-DPI fit before replacing the frame asset.',
          'If the Android server cannot be reached, confirm both devices are on the same LAN, the Android foreground-service notification is still active, the pairing token matches, and the phone has the required model/upscaler downloaded.',
        ],
      },
      {
        title: 'Vertex AI Setup',
        items: [
          'Use Settings > Providers > Google image credential mode > Vertex AI via Google Cloud desktop auth when you want Gemini/Imagen calls to run through a Google Cloud project instead of a Gemini API key.',
          'Set the Vertex project ID, location, authentication mode, optional quota project, and any needed environment variables. These values persist in local settings across app restarts.',
          'For a simple desktop login, run gcloud auth login and enable the Vertex AI API on the project. For ADC/service-account workflows, run gcloud auth application-default login or set GOOGLE_APPLICATION_CREDENTIALS to a credential JSON file.',
          'Useful Vertex variables include GOOGLE_APPLICATION_CREDENTIALS, GOOGLE_CLOUD_PROJECT, CLOUDSDK_CORE_PROJECT, CLOUDSDK_CONFIG, GOOGLE_CLOUD_QUOTA_PROJECT, optional GCLOUD_ACCOUNT (for explicit gcloud user account selection), and optional GCLOUD_BIN. Add them one per line as KEY=value in Settings.',
          'Paper print image upscaling can be Auto, Android accelerator, Stability Fast, Stability Conservative, Vertex Imagen, Local Vulkan AI when a compatible GPU/driver is available, or Local browser scaling only. The managed desktop Real-ESRGAN runtime has no CPU fallback. Auto uses the Android accelerator when configured, then Stability Fast when a Stability key is configured, then Vertex Imagen, then local scaling.',
          'Paper print upscaling shows source pixels, target print pixels, provider choice, and estimated cost before spending. Stability Fast is 2 credits / $0.02 per image; Stability Conservative is 40 credits / $0.40 per image. Sloom Studio locally fits provider results to the exact document-DPI target before replacing the frame asset.',
        ],
      },
    ],
  },
  {
    id: 'keyboard-shortcuts',
    title: 'Keyboard Shortcuts',
    summary: 'Common editor shortcuts.',
    groups: [
      {
        title: 'Navigation',
        items: [
          'Left / Right: scrub the playhead by 0.1 seconds.',
          'Shift + Left / Right: scrub by whole seconds.',
          '[ / ]: jump to the previous or next keyframe on the selected clip.',
        ],
      },
      {
        title: 'Editing',
        items: [
          'C: cut the selected visual clip at the playhead when possible, otherwise enter cut mode.',
          'V: select tool.',
          'S: slip tool.',
          'H: hand tool.',
          'M: snap marker tool.',
          'K: add or update a keyframe at the playhead.',
          'Delete / Backspace: remove the selected clip or stage object.',
        ],
      },
      {
        title: 'App',
        items: [
          'Ctrl/Cmd + Z: undo editor changes.',
          'Ctrl/Cmd + Shift + Z or Ctrl + Y: redo editor changes.',
          'F1 or Shift + /: open help.',
          'Esc: close help and context menus.',
        ],
      },
    ],
  },
];

export function getHelpSection(sectionId: HelpSectionId): HelpContentSection {
  return HELP_SECTIONS.find((section) => section.id === sectionId) ?? HELP_SECTIONS[0];
}
