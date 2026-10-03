# Illustrated cast action rigs

The site's eight crew and five machine chassis use **separate painted atlas parts**, parented bones and authored action clips. These are illustrated cast performances, not gameplay captures or ability demonstrations. The empty-handed crew check gear, gesture, look, step and brace; they do not pretend to fire or weld with absent tools.

## Texture and coordinate spaces

`rig-configs.json` is the final runtime fit. Bone pivots/endpoints and part sizes are normalized in the approved full-body reference cutout. Part rectangles are pixels in their particular atlas. Atlas dimensions and crop bounds differ: never derive rectangles by blindly dividing the nominal grid.

Each layer declares a source rectangle, local proximal pivot, distal axis, bind pivot/end, fixed dimensions, depth order and bone. The renderer aligns the painted link's local axis to its bind segment once, then applies the posed bone matrix. Head, torso, pelvis, machine cores and contact feet retain fitted dimensions rather than being scaled to short helper vectors. Overlapping joint caps and depth ordering cover sockets. No frame stretches armour to reach a target.

The whole-body cutout supplies the reference dimensions and static fallback. The production action rigs draw the articulated atlases. The earlier weighted triangle-mesh method remains in the renderer for configurations without parts; it is not used to fold the production forearms or machine tools.

## Authored motion

Every character has an `action` with duration, root keys, joint keys, phase events and individual contact tracks. Smooth interpolation connects authored anticipation, travel, gesture/tool action, release, return and settle poses. Idle follow-through is secondary to these clips.

Crew wrist targets drive two-link shoulder/elbow IK; separate glove bones complete the gesture. Feet have explicit lift and plant phases. Their contact transforms stay fixed during stance while two-link hip/knee/ankle IK accommodates the body shift. The shoe is a separate rigid layer. Machines use the same contact system for visible ground feet; Chime's airborne limbs have no fictitious planted contacts.

Scuttle has eight legs; Spool has five visible contacts and an occluded rear chain behind its core. Chime articulates two three-part wings and six tucked legs. Skip has two scythe arms, two smaller claws and two legs. Bastion has four heavy legs and a separate crusher jaw. Mochi's ears and Axi's six external gills are separate pieces; long tails have overlapping parented links.

## Playback

`OriginPortraitRig` caps normal playback at 24 fps. Only visible active canvases run. A hidden document, the global **Pause animations** control and `prefers-reduced-motion` freeze the clock. Resume continues from the retained pose without adding hidden time. Every cast folio and its actual Tideglass photograph remains visible during normal scrolling.

`renderAt(seconds)` exposes a deterministic pose for bounded browser motion inspection. `debugSummary()` reports rig structure. Neither adds a control or implementation detail to the public presentation.

## Durable source

Atlas PNGs, exact image-generation prompts, source/reference hashes, actual component bounds and initial body fits are in `art-sources/`. Crew measured sidecars are under `assets/illustrated/crew-<id>-atlas-parts.json`; chassis maps are `art-sources/<id>-layered-atlas.json`. The final authored tracks and reconstructed fits are in `rig-configs.json`. Source-only records are excluded from deployment.

See `QA-CHECKS.md` for the actual browser action study and join/contact review.
