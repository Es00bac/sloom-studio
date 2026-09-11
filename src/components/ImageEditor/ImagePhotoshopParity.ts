export type PhotoshopParityPriority = 'high' | 'medium' | 'low';
export type PhotoshopParityStatus = 'done' | 'partial' | 'remaining';

export interface PhotoshopParityItem {
  id: string;
  area: string;
  photoshop: string;
  signalLoom: string;
  priority: PhotoshopParityPriority;
  status: PhotoshopParityStatus;
  parityEstimate: number;
  workflowReason: string;
}

export const IMAGE_PHOTOSHOP_PARITY_ITEMS: PhotoshopParityItem[] = [
  {
    id: 'free-transform',
    area: 'Move / Free Transform',
    photoshop: 'Move, transform controls, skew, distort, perspective, warp, numeric transform, pivot',
    signalLoom: 'Layer move, runtime document/layer edge and center snapping through the Move tool, edge/corner resize, rotation controls, numeric geometry, numeric transform through ImageLayerNumericTransformDescriptor X/Y/W/H/rotation/pivot fields, pivot control, apply/cancel transform preview sessions, buildImageLayerTransformReadiness descriptors, transform capability descriptors, preview-session descriptors, transform-control handle plans, rotate/pivot handle metadata, descriptorId v2 support-matrix metadata, source-link/source-safety summaries, transform geometry summaries, pivot summaries, handle readiness summaries, support matrices for skew/distort/perspective/warp, deterministic preview IDs/signatures, export caveats, and layer-side skew/distort/perspective/warp modes now exist; Photoshop-style editable Smart Object transform semantics and fully interactive warp mesh editing remain missing',
    priority: 'high',
    status: 'partial',
    parityEstimate: 68,
    workflowReason: 'Every quick edit depends on reliable movement, scaling, rotation, and transform commit behavior.',
  },
  {
    id: 'crop',
    area: 'Crop',
    photoshop: 'Crop handles, aspect presets, overlays, straighten, rotate crop, destructive and non-destructive crop',
    signalLoom: 'Crop rectangle with apply/cancel, aspect presets, persisted save/apply/delete custom aspect-ratio preset management, guide overlays, persisted straighten / rotate-crop controls, undoable destructive and non-destructive crop commits, a real `Delete Cropped Pixels` workflow, crop planning metadata, describeCropToolReadiness working-state descriptors, fixed-size print geometry descriptors, crop preview signatures, aspect constraint descriptors, mismatch warnings, non-destructive preview safety metadata, resize/canvas handoff warnings, invalid crop blockers, Source Bin/export handoff safety summaries, batch/action suitability summaries, visible export planning, crop handle readiness descriptors for eight resize handles plus rotate-crop handle, stable hit-target/visual sizes, keyboard-step metadata, crop-handle signatures, crop commit plan signatures, destructive/non-destructive commit descriptors, and an interactive Perspective Crop mode — on-canvas four-corner quad with live projected-guide preview, Enter/Escape commit boundaries, one-undo destructive-flatten store operation, Crop-panel corner fields bound to the live session, and Tiltmark rasterize-first refusal — now exist; richer crop handle ergonomics and true content-aware fill of transparent corners remain incomplete',
    priority: 'high',
    status: 'partial',
    parityEstimate: 70,
    workflowReason: 'Fast standalone Image edits need a crop tool that behaves like a real editor, not a prototype.',
  },
  {
    id: 'brush-engine',
    area: 'Brush / Eraser Engine',
    photoshop: 'Brush presets, tips, textures, dynamics, smoothing, symmetry, pressure and tilt response',
    signalLoom: 'Brush dabs, spacing, hardness, opacity, flow, smoothing, pressure, tilt, centered vertical/horizontal/four-way symmetry, a broader standard preset library, Brush presets now include the standard built-in preset library, standard category metadata for basic/soft/hard round/pencil/inking/airbrush/texture/smudge/retouch/eraser presets, compatibility filters for paint/erase/mask/retouch, previewable preset tiles, persisted custom preset save/rename/delete plus JSON export/import, buildBrushEngineReadiness descriptors, describeBrushWorkflowSupport descriptors, describeBrushRouteSummaries for pixels/layer masks/QuickMask/RGB/alpha/spot targets, describeUnsupportedBrushDynamicsReadiness descriptors, describeBrushDynamicsSupportMatrix support matrix descriptors, dynamic settings signatures, pressure/tilt/velocity/randomization support states, brush-tip metadata for round/square tipShape, deterministic preset preview signatures, brush dab preview metadata, validateImageBrushPresetPack import/export validation, accepted/rejected preset counts, data-brush-preset-preview-signature attributes, stroke preview metadata, capability summaries, brush preset descriptors, brush workflow support descriptors, brush/eraser workflow descriptors, channel/mask/QuickMask route summaries, brush/eraser preview signatures, preset-pack metadata, preset pack serialization planning, stylus input readiness, preset import/export readiness, unsupported dynamics warnings, advanced dynamics, velocity dynamics, texture sampling, dual-brush composition, wet media, GPU brush engine targets for desktop AMD, desktop Nvidia, and Android Qualcomm/Adreno, Android/gamepad brush controls, native ABR import fidelity, describeAdvancedBrushEngineSupport descriptors, WebGPU/OffscreenCanvas/canvas backend routing, pointer pressure/tilt Android control routing, gamepad axis pressure/size/flow routing, and compact Brush panel controls now exist',
    priority: 'high',
    status: 'done',
    parityEstimate: 100,
    workflowReason: 'Painting and retouching quality rises or falls with the brush engine.',
  },
  {
    id: 'text-tool',
    area: 'Text Tool',
    photoshop: 'Live editable type, font discovery, OpenType, kerning, baseline, styles, text on path, native text interop',
    signalLoom: 'Live editable type on canvas and live type editing on canvas exist through retained text edit overlays, double-click/edit-button entry, text metadata, rerasterization, paragraph controls, retained baseline shift, canvas kerning mode, caps variant controls, named typography presets, style controls, a standard font stack picker, visible OpenType feature toggles, style-level OpenType feature persistence, OpenType descriptor normalization helpers, unsupported OpenType tag reporting, typography readiness descriptors, describeImageTextTypographySupportMatrix support descriptors, style package signature helpers, font fallback stack signatures, bounded native PSD text export state signatures, support-matrix summaries in selected text controls, support-matrix summaries in the Text tool panel, image-text-typography-parity-progress descriptors, retained straight-segment text-on-path attachment controls plus sampled cubic Bezier text-on-path attachment controls, retained path reference/path layout metadata, text-on-path glyph raster previews, native PSD text-on-path export warnings, text properties find/replace controls, readability metrics, buildImageTextExportSourceBinHandoffDescriptor helpers, retained text editability summaries, retained vector-style text metadata, style package signatures, font fallback persistence, native PSD text subset warning states, rasterized preview/editability descriptors, retained live-edit descriptors, live-edit readiness checks, export/source-bin handoff caveats, stableSignatures, text preview IDs/signatures, native horizontal unwarped solid-colour PSD text records, installed-font discovery, dictionary spellcheck, browser shaping, editable text warps, and bounded multi-column vertical-rl/vertical-lr raster type with pre-allocation resource limits now exist; full Japanese vertical glyph substitutions/shaping, kinsoku, tate-chu-yoko, native text-on-path/warp/effect/mask interop, and richer on-canvas typography remain unsupported',
    priority: 'high',
    status: 'partial',
    parityEstimate: 72,
    workflowReason: 'Comic lettering, captions, thumbnails, and quick graphics need editable text that stays editable.',
  },
  {
    id: 'layer-stack',
    area: 'Layer Stack',
    photoshop: 'Groups, multi-select, search/filter, labels, lock variants, linked layers, clipping masks, batch operations',
    signalLoom: 'Add, duplicate, delete, reorder, visibility, full lock, pixel/position lock variants, lock workflow descriptors, lock batch planning descriptors, describeImageLayerLockParityReadiness descriptors, opacity, blend, merge, flatten, basic layer groups/folders, group inheritance summaries, group hierarchy readiness descriptors, grouped stack descriptors, nested group normalization, tree warning codes, inherited visibility/lock/opacity summaries, organization descriptors, layer organization readiness descriptors, same-width organization summaries, selected-layer property descriptors, selected-group boundary summaries for multi-select planning, linked movement groups, describeImageLayerLinkParityReadiness descriptors, link workflow descriptors, link batch planning descriptors, clipping-mask readiness descriptors, clipping base visibility through groups, layer search/filtering, source filters, color labels, and clipping masks exist; bounded multi-select and group hierarchy readiness now emit cross-group/nested/pass-through/group-mask/inherited-lock caveats, but full multi-select linked-transform semantics remain incomplete, and nested/pass-through group UI plus unsupported grouped-batch behavior remains incomplete',
    priority: 'high',
    status: 'partial',
    parityEstimate: 76,
    workflowReason: 'Large suite projects need layers that can be organized, found, grouped, and operated on in batches.',
  },
  {
    id: 'layer-masks',
    area: 'Layer Masks',
    photoshop: 'Mask create/edit/refine, density, feather, preview, overlay, copy, link, apply, delete',
    signalLoom: 'Reveal/hide/from selection/invert/apply/delete plus explicit reveal/hide/from-selection readiness paths, selection blocker summaries, non-destructive density and feather controls, direct layer-mask painting, active-mask overlay feedback, mask operation descriptors, layer-mask readiness descriptors, layer-mask operation signatures, layer-mask readiness signatures, runnable preview signatures, refine metadata, preview-mode summaries, richer preview modes through typed preview-mode descriptors, mask-vs-pixel target mismatch warnings, copy/link workflow warnings, and copy/link/apply/refine handoff caveats now exist; refine workspace and true linked-mask workflows remain incomplete',
    priority: 'high',
    status: 'partial',
    parityEstimate: 71,
    workflowReason: 'Masking is the central non-destructive editing workflow for image compositing.',
  },
  {
    id: 'adjustment-layers',
    area: 'Adjustment Layers',
    photoshop: 'Non-destructive adjustments with histogram-aware Levels/Curves, presets, clipping, masks, and previews',
    signalLoom: 'Brightness, contrast, hue/saturation, levels, curves, exposure, temperature, tint, black-white, invert, histogram-aware Levels/Curves controls, preview-feedback helpers, adjustment plan descriptors, describeAdjustmentActionReadiness descriptors, describeAdjustmentStackReadiness descriptors, adjustment stack planning descriptors, per-kind channel summaries, mask interaction summaries, typed adjustment histogram feedback checks, describeAdjustmentHistogramFeedbackReadiness descriptors, validateAdjustmentPresetCompatibility descriptors, preset compatibility validation, stack signatures, stable preview IDs, preset import/export compatibility, before/after visible-pixel deltas, before/after histogram signatures, per-channel clipping feedback, preview/apply semantics, invalid parameter blockers, export/source-bin handoff safety, action/batch suitability, preset serialization, preset import/export warnings, readiness blockers for incomplete parameters and missing histogram source data, stable feedback signatures, a hardware-accelerated point-wise preview path for unmasked, unclipped, fully opaque Brightness/Contrast, Black & White, Invert, and Exposure layers, deterministic CPU fallback for every other adjustment or safety condition, unsupported true 16/32-bit processing, unsupported Photoshop preset families, unsupported LAB/CMYK native adjustment operations, normalized curves, stable stack preview/plan signatures, readiness signatures, and unsupported clipping/mask/preset-family/native preset import-export warnings exist; richer preset UI, clipping behavior, native PSD/Camera Raw/LUT/gradient-map adjustment execution, and broader live-preview visualization remain incomplete',
    priority: 'high',
    status: 'partial',
    parityEstimate: 71,
    workflowReason: 'Generated images often need color and value correction before handoff to Paper or Video.',
  },
  {
    id: 'channels',
    area: 'Channels',
    photoshop: 'RGB/alpha/spot channel panel, channel editing, channel-to-selection, selection-to-channel',
    signalLoom: 'A first-class Channels panel now exists with RGB rows, an active RGB/Red/Green/Blue channel target model, RGB channel target summaries, channel readiness descriptors, persisted alpha/saved-selection channels, persisted spot-channel metadata, alpha save/load action summaries, selection-channel round-trip descriptors, invalid-mask and size-mismatch blockers, direct RGB edit readiness metadata, channel preview/readiness signatures, spot-channel preview/readiness signatures, spot-channel RGB-tint preview metadata, channel paint-routing descriptors for RGB/component brush and eraser routes, RGB component channel editing through brush/eraser routing, unsupported alpha/spot paint targets with metadata/selection fallbacks, export-readiness summaries for alpha and spot metadata-only export warnings, direct alpha painting unsupported status, direct spot-channel painting unsupported status, and basic brush/eraser routing for active RGB components; deeper per-channel operations, native spot plates, and press-ready separations remain missing',
    priority: 'high',
    status: 'partial',
    parityEstimate: 63,
    workflowReason: 'Channels are required for masks, print workflows, and precision selections.',
  },
  {
    id: 'layer-styles',
    area: 'Layer Styles',
    photoshop: 'Stroke, shadows, glows, bevel, emboss, satin, overlays, blending options, global light, presets',
    signalLoom: 'Stroke, drop shadow, inner shadow, outer glow, inner glow, color overlay, satin, pattern overlay, and gradient overlay now exist with persisted settings, renderer output, compact effect controls, global light angle synchronization for shadows, satin distance/size/angle/invert controls, pattern overlay foreground/background colors, pattern selector, scale controls, inner-glow size controls, gradient overlay start/end colors, angle/scale/reverse controls, reusable style presets, style preset helpers, a capability catalog, capability-group descriptors, supported-effect catalog metadata, layer-effect readiness summaries, describeLayerEffectUnsupportedStateDescriptors unsupported-state descriptors, describeImageLayerStyleSignatureSet signatures, style-set signatures, clipboard signatures, preset signatures, preview-risk signatures, export-risk signatures, unsupported-state signatures, compact Layer Effects readiness summary attributes, structured blockers, structured warnings, unsupported-state tags, preview IDs/signatures, global-light participation metadata, style portability descriptors, per-effect export caveats, style clipboard suitability checks, global-light portability carry-through, clipboard suitability summaries, describeImageLayerStyleClipboardReadiness descriptors, preset portability metadata, flattened export rasterization warnings, deterministic unsupported-effect warnings, source-bin parity caveats, action/batch suitability, alpha/opacity caveats, math limitation metadata, Bevel & Emboss metadata-only readiness, Blend If metadata-only readiness, native PSD live effect fidelity unsupported state, and Smart Object effect preservation unsupported state; bevel/emboss rendering, Photoshop Blend If, true advanced blending, native PSD live effect fidelity, and Smart Object effect preservation remain missing',
    priority: 'high',
    status: 'partial',
    parityEstimate: 75,
    workflowReason: 'Layer styles are expected for text, UI art, thumbnails, and comic effects.',
  },
  {
    id: 'layer-filters',
    area: 'Editable Filter Stacks',
    photoshop: 'Smart filters with ordering, masks, blend/opacity, and non-destructive previews',
    signalLoom: 'Blur, sharpen, grayscale, sepia, invert, noise, and pixelate filters now support non-destructive stack ordering, per-filter opacity, per-filter blend modes, owned per-filter alpha masks, blend/opacity/mask controls, filter stack descriptors, describeLayerFilterActionReadiness descriptors, supported stack summaries, non-destructive preview/metadata commit semantics, per-layer filter metadata, source-bin handoff safety, batch/action suitability, invalid parameter blockers, filter stack interop planning, blend/order signatures, preview/export parity signatures, parameter caveats, filter-gallery/native Smart Filter unsupported states, filter-family gap descriptors, preview/control readiness, preset portability status, flattened export warnings, warning metadata, and preset serialization; richer filter families and native Photoshop Smart Filter roundtrip remain incomplete',
    priority: 'high',
    status: 'partial',
    parityEstimate: 60,
    workflowReason: 'Filters need to stay adjustable instead of being one-way destructive operations.',
  },
  {
    id: 'smart-source-linked-layers',
    area: 'Smart / Source-Linked Layers',
    photoshop: 'Embedded and linked Smart Objects, replace contents, edit original, rasterize, scale preservation, smart filters',
    signalLoom: 'Source-linked metadata, smart/source-linked layer metadata descriptors, relink history, describeSourceLinkedLayerReadiness descriptors, relink/repair and missing warnings, relink/repair readiness descriptors, source-linked layer readiness descriptors, missing source-linked refresh blockers, edit-original metadata-only status, replace-contents readiness with transform scale preservation, source-link-removing rasterize readiness, snapshot/reference preview metadata, source snapshot availability checks, source snapshot preservation, action/batch suitability, suite handoff safety summaries, smart-filter limitation metadata, PSD/source-bin handoff caveats, PSD metadata preservation for source-link status/history, source-linked/smart-object round-trip strategy descriptors, Smart Filter metadata-only caveat descriptors, PSD native-construct warning aggregates, liquify/source preservation descriptors, and explicit metadata-only PSD Smart Object warning now exist; true native Smart Object semantics, Embedded native Smart Objects, and native smart filters are not implemented',
    priority: 'high',
    status: 'partial',
    parityEstimate: 63,
    workflowReason: 'Sloom Studio projects rely on generated source assets staying traceable through the suite.',
  },
  {
    id: 'vector-layers',
    area: 'Vector Layers',
    photoshop: 'Editable shape/path layers, strokes/fills, booleans, path selection, rasterize vector, SVG/PSD interop',
    signalLoom: 'Rectangle, ellipse, and first retained straight/cubic Pen paths now create retained vector-backed layers with editable fill/stroke properties, direct Convert Shape to Editable Path actions for rectangle/ellipse layers, numeric retained path point editing, path-point editability boundaries, direct draggable anchor handles and retained cubic Bezier handle controls for active paths, Pen click-drag Bezier handle creation, rasterize support, describeImageVectorShapeMetadata descriptors, describeImageRasterVectorShapeReadiness descriptors, describeImageVectorBooleanSupportMatrix support metadata, unsupportedResultPolicy metadata, sourceMutation: none guarantees for unsupported boolean plans, handoffSignatures for SVG/PSD/source-bin routes, direct Layers context-menu Vector Boolean actions for adjacent retained vector operands, exact materialized boolean result layers for axis-aligned rectangles, identical simple polygons, and non-overlapping simple polygons through materializeImageVectorBooleanLayers (with vectorBooleanSource metadata), retained editability summaries, SVG/PSD handoff caveats, preview signatures, unsupported vector boolean warnings that do not mutate source layers, vector planning descriptors, and SVG/PSD vector handoff limitations; live boolean operation stacks, overlapping polygon/Bezier booleans, smooth/corner anchor conversion, and broader SVG/PSD vector semantics remain missing',
    priority: 'high',
    status: 'partial',
    parityEstimate: 68,
    workflowReason: 'Shapes, captions, masks, and print artwork need editable vector structure.',
  },
  {
    id: 'selection-tools',
    area: 'Selection Tools',
    photoshop: 'Marquee, lasso, magic wand, quick/object/subject selection, refine edge, save/load, transform selection',
    signalLoom: 'Marquee, lasso, magic wand, masks, combine modes, runtime feathered selection masks, saved channels, QuickMask, local alpha/luminance foreground object selection from visible layers, basic grow/shrink/feather/border/smooth refinement controls, direct undoable selection nudging from the Move properties panel, Arrow-key nudging of committed selections before layer movement, selection nudge quick actions for macro/action playback, Select and Mask readiness descriptors, object-selection readiness descriptors, lasso/marquee keyboard modifier caveats, batch/action suitability descriptors, invalid selection blockers, composite-derived Sobel magnetic lasso snapping with visible freehand fallback when a composite or canvas is unavailable, and a real Transform Selection workflow with numeric X/Y/W/H, numeric rotation preview/apply-cancel, Move-tool drag handoff from active selection masks, direct on-canvas move/resize/skew/distort handles, selection transform descriptors, apply/cancel readiness, numeric geometry/pivot signatures, skew/distort caveats, marching-ants/overlay unsupported states, and a direct on-canvas rotation handle now exist; AI subject detection and a fuller refine workspace are still missing',
    priority: 'high',
    status: 'partial',
    parityEstimate: 80,
    workflowReason: 'Selections are the bridge between AI edits, masking, paint, fill, and transform work.',
  },
  {
    id: 'magic-wand-paint-bucket',
    area: 'Magic Wand / Paint Bucket',
    photoshop: 'Tolerance, sample all layers, contiguous, anti-alias, gap close, opacity/mode, transparency behavior',
    signalLoom: 'Tolerance, sample-all-layers, contiguous/global matching, Magic Wand anti-aliased selection edge alpha, Magic Wand and Paint Bucket workflow descriptors, describePaintBucketActionReadiness descriptors, fill output summaries, opacity controls, fill blend modes, preserve-transparency behavior, target channel metadata, mask/channel caveats, alpha handling summaries, batch/action suitability, invalid tolerance blockers, stable preview signatures, Paint Bucket anti-aliased fill edge quality via a one-pixel neighbor-coverage fringe, and explicit unsupported gap-close and channel-specific fill warnings now exist',
    priority: 'high',
    status: 'partial',
    parityEstimate: 61,
    workflowReason: 'Flat fills and quick selection are common in comics, UI art, masks, and cleanup.',
  },
  {
    id: 'clone-heal-retouch',
    area: 'Clone / Heal / Retouch',
    photoshop: 'Clone Source panel, aligned modes, sample all/current/below, source overlay/transform, healing, patch, remove',
    signalLoom: 'Clone stamp, spot heal, healing brush, blur, sharpen, smudge, dodge, burn, and sponge exist; clone/heal now support current layer, current-and-below, and all-layers sampling, blur/sharpen now use current-layer/current-and-below/all-layers stroke snapshots, clone supports aligned versus restart-source strokes, helper metadata covers clone-source overlay planning plus spot-heal patch sampling plans, describeCloneStampToolWorkflow descriptors, describeSpotHealToolWorkflow descriptors, describeRetouchWorkflowReadiness summaries, describeRetouchToolReadiness descriptors, describeRetouchContentAwareRepairParity descriptors, describeRetouchParityChecks, non-destructive output planning, patch/remove/new-layer caveats, retouch tool readiness constants, and retouch brush planning metadata now exposes stable capability descriptors, clone workflow descriptors, sample readiness, sample-source-required blockers, retouch workflow readiness summaries, content-aware repair parity descriptors for Patch/Remove/new-layer limitations, preview IDs/signatures, active-layer destructive output caveats, layer/mask/channel caveats, batch/action suitability, strength/exposure/saturation behavior, rate/airbrush metadata for retouch brushes, sample/output warnings, bounded smudge current-and-below/all-layers live composite resampling, implemented dodge/burn tone-range targeting with protect-tones controls, and Sponge vibrance / preserve-luminosity controls. Live clone source overlay/transform UI, full patch workflow, remove tooling, and non-destructive retouch output remain missing',
    priority: 'high',
    status: 'partial',
    parityEstimate: 70,
    workflowReason: 'Retouching needs predictable sample sources and non-destructive-friendly cleanup paths.',
  },
  {
    id: 'gradients',
    area: 'Gradients',
    photoshop: 'Multi-stop editor, preset library, transparency stops, linear/radial/angle/reflected/diamond, dither, reverse',
    signalLoom: 'Linear, radial, angle/conical, reflected, and diamond gradients now exist with foreground-to-background, foreground-to-transparent, reverse, persisted tool controls, custom multi-stop gradients, deterministic gradient parity descriptors, gradient readiness descriptors, describeGradientReadiness descriptors, describeGradientActionReadiness descriptors, selection-mask-clipped routing, full-layer routing, alpha stop handling, transparent stop opacity, target/channel caveats, invalid blocker metadata, transparency stops via per-stop opacity controls, portable preset metadata, a standard preset library, add/remove/offset stop editing, deterministic ordered dithering, export flattening caveats, batch/action suitability, and editable-native-gradient-layer/mesh/noise/gradient-map unsupported warnings; editable native gradient layers, mesh gradients, noise gradients, and richer gradient-map workflows remain missing',
    priority: 'high',
    status: 'partial',
    parityEstimate: 70,
    workflowReason: 'Gradients are expected for masks, backgrounds, lighting, and graphic design work.',
  },
  {
    id: 'file-interop',
    area: 'File Interoperability',
    photoshop: 'PSD/PSB/TIFF/GIF/SVG plus native groups, text, effects, smart objects, warnings, and round-trip strategy',
    signalLoom: 'PNG/JPEG/WebP/AVIF/BMP/GIF/TIFF/SVG export, PSD partial import/export, native groups through PSD group folder export/import with nested children and group membership, PSD export manifests, PSD/XCF native-construct readiness descriptors, compact compatibility signatures, XCF export, XCF extension/MIME/header import-readiness detection, bounded XCF layered raster import (8-bit RGB/gray/indexed layers and masks, uncompressed/RLE/zlib tiles, explicit caps with typed errors, honest flattening warnings for groups/text/channels), XCF import/export policy warning descriptors, structured XCF policy warning metadata, describeXcfNativeDecodeState bounded decode-state descriptors, XCF header recognition, blocked edit-state operations, fallbackRecommendations, enriched XCF round-trip risk descriptors, PNG/TIFF/PSD/source-library fallback route descriptors, source-link status/history metadata, retained typography/effects/source-link/filter metadata summaries, deterministic per-layer warning descriptors, PSD layer-mask/native construct aggregates, PSD roundtrip risk descriptors, PSD/PSB size-policy import guards, shared Photoshop header size policy, PSD 30000 px blockers, PSB header blockers, source format import-policy metadata, format export-readiness helpers for TIFF/GIF/SVG/RAW/PSB limits, PSB threshold records and caveats, RAW develop-first handoff metadata, supported RAW handoff format descriptors, high-bit-depth caveats, source-format policy warning descriptors, stable policy signatures, print/proof export readiness descriptors, printProof export descriptors, explicit native PSD Smart Object/text/effect warnings, and honest format-policy descriptions for PSD/PSB/XCF/TIFF/GIF/SVG/RAW limits exist; native PSD Smart Object/editable text/adjustment/effect/mask/filter constructs remain flattened/partial and XCF native edit state (text, groups, filters, effects, source links) does not round-trip, while XCF raster layers and masks import within the documented bounds',
    priority: 'high',
    status: 'partial',
    parityEstimate: 61,
    workflowReason: 'Users need to move assets into and out of external editors without hidden data loss.',
  },
  {
    id: 'history-actions',
    area: 'History / Actions',
    photoshop: 'History panel, named states, snapshots, action recording/playback, batch processing',
    signalLoom: 'Undo/redo operations, a first-class History panel with clickable state navigation, named states, snapshots, named snapshot controls, custom snapshot naming, snapshot rename controls, buildImageSnapshotReadinessDescriptor diagnostics, snapshot identity summaries, persisted quick-action recording/playback, rename controls, describeImageQuickActionReadiness descriptors, buildImageQuickActionMacroReadiness descriptors, buildImageQuickActionMacroPlaybackDiagnostics, macroRunIdentity, importValidation descriptors, per-document playback diagnostics, per-document macro compatibility checks, step-level blockers/signatures, stepExecutionLog entries, batch playback across currently open Image documents now exist, open-document macro playback previews, duplicate-step/reference validation, schema-versioned macro import/export manifests, and history/action workflow descriptors with fixed-command limitations now exist; full arbitrary command recording, arbitrary plugin commands, unattended background execution, unattended native filesystem execution, and unattended file/folder batch processing remain missing',
    priority: 'high',
    status: 'partial',
    parityEstimate: 73,
    workflowReason: 'Professional editing needs recoverability, repeatability, and auditable batch automation.',
  },
  {
    id: 'android-parity',
    area: 'Android Image Parity',
    photoshop: 'Mobile-capable color picking, accelerated local processing, and feature parity where platform permits',
    signalLoom: [
      'Mobile-capable color picking is covered by the advanced picker with compact Android/touch controls, HSV/RGB/hex/alpha controls, and optional eyedropper affordance; accelerated local processing is covered by Android accelerator / Android-native QNN upscaling paths, describeAndroidNativeImageParityReadiness descriptors, android-on-device-upscale-readiness descriptors, single-app runtime checks, single-app handoff guard checks, runtime assets checks, and upscaler model checks',
      'route method descriptors for QNN / bitmap fallback / cloud fallback, upscaler method/cost/capability descriptors, fallback order descriptors, Dex 4K display evidence, Image workspace screenshot evidence, DeX evidence status with 1920x1080 requirements',
      'feature parity where platform permits is tracked by opened-document Dex evidence for a blank Image canvas, blank-canvas opened-document edit evidence with visible brush marks, imported-image edit coverage requiring filename/artifact/visible edit marks, unsupported runtime/accelerator/cloud/DeX/imported-edit states, accelerated execution unproven state when no runtime proof exists, and Android 1080p DeX workspace evidence at 1920x1080 with no-document-open state now exist',
      'broader imported/opened editing still needs coverage and imported-file editing coverage remains required for every Image change',
    ].join('; '),
    priority: 'high',
    status: 'partial',
    parityEstimate: 73,
    workflowReason: 'The Android version must not lag behind desktop for color and upscaling workflows.',
  },
  {
    id: 'workspace-launch-icons',
    area: 'Workspace Launch / Icons',
    photoshop: 'Distinct app launch identity with clean transparent icons and predictable standalone entry points',
    signalLoom: 'Flow, Video, Image, and Paper have stable menu launch/focus commands, workspace app launch descriptors, buildWorkspaceSuiteStandaloneHandoff descriptors, desktop workspace launch readiness descriptors, Distinct app launch identity with clean transparent icons readiness through distinct workspace launch commands and transparent Image workspace PNG icon metadata, icon readiness descriptors, buildWorkspaceTransparentEdgeDescriptor helpers, workspace launch/icon readiness summaries, workspace tab PNGs with transparent edge alpha, transparent-edge icon metadata checks, NATIVE_WORKSPACE_STANDALONE_ENTRY_POINTS, buildNativeStandaloneEntryReadiness descriptors, shared-binary standalone entry readiness, package target caveats, signed-package unsupported states, and Windows/macOS/Linux packaging readiness summaries; OS launcher identity and signed package evidence remain partial',
    priority: 'high',
    status: 'partial',
    parityEstimate: 53,
    workflowReason: 'Image must work as a fast standalone editor and as part of the suite.',
  },
  {
    id: 'tool-registry',
    area: 'Tool Registry / Shortcuts',
    photoshop: 'Complete toolbar with shortcuts, nested tools, and customization',
    signalLoom: 'Complete toolbar with shortcuts is backed by twenty-five registered tools and keyboard shortcuts, including Pen and Magic Eraser entries, buildImageEditorToolReadinessDescriptor typed catalog summaries, grouped tool catalog metadata, option availability summaries, command state descriptors, device route support descriptors, stable toolbar grouping signatures, Image tool shortcut signatures, registered tool coverage descriptors, shortcut collision/missing-state descriptors, describeImageToolDispatcherSupport dispatcher support coverage, full/partial/inactive canvas handler states, workspace command routing summaries, Image tool shortcut readiness, compact flyout groups for nested tool behavior, user-reorderable toolbar customization now exists through sanitized drag-reorderable compact flyout slots, customization:user-reorderable-flyout-groups:no-dock:no-resize evidence, Android/gamepad route unsupported states, and explicit nested/flyout customization descriptors',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 64,
    workflowReason: 'A credible editor needs dense, predictable tool access.',
  },
  {
    id: 'compact-tools-palette',
    area: 'Compact Tools Palette',
    photoshop: 'Floating two-column fixed toolbar with integrated color wells and no wasted area',
    signalLoom: 'Fixed 66x456 floating-only palette with compact chrome, two columns, zero icon gap, no wasted area, color wells, no Dock button for fixed tool palettes, non-tab-target behavior, stable toolbar grouping signatures, shared tool-readiness catalog contract, nested tool flyouts now exist, absolute-overlay flyout footprint metadata, broader toolbar customization now exists through user-reorderable compact flyout slots, and customization:user-reorderable-flyout-groups:no-dock:no-resize evidence exist',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 77,
    workflowReason: 'The user explicitly requested old-Photoshop-style tool palette behavior.',
  },
  {
    id: 'dockable-tab-groups',
    area: 'Dockable Dialog Tab Groups',
    photoshop: 'Tabbed docked and floating dialog groups with active-panel switching and persistent geometry',
    signalLoom: 'Adobe-style docked and floating panel grouping now renders stable tabbed dialog groups for standard Image dialogs, including Tabbed docked groups with active-panel switching and default preset grouping for Layers, Channels, and Paths, switches active tab bodies through real tab clicks, keeps grouped dock stacks non-overlapping in 1920x1080 and 2560x1440 evidence, persists drag-to-tab metadata and persistent geometry, keeps stable externalWindowKey/native popup size while switching tabs, compact floating chrome implies fixed native popup geometry, suppresses dock affordances for compact tool palettes, visible ungroup controls, ungrouping docked tabs reassigns dock-stack z-order from former tab order, richer tab context menus with activate, move left/right, ungroup, float, and reset actions now exist, and compact fixed tool palettes are excluded from tab targets',
    priority: 'medium',
    status: 'done',
    parityEstimate: 100,
    workflowReason: 'Adobe-style Image work depends on panel groups that can share space without ballooning or hiding active editing controls.',
  },
  {
    id: 'hand-navigation',
    area: 'Hand / Navigation',
    photoshop: 'Pan/zoom navigation, fit controls, shortcuts, and stable canvas interaction',
    signalLoom: 'Hand tool, viewport controls, explicit top-bar Fit / 100% / zoom in / zoom out controls, typed pan/fit/100%/zoom command descriptors with viewportTarget and shortcutKeys metadata, shortcut routing metadata with focus/editable-target blockers, editable-target shortcut routing policy, resolveImageNavigationKeyboardShortcut helpers, mixed-tool interaction caveats, stable mixed-tool canvas interaction descriptors, preservesActiveTool / temporaryHandPan / pointer capture / cursor policy metadata, deeper navigation affordance descriptors for top-toolbar, floating-tool-palette, canvas, wheel zoom, Space+Drag, middle-mouse drag, pinch zoom, and two-finger pan, desktop/Android/DeX handoff caveats, viewport-only action/batch suitability metadata, and Ctrl/Cmd zoom/focus shortcuts now exist through shared viewport command helpers',
    priority: 'medium',
    status: 'done',
    parityEstimate: 100,
    workflowReason: 'Editing speed depends on moving through large images without fighting the UI.',
  },
  {
    id: 'move-tool',
    area: 'Move Tool',
    photoshop: 'Move, align, distribute, transform controls, snapping, and layer selection behavior',
    signalLoom: 'Layer drag, geometry display, resize, rotation, runtime document/layer edge and center snapping, move workflow descriptors, transform status, link/lock movement planning, source-safe movement metadata, source-safety summaries, metadata-only source-linked moves, missing source-link warnings, source IDs, deterministic preview IDs/signatures, export caveats, nudge, canvas-align command metadata, Move-tool selection drag handoff from active selection masks starts/reuses Transform Selection sessions, updates the live selection preview instead of moving the active layer, and commits/cancels through pointer release, Enter/Escape, and undoable selection history, describeMoveToolParityPlan descriptors, align-readiness command descriptors, distribute-readiness descriptors, deterministic snapping/distribution planning helpers, snap guide/candidate summaries, snap candidate summaries, guide counts, closest candidates by axis, in-range counts, snapped-delta helpers used by runtime dragging, active-layer movement safety summaries, active locks, group layers, no movable layers, stationary linked members, and explicit distribution unsupported warning descriptors exist; multi-layer align targets, full smart-guide overlay feedback, multi-layer distribution, and richer selection behavior remain incomplete',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 67,
    workflowReason: 'Layer placement is a core quick-edit operation.',
  },
  {
    id: 'marquee',
    area: 'Marquee',
    photoshop: 'Rectangular/elliptical selections, feathering, anti-alias, modes, transform, save/load',
    signalLoom: 'Rectangle and ellipse marquee with runtime feathered selection masks, feathering through runtime feathered selection masks, anti-alias, selection modes, selection-mode semantics, marquee workflow descriptors, describeMarqueeSelectionGeometry descriptors, zero-area invalid metadata, geometry/output metadata, preview signatures, keyboard modifier caveats, batch/action suitability, transform through shared Transform Selection handoff, invalid selection blockers, invalid marquee geometry blockers, explicit saved-selection operation readiness for save/load replace/add/subtract/intersect, zero-area marquee drags cancel behavior, and explicit smoothing limitations exists',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 62,
    workflowReason: 'Simple selections must remain dependable as more advanced selection features arrive.',
  },
  {
    id: 'lasso',
    area: 'Lasso',
    photoshop: 'Freehand, polygonal, magnetic lasso, refine edge, selection modes',
    signalLoom: 'Freehand and polygonal lasso exist with selection-mode semantics, lasso workflow descriptors, commit vs cursor-preview geometry descriptors, bounds, area, path length, invalid reasons, signatures, open polygonal preview metadata, closure/geometry signatures, keyboard modifier caveats, batch/action suitability, invalid selection blockers, invalid lasso path blockers, underspecified freehand lasso strokes cancel behavior, freehand smoothing limitations, and an interactive magnetic lasso that builds a composite-derived Sobel edge field, snaps anchors within a bounded snap radius and contrast threshold, and falls back to freehand when a readable composite or canvas is unavailable; refinement workflows remain missing',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 57,
    workflowReason: 'Manual selection is still needed when AI/object selection fails.',
  },
  {
    id: 'selection-mask-system',
    area: 'Selection Mask System',
    photoshop: 'QuickMask, alpha channels, saved selections, mask refinement, overlays',
    signalLoom: 'Alpha mask buffer, combine modes, selection alpha combine mode formulas/signatures, featherable selections, registry, persisted saved alpha channels for saved selections, selection-to-layer-mask readiness summaries, a real QuickMask overlay, QuickMask and selection-mask overlays, animated marching ants for committed active selection outlines, QuickMask overlay summaries, QuickMask edit readiness descriptors, Select and Mask local matte preview controls, richer visualization through QuickMask overlays, selection-mask overlays, animated marching ants, and Select and Mask local matte previews, enter/exit selection-to-mask and mask-to-selection semantics, brush/eraser QuickMask editing, brush-route blocker metadata for pixel-alpha erasers, alpha/channel interop warnings, stable QuickMask edit signatures, selection-mask overlay alpha summaries, opacity/feather display metadata, basic refinement controls, select-and-mask style preview/output routing, and selection refine handoff now exist; brush-based edge refinement remains missing',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 79,
    workflowReason: 'Selection data should be reusable across tools, masks, and channels.',
  },
  {
    id: 'eraser',
    area: 'Eraser',
    photoshop: 'Eraser, background eraser, magic eraser, brush dynamics, opacity/flow controls',
    signalLoom: 'Eraser uses the brush engine with destination-out compositing plus deterministic workflow descriptor metadata for pixel, RGB-channel, layer-mask, and QuickMask routes; Eraser inherits brush-engine dab dynamics for spacing, hardness, smoothing, pressure/tilt, opacity, and flow across pixel, RGB-channel, layer-mask, and QuickMask routes; Eraser opacity/flow controls are routed through brush-engine dab alpha and dab build-up settings; Background Eraser is now a bounded active-pixel-layer alpha-clear brush with sampling once/continuous, background swatch, contiguous/discontiguous brush-bounded matching, heuristic limits/protect-foreground semantics, edgeSummary output, per-route eraser support paths, blocker summaries, and route signatures; Magic Eraser is now a dedicated toolbar/tool-dispatch path that clears active pixel-layer alpha by tolerance with contiguous/global matching, undoable paint operations, compact tolerance/contiguous Properties controls, edgeSummary output, per-route eraser support paths, blocker summaries, and route signatures; Photoshop edge cleanup now exists through anti-aliased one-pixel alpha-fringe cleanup controlled by the selection anti-alias setting; Background Eraser and Magic Eraser mask/channel/QuickMask routes remain missing, and true sampling/limits semantics remain incomplete',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 52,
    workflowReason: 'Cleanup and masking workflows need reliable erasing behavior.',
  },
  {
    id: 'blur-sharpen-smudge',
    area: 'Blur / Sharpen / Smudge',
    photoshop: 'Brush-based local blur, sharpen, and smudge with strength, samples, modes, and dynamics',
    signalLoom: 'Local blur, sharpen, and smudge brush tools exist with shared brush options, deterministic capability descriptors, dedicated readiness descriptors, shared finishing readiness signatures, retouch tool readiness constants, current-layer/current-and-below/all-layers sampling routes, bounded smudge composite sampling descriptors, layer/mask/channel route summaries, batch/action suitability, and a dedicated finishing-brush properties section; smudge with strength, sample controls, and samples controls now exists through the shared finishing-brush strength setting plus current-layer/current-and-below/all-layers sampling routes; blur and sharpen now support current-layer, current-and-below, and all-layers stroke snapshots in both descriptors and live brush strokes, while smudge keeps previous-point current-layer sampling and now has bounded live composite resampling for currentAndBelow and allLayers. Richer blend modes and deeper dynamics remain missing',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 52,
    workflowReason: 'Finishing workflows need local pixel manipulation beyond paint and erase.',
  },
  {
    id: 'dodge-burn-sponge',
    area: 'Dodge / Burn / Sponge',
    photoshop: 'Range-aware tonal and saturation brushes with protect-tones and exposure/rate controls',
    signalLoom: 'Local dodge, burn, and sponge brushes exist; Range-aware tonal brushes now exist through dodge/burn all/shadows/midtones/highlights range targeting and protect-tones scaling; saturation brushes with protect-tones now exist through Sponge saturate/desaturate vibrance-weighted saturation response and optional luminance preservation; exposure/rate controls now exist through dedicated properties controls, bounded rate controls, airbrush metadata, live tool-settings wiring, and descriptor metadata; non-destructive retouch output now exists through New Retouch Layer output mode for Dodge, Burn, Saturate, and Desaturate strokes with source-layer preservation, generated retouch layer metadata, undoable layerOp commits, and Retouch output mode controls',
    priority: 'medium',
    status: 'done',
    parityEstimate: 100,
    workflowReason: 'Generated art often needs local tonal cleanup.',
  },
  {
    id: 'raster-shapes',
    area: 'Raster Shape Tools',
    photoshop: 'Vector-backed rectangles, ellipses, custom shapes, strokes, fills, booleans',
    signalLoom: 'Vector-backed rectangles, Rectangle and ellipse tools, and the circle/ellipse shape tool now create editable vector-backed layers with retained strokes and fills; retained fill/stroke controls and direct Convert Shape to Editable Path actions now exist; custom shapes now have preset/library readiness descriptors and retained preset geometry metadata; drawVectorPathOnImageData renders open vector paths as stroke-only and closed paths with retained fill/stroke order; booleans now have exact materialization for rectangle, identical, non-overlapping, and overlapping simple-polygon pairs through real Greiner-Hormann polygon clipping in ImagePolygonBooleanClip (degenerate shared-vertex inputs resolve approximately with an honest warning; even-odd hole outputs materialize as separate paths), creating retained editable path results through direct context-menu boolean actions with export handoff descriptors; live boolean operation stacks, ellipse convert-to-path support for general boolean workflows, Bezier-segment booleans, and general multi-path boolean tooling remain missing',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 72,
    workflowReason: 'Shape tools need to become editable vectors instead of one-way raster pixels.',
  },
  {
    id: 'typography-workflows',
    area: 'Typography Workflow',
    photoshop: 'Character and paragraph panels, font browser, OpenType, text-on-path, styles, spell/find/replace',
    signalLoom: 'Basic text metadata controls now include retained baseline shift, kerning mode, caps variant controls, serialized paragraph style controls including vertical orientation, named typography presets, serialized character/paragraph style descriptors, styles via named typography presets and serialized style packages, style package serialization warnings, style package signatures, style package signature helpers, style preset portability descriptors, typography parity-progress descriptor, describeImageTextTypographySupportMatrix descriptors, OpenType support matrix descriptors, OpenType feature descriptors, OpenType caveats, OpenType unsupported states, a standard font stack catalog, visible OpenType feature toggles, retained straight-segment text-on-path controls plus sampled cubic Bezier text-on-path controls, path reference metadata, path layout metadata, text-on-path glyph raster preview descriptors, native PSD text-on-path export caveats, retained text find/replace planning and pure replacement helpers, text properties UI find/replace, find/replace readiness operations, live-edit readiness checks, readability metrics, spellcheck/readability planning descriptors, support-matrix UI summaries, stableSignatures, font fallback stack signatures, native PSD text subset warning states, bounded native horizontal unwarped solid-colour export records, sampled cubic Bezier text-on-path layout planning, font fallback/persistence notes, font fallback persistence descriptors, font discovery/fallback metadata, export/source-bin handoff caveats, native PSD text caveats, installed-font browsing, dictionary-backed spellcheck, browser shaping, editable text warps, and bounded newline-delimited or box-height-wrapped multi-column vertical type with distinct right-to-left/left-to-right progression and an 8-Mpixel raster gate; full Japanese glyph substitution/shaping, kinsoku, tate-chu-yoko, native text-on-path/warp/effect/mask interop, and richer on-canvas typography remain incomplete',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 69,
    workflowReason: 'The Text tool cannot be considered competitive without typography workflows.',
  },
  {
    id: 'blend-modes',
    area: 'Blend Modes',
    photoshop: 'Broad blend mode catalog with accurate preview/export parity',
    signalLoom: 'Sixteen blend modes are represented in types, UI, interchange mapping, capability descriptors, readiness catalog metadata, support groups, canvas composite mapping descriptors, describeImageBlendModePortabilityReadiness descriptors, blend portability checks, stable signatures, style clipboard metadata, describeImageLayerStyleClipboardReadiness descriptors, style-set signatures, clipboard signatures, deterministic preview/export parity signatures, preview-risk signatures, export-risk signatures, source-bin export caveats, action/batch suitability, alpha/opacity caveats, Fill Opacity unsupported state, Blend If unsupported state, channel targeting unsupported state, knockout unsupported state, native PSD live effect fidelity unsupported state, and known Canvas/Photoshop blend math limitations; Photoshop Blend If, fill opacity, channel targeting, knockout, and advanced blending remain unsupported',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 70,
    workflowReason: 'Layer compositing needs predictable blend behavior across live, export, and handoff paths.',
  },
  {
    id: 'source-library-handoff',
    area: 'Source Library / Suite Handoff',
    photoshop: 'External links and asset packaging that keep source data traceable',
    signalLoom: 'Source assets, Open PSD, visible/mask export, Send to Video/Flow, project asset sync, generated/source-linked handoff descriptors, Source Library-backed external/source links with durable URL or native-file provenance, document state classification, save source state signatures, save/export policy signatures, suite package descriptors, source-linked asset packaging preserves Source Library provenance, source ids, snapshots, and suite handoff signatures, asset packaging that keep source data traceable, external asset package signatures, Flow/Video/Paper readiness summaries, layerHandoff generated/reference/sourceLinked summaries, typed Source Library layer handoff signatures, source-linked relink/repair UI, readiness descriptors, blocker states, relink history, shared-binary non-standalone package caveats and unsigned package evidence descriptors, source snapshot availability, source snapshot risk descriptors, describeSourceLinkedLayerReadiness summaries, describeImageSourceDocumentRoundtripRisk descriptors, external asset packaging caveats, suite handoff blockers, generated/reference layer summaries, reference snapshot summaries, missing source-id warnings, source-linked action/batch suitability, destructive overwrite safeguard descriptors, export-only reason descriptors, deterministic preview IDs/signatures, and blob-only warnings exist; native PSD/XCF roundtrip save and blob-only packaging remain unsupported',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 88,
    workflowReason: 'Image must preserve Flow/Video/Paper handoff behavior while gaining editor depth.',
  },
  {
    id: 'document-canvas-size',
    area: 'Document / Canvas Size',
    photoshop: 'Image size, canvas size, resolution, anchors, resampling, and print-size controls',
    signalLoom: 'Image size controls and resampling through resample method planning now exist. Image resize, canvas resize with anchors, 2x upscale command, deterministic resize planning descriptors, buildImageDocumentCanvasSizeReadiness descriptors, buildStandaloneCropResizeReadiness descriptors, canvas-size readiness descriptors, document-level universal upscale readiness descriptors, target/print-resolution upscale policy, printResolution policy descriptors, resize preview descriptors, fixed-size print geometry summaries, crop/resize quick-edit readiness signatures, crop resize/canvas handoff warnings, Source Bin/export handoff safety summaries, stable preview signatures, upscale route signatures, and anchor offset descriptors for print DPI, print-size readiness, resample method, anchor offsets, transparent expansion, destructive resize, and unsupported high-bit-depth preservation warnings exist',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 61,
    workflowReason: 'Standalone edits and print handoff need dependable size and resolution controls.',
  },
  {
    id: 'ai-generative-hooks',
    area: 'AI / Generative Hooks',
    photoshop: 'Generative fill/expand/remove with selection-aware controls and provider/runtime transparency',
    signalLoom: 'Provider/model-aware selected-region operations, generative edit readiness descriptors, reference-input readiness, provider/model capability transparency, missing credential/provider blockers, deterministic cost/capability descriptors, selected-provider/local/cloud/browser fallback states, credential/provider/runtime blockers, native/cloud execution warnings, runtimeSummary descriptors for cloud/local/native/browser modes, grouped blocker summaries, explicit non-Photoshop-native-AI warnings, describeGenerativeFillPlacementPlan placement planning, local selection bounds, selected pixel counts, source/mask artifact dimensions, request artifact manifests, sanitized reference-slot descriptors, reference slot signatures, reference chip slot descriptors, source-print-resolution-excluded blockers, and stable generative preview signatures now exist, and universal upscaler paths exist with method/cost/capability descriptors for Android/local/cloud paths plus on-device preferred routing, describeAndroidNativeImageParityReadiness route descriptors, cloud fallback, bitmap fallback, fallback order descriptors, target/print-resolution policy, sourceExclusion policy descriptors, comic sound-effect exclusions, already-print-resolution skip warnings, dependency/model/runtime blockers, route readiness metadata, imported-edit evidence requirements, unsupported Android/cloud/runtime state summaries, and stable upscale signatures; Photoshop Generative Fill semantic parity remains unsupported',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 64,
    workflowReason: 'AI edits are a core Sloom Studio differentiator but still need editor-grade control surfaces.',
  },
  {
    id: 'standalone-quick-edit',
    area: 'Standalone Quick Edit',
    photoshop: 'Open an image directly, edit quickly, save/export predictably',
    signalLoom: 'Image workspace/window, local file opening, Open an image directly via direct local raster image opening from the Image tab into an editable document, focused layout presets, edit quickly through Quick Edit layout preset plus standalone crop/resize save/export readiness, workspace app launch descriptors, shared-binary standalone entry readiness, OS identity descriptors record platform, appId, signed-package state, and unsigned/missing-app-id blockers, save/open workflow descriptors for quick-edit, source-linked, and export-only documents, source-linked quick-edit relink/repair readiness, repair blockers, relink history, standalone state descriptors, source state descriptors, save source state signatures, save/export policy signatures, suite package descriptors, destructive save policy, destructive overwrite safeguard descriptors, export-only reasons, flattened export, missing source link, missing source-linked refresh blockers, unsupported native roundtrip warnings, save preview metadata, export-only copy warning, standalone crop/resize readiness, quick crop/export handoff safety, external asset package signatures, source snapshot risk descriptors, standard installer targets, package target caveats, signed-package unsupported states, and Mac packaging caveats now exist; native PSD/XCF roundtrip save, signed installers, and full native roundtrip remain incomplete',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 70,
    workflowReason: 'Users need Image to work both as a suite workspace and a fast standalone editor.',
  },
  {
    id: 'psd-roundtrip',
    area: 'PSD Interoperability',
    photoshop: 'Native PSD groups, type, effects, smart objects, adjustment layers, and robust round-trip behavior',
    signalLoom: 'Layered PSD import/export exists through ag-psd with custom metadata for retained text typography, source-link status/history summaries, source-link preview signatures, source-link roundtrip summaries, source-linked/smart-object round-trip strategy descriptors, source snapshot preservation metadata, layer effects, filters, layer masks, PSD native-construct readiness descriptors, retained metadata summaries, compact compatibility signatures, deterministic per-layer warning descriptors, nativeConstructWarnings aggregates, layer-mask native construct summaries, deterministic PSD roundtrip risk descriptors, early PSD/PSB size-policy import guards, shared Photoshop header size policy, PSD 30000 px blockers, PSB header blockers, fallback route recommendations, compatibility descriptors, stable manifest serialization, Smart Filter metadata-only caveat descriptors, and metadata-only warnings for unsupported native constructs; native editable PSD constructs remain partial',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 60,
    workflowReason: 'External finishing depends on honest PSD limits and better preservation.',
  },
  {
    id: 'xcf-interoperability',
    area: 'XCF Interoperability',
    photoshop: 'Not applicable; GIMP-native XCF import/export expectations apply',
    signalLoom: 'Not applicable; GIMP-native XCF import/export expectations apply through bounded XCF layered raster import plus layered raster export with explicit policy descriptions, compatibility descriptors for raster layers, rasterized text, detected GIMP 3 non-destructive-effect warnings, omitted adjustments, masks/groups/source-link warnings, XCF extension/MIME/header detection, bounded import readiness policy with explicit compression/precision/caps limits and typed failures, XCF import/export policy warning descriptors, structured XCF policy warning metadata with native construct, affected layer IDs, preservation mode, and unsupported native round-trip status, describeXcfNativeDecodeState nativeDecodeState descriptors for recognized `gimp xcf` headers, blocked edit-state decode operations, fallbackRecommendations ranking, XCF import compatibility signatures, PNG/TIFF/PSD/source-library fallback routes, source policy signatures, native round-trip caveats, bounded import metadata, enriched round-trip risk descriptors, high round-trip risk metadata, retained metadata summaries, filter-metadata-flattened export warnings, deterministic per-layer import warning descriptors for text and detected GIMP 3 non-destructive effects; XCF raster layers, masks, offsets, opacity, visibility, and blend modes are detected and decoded within the documented bounds while native XCF edit state is not reconstructed',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 42,
    workflowReason: 'GIMP parity requires more than one-way XCF output.',
  },
  {
    id: 'export-formats',
    area: 'TIFF / SVG / GIF / Raster Export',
    photoshop: 'Broad format import/export with color, layers, animation, and warnings',
    signalLoom: 'Broad format import/export with color now exists. PNG, JPEG, WebP, AVIF, BMP, static GIF, TIFF, SVG, PSD, and XCF save/export paths exist with honest format-policy descriptions, format readiness descriptors, buildImageDocumentExportReadinessDescriptor helpers, Export As / Save for Web readiness descriptors, format capability matrix metadata, scale/output-size/DPI metadata, export preset readiness, batch export readiness, Source Library / suite handoff readiness descriptors, warning summary groups for flattened text/vector/effects/masks/profile/high-bit limits, source-bit-depth metadata, export bit-depth descriptors, source-high-bit-depth downsample warnings, per-operation print/export warnings, pressReady export caveats, printProof export descriptors, true contract proof and PDF-X gaps, 8-bit derivative caveats, blocker summaries for missing source ids and blob-only export paths, flattened derivative caveats, blob-only URL warnings, missing source id blockers, source-linked editability caveats, XCF compatibility metadata, visible export planning metadata, DPI/PPI checks, color profile non-embedding warnings, CMYK proof limitations, unsupported CMYK/spot separations, TIFF/GIF/SVG export policy warnings for flattened, first-frame, rasterized, export-only, hidden-layer, mask/effect/filter, compositing, animation/frame limits, SVG vector rasterization, RAW develop-first requirements, PSB unsupported thresholds, high-bit-depth caveats, recommended handoff formats, stable preview/readiness signatures, unsupported-state descriptors, blocker descriptors, and unsupported limits, plus round-trip caveats for TIFF/GIF/SVG',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 72,
    workflowReason: 'Users must know which formats are true interchange and which are flattened or limited.',
  },
  {
    id: 'quick-actions',
    area: 'Quick Actions',
    photoshop: 'Task shortcuts that apply predictable edits and surface undoable state',
    signalLoom: 'Task shortcuts that apply predictable edits and surface undoable state through input/output/undoability metadata now exist. A catalog of generated quick actions exists for selection, pixels, layers, transform, and canvas operations with capability descriptors, input/output/undoability metadata, catalog summaries, macro playback diagnostics, describeImageQuickActionReadiness summaries, buildImageQuickActionMacroReadiness descriptors, per-document macro compatibility checks, step-level blockers/signatures, batch-readiness metadata, per-document blockers, open-document playback previews, gradient/fill action readiness, paint-bucket action readiness, filter action readiness, content-aware requested-vs-applied output planning, manual patch-source planning, active-layer output warnings, native execution unsupported warnings, browser/store-only playback, and warnings for local approximations of Photoshop/cloud AI features',
    priority: 'low',
    status: 'partial',
    parityEstimate: 51,
    workflowReason: 'Quick actions help users discover capabilities while deeper panels are built.',
  },
  {
    id: 'pen-tool',
    area: 'Pen Tool',
    photoshop: 'Pen and curvature tools for Bezier paths, shape creation, selections, strokes, and masks',
    signalLoom: 'A first retained straight/cubic Pen workflow now exists with retained vector path layers, live preview, Enter commit, Escape cancel, first-anchor close-path gesture for retained closed paths, click-drag cubic Bezier handle creation, Move-tool retained in/out handle adjustment, shape creation, selections, strokes, and masks through Paths-panel selection/fill/stroke/vector-mask interoperability, numeric point editing after creation, direct draggable anchor handles for active path layers, straight anchor add/delete after commit, delegated post-commit anchor editing through Paths, retained straight/cubic paths that can be targeted by Text Path controls, Pen workflow descriptors, describePenToolReadiness descriptors, typed Pen Bezier handle readiness descriptors, text-on-path readiness descriptors, creation/edit session descriptors, path geometry signatures, saved/work path classification, separate-layer boolean readiness, operation blockers, action suitability, SVG/PSD caveats, native PSD path fidelity warnings, and preview ID/signature v2; curvature mode, anchor conversion, one-step live Pen-tool vector-mask creation, and one-step live Pen-tool text-on-path creation remain missing',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 49,
    workflowReason: 'A Photoshop/GIMP-class editor needs precise path creation.',
  },
  {
    id: 'paths-panel',
    area: 'Paths Panel',
    photoshop: 'Manage work paths, saved paths, path thumbnails, stroke/fill/selection operations',
    signalLoom: 'A first-class Paths panel now exists for vector shape and straight-segment Pen path layers with durable path entries, layer-backed path classification, rectangle/ellipse shape-to-path conversion, rename/delete controls, numeric point controls for retained path anchors, active anchor session state/signatures, selectable anchor rows, add/delete straight anchor controls, direct canvas anchor handles for selected active paths, describeImagePathsPanelReadiness descriptors, path workflow descriptors, paths-panel readiness descriptors, operation readiness descriptors, selected path operation lane metadata, selection/fill/stroke/vector-mask/text-on-path/live-stroke/native-PSD operation readiness, operation blocker summaries, path operation checks, Bezier unsupported states, panel visibility descriptors, compact status/caveat text, conversion target descriptors, action suitability, rasterize vector mask readiness, SVG/PSD caveats, load-selection actions, raster layer-mask creation, retained vector-mask creation on the active target layer, fill/stroke layer generation, independent saved-path metadata, and Path thumbnails through ImagePathsPanel thumbnail readiness/signatures. Now, saved paths independent of layers are real and document-owned (ImageSavedWorkPaths.ts): detach a Pen path into a persisted, document-level saved-path record with its own id, save/rename/select/delete controls, "documentState" undo/redo, project-snapshot persistence, and a Make Selection reuse route that rasterizes the points stored on the saved path; deleting or editing the source layer afterward never touches the detached copy; broader Bezier operations on saved paths, saved-path thumbnails, and a pen tool that draws directly into an independent work path (rather than detaching from a layer) remain missing',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 74,
    workflowReason: 'Paths need a durable home, not only a transient tool state.',
  },
  {
    id: 'path-anchor-editing',
    area: 'Path / Anchor Editing',
    photoshop: 'Direct/Path selection, anchor conversion, handles, path-to-selection, stroke and fill',
    signalLoom: 'Numeric point controls, rectangle/ellipse shape-to-path conversion, anchor editing descriptors, describeImagePathAnchorEditSession descriptors, moveImagePathAnchors geometry helpers, insertImagePathAnchor/deleteImagePathAnchor geometry helpers, bounded multi-anchor move helper support, anchor conversion, straight anchor add/delete controls in the Paths panel, typed Bezier handle readiness descriptors, path geometry signatures, operation readiness lane metadata, direct canvas draggable anchor handles, retained cubic in/out handle controls, Direct Selection, Path Selection, and Curvature Pen can edit retained straight/cubic Pen path anchors in document coordinates and rebuild selection/fill/stroke geometry; native PSD path fidelity remains missing',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 51,
    workflowReason: 'Vector masks and custom shapes depend on editable paths.',
  },
  {
    id: 'custom-vector-shapes',
    area: 'Custom Vector Shapes',
    photoshop: 'Line, polygon, custom shape libraries, fills, strokes, and boolean operations',
    signalLoom: 'Custom shape presets now include retained line, triangle, diamond, polygon, and star shapes as editable vector path layers with persisted fills, strokes, fill/stroke tool settings, retained custom shape descriptors, describeCustomVectorShapePresetGeometry descriptors, line direction metadata, clamped star parameters, preset/library readiness descriptors, editable parameter lists, SVG/PSD caveats, SVG, PSD, and source-bin handoff signatures, and layer-side preset controls; exact boolean result materialization tracked for axis-aligned rectangle, identical simple-polygon, and non-overlapping simple-polygon operands now exists as boolean operations that store vectorBooleanSource metadata with export handoff descriptors and non-mutating boolean policies; native custom-shape library instances, broader shape libraries, overlapping polygon/Bezier booleans, and retained live boolean operation stacks remain missing',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 52,
    workflowReason: 'Vector shape booleans are required for non-destructive graphic work.',
  },
  {
    id: 'layer-groups',
    area: 'Layer Groups / Folders',
    photoshop: 'Nested groups, pass-through blending, masks, visibility, locking, and batch operations',
    signalLoom: 'Basic one-level group/folder layers exist with persisted membership, collapse state, Layers panel controls, group row badges, group visibility suppressing child rendering, deterministic nested group tree normalization for nested groups, group hierarchy readiness descriptors, image-layer-grouped-stack-readiness descriptors, grouped stack descriptors for bounds, groupMaskPlan descriptors, sourceSafety descriptors, source-linked destructive batch safety, unsupportedStateSummary descriptors, normal vs pass-through caveats, group masks, batch blockers, tree warning codes, inherited visibility/lock/opacity summaries, group planning descriptors, group preview signatures, readiness signatures, organization boundary summaries for bounded multi-select, layer organization readiness descriptors, link/lock parity readiness descriptors, pass-through/group-mask warnings, and batch-operation blocker metadata for missing selections, cross-group selections, nested selections, pass-through groups, group masks, inherited locks, source-linked layers, and native PSD group-mask roundtrip risk; nested group UI, pass-through blending fidelity, live Photoshop group masks, deep native PSD group-mask roundtrip, and batch operations remain incomplete',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 55,
    workflowReason: 'Large Image documents become unmanageable without groups.',
  },
  {
    id: 'clipping-masks',
    area: 'Clipping Masks',
    photoshop: 'Clip layers to lower-layer transparency/content, group-base clipping, adjustment clipping, PSD semantics',
    signalLoom: 'Clip layers to lower-layer transparency/content now exists with pixel clipping, adjustment clipping, layer-stack UI, project persistence, rendered group-base alpha clipping for visible group descendants, group-base visibility through clipping masks, and context-menu batch create/release controls for layers above a base layer; typed clipping-chain readiness metadata, chainValidation descriptors, grouped clipping-chain depth, group-base chain layers, sourceSafety descriptors, source-linked safety summaries, image-clipping-mask-readiness descriptors, clipping-mask readiness descriptors, invalid-operation metadata, batch create/release suitability, and source/PSD handoff summaries now exist; nested group clipping semantics, native clipping-group roundtrip, and full PSD semantics remain incomplete',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 48,
    workflowReason: 'Clipping masks are fundamental for non-destructive shading, texture, and adjustment workflows.',
  },
  {
    id: 'vector-masks',
    area: 'Vector Masks',
    photoshop: 'Path-backed masks editable independently from pixel masks',
    signalLoom: 'Image layers can now retain path-backed vector-mask descriptors, deterministically evaluate/rasterize them to the current layer mask size with target layer/invert/link normalization, bounds, and rasterization planning metadata, vector-mask creation/boolean/Bezier/rasterization parity signatures, vector-mask path operation readiness, retain/rasterize/Bezier/native PSD state descriptors, summarizeLayerVectorMaskReadiness summaries, action/batch suitability, unsupported boolean/PSD vector-mask states, handoff caveats, and live preview/export compositing now intersects retained vector masks with raster layer masks through the shared flattening path and renderer cache signatures; Paths panel can create retained vector masks from selected path layers on the active target layer and can also rasterize selected paths into pixel layer masks. Independent editable vector-mask UI now edits active retained vector-mask path points while preserving the pixel mask and bitmap version, path-backed masks are editable independently from pixel masks, and boolean mask operations plus PSD vector mask semantics stay represented as explicit unsupported states and handoff caveats',
    priority: 'medium',
    status: 'done',
    parityEstimate: 100,
    workflowReason: 'Print and UI artwork need crisp editable mask edges.',
  },
  {
    id: 'channels-panel-alpha',
    area: 'Channels Panel / Alpha Channels',
    photoshop: 'RGB, alpha, spot channel management and direct channel editing',
    signalLoom: 'Channels panel now exists with RGB channel target controls, channel readiness descriptors, persisted alpha/saved-selection channels, rename/delete, channel-to-selection load modes, selection save/load caveats, selection-channel round-trip descriptors, invalid-mask and size-mismatch blockers, channel row/action descriptors, alpha panel action-readiness descriptors, load/export summaries for size-mismatch blockers, load-selection action metadata, channel manifest descriptors, selection-channel planning summaries, deterministic alpha/spot panel descriptors, and panel summary lines; panel-backed spot-channel section, spot-channel create/rename/delete, tint/opacity/solidity/visibility controls, persisted spot-channel metadata helpers, spot-channel readiness descriptors, and spot-channel workflow descriptors now support mask-backed entry creation, tint-preview serialization, opacity preview metadata, RGB-tint preview metadata, export metadata-only warnings, effective opacity, export warnings for non-native print separations, direct spot-channel painting support status, alpha/spot export-readiness summaries, and print separation limits, while direct channel paint/edit, direct spot-channel painting, Photoshop separations, print plates, and print separations remain missing',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 65,
    workflowReason: 'Channel workflows unlock saved selections, masks, print prep, and precise edits.',
  },
  {
    id: 'histogram-panel',
    area: 'Histogram Panel',
    photoshop: 'Live histogram with channel display and adjustment feedback',
    signalLoom: 'Document histogram exists in Image Properties with channel switching and clipping readouts, histogram panel/readout descriptors, histogram channel coverage descriptors, luminance/R/G/B summaries, tone/informational channel classification, explicit non-tonal alpha histogram mode, aggregate clipping counters, empty-channel readiness, before/after histogram comparison helpers, before/after signature descriptors, clipping delta summaries, per-channel clipping delta descriptors, adjustment-preview feedback descriptors, describeAdjustmentHistogramFeedbackReadiness descriptors, histogram feedback readiness descriptors, visible-pixel deltas, stable preview IDs, scope caveats, a bounded GPU compositor for only four unmasked, unclipped, full-opacity point-wise adjustments, CPU/data-driven histogram feedback that deliberately excludes that compositor, histogram feedback descriptors, stable histogram signatures, and before/after adjustment feedback; alpha histogram use is explicit and tone-only clipping limits remain; broader live-preview wiring remains incomplete',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 53,
    workflowReason: 'Levels, Curves, exposure, and print correction need histogram feedback.',
  },
  {
    id: 'color-management',
    area: 'Color Management / Proof Setup',
    photoshop: 'ICC profiles, proof setup, soft proof, output intents, and color conversion warnings',
    signalLoom: 'ICC profiles are represented as metadata-only ICC/profile behavior, and document-level RGB, grayscale soft-proof, CMYK soft-proof intent metadata, proof setup, soft proof, output intents, color conversion warnings, and source bit-depth export metadata now exist with Properties-panel status, warnings, deterministic channel-preview descriptors, proof/workflow descriptors, color-mode planning descriptors, color-proof planning descriptors, color-mode readiness descriptors, color-proof readiness descriptors, describeImageColorModeOperationalReadiness descriptors, describeImageColorProofOperationalReadiness descriptors, describeImageColorProofHighBitImplications descriptors, describeImageColorProofReadOnlyState descriptors, high-bit proof/export limits, external proofing fallbacks, bounded operation descriptors, operationCaveats, coded unsupportedStates, separation readiness metadata, profile-transform blocker codes, read-only proof preview states, proof read-only state descriptors, operation-limit policies, conversion/preview/export policy, gamut-warning summaries, print/export implication summaries, per-operation print/export warnings, print warnings, action/batch suitability, and ICC limitations; true ICC conversion, separations, profile transforms, ICC proof transforms, native CMYK proof export, black-generation, TAC, press-ready separations unsupported, and native CMYK export remain missing',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 55,
    workflowReason: 'Print and pro interchange require honest color handling.',
  },
  {
    id: 'bit-depth-workflow',
    area: '16-bit / 32-bit Workflow',
    photoshop: 'Bit-depth-aware documents and operations',
    signalLoom: 'Image now executes a bounded native RGB high-bit route. Supported PNG16, TIFF16, TIFF32f, and single-part scanline OpenEXR inputs create u16 or f32 per-layer pixel authority with a derived 8-bit display proxy. Direct brush and eraser commits, u8 alpha masks (compositor-side support; live mask editing remains separately bounded), bounded resize/scale and rectangular crop, source-over and sixteen admitted blend modes, ordinary undo/redo with resource accounting, worker request coalescing plus permanent synchronous fallback after worker failure (distinct from cancellation/termination), bit-exact .slimg persistence, and native single-raster PNG16/TIFF16/TIFF32f/OpenEXR export retain that authority. Image Properties reports source and working depth. Native GPU high-bit and CMYK routes are unavailable capabilities, not runtime refusals; high-bit PSD ingress, served/remote editing without a round-trippable native authority, retained filters/adjustments, groups/clipping/Blend If, transformed layered native export, and unsupported codec variants refuse instead of silently downsampling, and refuse before mutation with a mounted disclosure. This is not arbitrary Photoshop high-bit parity.',
    priority: 'low',
    status: 'partial',
    parityEstimate: 68,
    workflowReason: 'High-end edits need retained native precision with explicit refusal at every unsupported boundary.',
  },
  {
    id: 'cmyk-lab-grayscale',
    area: 'CMYK / Lab / Grayscale / Indexed',
    photoshop: 'Document color modes with conversion, preview, and operation limits',
    signalLoom: 'RGB-centric rendering with grayscale and CMYK proof/status metadata now exists; RGB-centric rendering remains, but grayscale and CMYK soft-proof metadata/status now sit alongside deterministic RGB-to-grayscale helpers, CMYK channel separation preview arrays, color-mode readiness descriptors, color-mode conversion planning descriptors and blockers for RGB, grayscale, CMYK, Lab, and indexed workflows, describeImageNonRgbColorModeSupportMatrix descriptors, non-RGB color-mode support matrices, operational mode/proof descriptors, proof/workflow descriptors, operation policies, operation limits through per-mode operation-limit policies for paint, adjustments, filters, and export, per-mode operation-limit policies for paint, adjustments, filters, and export, operation descriptors for RGB, high-bit RGB, grayscale, CMYK, Lab, and indexed modes, per-operation paint/adjustment/filter/export support, conversion blockers, export blockers, prepress checks, conversion/flattening limits, print/export caveats, action/batch suitability, precision notes, indexed preview limits, Lab policy caveats, read-only preview states, profile-transform blocker codes, coded unsupportedStates, black-generation and TAC unsupported states, and explicit conversion warnings; color-mode state, ICC transforms, native CMYK export, native CMYK proof export, and full Lab workflow remain incomplete',
    priority: 'low',
    status: 'partial',
    parityEstimate: 46,
    workflowReason: 'A credible pro editor must document or implement non-RGB workflows.',
  },
  {
    id: 'select-subject-object',
    area: 'Select Subject / Object Selection',
    photoshop: 'Subject/object selection with cloud/local fallbacks and refinement',
    signalLoom: 'Subject/object selection with cloud/local fallbacks now has fallback-route descriptors through image-object-selection-fallback-routes:v1, with local-alpha-luminance-components ready, cloud-ai-subject-object-provider blocked when no provider is configured, and local route fallback signatures. A first-class local fallback can create an undoable selection from the active visible layer by taking the largest connected alpha/luminance foreground component, with opt-in minimum component area, disconnected-island inclusion, hole fill, conservative cleanup passes, selection bounds/foreground scoring, component diagnostics, selected/rejected component descriptors, readiness descriptors (including explicit AI subject detection caveat), cleanup metadata, object-selection preview signatures, output routing handoff, selection/QuickMask/layer-mask output planning, and refinement handoff metadata. Local object selection handoff metadata targets Select. Mask for edge refinement handoff exists. True AI subject detection remains unsupported.',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 31,
    workflowReason: 'Modern image editors need assisted selection with clear offline states.',
  },
  {
    id: 'select-mask-workspace',
    area: 'Select And Mask',
    photoshop: 'Refine edge workspace with overlays, brush refinement, feather, contrast, shift edge, output modes',
    signalLoom: 'Preview modes plus feather, smooth, contrast, shift-edge, output to selection/QuickMask/layer mask/alpha channel, planning descriptors, output target summaries, output routing handoff, readiness descriptors, brush-refinement signatures, component diagnostics handoff, describeSelectAndMaskPreviewModeCoverage descriptors, richer edge-visualization modes through local matte previews, refine-edge unsupported caveat, radius/decontaminate warnings, deterministic local brush-stroke helper for expand/contract/soften refinement, mounted Channels-panel Select & Mask workspace UI, Enter/Exit preview controls, Smart Radius controls, Decontaminate Colors controls, Decontaminate amount controls, store-backed settings persistence, preview apply controls, and output route controls now exist',
    priority: 'medium',
    status: 'done',
    parityEstimate: 100,
    workflowReason: 'Selections need refinement tools before they can drive masks and generative edits reliably.',
  },
  {
    id: 'content-aware-fill-remove-patch',
    area: 'Content-Aware Fill / Remove / Patch',
    photoshop: 'Content-aware fill, remove, patch, sampling areas, preview, output controls',
    signalLoom: 'A deterministic local content-aware fill / patch quick action now repairs an active selection or transparent blemish pixels from nearby non-target layer pixels with undoable dirty paint history, quick-action capability metadata, patch descriptors, fill/remove/patch operation descriptors, repair operation descriptors, deterministic sampling-region planning with radius rings, candidate counts, nearest source distance, usable source ratio, source pixel summaries, source diagnostics, selection vs transparent target policy, selection mask size validation, sampling-area policy descriptors, sampling-area descriptors stay metadata-only, patch-source limits, patch-source support status, manual patch-source planning, requested-vs-applied output planning, active-layer/new-layer output policy descriptors, output limits, output-to-new-layer unsupported status, local-vs-AI unsupported states, preview/output caveats, Source Bin handoff safety, quick-action/batch suitability, quick-action compatibility descriptors, automation dry-run blocking, invalid selection/source blockers, local-vs-AI limitation warnings, preview IDs/signatures, active-layer output warnings, active-layer-only output warnings, and local approximation warnings; it is not Photoshop AI generative fill, no native Photoshop AI path is wired yet, and editable sampling-area preview, live manual patch-source controls, output-to-new-layer, and advanced remove tooling remain missing',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 54,
    workflowReason: 'Object removal and repair are expected baseline photo-editing operations.',
  },
  {
    id: 'liquify',
    area: 'Liquify',
    photoshop: 'Liquify workspace with push, twirl, pucker, bloat, freeze/thaw masks, face-aware options',
    signalLoom: 'A deterministic local push, twirl, pucker, and bloat deformation helper now exists for layer bitmaps/ImageData with explicit falloff helpers, freeze/thaw masks, freeze/thaw summaries, brush preview metadata, describeLiquifyReadiness descriptors, session/control descriptors, source preservation descriptors, descriptor-only on-canvas readiness, source handoff safety, action/batch suitability, explicit unsupported face-aware/reconstruct/smooth/non-destructive mesh states, tool support matrix, falloff limitation metadata, smart-object unsupported warnings, smart-object/source unsupported warnings, buildLiquifyWorkspaceUiDescriptor descriptors, and a mounted Liquify Workspace panel UI with real Push/Twirl/Pucker/Bloat mode controls, center/radius/strength/falloff controls, preview/apply/cancel commands, history-backed bitmap apply, freeze/thaw status, and visible unsupported-control chips',
    priority: 'low',
    status: 'done',
    parityEstimate: 100,
    workflowReason: 'Advanced retouching requires deformation tools or an explicit unsupported status.',
  },
  {
    id: 'puppet-warp-advanced-warp',
    area: 'Puppet Warp / Advanced Warp',
    photoshop: 'Mesh/pin based warp, perspective and advanced transform deformation',
    signalLoom: 'Image now has a retained on-canvas Puppet mesh: a directly draggable 4×4 cage of named pins, live renderer/high-resolution propagation, Apply/Cancel, one-step undo/redo, reset, and `.slimg` save/reopen. Perspective mode presents a visible single-plane grid with four draggable corners plus bounded PX/PY controls. This is deliberately not a Photoshop-weighted triangulated Puppet mesh, multi-plane Perspective Warp, GIMP Cage Transform, or native smart-object deformation workflow.',
    priority: 'low',
    status: 'partial',
    parityEstimate: 62,
    workflowReason: 'Transform parity requires more than affine layer resize and rotation.',
  },
  {
    id: 'camera-raw',
    area: 'Camera Raw Workflow',
    photoshop: 'Raw development entry point or clear unsupported file flow',
    signalLoom: 'Raw development entry point or clear unsupported file flow is handled by Camera Raw extensions and MIME types detected before browser decode with isCameraRawExtension, isCameraRawMimeType, describeCameraRawImportReadiness, describeCameraRawOpenPolicy, develop-first/open-as-pixels policy descriptors, fallback routes, unsupported RAW states, and a clear unsupported import path, and format-policy descriptions plus source policy signatures, describeImageSourceDocumentRoundtripRisk descriptors, handoff-required readiness, unsupported import blockers, supported handoff formats, suite handoff caveats, stable signatures, and round-trip caveats make it explicit that RAW files require external RAW development first (no in-app RAW demosaic or camera-profile processing). Already-imported RGB photographic pixels can receive the mounted bounded Camera Raw-style temperature/tint, exposure, and tone adjustment stack, but that is not native RAW development. Supported handoff formats are 8-bit TIFF, PSD, PNG, and JPEG.',
    priority: 'low',
    status: 'partial',
    parityEstimate: 34,
    workflowReason: 'Users need clear expectations when opening camera/raw assets, including explicit external-development deferment.',
  },
  {
    id: 'actions-batch-processor',
    area: 'Actions / Batch Processor',
    photoshop: 'Record, play, manage, and batch actions over files or documents',
    signalLoom: 'Saved quick-action macros can now batch-play across currently open Image documents, saved quick-action macro management with record, save, rename, play, and delete controls now exists, batch actions across currently open Image documents now run through saved macro playback, and dry-run file/folder queue planning can model input records, folder labels, saved macro/action ids, queueIdentity metadata, stable queue/action-set IDs, queueDiagnostics per-item records, dry-run executionLog entries, macroRunIdentity, stepExecutionLog, macro descriptor normalization, schema-versioned macro import/export, import/exportable action-set manifests, importValidation descriptors, referenced-id validation, typed queue planning, output folders/formats/naming, output naming/collision policies, duplicate/output conflict strategies, output naming collision policy, unsupported files, skipped item diagnostics, per-item audit logs, batch queue audit summaries, queue readiness, retry/error policy, getImageAutomationWorkspaceDescriptor, image-automation workspace separation from main Flow, file/folder access descriptors, native filesystem unsupported states, directory write caveats, AI variable fill planning, variable-fill metadata, macro/quick-action handoff descriptors, dashboard/checklist signatures, stable node/workspace signatures, plan-only progress evidence, Image Automation handoff readiness, unavailable command warnings, and batch/playback preview IDs/signatures; actual unattended native execution, import/export UI, arbitrary plugin commands, full Photoshop Actions, native filesystem execution, and real filesystem execution logs remain incomplete',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 64,
    workflowReason: 'Batch processing is essential for production workflows and suite-scale projects.',
  },
  {
    id: 'artboards-print-proof',
    area: 'Artboards / Print Proof',
    photoshop: 'Artboards plus print/proof export workflow from Image',
    signalLoom: 'Image now carries bounded document-level artboard metadata with page size, DPI, bleed, proof labels, print-pixel bounds, Properties-panel warnings, print-proof descriptors with trim/safe-area/bleed checks, bounded Image print/proof export planning workflow with raster bounds, filename policy, and print-proof batch disposition, layout planning, artboard preview descriptors, buildImageArtboardsPrintExportReadiness descriptors, Source Bin handoff readiness, Paper handoff readiness, action suitability, batch suitability, deterministic batch export planning for one or more artboards, batchPlan descriptors, filename collision policy, numeric suffix resolution, per-artboard raster export bounds, resolved batch filenames, proof profile warnings, v2 readiness signatures, per-artboard export filenames, print-proof disposition, grouped counts, printProduction metadata, explicit imposition/package warnings, and explicit Paper owns the stronger print export caveat for imposition handoff; bleed extension, slices, printer marks, PDF-X, packaged print folders, ICC conversion/embedding, and true contract proof output remain unsupported',
    priority: 'medium',
    status: 'partial',
    parityEstimate: 48,
    workflowReason: 'Image should support multi-output design and print/proof checks without forcing a Paper round trip.',
  },
];

