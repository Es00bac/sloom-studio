# Illustrated cast rig source

`../rigs.js` is a dependency-free Canvas 2D textured mesh renderer. Each bind vertex receives up to three normalized Gaussian distance-to-segment bone weights; parent matrices articulate identity-specific joints. Each triangle samples the original transparent cutout via an affine texture map. Subpixel clip overlap closes raster seams.

Two-link inverse kinematics retains each declared visible ground contact while the body makes a small weight shift. Ground-area vertices are additionally pinned to avoid sliding toe ends. Motion amplitudes stay small to preserve rigid armour and silhouettes. Chime is airborne with wing/tucked-leg articulation; Spool's obscured sixth ground limb is attached to the chassis rather than assigned an invented foot.

`../rig-configs.json` stores final normalized bind pivots/endpoints, parent bones, phase/amplitude, contact chains and pinned areas for all 13 identities. Crew source landmarks: `../assets/illustrated/crew-rig-landmarks.json`. Chassis source landmarks and suggested bones: `generated-chassis-assets.json`. All coordinates refer to the final full untrimmed WebP image.

Visible pause/reduced motion freeze the pose. Intersection/document visibility stops RAF; the active elapsed clock resumes from the frozen pose. `renderAt(seconds)` exposes a deterministic clock for the finite actual browser motion study under ignored `../qa/`. There are no libraries, fake sprite frames or whole-image float animations.

All illustrated cast is labeled artwork. The separately selectable actual game photographs retain their own accurate engine captions. Original image generation/reference provenance belongs to the adjacent manifests and PNGs; exclude this source directory from live deployment.
