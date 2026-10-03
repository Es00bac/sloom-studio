# Qind Qompany: Origin of Species website

Public target: **https://sloom.studio/origin**. This is a self-contained static directory within the existing Sloom website. It uses plain HTML, CSS and JavaScript, with no package manager or build step.

## Preview

From the repository root:

```sh
python3 -m http.server 18867 --bind 127.0.0.1 --directory website
```

Visit `http://127.0.0.1:18867/origin/`. Fonts and image paths are relative to this directory, so previews do not require the live site's root assets.

## Publication

The existing external hosting is on `hostinger-vps`, with the directory `/var/www/sloom.studio/html/origin/`. No nginx configuration change is required. The manager owns deployment and must copy **only this route**. Preserve `website/index.html`, the rest of the Sloom website and its live files.

The public bundle comprises `index.html`, `origin.css`, `origin.js`, `assets/` and `media/`. Source notes and ignored `qa/` evidence need not be copied into the public web root.

The website's canonical URL is exactly `https://sloom.studio/origin`; existing directory routing may redirect the browser to `/origin/`.

## Media delivery

Both native players use local MP4s and narration-only English subtitle tracks. They do not autoplay or fetch the entire films on page load. The tracks are labeled narration subtitles because field dialogue is not transcribed.

Expected names:

- `media/hold-the-light.mp4`
- `media/hold-the-light.vtt`
- `media/send-another.mp4`
- `media/send-another.vtt`

MP4s are intentionally ignored by Git. Durable masters and web files belong to the game's Qinda trailer lane, `/home/cabewse/work_SPaC3/Games/origin-lanes/vulkan/validation/branded-trailers/`. The trailer worker provides their verified production manifest. Record the actual deployed file hashes in `media-manifest.json` after receiving corrected finals.

**Publication hold:** the initially delivered branding-correct films contain welding shots that must be replaced with the actual Arc shears welder. Do not publish that earlier copy. The manager and trailer worker are correcting these shots in both films. Site posters show the crew entering the pool room and the Seedweb-covered pool; neither portrays active welding. Patches's roster image is explicitly an idle-ready Purge kit pose, not a welding pose.

## Content and art

- The user's written title is **Qind Qompany: Origin of Species**. Spoken narration says **Kind Company**.
- All eight crew identities, five Cyber Creep chassis, seven crew structures and ten hive structures are documented.
- Both actual tier paths, costs, timings, base prerequisites, Arms lab research, hive traits and offline behavior are explained.
- Tideglass Baths, Seedweb/Custodian history and the supplied creator history are included.
- The page says **In development** and makes no release-date, download or finished-production promise.
- Artwork is existing production material: the hero is labeled illustrated key art; world, crew, chassis and trailer images are actual in-engine renders/captures. See `asset-provenance.json` for original Qinda paths, operations and SHA-256 hashes.
- `content-sources.json` records the authoritative game files and user-supplied account. Latest Patches input correction was verified by the manager against the simulation: **hold G** for the dedicated Arc shears welder; releasing G redraws the selected firearm. E remains use/service/build.

## Behavior and accessibility

Roster and faction selectors use native buttons with pressed state. Expandable manuals use native details/summary. Without JavaScript all dossiers and both technology paths remain readable. Mobile navigation exposes its expanded state and Escape closes it and focuses its trigger. Focus indicators are visible. Decorative motion respects reduced-motion preference; enlarged text can grow the introduction without colliding with navigation or the scene footer.

See `QA-CHECKS.md` for the checks and their practical limits. QA scripts, browser profiles and screenshots are separate ignored evidence, not production code.