export function getHighPriorityImageParityItems(items = IMAGE_PHOTOSHOP_PARITY_ITEMS): PhotoshopParityItem[] {
  return items.filter((item) => item.priority === 'high');
}

export function countImageParityStatuses(items = IMAGE_PHOTOSHOP_PARITY_ITEMS): Record<PhotoshopParityStatus, number> {
  return items.reduce<Record<PhotoshopParityStatus, number>>(
    (counts, item) => {
      counts[getImageParityChecklistStatus(item)] += 1;
      return counts;
    },
    { done: 0, partial: 0, remaining: 0 },
  );
}

export function getImageParityChecklistStatus(item: PhotoshopParityItem): PhotoshopParityStatus {
  if (item.status === 'done') return 'done';
  if (item.status === 'remaining') return 'remaining';
  if (hasOpenParityLanguage(item.signalLoom)) return 'partial';

  const objectiveAtoms = atomizeImageParityText(item.photoshop || item.workflowReason || item.area);
  const currentAtoms = atomizeImageParityText(item.signalLoom);
  if (objectiveAtoms.length > 0 && objectiveAtoms.every((atom) => isImageParityAtomCovered(atom, currentAtoms))) {
    return 'done';
  }

  return 'partial';
}

function hasOpenParityLanguage(value: string): boolean {
  const text = value.toLowerCase();
  if (/\bunsupported (warning|warnings|state|states|caveat|caveats|metadata|descriptor|descriptors)\b/.test(text)) {
    return false;
  }
  return /\b(remain|remains|remaining|still|missing|not implemented|unavailable|lag|lags|incomplete)\b/.test(text);
}

