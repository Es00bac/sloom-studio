# Qind Qompany: Origin of Species website

Public target: **https://sloom.studio/origin**. This is a static directory in the existing Sloom website: plain HTML, CSS and JavaScript, no build step or new dependencies.

## Preview

From the repository root:

```sh
python3 -m http.server 18867 --bind 127.0.0.1 --directory website
```

Visit `http://127.0.0.1:18867/origin/`. Fonts, illustrations, photographs and films use relative local paths.

## Publication

Root owns scoped deployment to `hostinger-vps:/var/www/sloom.studio/html/origin/`. Preserve the Sloom homepage and every other route.

Publish **only** `index.html`, `origin.css`, `origin.js`, `rigs.js`, `rig-configs.json`, `assets/` and `media/`. Do not publish `art-sources/`, source notes or ignored `qa/` browser evidence. Original generated PNGs, prompts and reference hashes belong to the source history, not the runtime bundle.

Directory routing already serves `/origin/`. Root added this scoped nginx rule so both narration tracks are served as `text/vtt`:

```nginx
location ~ ^/origin/media/(hold-the-light|send-another)\.vtt$ {
    default_type text/vtt;
    try_files $uri =404;
}
```

The live configuration was validated and reloaded; no nginx source file exists in this repository. Preserve that rule during deployment. CSS, JavaScript and rig-config URLs carry a new version query; actual character photos have fresh `scene-` filenames to avoid stale cached renders.

## Artwork and motion

The opening composition uses the illustrated Qompany habitat with articulated Ducké and Vix foreground figures. Matched Qompany/Seedweb habitat paintings form the world and faction chapters. Manufactured cable/plate bitmap art and cyan/violet SVG conduits progressively invade the roster chapter, then recede before the field guide. Strong strokes stay outside reading copy.

Every one of the eight crew and five chassis has two views: labeled illustrated cast and actual current-engine canonical full six-site Tideglass photography. Patches's actual photograph holds the dedicated Arc shears **at rest**; the illustrated cast is empty-handed. Rejected development-room renders are removed.

`rigs.js` implements real Canvas 2D bone-weighted textured triangle meshes, parented joint chains, two-link ground-contact IK and fixed foot vertices. `rig-configs.json` fits each identity to the artists' normalized landmarks: tails, ears, Axi's six gills, Chime's wings, Scuttle's eight contact legs and other machine appendages. Occluded limbs are not invented. Motion is small and anatomy-specific. A visible pause control and reduced-motion preference freeze the pose; offscreen and hidden pages stop animation; resumed clocks do not jump.

Originals, exact prompts, reference/map/build hashes and landmarks are recorded under `art-sources/` and indexed in `asset-provenance.json`. Illustrations are explicitly labeled and never presented as gameplay.

## Films and game content

Both corrected full films remain unchanged from the initial published site:

- `media/hold-the-light.mp4` and `.vtt`
- `media/send-another.mp4` and `.vtt`

The MP4s are ignored by Git. Durable verified production files belong to the game's Qinda trailer lane, `/home/cabewse/work_SPaC3/Games/origin-lanes/vulkan/validation/branded-trailers/`; the site worktree also holds the runtime copies. Final hashes, actual Firefox playback/seek/decode checks and 19/20 parsed narration cues are recorded in `media-manifest.json`. Films have correct Arc shears welding footage and verified **Kind Company** narration. Native controls, `playsinline` and `preload=none` are retained. Tracks honestly say narration subtitles because field dialogue is not fully transcribed.

The site retains the complete accurate world/history, all eight crew, five chassis, seven crew structures, ten hive structures, both three-tier tech paths with costs/timings/base prerequisites, Arms lab/trait research, offline behavior and field/commander controls. The full six-site Tideglass is canonical. Patches **holds G** to draw the dedicated welder alongside any selected gun kit; releasing G redraws that gun. E remains use/service/build; commander research controls are separate.

The creator's supplied NS/NS2 history is preserved. The game is independent and **In development**, with no release-date, download or finished-production promise. Written title: **Qind Qompany: Origin of Species**; spoken title: **Kind Company**. `content-sources.json` records authoritative sources and the supplied personal account.

## Access and verification

Native roster/tech buttons expose pressed state; roster arrows move selection/focus. Manuals use native details/summary. Without JavaScript, every dossier and both technology paths remain readable, with static hero art. Mobile navigation exposes expanded state and Escape closes it and restores focus. Main/header resize observers keep scroll geometry correct after reflow.

See `QA-CHECKS.md` for the bounded changed-page verification and actual browser motion evidence. Root owns final live verification and publication.
