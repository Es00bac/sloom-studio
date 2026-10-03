# Website verification — 2026-10-03

## Cinematic redesign checks

The existing Portage Firefox/QindaFox engine rendered the actual redesigned page in isolated temporary headless profiles. Finite checks were injected by a local QA server; production source contains no test UI.

Passed in the final changed-page cases (`hive-illustrated-final.json`, `mobile-crew-final.json`, `desktop-text200.json` and reduced-motion `mobile-final.json`):

- All 13 illustrated textures and 15 production rig instances load; every identity has 11–20 fitted bones, a weighted triangulated texture mesh and species-specific chains.
- Ground vertices remain fixed at the sampled joint pose; other vertex displacement varies across the figure. This is articulated deformation, not whole-image translation.
- Visible pause freezes the clock; resume continues without a hidden-time jump. Hidden documents and offscreen hero stop RAF. Reduced motion freezes all rigs and uses a static infestation treatment.
- Every roster selector shows exactly one requested dossier. Arrow keys move selection/focus. Both technology paths switch correctly. Mobile Escape closes the menu and restores focus.
- Infestation starts clean, grows through the roster, peaks at Seedweb and recedes before the guide. Main reflow updates scroll geometry, including doubled text.
- Illustrated mode replaces the actual photograph; the engine-photo reveal animation no longer masks the mesh. Strong left conduit strokes remain in the outer 28 px, clear of Scuttle's title and roles.
- All 13 fresh canonical Tideglass photographs, 17 structure entries and two unchanged full films remain present.
- No horizontal overflow at 1440 px desktop or 390 px mobile, including desktop text enlarged to twice every computed size. The title reflows at enlarged text.

Visual inspection covered the composed illustrated desktop/phone hero, full-body phone Vix, illustrated Seedweb/Scuttle presentation and enlarged-text layout. Root approved the new desktop/mobile hero. The pronunciation footer was moved into the clear left region after that review.

Evidence is in ignored `website/origin/qa/` in the Qinda feature worktree, mirrored from `/tmp/origin-redesign-qa/`: `desktop-final.png`, `mobile-final.png`, `hive-illustrated-final.png`, `mobile-crew-final.png`, `desktop-text200.png` and their finite JSON reports. Section screenshots translate the existing main into the screenshot CLI viewport origin; this only affects the temporary response.

## Actual motion evidence

`qa/rig-motion-preview.mp4` is one compact silent 1280×720, eight-second browser motion study. Native Firefox `canvas.captureStream` and `MediaRecorder` recorded the **production** Vix and Spool textured bone-mesh renderer at a deterministic joint clock, generated matched habitat art, invasion fringe and the page's actual SVG conduit geometry as it spreads and recedes. It is not an engine capture or a claim of gameplay. The browser-produced VP8 source is retained as `rig-motion-preview.webm`; MP4 is a standard H264 faststart derivative for playback.

`rig-motion-report.json` records 513 vertices per mesh, Vix's 15 bones/two fixed contacts and Spool's 17 bones/five visible fixed contacts. The record rendered 170 poses across eight seconds in the isolated headless browser with other screenshot profiles active. Production animation caps at 24 fps and only visible active figures run. Static sampled frames were inspected for mesh seams, unwanted armour stretching and contact drift; root receives the playable clip for actual motion review.

## Retained film verification

Both corrected MP4s retain the producer hashes. Earlier actual Firefox checks loaded metadata, advanced muted playback and decoded corrected welder footage at A08 43.00 s, D06 147.00 s and D07 148.38 s using native video and `requestVideoFrameCallback`. Saved browser pixels show the forked Arc tool and attached glow; no media errors occurred. Both 1920×1080 H264/AAC films have 4,548 frames, 189.504 seconds and faststart. Narration tracks parsed 19/20 cues within the films. These unchanged movies were not re-encoded for the redesign.

`media-manifest.json` and retained `qa/media-final.json` record those checks. Root's live nginx rule now serves both tracks as `text/vtt`. Final live route/asset/range verification belongs to root after scoped deployment.

## Practical limits

Checks activate native controls and dispatch finite keyboard events; they are not a claim of a manual trusted Tab/Enter walkthrough. Enlarged text directly doubles computed sizes, not native browser zoom. The earlier JavaScript-disabled source/layout check remains applicable to the retained semantic fallback: all dossiers and both trees remain accessible, selector controls are hidden and the hero has static illustration fallbacks. No engine build, test or capture was run by this website lane during the redesign. All new production photographs and canonical map hashes were supplied and reviewed by root.
