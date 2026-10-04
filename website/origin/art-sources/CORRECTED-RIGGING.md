# Source-preserving cast repair

The generated part atlases remain here as source history. They changed limb
proportions and sometimes assigned a piece to the wrong image side. They are
superseded by cutouts made from the approved intact character illustrations.
No new character pixels were generated for this repair.

## Durable fit data

- `corrected-primary-rigs.json`: CyberPengu, Ducké, Vix, Patches, Scuttle and Spool.
- `corrected-crew-support-rigs.json`: Cache, Mochi, Hex and Axi.
- `corrected-chassis-rigs.json`: Chime, Skip and Bastion.
- `corrected-source-rig-specs.json`: measured source axes and sole contacts for
  the first group. The configurations contain the final painted boundaries.
- `compact-source-rigs.py`: bounds each painted mask with a two-pixel source
  margin and remaps its coordinates without changing the posed geometry.

The canonical runtime configuration is the minified `../rig-configs.json`. These records
retain the ownership and measurements used to assemble it. The source imagery
is `../assets/illustrated/{crew,chassis}-<identity>.webp`; original generated
PNGs, prompts and source hashes remain in the earlier illustration manifests.

## Assembly and motion

Every articulated layer uses the same original illustration, its measured
joint pivot and its original bind coordinates. A residual body removes the
moving piece masks. Priority exclusions prevent a hand from taking adjacent
tail pixels or a thigh from taking a belt. Original painted socket underlap
remains beneath elbow, knee and hip joins. It is attached to the corresponding
parent bone rather than stretched across the joint.

Source image sides are explicit. Crew knees and ankles are separate anatomical
points; neither is substituted for the other. The chassis use their visible
mechanical joints and actual claw tips. Feet are pinned to the original painted
sole, with reachable two-link leg poses and authored lift/plant phases. Root
movement follows supported placements. No generic idle wobble is added to the
authored tracks.

The crew make empty-handed stance changes, acknowledgments and gauntlet or
strap checks. These illustrations do not demonstrate shooting or welding.
Scuttle and Spool retain support while crawling and operating their existing
painted pincers or probes. Chime moves its actual wing assemblies. Skip uses
its four painted arms with rigid internal armor angles. Bastion braces and
cycles the crusher along its painted hydraulic axis. Hidden rear Bastion joints
are conservative estimates; its action does not expose them with a large walk.
Spool's occluded sixth foot is not invented as an independent visible contact.

## Acceptance evidence

Validation compares each assembled zero pose to its intact original at the
same browser framing, samples planted contact reach through complete authored
cycles, and inspects actual full-size moving joints. A compact native browser
motion study shows all thirteen through complete cycles. Full-size swing and
gesture evidence checks joints that small montage thumbnails can hide.

`corrected-rig-constraints.json` records action names, durations and each
contact's maximum error. `corrected-rig-validation.json` adds source hashes,
native browser evidence and the final movie hash. All thirteen initial poses
match their original RGBA pixels exactly. Crew retain at least one planted
foot; Scuttle retains seven claws, Spool four visible feet, Skip two and
Bastion four. Chime is airborne. Reach errors remain below 0.25 source pixels
through complete cycles.

The study uses one 44-second cast capture and one targeted 11-second Vix/Axi
replacement. The latter closes Vix's foreground forearm ordering and Axi's
lifted-step ownership and knee pivots. Other actors retain the original
accepted recording. Native Canvas update counts and variable-rate browser
recording packets are reported separately; the final MP4 is delivered at
24 fps. Raw review frames and WebMs live outside game validation galleries.

The parent task accepted the combined 44-second study, full-size risk poses
and the two targeted Vix/Axi corrections. The runtime loads all thirteen actions
by default; pause, reduced motion and offscreen suspension remain. An intact
source fallback remains visible while a rig is loading or an asset is missing.
Initial fallback framing in `index.html` matches the corresponding action fit.
Art source records and review artifacts are not published as site runtime files.

Actual-page desktop and reduced-motion mobile checks cover all thirteen lazy
mounts, photographs, pause controls and measured platform contacts. A focused
stage check confirms portraits paint above the routed growth and hardware;
container queries belong to the support layer so they cannot trap the portrait
in a lower stacking context. Native headless evidence uses the Canvas material
fallback, not a website GPU runtime. Browser screenshot shutdown warnings are
separate from the completed functional reports.
