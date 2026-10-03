# Website verification — 2026-10-03

## Passed

- JavaScript syntax check with the existing Node runtime.
- HTML anchor targets are present and IDs are unique.
- Every referenced local stylesheet, script, image, subtitle and MP4 exists and returns HTTP 200 in the static preview. Image derivatives decode successfully.
- Actual existing Portage Firefox/QindaFox engine rendered the page at 1440 px, 390 px and 320 px widths in isolated temporary headless profiles.
- All eight crew and five chassis selector buttons display exactly the requested dossier, maintain a single visible panel and accept focus.
- Both technology selectors switch to the correct faction path and accept focus.
- The 17 native structure details are present in source, with every function and current cost.
- Mobile navigation expands; Escape closes it and returns focus to the menu trigger.
- Both final MP4s match the producer SHA-256 hashes. File metadata verifies 1920×1080 H264/AAC, 24 fps, 4,548 frames, 189.504 seconds and moov-before-mdat faststart.
- Actual Firefox native players loaded metadata, advanced muted playback, and decoded the corrected welding shots at A08 43.00 s, D06 147.00 s and D07 148.38 s. requestVideoFrameCallback reported the sought times; saved canvas pixels were inspected and show the forked Arc welder with attached glow. No media error occurred.
- Both narration subtitle tracks loaded and parsed: 19 / 20 cues, all within the films. The production page retains native controls, playsinline and preload=none. Tracks honestly say narration subtitles.
- Reduced-motion profiles have no motion-enabled class. The normal-motion profile initializes the enhancements.
- No horizontal overflow at 1440, 390 or 320 px widths.
- Text enlarged to twice every computed font size at 1440 and 390 px reflows without horizontal overflow. The hero, fixed header and scene footer were visually inspected and corrected to avoid overlap.
- The JavaScript-disabled 390 px browser capture was inspected: navigation and introduction remain readable. Static source keeps all 13 dossiers and both trees accessible in this fallback; selector controls are hidden.

## Visual evidence

Actual full-page Firefox captures were cropped by reported document section coordinates. Inspected desktop hero, world, crew dossier, field guide, both technology layouts, trailer players and creator section; inspected phone hero, roster, technology tree and 200% text. Asset originals/contact sheets were also inspected to distinguish the production machine chassis and character models from obsolete proxy/concept material.

Evidence lives in ignored `website/origin/qa/` in the Qinda feature worktree and in `/tmp/origin-site-qa/` on the laptop. Representative names are `desktop-hero-proof.png`, `mobile-hero-proof.png`, `desktop-crew-proof.png`, `mobile-crew-proof.png`, `desktop-hive-tech-proof.png`, `mobile-hive-tech-proof.png`, `desktop-world-proof.png`, `desktop-field-guide-proof.png`, `desktop-trailers-proof.png`, `desktop-creator-proof.png` and `mobile-text200-proof.png`.

## Method and remaining integration checks

The isolated QA server injects finite DOM checks into a temporary response; it does not alter production source. Selector checks activate native buttons and verify focus, while the menu Escape check dispatches a keyboard event. There was no available interactive desktop browser surface, so this is not a claim of a manual Tab/Enter walkthrough. Semantic controls and focus styles were inspected in source. The 200% case enlarges computed text directly; it is not a claim of native browser zoom.

Firefox's screenshot CLI with a fixed height clips the document origin, even after a script scrolls the viewport. Section evidence therefore uses real full-page images and coordinate-based crops. QA eagerly loads images to make offscreen capture evidence complete; production keeps normal lazy loading.

The manager will verify the final live route, MIME and range responses after deployment. Corrected movie browser evidence is `qa/media-final.json`, `media-final-A08.png`, `media-final-D06.png`, `media-final-D07.png` and `media-final-players.png`. Those are actual browser-decoded film pixels; the player screenshot uses a temporary QA stage holding the production native video elements.

New user direction requires the canonical full six-site Tideglass for all play, tests and screenshots. The website now describes its six authored command sites. Publication awaits root’s map-provenance review of earlier film body footage and environment/poster captures. No engine/map test or capture was run after that instruction. The media gate proves actual playback, subtitles and the repaired welding tool; it does not independently establish the map source of all earlier imagery.
