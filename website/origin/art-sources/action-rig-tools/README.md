# Action authoring recipes

These source-only scripts record the assembly and keyframe authoring steps used during production. The accepted final runtime is `../../rig-configs.json`; no script is run at deployment.

Assembly scripts reconstruct initial rigs from the saved `246fdba` bind skeleton and measured atlas sidecars. They replace existing bone/part fits and therefore must not be run over the accepted runtime without preserving final calibration. Vix was fitted independently in the action prototype. Final head/collar offsets are recorded in `../final-fit-corrections.json`, and the final overlap/depth/IK fits and Vix action are in `rig-configs.json`.

Authoring scripts write keyframe tracks and initial secondary-motion tuning. They are production recipes rather than idempotent build tools. Work in an isolated source copy, compare the result against the accepted runtime, and review actual articulated motion after a deliberate edit. The durable crew body-fit records are `../crew-<identity>-fit.json`.

All files in `art-sources/` are excluded from the public runtime bundle.