function atomizeImageParityText(value: string): string[][] {
  return value
    .replace(/`/g, '')
    .replace(/\b(now|already|currently|basic|first-class|real|direct|dedicated|persisted|deterministic)\b/gi, ' ')
    .replace(/\b(exist|exists|available|implemented|support|supports|now support|now supports|now exist|now exists)\b/gi, ' ')
    .split(/\s*,\s*|\s+\band\b\s+|\s+\bplus\b\s+/i)
    .map(normalizeImageParityAtom)
    .filter((atom) => atom.length > 0);
}

function isImageParityAtomCovered(atom: string[], candidates: string[][]): boolean {
  return candidates.some((candidate) => {
    const overlap = atom.filter((token) => candidate.includes(token)).length;
    const atomText = atom.join(' ');
    const candidateText = candidate.join(' ');
    return overlap >= Math.max(1, Math.ceil(atom.length * 0.6))
      || candidateText.includes(atomText)
      || atomText.includes(candidateText);
  });
}

function normalizeImageParityAtom(value: string): string[] {
  const stopWords = new Set([
    'a', 'an', 'and', 'are', 'as', 'be', 'for', 'from', 'in', 'into', 'is', 'it',
    'of', 'on', 'or', 'plus', 'the', 'to', 'true', 'with', 'without', 'workflow',
    'workflows', 'tool', 'tools', 'control', 'controls', 'mode', 'modes',
  ]);
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1 && !stopWords.has(token))
    .map(normalizeImageParityToken);
}

function normalizeImageParityToken(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
  return token;
}
