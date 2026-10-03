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
- Both native players expose controls, playsinline and preload=none; MP4 H264/AAC is supported. Both English tracks honestly say narration subtitles.
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

The manager will verify the final live route, MIME and range responses, and corrected trailer playback after deployment. Current publication is held until the trailer worker replaces the erroneous welding shots and supplies the final hashes. This website source does not include an active-welding still.
