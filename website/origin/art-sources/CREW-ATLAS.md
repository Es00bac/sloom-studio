# Layered crew action sources

Each `crew-<id>-rig-atlas.png` is a built-in imagegen edit of the approved full-body illustration, with the validated Vix atlas supplied as a layout reference. The seven additional characters each used one generation. Exact prompts, source paths, hashes and alpha verification are in `crew-<id>-atlas-generation.json`.

Optimized RGBA WebPs are under `../assets/illustrated/`; encoding preserves each PNG alpha channel exactly. Six atlases are 887×1774. Axi is 768×2048, with 24 parts including six separate external gills. PNG sources and this source directory are excluded from the public deployment bundle.

## Source arrangement

Logical rows 0–4 are head/torso/pelvis, anatomical left arm trio, right arm trio, left leg trio, right leg trio. Atlas left/right is anatomical; original rig L/R denotes image side, so anatomical left binds R. Actual part rects extend beyond some nominal cell boundaries: use measured rect manifests rather than blindly dividing the canvas.

Row 5 contains three tail links for Cache, Hex and Patches; one short tail tuft for CyberPengu and Ducké. Mochi uses a tail tuft plus two independently articulated long ears. The generator swapped Mochi's ear cells: column 1 is anatomical right without the tech insert; column 2 is anatomical left with the insert. The manifest maps these actual cells to original ear-L/ear-R anchors correctly.

Axi row 5 has three finned tail links. Row 6 contains anatomical left upper/middle/lower gills, binding original gill-R-1/2/3. Row 7 contains anatomical right gills, binding gill-L-1/2/3. The head retains its helmet but has no baked gill silhouettes.

## Fit metadata

`../assets/illustrated/crew-<id>-atlas-parts.json` contains actual rects, measured alpha bounds, local proximal/distal socket axes and original bind endpoints. Forearms end at the wrist, shins at the ankle. Feet use their separate ground-contact transform. Ducké's shin rects select the thin orange shin above the ankle and exclude the generated small foot flange; intact webbed feet are separate layers.

`crew-<id>-fit.json`, also delivered at `/tmp/origin-actions/<id>-fit.json`, supplies initial original-proportion head, torso, pelvis and boot/foot overrides. These pieces use fixed reference proportions instead of short helper-bone lengths. The website renderer owns final overlap, depth, IK, and reconstructed bind/action verification.

`measure-crew-atlases.py` reads alpha without altering any image pixels. Its JSON specs record visually selected source rectangles and socket stations. Bounds and socket cross-section centers are measured; curved tail, ear and gill axes are individually fitted by inspection. The helper regenerates initial source sidecars, while final runtime fitting belongs to `../rig-configs.json`.
