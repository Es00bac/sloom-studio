#!/usr/bin/env node
/**
 * Build the public Sloom Video / Kdenlive feature matrix.
 *
 * The hand-authored rows describe Sloom's qualified implementation and the
 * editor-level Kdenlive workflows. Kdenlive's official RST tables are parsed
 * so every documented video effect, audio effect, transition, and default
 * shortcut remains individually searchable instead of being collapsed into
 * an "effects supported" claim.
 *
 * Usage:
 *   node scripts/build-video-kdenlive-comparison.mjs /path/to/docs-kdenlive-org
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot = resolve(process.argv[2] ?? '/tmp/kdenlive-docs-26.04');
const outputPath = join(repoRoot, 'docs/release/website/sloom-studio/video/kdenlive/comparison-data.js');

const sources = {
  sloomProduct: {
    label: 'Sloom Studio product and licensing page',
    href: '/#license',
    kind: 'Sloom',
  },
  sloomManual: {
    label: 'Sloom Video workspace manual',
    href: '/docs.html#video',
    kind: 'Sloom',
  },
  sloomQualified: {
    label: 'Sloom qualified implementation record · 2026-08-27',
    href: '#methodology',
    kind: 'Sloom',
  },
  sloomSource: {
    label: 'Sloom current source and regression suites · 2026-08-27',
    href: '#methodology',
    kind: 'Sloom',
  },
  kdenliveManual: {
    label: 'Kdenlive 26.04 manual',
    href: 'https://docs.kdenlive.org/en/',
    kind: 'Kdenlive',
  },
  kdenliveDownload: {
    label: 'Kdenlive official download page',
    href: 'https://kdenlive.org/en/download/',
    kind: 'Kdenlive',
  },
  kdenliveRender: {
    label: 'Kdenlive rendering manual',
    href: 'https://docs.kdenlive.org/en/exporting/render.html',
    kind: 'Kdenlive',
  },
  kdenliveEffects: {
    label: 'Kdenlive effect lists',
    href: 'https://docs.kdenlive.org/en/effects_and_filters/lists.html',
    kind: 'Kdenlive',
  },
  kdenliveShortcuts: {
    label: 'Kdenlive default keyboard shortcuts',
    href: 'https://docs.kdenlive.org/en/user_interface/shortcuts.html',
    kind: 'Kdenlive',
  },
};

const rows = [];
let nextId = 1;

const add = (category, feature, sloomState, sloomNote, kdenliveState, kdenliveNote, rowSources = ['sloomQualified', 'kdenliveManual'], extra = {}) => {
  rows.push({
    id: `feature-${String(nextId++).padStart(4, '0')}`,
    category,
    feature,
    sloom: { state: sloomState, note: sloomNote },
    kdenlive: { state: kdenliveState, note: kdenliveNote },
    sources: rowSources,
    ...extra,
  });
};

const addMany = (category, entries, rowSources) => {
  for (const entry of entries) add(category, ...entry, rowSources);
};

addMany('Product, license & platforms', [
  ['General-purpose non-linear video editor', 'yes', 'Video workspace with source/program editing, a multitrack timeline, effects, audio, captions, and delivery.', 'yes', 'Established multitrack non-linear editor.'],
  ['Node-based generative media workflow beside the editor', 'yes', 'Flow graphs generate and route video, image, audio, text, and composition outputs into Video.', 'no', 'No integrated generative node graph.'],
  ['Free edition', 'yes', 'Community edition is free for personal and noncommercial use.', 'yes', 'Free software for personal and commercial use under the GPL.'],
  ['Commercial use permitted', 'yes', 'Requires Sloom\'s permanent commercial license once the work is earning.', 'yes', 'The GPL permits commercial use without buying a separate editor license.'],
  ['Separate paid commercial license', 'yes', 'A permanent one-time commercial license is offered.', 'no', 'No separate paid editor license is required.'],
  ['Open-source application code', 'no', 'The comparison does not claim Sloom Studio is open source.', 'yes', 'GPL-licensed source is publicly available.'],
  ['Source-available application code', 'yes', 'Source is published under the PolyForm Noncommercial license.', 'yes', 'GPL-licensed source is publicly available.'],
  ['No-subscription editor license', 'yes', 'No recurring subscription is required; connected providers may bill separately.', 'yes', 'No subscription.'],
  ['Windows desktop', 'yes', 'Packaged Windows installer.', 'yes', 'Official Windows build; Windows 10 or newer.'],
  ['Linux desktop', 'yes', 'AppImage and Debian package paths.', 'yes', 'Official AppImage and Flatpak paths.'],
  ['macOS Intel', 'yes', 'Intel DMG path.', 'yes', 'Official macOS package for supported macOS releases.'],
  ['macOS Apple Silicon', 'yes', 'Arm64 DMG path.', 'yes', 'Official Apple-silicon package.'],
  ['Android editor shell', 'partial', 'A bounded phone Video shell supports review and selected edits; it is not the full desktop surface.', 'no', 'No official Android editor.'],
  ['Browser-hosted workspace', 'partial', 'The React workspace runs in a browser, but native rendering and filesystem features require the desktop host.', 'no', 'Desktop application rather than a browser editor.'],
  ['Offline editing', 'yes', 'Local editing works offline for imported media; cloud generation and provider calls do not.', 'yes', 'Core editing is local and offline.'],
  ['Self-hosted fonts and core UI assets', 'yes', 'Core interface assets are local.', 'yes', 'Desktop application assets are local.'],
  ['English interface', 'yes', 'English product interface and manual.', 'yes', 'English interface and manual.'],
  ['Localized interface packs', 'partial', 'Selected localized surfaces and Japanese documentation; not a Kdenlive-scale translation catalog.', 'yes', 'Broad KDE localization support.'],
  ['Built-in handbook', 'yes', 'Sloom user guide and diagnostics are linked from the product.', 'yes', 'Integrated handbook and context help.'],
  ['First-run configuration wizard', 'no', 'Uses regular settings and diagnostics instead of a dedicated first-run wizard.', 'yes', 'Run Config Wizard and initial setup flow.'],
  ['Portable / no-install package', 'partial', 'AppImage is portable on Linux.', 'yes', 'AppImage and Windows standalone package paths.'],
  ['Automatic update channel', 'partial', 'Release downloads are published, but this matrix does not claim a universal in-app updater.', 'partial', 'Package-specific; distribution and store paths update differently.'],
], ['sloomProduct', 'sloomQualified', 'kdenliveDownload']);

addMany('Workspace & interface', [
  ['Dark editor theme', 'yes', 'Dark node-and-timeline workspace.', 'yes', 'Color themes, including dark themes.'],
  ['Configurable color theme', 'partial', 'A consistent dark theme is supplied; broad theme switching is not claimed.', 'yes', 'Theme selection is configurable.'],
  ['Dockable panels', 'yes', 'Source Bin, monitors, Inspector, Timeline, diagnostics, and parity panels can be docked.', 'yes', 'Dockable widgets throughout the interface.'],
  ['Resizable panels and splitters', 'yes', 'Dock areas and timeline regions resize.', 'yes', 'Dock widgets and splitters resize.'],
  ['Show / hide individual panels', 'yes', 'Workspace controls expose the major Video panels.', 'yes', 'View menu toggles individual widgets.'],
  ['Saved workspace layouts', 'partial', 'Video remembers working state, but does not expose Kdenlive\'s named layout catalogue.', 'yes', 'Save, load, and manage workspace layouts.'],
  ['Reset workspace layout', 'yes', 'Panel layout can return to the Video default.', 'yes', 'Reset layout action.'],
  ['Full-screen application mode', 'yes', 'Desktop fullscreen is available.', 'yes', 'Full Screen Mode.'],
  ['Hide / show menu bar', 'partial', 'Native KDE global-menu integration is supported in the packaged Linux build.', 'yes', 'Menu bar can be hidden and restored.'],
  ['Configurable toolbars', 'no', 'Tools are fixed to the Video workspace and floating toolbar.', 'yes', 'Main and extra toolbars can be configured.'],
  ['Command palette / action search', 'yes', 'Searchable command registry with remappable commands.', 'yes', 'Find Action opens the KDE action search.'],
  ['Source / clip monitor', 'yes', 'Dedicated source monitor with I/O and source-record edits.', 'yes', 'Clip Monitor.'],
  ['Program / project monitor', 'yes', 'Edit Stage / rendered Program monitor.', 'yes', 'Project Monitor.'],
  ['Monitor split view / compare', 'partial', 'Source and Program monitors can be shown together; no full Kdenlive comparison-mode set.', 'yes', 'Monitor comparison and split-overlay tools.'],
  ['External / second-screen monitor output', 'no', 'No bundled second-monitor output.', 'yes', 'Fullscreen output and 26.04 monitor mirroring.'],
  ['Project Bin / Source Bin', 'yes', 'Source Bin aggregates imported and generated assets.', 'yes', 'Project Bin.'],
  ['Media Browser panel', 'yes', 'Mounted-volume and camera-card media browser.', 'yes', 'Filesystem Media Browser.'],
  ['Effects / composition browser', 'yes', 'Inspector exposes clip effects, presets, transitions, and objects.', 'yes', 'Effects and Compositions widgets.'],
  ['Inspector / properties panel', 'yes', 'Clip, object, effect, audio, caption, and sequence properties.', 'yes', 'Properties and Effect/Composition Stack.'],
  ['Audio Mixer panel', 'partial', 'Bounded 64-track mixer with one main bus; no sends, returns, or surround.', 'yes', 'Per-track and master Audio Mixer.'],
  ['Subtitle management panel', 'yes', 'Caption tracks and cue editing live in Video.', 'yes', 'Subtitle Manager / subtitle tools.'],
  ['Speech Editor panel', 'partial', 'Timed transcript editing is available; transcription is supplied by a connected workflow.', 'yes', 'Speech recognition and Speech Editor workflow.'],
  ['Guides / marker panel', 'yes', 'Marker index and navigation.', 'yes', 'Guides widget and category management.'],
  ['Project Notes panel', 'partial', 'Project history and review notes exist; no exact Kdenlive rich project-notes widget.', 'yes', 'Project Notes widget with clickable timecode links.'],
  ['Scopes panels', 'yes', 'Histogram, waveform, RGB parade, and vectorscope are available on demand.', 'yes', 'Audio and color scopes as dockable widgets.'],
  ['Multiple sequence tabs', 'yes', 'Sequence navigator switches among compositions.', 'yes', 'Multiple timeline sequences open in tabs.'],
  ['Welcome / recent projects screen', 'yes', 'Project gallery and recent projects.', 'yes', 'Welcome screen and recent projects.'],
  ['Splash screen', 'yes', 'Packaged desktop splash / startup surface.', 'yes', 'Configurable splash screen.'],
  ['Desktop touch controls', 'partial', 'Touch-aware shell and large controls are available on bounded surfaces.', 'partial', 'Standard desktop UI supports some touch input but is not a dedicated touch editor.'],
  ['Samsung DeX workflow', 'partial', 'Android shell can be used through DeX for supported tasks.', 'no', 'No Android / DeX build.'],
], ['sloomManual', 'sloomQualified', 'kdenliveManual']);

addMany('Projects, sequences & history', [
  ['New project', 'yes', 'Create a Sloom project and Video composition.', 'yes', 'New Kdenlive project.'],
  ['Open project', 'yes', 'Open local project files and packages.', 'yes', 'Open .kdenlive projects.'],
  ['Save project', 'yes', 'Browser and desktop save paths.', 'yes', 'Save .kdenlive project.'],
  ['Save As', 'yes', 'Save a copy under a new name or location.', 'yes', 'Save As.'],
  ['Recent projects', 'yes', 'Recent project gallery.', 'yes', 'Open Recent.'],
  ['Close project', 'yes', 'Close or leave the active project.', 'yes', 'Close project.'],
  ['Revert to saved state', 'partial', 'Use project history restore rather than a single Revert command.', 'yes', 'Revert action.'],
  ['Automatic save', 'yes', 'Bounded autosave with storage safeguards.', 'yes', 'Automatic project backup / autosave.'],
  ['Crash-recovery restore', 'yes', 'Crash recovery snapshot and guarded restore.', 'yes', 'Recovers autosaved project state.'],
  ['Version history', 'yes', 'Bounded restore history with validation.', 'partial', 'Backup versions are available; not a named branching history system.'],
  ['Clear undo history', 'yes', 'History can be bounded/reset through project lifecycle controls.', 'yes', '26.04 adds Clear Undo History.'],
  ['Project archive / collect media', 'yes', 'Consolidate media into a selected destination with bounded refusal.', 'yes', 'Archive Project packages project and used media.'],
  ['Relink offline media', 'yes', 'Missing source relink workflow.', 'yes', 'Locate / replace missing media.'],
  ['Consolidate / copy used media', 'yes', 'Project media consolidation.', 'yes', 'Archive and proxy/project-folder workflows.'],
  ['Project metadata fields', 'partial', 'Project identity and delivery metadata are stored; no claim of Kdenlive\'s arbitrary render metadata editor.', 'yes', 'Project metadata tab and custom fields.'],
  ['Project profile: resolution', 'yes', 'Custom width and height.', 'yes', 'Project profile resolution.'],
  ['Project profile: frame rate', 'yes', 'Common and exact rational frame rates.', 'yes', 'Project profile frame rate.'],
  ['Project profile: aspect ratio', 'yes', 'Display and pixel aspect controls.', 'yes', 'Display and pixel aspect ratios.'],
  ['Project profile: audio sample rate', 'yes', 'Sequence audio sample rate.', 'yes', 'Project audio settings depend on profile/render path.'],
  ['Drop-frame timecode', 'yes', 'Rational/drop-frame timebase support.', 'yes', 'Drop-frame profiles and timecode display.'],
  ['Multiple sequences in one project', 'yes', 'Compositions / sequences are first-class project items.', 'yes', 'Sequences are project-bin clips and timeline tabs.'],
  ['Create sequence', 'yes', 'Create a composition or starter sequence.', 'yes', 'Create Sequence.'],
  ['Rename sequence', 'yes', 'Sequence name editing.', 'yes', 'Rename sequence in Project Bin.'],
  ['Duplicate sequence', 'yes', 'Starter/sequence duplication and cross-sequence copy.', 'yes', 'Duplicate sequence.'],
  ['Delete sequence', 'yes', 'Remove a composition with project safeguards.', 'yes', 'Delete sequence clip.'],
  ['Sequence properties', 'yes', 'Duration, profile, timing, track, and delivery settings.', 'yes', 'Sequence properties and profile.'],
  ['Nested sequences', 'yes', 'Executable nested-sequence clips with cycle and budget refusal.', 'yes', 'Sequences can be inserted as clips.'],
  ['Nested-sequence audio waveforms', 'partial', 'Nested execution is supported; dedicated nested waveform rendering is bounded.', 'yes', '26.04 adds sequence clip waveforms.'],
  ['Starter sequence templates', 'yes', 'Starter sequences seed common layouts.', 'partial', 'Project/profile templates rather than Sloom starter compositions.'],
  ['Cross-project media catalogue', 'partial', 'Bounded metadata catalogue and Source Library reuse.', 'yes', 'Library clips can be reused across projects.'],
], ['sloomQualified', 'sloomSource', 'kdenliveManual']);

addMany('Media ingest & source organization', [
  ['Import individual media files', 'yes', 'File picker and drag/drop import.', 'yes', 'Add Clip or Folder.'],
  ['Import multiple files at once', 'yes', 'Multi-file picker and media-browser selection.', 'yes', 'Multi-file import.'],
  ['Import a folder', 'partial', 'Media Browser and watch folders ingest folder contents; Source Bin does not mimic every Kdenlive folder-import rule.', 'yes', 'Add Clip or Folder.'],
  ['Drag files from desktop into bin', 'yes', 'Desktop drag/drop into Source Bin and timeline.', 'yes', 'Drag/drop into Project Bin or timeline.'],
  ['Drag files directly to timeline', 'yes', 'Creates timeline clips on the target track.', 'yes', 'Direct timeline add; expanded in 26.04.'],
  ['Mounted-volume browser', 'yes', 'Lists mounted filesystems and GVfs locations.', 'partial', 'Filesystem Media Browser; no dedicated Sloom-style mounted-volume catalogue claim.'],
  ['Camera-card / DCIM mode', 'yes', 'Camera-card mode detects DCIM-style media roots.', 'partial', 'Can browse mounted cards and import files; no dedicated documented camera-card mode.'],
  ['Favorite media locations', 'yes', 'Favorites and last location are persisted.', 'yes', 'Media Browser bookmarks / places integration.'],
  ['Compact and thumbnail browser density', 'yes', 'Compact list and thumbnail presentation modes.', 'yes', 'Icon and list views.'],
  ['Sort media by columns', 'yes', 'Name, kind, duration, size, and date-oriented sorting.', 'yes', 'Project Bin column sorting.'],
  ['Search bin by text', 'yes', 'Search across labels and metadata.', 'yes', 'Project Bin search.'],
  ['Filter bin by media type', 'yes', 'Origin, kind, and editor-asset filters.', 'yes', 'Video/audio/image/title/sequence filters.'],
  ['Filter by asset origin', 'yes', 'Imported, generated, Flow, Image, Paper, editor, and linked/copy origin classes.', 'no', 'No cross-workspace generation-origin taxonomy.'],
  ['Folders in bin', 'yes', 'Collapsible source groups and smart organization.', 'yes', 'Project Bin folders.'],
  ['Multiple bin widgets', 'no', 'One Source Bin with filters and groups.', 'yes', 'Additional Project Bin widgets can show folders independently.'],
  ['Tags / colored tags', 'partial', 'Stars, origin, kind, metadata, and logging fields; no exact Kdenlive tag editor.', 'yes', 'Project Bin tags.'],
  ['Star / favorite source items', 'yes', 'Per-item star and favorites filtering.', 'partial', 'Favorites exist for effects/compositions; bin tags fill a similar role.'],
  ['Subclips / clip zones', 'yes', 'Source In/Out and logged subclip metadata.', 'yes', 'Create subclips from Clip Monitor zones.'],
  ['Clip metadata logging', 'yes', 'Logging metadata and bounded searchable fields.', 'yes', 'Clip properties, description, rating, tags, and metadata.'],
  ['Clip properties dialog', 'yes', 'Inspector and source metadata views.', 'yes', 'Clip Properties.'],
  ['Rename bin item', 'yes', 'Editable item labels.', 'yes', 'Rename clip.'],
  ['Duplicate bin item', 'yes', 'Copy/link semantics and timeline duplication.', 'yes', 'Duplicate clip.'],
  ['Replace source media', 'yes', 'Relink and replacement workflow keeps edit state.', 'yes', 'Replace Clip.'],
  ['Reload changed source', 'partial', 'Linked media can be refreshed/relinked; no universal Reload command claim.', 'yes', 'Reload Clip.'],
  ['Locate source on disk', 'yes', 'Native paths can be revealed through the host.', 'yes', 'Locate Clip / Open Containing Folder.'],
  ['Delete bin item with usage guard', 'yes', 'Referenced assets are checked before removal.', 'yes', 'Delete warns about timeline use.'],
  ['Show clip usage in sequences', 'partial', 'Source references and composition diagnostics identify consumers.', 'yes', 'Clip-in-timeline usage markers and context actions.'],
  ['Image sequence import', 'yes', 'Still sequences can be represented and exported.', 'yes', 'Dedicated image-sequence clip import.'],
  ['Color clip generator', 'yes', 'Shape/color stage objects and generated still sources.', 'yes', 'Color Clip.'],
  ['Title clip generator', 'yes', 'Text and graphic stage objects.', 'yes', 'Title Clip.'],
  ['Template title clip', 'partial', 'Reusable stage-object compositions and starters.', 'yes', 'Template Title.'],
  ['Countdown generator', 'no', 'No dedicated countdown source generator.', 'yes', 'Generator clip.'],
  ['Noise generator', 'no', 'No dedicated video-noise source generator.', 'yes', 'Generator clip.'],
  ['Online stock-media browser', 'no', 'Provider workflows generate or ingest media, but do not replicate Kdenlive Online Resources.', 'yes', 'Online Resources integrates supported stock services.'],
  ['Video capture', 'no', 'No dedicated webcam, FireWire, V4L2, or screen-capture panel in Video.', 'yes', 'Capture configuration supports platform-dependent devices and screen capture.'],
  ['Audio recording / narration capture', 'yes', 'Narration recording creates timeline audio.', 'yes', 'Audio capture to a selected track.'],
  ['Lazy metadata probing', 'yes', 'Probes are bounded, paginated, and requested on demand.', 'yes', 'FFmpeg/MLT-backed clip probing.'],
  ['Thumbnail generation', 'yes', 'Bounded image/video thumbnails.', 'yes', 'Project Bin and timeline thumbnails.'],
  ['Hover video scrub', 'yes', 'Bounded hover scrub samples no more than five frames.', 'yes', 'Clip preview/monitor scrubbing.'],
  ['Audio waveform thumbnails', 'yes', 'Embedded and timeline waveforms with bounded decoding.', 'yes', 'Project/timeline audio thumbnails.'],
  ['Automatic proxy clips', 'yes', 'Proxy policy and external FFmpeg transcode jobs.', 'yes', 'Automatic proxy generation by profile and size.'],
  ['Manual proxy toggle per clip', 'yes', 'Proxy can be requested or cleared for selected media.', 'yes', 'Proxy Clip context action.'],
  ['Proxy profile configuration', 'partial', 'Bounded predefined/external transcode policy.', 'yes', 'Project and global proxy profile configuration.'],
  ['Transcode clips', 'yes', 'External FFmpeg transcode workflow.', 'yes', 'Transcode to edit-friendly formats.'],
  ['Watch folders', 'yes', 'Configured folders can add newly appearing media.', 'no', 'No current manual feature matching Sloom watch-folder ingest.'],
  ['Link versus copy imported media', 'yes', 'Explicit link/copy handling.', 'partial', 'Kdenlive normally links; Archive Project copies used assets.'],
  ['Generated Flow outputs in bin', 'yes', 'Video, image, audio, text, and composition node outputs are indexed.', 'no', 'No Flow workspace.'],
  ['Image-workspace assets in bin', 'yes', 'Image editor outputs appear with origin metadata.', 'no', 'No sibling Sloom Image workspace.'],
  ['Paper storyboard assets in bin', 'yes', 'Paper panels/storyboards can become Video sources.', 'no', 'No sibling Sloom Paper workspace.'],
  ['Browser large-file session links', 'yes', 'Files at or above 512 MiB can stay as session-scoped links instead of duplicated browser bytes.', 'na', 'Desktop-native file access does not need this browser safeguard.'],
  ['Paginated source inventory', 'yes', '48 cards per page with bounded probe work.', 'partial', 'Project Bin scales as a native item view rather than fixed pages.'],
], ['sloomManual', 'sloomQualified', 'kdenliveManual']);

addMany('Timeline & track controls', [
  ['Multitrack video timeline', 'yes', 'Dynamic timeline with visual and audio tracks.', 'yes', 'Multitrack timeline.'],
  ['Maximum documented track count', 'partial', '64 executable tracks.', 'yes', 'Virtually unlimited tracks, bounded by machine resources.'],
  ['Add track', 'yes', 'Add video/audio-capable tracks.', 'yes', 'Insert Track.'],
  ['Delete track', 'yes', 'Remove tracks with edit safeguards.', 'yes', 'Delete Track.'],
  ['Rename track', 'yes', 'Editable track labels.', 'yes', 'Rename Track.'],
  ['Reorder tracks', 'yes', 'Track order can be changed.', 'yes', 'Move Track.'],
  ['Resize track height', 'yes', 'Per-track resizing.', 'yes', 'Resize individual or all tracks.'],
  ['Collapse / expand track', 'yes', 'Collapsible track rows.', 'yes', 'Collapse/expand track controls.'],
  ['Lock track', 'yes', 'Locked tracks refuse edits.', 'yes', 'Track lock.'],
  ['Hide video track', 'yes', 'Video visibility toggle.', 'yes', 'Track visibility.'],
  ['Mute audio track', 'yes', 'Track mute.', 'yes', 'Track mute.'],
  ['Solo audio track', 'yes', 'Track solo in bounded mixer.', 'yes', 'Track solo.'],
  ['Track targeting', 'yes', 'Video/audio track targets drive edits.', 'yes', 'Active-track targeting.'],
  ['Source video patching', 'yes', 'Video source patch and edit routing.', 'yes', 'V1/V2 source-track patching.'],
  ['Source audio patching', 'yes', 'Audio source patch and edit routing.', 'yes', 'A1/A2 source-track patching.'],
  ['Track sync locks', 'yes', 'Sync-lock state participates in ripple operations.', 'yes', 'Track lock/sync behavior.'],
  ['Track effects', 'partial', 'Adjustment layers and clip effects can span content; there is no universal Kdenlive-style track stack.', 'yes', 'Effects can be applied to tracks.'],
  ['Master effects', 'partial', 'One bounded main audio bus and delivery processors; no general master video effect stack.', 'yes', 'Master effect stack and On Master effects.'],
  ['Timeline thumbnails', 'yes', 'Visual clips render thumbnails and labels.', 'yes', 'Video thumbnails can be shown in tracks.'],
  ['Timeline audio waveforms', 'yes', 'Audio and embedded-video waveforms.', 'yes', 'Audio thumbnails/waveforms.'],
  ['Timeline snapping toggle', 'yes', 'Snap tool and keyboard toggle.', 'yes', 'Snap toggle.'],
  ['Snapping sensitivity', 'yes', 'Configurable pixel/time sensitivity.', 'partial', 'Snapping is configurable through timeline behavior rather than the same sensitivity control.'],
  ['Snap to clips', 'yes', 'Clip edges are snap points.', 'yes', 'Clip edges are snap points.'],
  ['Snap to playhead', 'yes', 'Playhead participates in snapping.', 'yes', 'Playhead is a snap point.'],
  ['Snap to markers / guides', 'yes', 'Point and range markers participate in navigation/snapping.', 'yes', 'Guides and markers are snap points.'],
  ['Timeline zoom slider', 'yes', 'Duration-scaled zoom.', 'yes', 'Zoom slider and fit timeline.'],
  ['Timeline minimap / overview', 'yes', 'Navigator/minimap for long sequences.', 'partial', 'Timeline overview and scroll controls; no exact Sloom minimap claim.'],
  ['Horizontal mouse-wheel navigation', 'yes', 'Hand tool and wheel/gesture navigation.', 'yes', 'Wheel scroll and 26.04 continuous pan.'],
  ['Fixed playhead scrolling mode', 'yes', 'Playhead-centered long-form navigation.', 'yes', '26.04 fixed playhead mode.'],
  ['Automatic timeline scrolling', 'yes', 'Playback follows the active region.', 'yes', 'Page/scroll timeline modes.'],
  ['Timeline zone / work area', 'yes', 'Sequence and source In/Out ranges.', 'yes', 'Timeline zone.'],
  ['Rich timeline markers / guides', 'yes', 'Point/range/clip markers with labels, color, categories, and notes.', 'yes', 'Guides with categories, comments, colors, and editing.'],
  ['Clip markers', 'yes', 'Markers can attach to clips and travel with them.', 'yes', 'Clip markers.'],
  ['Range markers', 'yes', 'Start/end range markers.', 'partial', 'Zones and paired guides provide ranges; guide objects themselves are points.'],
  ['Marker search / index', 'yes', 'Searchable marker index and source navigation.', 'yes', 'Guides widget provides filtering and navigation.'],
  ['Timeline preview rendering', 'yes', 'Rendered preview segments and cache readiness.', 'yes', 'Preview render zones with cached chunks.'],
  ['Disable all timeline effects', 'partial', 'Effects can be bypassed per clip/preset; no single universal timeline bypass claim.', 'yes', 'Disable Timeline Effects command.'],
  ['Long-timeline item culling', 'yes', 'Offscreen timeline work is culled.', 'yes', 'Native timeline view virtualizes drawing according to view.'],
  ['Editing during background render', 'yes', 'Queue jobs snapshot their settings; editing can continue.', 'yes', 'Non-blocking render and queued jobs.'],
], ['sloomQualified', 'sloomSource', 'kdenliveManual']);

addMany('Editing, trimming & clip operations', [
  ['Selection tool', 'yes', 'V selects and manipulates clips and objects.', 'yes', 'Selection Tool.'],
  ['Razor / cut tool', 'yes', 'C activates cut/split interactions.', 'yes', 'Razor Tool.'],
  ['Marquee selection tool', 'yes', 'M activates a bounded box-selection session for timeline items.', 'yes', 'Timeline rubber-band selection.'],
  ['Range selection tool', 'yes', 'R activates a time-range selection session.', 'yes', 'Timeline zone and range-selection workflows.'],
  ['Slip tool', 'yes', 'Y slips source content inside fixed timeline bounds.', 'yes', 'Slip Tool.'],
  ['Spacer / gap tool', 'partial', 'Hand/ripple/gap operations move bounded regions; no exact multitrack Spacer Tool UI.', 'yes', 'Spacer Tool moves clips after a point on one or all tracks.'],
  ['Hand / pan tool', 'yes', 'H pans the timeline.', 'yes', 'Grab/scroll interactions pan the timeline.'],
  ['Ripple tool / ripple edits', 'yes', 'Q/W ripple trims and gap operations shift downstream material.', 'yes', 'Ripple trim and extract operations.'],
  ['Rolling edit tool', 'yes', 'E rolls the boundary between adjacent clips.', 'yes', 'Roll Tool / rolling trim.'],
  ['Slide edit tool', 'yes', 'Dedicated slide trim session moves a clip while compensating adjacent edit boundaries.', 'yes', 'Slide Tool changes adjacent source boundaries while moving a clip.'],
  ['Rate-stretch tool', 'yes', 'T changes clip duration and playback rate as one bounded edit.', 'yes', 'Rate Stretch Tool changes clip duration and speed together.'],
  ['Three-point source editing', 'yes', 'Source In/Out plus target track and playhead.', 'yes', 'Three-point editing between Clip Monitor and timeline.'],
  ['Set source In point', 'yes', 'I sets source or sequence In.', 'yes', 'I sets Zone In.'],
  ['Set source Out point', 'yes', 'O sets source or sequence Out.', 'yes', 'O sets Zone Out.'],
  ['Clear source In', 'yes', 'Alt+I clears In.', 'yes', 'Clear Zone In command.'],
  ['Clear source Out', 'yes', 'Alt+O clears Out.', 'yes', 'Clear Zone Out command.'],
  ['Clear source In and Out', 'yes', 'Monitor control clears both bounds.', 'yes', 'Clear Zone command.'],
  ['Insert edit', 'yes', 'Comma inserts the marked source and ripples later material.', 'yes', 'Insert Zone in Timeline.'],
  ['Overwrite edit', 'yes', 'Period overwrites the targeted duration.', 'yes', 'Overwrite Zone in Timeline.'],
  ['Append source to end', 'yes', 'Add-to-track appends source material.', 'yes', 'Append to Timeline.'],
  ['Direct clip add at playhead', 'yes', 'Source items can be added at the playhead/target.', 'yes', '26.04 direct add from Project Bin to timeline.'],
  ['Split selected clip at playhead', 'yes', 'Split command preserves source timing and link data.', 'yes', 'Cut Clip.'],
  ['Cut all clips at playhead', 'partial', 'Batch split operates over selected/targeted clips.', 'yes', 'Cut All Clips.'],
  ['Delete selected clips', 'yes', 'Delete leaves or closes space according to the chosen operation.', 'yes', 'Delete Selected Item.'],
  ['Ripple delete / remove selected space', 'yes', 'Gap fill and ripple delete shift following edits.', 'yes', 'Extract / Delete Space.'],
  ['Lift selection', 'yes', 'Removes content while retaining duration.', 'yes', 'Lift Zone.'],
  ['Extract selection', 'yes', 'Removes range and closes the gap.', 'yes', 'Extract Zone.'],
  ['Remove one gap', 'yes', 'Fill Gap acts on a selected/adjacent gap.', 'yes', 'Remove Space.'],
  ['Remove all gaps', 'partial', 'Repeated/batch gap actions are available, without a separate global remove-all promise.', 'yes', 'Remove All Spaces.'],
  ['Pointer drag move', 'yes', 'Drag clips between times/tracks with snapping.', 'yes', 'Drag clips in timeline.'],
  ['Pointer drag trim', 'yes', 'Drag either clip edge with source-bound safeguards.', 'yes', 'Resize clip edges.'],
  ['Shift ripple trim', 'yes', 'Modified edge drag ripples downstream clips.', 'yes', 'Ripple trim interactions.'],
  ['Keyboard ripple trim previous edit (Q)', 'yes', 'Q ripples from the previous boundary to playhead.', 'yes', 'Ripple trim commands are assignable.'],
  ['Keyboard ripple trim next edit (W)', 'yes', 'W ripples from playhead to the next boundary.', 'yes', 'Ripple trim commands are assignable.'],
  ['Keyboard roll edit (E)', 'yes', 'E rolls the selected edit point.', 'yes', 'Roll edit commands are assignable.'],
  ['Keyboard slip edit (Y)', 'yes', 'Y applies the bounded slip operation.', 'yes', 'Slip Tool and shortcuts.'],
  ['Advanced trim monitor', 'partial', 'Live source/program feedback for the bounded roll/slip operations.', 'yes', 'Trim preview and trim mode workflows.'],
  ['Loop around edit while trimming', 'partial', 'Loop/JKL playback can be used during inspection; no dedicated trim-loop claim.', 'yes', 'Loop and trim workflows.'],
  ['Move clip by one frame', 'yes', 'Arrow/nudge commands move selected material by exact increments.', 'yes', 'Move Clip by one Frame.'],
  ['Move clip by larger increment', 'yes', 'Shift+nudge uses a larger exact step.', 'yes', 'Configurable move actions.'],
  ['Duplicate clip by Alt-drag', 'yes', 'Alt-drag clones edit state.', 'partial', 'Copy/paste and duplicate actions; modifier behavior is platform/configuration dependent.'],
  ['Cut / copy / paste clips', 'yes', 'Clipboard preserves professional clip state.', 'yes', 'Standard Cut, Copy, Paste.'],
  ['Cross-sequence clipboard', 'yes', 'Copies clips, sync groups, effects, and objects between sequences.', 'yes', 'Copy/paste between sequences and projects.'],
  ['Paste effects only', 'yes', 'Effect state can be copied/applied independently.', 'yes', 'Paste Effects.'],
  ['Multi-select clips', 'yes', 'Shift/box selection and bounded batch actions.', 'yes', 'Shift/Ctrl and rubber-band selection.'],
  ['Batch clip property editing', 'yes', 'Selected clips can receive shared effect, timing, and logging changes.', 'yes', 'Multi-clip actions; 26.04 adds multi-clip speed changes.'],
  ['Group clips', 'yes', 'Professional link/sync groups persist across edits.', 'yes', 'Group Clips.'],
  ['Ungroup clips', 'yes', 'Break an edit group without deleting members.', 'yes', 'Ungroup Clips.'],
  ['Linked audio and video', 'yes', 'Link groups keep companion audio/video aligned.', 'yes', 'Split/restore audio and grouped A/V.'],
  ['Sync groups across tracks', 'yes', 'Named sync groups survive cross-sequence copy.', 'partial', 'Grouping and track sync behavior; no exact named Sloom sync-group object.'],
  ['Detach / split audio from video', 'yes', 'Embedded audio can become an editable audio clip.', 'yes', 'Split Audio.'],
  ['Restore audio to video clip', 'partial', 'Link/replacement workflows can restore paired media.', 'yes', 'Restore Audio.'],
  ['Replace timeline clip source', 'yes', 'Relink/replace preserves the edit where possible.', 'yes', 'Replace Clip in timeline.'],
  ['Change clip duration numerically', 'yes', 'Duration and source bounds can be entered exactly.', 'yes', 'Edit Duration.'],
  ['Align clip to playhead', 'yes', 'Nudge/alignment commands use the active playhead.', 'yes', 'Set Clip Start/End at Cursor actions.'],
  ['Automatic audio/video synchronization', 'no', 'Multicam requires explicit angle timing; no waveform/timecode auto-sync.', 'yes', 'Set Audio Reference / Align Audio to Reference.'],
  ['Undo', 'yes', 'Bounded command history.', 'yes', 'Undo.'],
  ['Redo', 'yes', 'Redo after undo.', 'yes', 'Redo.'],
  ['200-entry professional edit history', 'yes', 'Bounded professional history records up to 200 edit commands.', 'partial', 'Undo history exists; the manual does not promise the same fixed 200-entry model.'],
], ['sloomManual', 'sloomQualified', 'kdenliveManual']);

addMany('Playback, monitors & navigation', [
  ['Play / pause with Space', 'yes', 'Space toggles program playback.', 'yes', 'Space plays/stops.'],
  ['JKL shuttle', 'yes', 'J reverses, K pauses, L forwards with repeated-speed steps.', 'yes', 'J/K/L shuttle with repeated-speed steps.'],
  ['Reverse shuttle speeds', 'yes', 'Repeated J increases reverse speed.', 'yes', '−1x, −1.5x, −2x, −3x, −5.5x, and −10x defaults.'],
  ['Forward shuttle speeds', 'yes', 'Repeated L increases forward speed.', 'yes', '1x, 1.5x, 2x, 3x, 5.5x, and 10x defaults.'],
  ['Step one frame backward / forward', 'yes', 'Left/Right arrows perform exact frame seeks.', 'yes', 'Left/Right arrows.'],
  ['Step one second backward / forward', 'yes', 'Shift+Left/Right uses exact sequence-time increments.', 'yes', 'Shift+Left/Right.'],
  ['Go to sequence start / end', 'yes', 'Home/End.', 'yes', 'Ctrl+Home/Ctrl+End for project; Home/End for clip boundaries by default.'],
  ['Go to clip start / end', 'yes', 'Edit-boundary navigation is available.', 'yes', 'Home/End defaults.'],
  ['Go to previous / next edit', 'yes', 'Boundary navigation follows timeline edits.', 'yes', 'Previous/Next Snap Point.'],
  ['Go to previous / next marker', 'yes', 'Marker index and keyboard navigation.', 'yes', 'Previous/Next Guide.'],
  ['Go to zone start / end', 'yes', 'In/Out navigation.', 'yes', 'Shift+I / Shift+O.'],
  ['Play selected zone', 'yes', 'Program range playback.', 'yes', 'Play Zone.'],
  ['Loop selected zone', 'yes', 'Loop range playback.', 'yes', 'Loop Zone.'],
  ['Playback follows selected clip', 'yes', 'Program seek follows timeline selection/playhead.', 'yes', 'Monitor follows timeline/project position.'],
  ['Source monitor audio playback', 'yes', 'Source media audio is decoded and monitored.', 'yes', 'Clip Monitor audio.'],
  ['Program monitor audio playback', 'yes', 'Rendered/program audio is monitored.', 'yes', 'Project Monitor audio.'],
  ['Rendered program preview', 'yes', 'Current sequence can be rendered/cached and played in the Program monitor.', 'yes', 'Timeline preview rendering and Project Monitor.'],
  ['Exact seek after playhead change', 'yes', 'Timeline changes seek active Edit Stage media.', 'yes', 'Project Monitor seeks to timeline cursor.'],
  ['Fit monitor image', 'yes', 'Fit view mode.', 'yes', 'Fit monitor zoom.'],
  ['Fill monitor', 'yes', 'Fill stage mode.', 'partial', 'Monitor zoom/crop controls provide comparable viewing, not the same named mode.'],
  ['100% monitor zoom', 'yes', 'One-to-one view.', 'yes', '100% monitor zoom.'],
  ['Monitor zoom in / out', 'yes', 'Zoom controls and gestures.', 'yes', 'Monitor zoom shortcuts/wheel.'],
  ['Monitor full-screen', 'yes', 'Full-screen stage/monitor.', 'yes', 'F11 or double-click.'],
  ['Safe-zone overlay', 'partial', 'Stage guides are available, without every Kdenlive monitor overlay.', 'yes', 'Title/action safe-zone overlay.'],
  ['Monitor grid / guides overlay', 'yes', 'Stage guides and object snapping.', 'yes', 'Monitor overlay and guides.'],
  ['Monitor timecode display', 'yes', 'Exact sequence time display and entry.', 'yes', 'Timecode field and overlay.'],
  ['Monitor frame-count display', 'partial', 'Frame-aware timeline/timebase; no separate persistent frame-count monitor mode claim.', 'yes', 'Timecode or frame display modes.'],
  ['Monitor audio meter', 'partial', 'Bounded mixer/meters expose main levels.', 'yes', 'Monitor and mixer audio meters.'],
  ['Extract current frame / snapshot', 'yes', 'Program snapshot exports the current frame.', 'yes', 'Extract Frame and Extract Frame to Project.'],
  ['Add extracted frame to bin', 'yes', 'Snapshot can become a source item.', 'yes', 'Extract Frame to Project.'],
  ['Monitor overlay information', 'partial', 'Time, selection, bounds, and diagnostics; not every Kdenlive overlay option.', 'yes', 'Monitor overlay information and guides.'],
  ['Monitor mirroring', 'no', 'No bundled mirrored second output.', 'yes', 'Added in Kdenlive 26.04.'],
  ['Continuous timeline pan', 'yes', 'Hand/pan navigation is continuous.', 'yes', 'Added in Kdenlive 26.04.'],
], ['sloomManual', 'sloomQualified', 'kdenliveManual']);

addMany('Sequences, multicam & advanced timing', [
  ['Adjustment layers', 'yes', 'Executable adjustment clips apply bounded visual state over lower content.', 'yes', 'Adjustment Layer clips.'],
  ['Nested sequence cycle detection', 'yes', 'Rejects recursive sequence graphs.', 'partial', 'Nested sequences are supported; invalid project graphs are handled by the application.'],
  ['Nested sequence execution budget', 'yes', 'Depth, clip, and duration budgets produce explicit refusal.', 'na', 'Native sequence processing is resource-bound but not documented with Sloom\'s explicit budgets.'],
  ['Multicam source', 'partial', 'Two to four explicitly aligned angles.', 'yes', 'Multicam workflow supports multiple source clips.'],
  ['Multicam angle count', 'partial', 'Qualified for 2–4 angles.', 'yes', 'Not limited to four by the documented workflow.'],
  ['Multicam cut list', 'yes', 'Persisted angle cuts project to executable clips.', 'yes', 'Switch angles and create cuts.'],
  ['Live multicam switching grid', 'no', 'No live angle grid/switcher.', 'yes', 'Multicam monitor and live switching workflow.'],
  ['Multicam automatic sync', 'no', 'Angles require explicit alignment.', 'yes', 'Audio-reference synchronization can align clips.'],
  ['Multicam audio follows video', 'no', 'No automatic audio-follow-video policy.', 'yes', 'Audio handling can follow the chosen multicam workflow.'],
  ['Uniform clip speed', 'yes', 'Forward/reverse speed presets and exact rendered duration.', 'yes', 'Change Speed, including 26.04 multi-clip changes.'],
  ['Reverse playback / reverse speed', 'yes', 'Negative rate renders in native delivery.', 'yes', 'Reverse Clip / negative speed.'],
  ['Freeze frame / hold', 'yes', 'Hold-frame segments render deterministically.', 'yes', 'Freeze-frame effect and speed/remap techniques.'],
  ['Frame blending retime', 'yes', 'Native delivery supports blended frame sampling.', 'yes', 'Frame blending/interpolation options depend on the retime effect.'],
  ['Optical-flow retime', 'yes', 'Native delivery supports optical-flow sampling.', 'yes', 'Motion-compensated interpolation effects are available.'],
  ['Speed ramp / time-remap curve editor', 'no', 'The UI exposes uniform speed choices; no arbitrary speed-curve editor.', 'yes', 'Time Remapping effect with keyframed speed.'],
  ['Preserve pitch while changing speed', 'partial', 'Audio policy is bounded by the native rendering path.', 'yes', 'Pitch compensation option in speed workflows.'],
  ['Rational frame-rate math', 'yes', 'Exact rational timeline timing.', 'yes', 'Project profiles use rational frame rates.'],
  ['Variable-frame-rate media handling', 'partial', 'Probe/transcode paths can normalize media; exact VFR editing parity is not claimed.', 'yes', 'FFmpeg-backed import with transcode advice for problematic VFR footage.'],
], ['sloomQualified', 'sloomSource', 'kdenliveManual']);

addMany('Keyframes, effects stack & animation', [
  ['Clip position keyframes', 'yes', 'X and Y can be keyframed.', 'yes', 'Transform position keyframes.'],
  ['Clip scale keyframes', 'yes', 'Scale can be keyframed.', 'yes', 'Transform size/scale keyframes.'],
  ['Clip rotation keyframes', 'yes', 'Rotation can be keyframed.', 'yes', 'Transform rotation keyframes.'],
  ['Clip opacity keyframes', 'yes', 'Opacity can be keyframed.', 'yes', 'Opacity/composition keyframes.'],
  ['Effect-parameter keyframes', 'yes', 'Supported numeric filter parameters use the shared keyframe model.', 'yes', 'Most eligible effect parameters can be keyframed.'],
  ['Audio-volume keyframes', 'yes', 'Clip/track volume automation.', 'yes', 'Volume keyframes.'],
  ['Audio-pan keyframes', 'yes', 'Bounded pan automation.', 'yes', 'Pan effects can be keyframed.'],
  ['Add keyframe', 'yes', 'Add at the playhead in the Inspector.', 'yes', 'Add Keyframe.'],
  ['Delete keyframe', 'yes', 'Delete selected point.', 'yes', 'Delete Keyframe.'],
  ['Next / previous keyframe', 'yes', 'Keyframe navigation.', 'yes', 'Previous/Next Keyframe.'],
  ['Copy / paste keyframes', 'yes', 'Parameter state survives clip copy and preset operations.', 'yes', 'Copy/paste effect and keyframe data.'],
  ['Move keyframes in time', 'yes', 'Drag/numeric time editing.', 'yes', 'Drag keyframes in the keyframe ruler.'],
  ['Linear interpolation', 'yes', 'Linear segments.', 'yes', 'Linear keyframes.'],
  ['Hold / stepped interpolation', 'yes', 'Hold segments.', 'yes', 'Discrete keyframes.'],
  ['Smooth / eased interpolation', 'yes', 'Eased segments.', 'yes', 'Smooth keyframes.'],
  ['Bezier interpolation', 'yes', 'Bounded cubic Bezier values and handles persist.', 'yes', 'Smooth/Bezier keyframes and curve controls.'],
  ['Full graph / curve editor', 'partial', 'Bezier handles exist for supported parameters; no universal multilane graph editor.', 'partial', 'Keyframe curves are edited inside effect panels, not a standalone high-end graph editor.'],
  ['On-monitor transform handles', 'yes', 'Move, scale, and rotate directly on the Edit Stage.', 'yes', 'On-monitor edit handles for transform-capable effects.'],
  ['Constrain transform proportions', 'yes', 'Modifier/lock constraints preserve aspect.', 'yes', 'Lock aspect ratio and modifier behavior.'],
  ['Effect stack per clip', 'yes', 'Ordered non-destructive filter stack.', 'yes', 'Effect/Composition Stack.'],
  ['Reorder effects', 'yes', 'Drag/reorder stack entries.', 'yes', 'Reorder effects.'],
  ['Enable / disable individual effect', 'yes', 'Per-effect enabled state.', 'yes', 'Enable/disable effect.'],
  ['Reset effect', 'yes', 'Reset individual or preset-managed effect values.', 'yes', 'Reset effect parameters.'],
  ['Copy effect between clips', 'yes', 'Paste effects and professional clipboard.', 'yes', 'Copy/Paste Effects.'],
  ['Save custom effect preset', 'yes', 'Named editor clip presets.', 'yes', 'Save Effect.'],
  ['Favorite effects', 'partial', 'Named presets and browser categories; no separate star for every effect.', 'yes', 'Favorite effects filter.'],
  ['Search effects', 'yes', 'Inspector/preset search and categories.', 'yes', 'Effects widget search.'],
  ['Show effect description / documentation', 'partial', 'Inline labels, notes, diagnostics, and manual.', 'yes', 'Description pane links to online documentation.'],
  ['Apply effect to clip', 'yes', 'Clip effects.', 'yes', 'Clip effect stack.'],
  ['Apply effect to track', 'partial', 'Use adjustment clips for visual track-spanning work.', 'yes', 'Track effect stack.'],
  ['Apply effect to master', 'partial', 'Bounded audio delivery processors; no general video master stack.', 'yes', 'Master effect stack.'],
], ['sloomManual', 'sloomQualified', 'kdenliveManual']);

addMany('Compositing, masks & transitions', [
  ['Automatic alpha-channel compositing on stacked tracks', 'yes', 'Transparent image/video sources composite by track order.', 'yes', 'Alpha is honored automatically.'],
  ['Per-clip opacity', 'yes', 'Static and keyframed opacity.', 'yes', 'Opacity through effects/compositions.'],
  ['Per-clip blend mode', 'yes', 'Sixteen CSS-compatible blend modes.', 'yes', 'Composition and Cairo Blend modes.'],
  ['Composition track selection', 'partial', 'Track order determines the lower sources; no arbitrary composition-target dropdown.', 'yes', 'Composition Track can target a lower track.'],
  ['Insert composition from clip corner', 'no', 'Transitions are chosen in the Inspector.', 'yes', 'Drag a clip-corner composition handle.'],
  ['Insert composition from context menu', 'partial', 'Clip Inspector/context actions add transitions.', 'yes', 'Insert Composition context menu.'],
  ['Drag composition from browser', 'partial', 'Transition presets can be selected/applied; no exact drag bar workflow.', 'yes', 'Drag from Compositions widget to timeline.'],
  ['Trim composition duration on timeline', 'yes', 'Transition duration is editable and bounded by source length.', 'yes', 'Drag either composition edge.'],
  ['Default transition duration setting', 'yes', 'Transition duration defaults and per-clip override.', 'yes', 'Configurable default duration.'],
  ['Transition direction / reverse', 'yes', 'Four directional slide variants are selectable.', 'yes', 'Reverse option and directional lumas.'],
  ['Cross dissolve', 'yes', 'Adjacent paired fades produce a deterministic cross dissolve.', 'yes', 'Dissolve/Wipe None.'],
  ['Dip to arbitrary color', 'no', 'No current dip-to-arbitrary-color transition.', 'yes', 'Color clips and compositions can create a dip to a chosen color.'],
  ['Fade to / from black', 'yes', 'Qualified fade-black transition behavior.', 'yes', 'Fade to/from Black effects and compositions.'],
  ['Wipe transition', 'no', 'No current wipe transition in the qualified runtime.', 'yes', 'Wipe with selectable luma maps.'],
  ['Slide transition', 'yes', 'Directional slide variants.', 'yes', 'Slide and directional slides.'],
  ['Fade transition', 'yes', 'Fade in/out and fade-black.', 'yes', 'Video fade effects and mix transitions.'],
  ['Audio crossfade with transition', 'yes', 'Equal-power crossfades render deterministically.', 'yes', 'Mix transition and audio crossfade.'],
  ['Animated transition previews', 'partial', 'Stage preview renders selected transitions; no icon-browser animation claim.', 'yes', 'Animated composition previews added in 26.04.'],
  ['Favorite compositions', 'partial', 'Transition presets are named and reusable.', 'yes', 'Star compositions for context-menu access.'],
  ['Download wipes from KDE Store', 'no', 'No KDE Store integration.', 'yes', 'Download New Wipes.'],
  ['Load custom luma wipe file', 'no', 'No arbitrary luma-file import.', 'yes', 'Select local luma file.'],
  ['Generate custom wipe previews with Python', 'no', 'No equivalent.', 'setup', 'Available when Python is installed.'],
  ['Reviewed-composition filter', 'no', 'No upstream-reviewed/test-phase filter.', 'yes', 'Compositions widget filter.'],
  ['10-bit-compatible composition filter', 'no', 'No 10-bit pipeline.', 'yes', 'Show 10-bit compatible only.'],
  ['Clip crop', 'yes', 'Top/right/bottom/left crop controls.', 'yes', 'Crop, Scale and Tilt / Edge Crop effects.'],
  ['Chroma key', 'yes', 'Deterministic keyed color with similarity/edge controls.', 'yes', 'Basic and advanced Chroma Key effects.'],
  ['Chroma-key spill suppression', 'no', 'No spill suppression or matte cleanup controls.', 'yes', 'Advanced keying and despill effects are available.'],
  ['Garbage matte', 'partial', 'One rectangle or ellipse mask can bound the key.', 'yes', 'Rotoscoping/alpha-mask effects support arbitrary mattes.'],
  ['Rectangle mask', 'yes', 'One persisted rectangle mask per qualified clip workflow.', 'yes', 'Alpha Shapes and mask effects.'],
  ['Ellipse mask', 'yes', 'One persisted ellipse mask per qualified clip workflow.', 'yes', 'Alpha Shapes and mask effects.'],
  ['Polygon / freehand mask', 'no', 'No qualified polygon or freehand video mask.', 'yes', 'Rotoscoping and shape masks.'],
  ['Mask feather', 'yes', 'Bounded feather percentage.', 'yes', 'Mask feather controls.'],
  ['Invert mask', 'yes', 'Persisted inverted state.', 'yes', 'Mask operation/invert controls.'],
  ['Tracked mask', 'partial', 'One rectangle/ellipse tracked-mask artifact can be applied.', 'yes', 'Masking and motion-tracking workflow.'],
  ['Planar / perspective tracking', 'no', 'No qualified planar tracker.', 'partial', 'Motion tracker provides region tracking; not a full planar compositor.'],
  ['Video stabilization', 'yes', 'Persisted stabilization artifact is consumed by native render.', 'yes', 'Stabilize clip job/effects.'],
  ['360-degree stabilization and transforms', 'no', 'No dedicated 360 workflow.', 'yes', 'Bigsh0t 360 effects are listed when packaged.'],
  ['Horizontal / vertical flip', 'yes', 'Clip flip controls.', 'yes', 'Flippo/Flip effects.'],
  ['Stroke around clip / keyed edge', 'yes', 'Color, width, and opacity stroke.', 'partial', 'Achievable with alpha/mask/stylize effects; no identical universal clip-stroke control.'],
], ['sloomManual', 'sloomQualified', 'kdenliveManual']);

const sloomBlendModes = new Set(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color dodge', 'color burn', 'hard light', 'soft light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']);
const kdenliveBlendModes = [
  ['Normal / source-over', 'normal'], ['Addition / addition alpha', 'addition'], ['Burn / Color Burn', 'color burn'],
  ['Color Only', 'color'], ['Darken', 'darken'], ['Difference', 'difference'], ['Divide', 'divide'],
  ['Dodge / Color Dodge', 'color dodge'], ['Grain Extract', 'grain extract'], ['Grain Merge', 'grain merge'],
  ['Hardlight', 'hard light'], ['Hue', 'hue'], ['Lighten', 'lighten'], ['Multiply', 'multiply'],
  ['Overlay', 'overlay'], ['Saturation', 'saturation'], ['Screen', 'screen'], ['Softlight', 'soft light'],
  ['Subtract', 'subtract'],
];
for (const [label, normalized] of kdenliveBlendModes) {
  const sloomHas = sloomBlendModes.has(normalized);
  add('Blend modes · individual', label, sloomHas ? 'yes' : 'no', sloomHas ? `Sloom blend mode: ${normalized}.` : 'No exact Sloom blend mode.', 'yes', 'Listed Kdenlive composition/Cairo Blend mode.', ['sloomSource', 'kdenliveManual']);
}
for (const mode of ['exclusion', 'luminosity']) {
  add('Blend modes · individual', mode[0].toUpperCase() + mode.slice(1), 'yes', `Sloom blend mode: ${mode}.`, 'no', 'Not listed as an individual Kdenlive composition blend in the 26.04 composition table.', ['sloomSource', 'kdenliveManual']);
}
for (const [label, note] of [
  ['Default alpha composite', 'Normal alpha-aware source-over.'],
  ['Alpha ATOP', 'Base is drawn atop the blend where both are non-transparent.'],
  ['Alpha IN', 'Keep base where both layers are non-transparent.'],
  ['Alpha OUT', 'Alpha-out operation.'],
  ['Alpha OVER', 'Alpha-over operation.'],
  ['Alpha XOR', 'Keep pixels present in only one layer.'],
]) {
  const basic = label === 'Default alpha composite' || label === 'Alpha OVER';
  add('Alpha composition operations · individual', label, basic ? 'yes' : 'no', basic ? 'Covered by normal alpha compositing.' : 'No separately selectable Porter-Duff operation.', 'yes', note, ['sloomSource', 'kdenliveManual']);
}

addMany('Titles, graphics, comics & captions', [
  ['Built-in title/text objects', 'yes', 'Stage text objects render in preview and delivery.', 'yes', 'Title Editor creates title clips.'],
  ['Multiple text objects in one title', 'yes', 'Multiple stage objects per composition.', 'yes', 'Multiple title objects.'],
  ['Font family selection', 'yes', 'Local font family names and managed text state.', 'yes', 'Installed fonts.'],
  ['Font size', 'yes', 'Exact text size.', 'yes', 'Title text size.'],
  ['Font weight / bold', 'yes', 'Weight controls.', 'yes', 'Bold and font-weight selection.'],
  ['Italic', 'yes', 'Italic style.', 'yes', 'Italic style.'],
  ['Underline', 'no', 'No qualified underline control in the current Video text model.', 'yes', 'Underline.'],
  ['Text color / fill', 'yes', 'Fill color and opacity.', 'yes', 'Text color and gradient.'],
  ['Text outline / stroke', 'yes', 'Stroke color, width, and opacity.', 'yes', 'Outline width and color.'],
  ['Text shadow', 'yes', 'Shadow controls.', 'yes', 'Shadow parameters.'],
  ['Text alignment', 'yes', 'Left, center, and right alignment.', 'yes', 'Horizontal alignment.'],
  ['Justified text', 'yes', 'Justify is a selectable paragraph alignment.', 'no', 'The documented Title Editor alignment controls do not list full justification.'],
  ['Vertical text alignment', 'partial', 'Text-box placement supports vertical positioning; no full titler parity claim.', 'yes', 'Vertical alignment tools.'],
  ['Character tracking / letter spacing', 'yes', 'Tracking control.', 'yes', 'Letter spacing.'],
  ['Line height / line spacing', 'yes', 'Independent line-height control is persisted per text object.', 'yes', 'Line spacing.'],
  ['Kerning mode', 'yes', 'Auto, normal, and none kerning modes are selectable.', 'partial', 'Font shaping and letter spacing are available, without the same explicit three-mode control.'],
  ['Arc text', 'yes', 'Text can be laid out on a configurable arc.', 'no', 'No dedicated arc-text control is documented.'],
  ['Glow text effect', 'yes', 'Glow is a selectable text effect.', 'partial', 'A glow look can be built with effects, but is not the same dedicated text toggle.'],
  ['Text background', 'yes', 'Shapes/panels can serve as backgrounds.', 'yes', 'Per-object background color.'],
  ['Gradient text / fill', 'no', 'No qualified Video gradient-fill control.', 'yes', 'Title gradients.'],
  ['Typewriter title animation', 'partial', 'Text animation presets exist; no exact typewriter control is qualified.', 'setup', 'Typewriter effect is package/OS dependent in the manual list.'],
  ['Scrolling / crawling title', 'partial', 'Position animation can scroll text; no dedicated crawl generator.', 'yes', 'Scrolling Title workflow.'],
  ['Title animation via keyframes', 'yes', 'Position, scale, rotation, and opacity keyframes.', 'yes', 'Title clip effects/keyframes.'],
  ['Title rectangle', 'yes', 'Rectangle shape object.', 'yes', 'Rectangle object.'],
  ['Title ellipse', 'no', 'The current Video stage shape model supports rectangles, not ellipses.', 'yes', 'Ellipse object.'],
  ['Title polygon', 'no', 'No polygon stage shape.', 'no', 'Titler documents rectangles and ellipses; polygon requires another asset/tool.'],
  ['Title line', 'no', 'No dedicated line stage object.', 'partial', 'Can be built as a thin shape; no separate documented line tool.'],
  ['Insert raster image into title', 'yes', 'Image stage/source objects.', 'yes', 'Add Image to title.'],
  ['Insert SVG into title', 'partial', 'SVG can enter through broader asset paths; no dedicated Video title SVG control claim.', 'yes', 'Add image/SVG in Title Editor.'],
  ['Title templates', 'yes', 'Starter compositions and reusable object state.', 'yes', 'Template titles and title templates.'],
  ['Save / load title file', 'partial', 'Saved in Sloom project/composition rather than a Kdenlive .kdenlivetitle file.', 'yes', 'Open and save title files.'],
  ['Title object alignment / distribution', 'yes', 'Stage selection alignment and guides.', 'yes', 'Align/distribute title objects.'],
  ['Title grid and guides', 'yes', 'Stage guides and snapping.', 'yes', 'Title workspace grid/guides.'],
  ['Title layer ordering', 'yes', 'Object z-order.', 'yes', 'Raise/lower objects.'],
  ['Unicode text', 'yes', 'Browser/native Unicode text.', 'yes', 'Unicode text supported by installed fonts.'],
  ['Comic panel objects', 'partial', 'Rectangle objects can construct panels, but there is no dedicated panel object.', 'no', 'Can be constructed manually but has no dedicated comic-panel object.'],
  ['Speech bubbles', 'yes', 'Bubble objects with editable body and tail.', 'no', 'No dedicated speech-bubble object.'],
  ['Thought bubbles', 'yes', 'Dedicated thought-bubble stage objects.', 'no', 'No dedicated thought-bubble object.'],
  ['Speech-bubble tail editing', 'yes', 'Tail anchor/shape editing on stage.', 'no', 'No dedicated bubble-tail tool.'],
  ['Comic sound-effect lettering', 'partial', 'Styled and arced text can construct SFX lettering, but there is no dedicated SFX object.', 'partial', 'Use standard titles and effects manually.'],
  ['Caption track', 'yes', 'Timed caption cues and tracks.', 'yes', 'Subtitle tracks.'],
  ['Multiple caption / subtitle tracks', 'yes', 'Multiple language/service tracks persist.', 'yes', 'Multiple subtitle tracks.'],
  ['Caption cue editor', 'yes', 'Edit text, start, end, language, and service.', 'yes', 'Subtitle editing tools.'],
  ['Caption timing on timeline', 'yes', 'Cue ranges align with sequence time.', 'yes', 'Subtitle clips in subtitle track.'],
  ['Import SRT', 'yes', 'Supported caption import.', 'yes', 'Subtitle import.'],
  ['Import WebVTT', 'yes', 'Supported caption import.', 'yes', 'Subtitle import.'],
  ['Import TTML', 'yes', 'Supported caption import.', 'partial', 'Current support depends on subtitle conversion/import path.'],
  ['Import ASS / SSA', 'no', 'No qualified ASS/SSA importer.', 'yes', 'ASS/SSA subtitle support.'],
  ['Export SRT', 'yes', 'Sidecar export.', 'yes', 'Subtitle export.'],
  ['Export WebVTT', 'yes', 'Sidecar export.', 'yes', 'Subtitle export/conversion path.'],
  ['Export TTML', 'yes', 'Sidecar export.', 'partial', 'Depends on available subtitle/export tooling.'],
  ['Styled subtitle export', 'no', 'Plain-text cue interchange and plain mov_text embedding.', 'yes', 'ASS styling and subtitle style tools.'],
  ['Burn captions into video', 'yes', 'Caption stage rendering can burn text.', 'yes', 'Default render behavior can burn subtitles.'],
  ['Embed captions in container', 'partial', 'Plain mov_text in Native CPU MP4/MOV.', 'yes', 'Embed subtitles where the selected container supports them.'],
  ['CEA-608 / CEA-708 captions', 'no', 'No qualified broadcast closed-caption encoding.', 'no', 'Not documented as a built-in Kdenlive caption-authoring format.'],
  ['SCC caption interchange', 'no', 'No SCC.', 'partial', 'May be possible through backend tools, but is not a universal documented editor feature.'],
  ['Automatic speech transcription inside Video', 'no', 'Transcript edits apply, but Video does not itself transcribe without a connected provider workflow.', 'yes', 'Speech recognition can use Vosk/Whisper depending on setup.'],
  ['Transcript-based text editing', 'yes', 'Delete/restore transcript ranges and apply edits to the timeline.', 'yes', 'Speech Editor supports text-based editing workflows.'],
  ['Speaker-labelled transcript', 'yes', 'Timed words and speaker IDs can be ingested from connected transcription.', 'partial', 'Speech engines and model output determine speaker support.'],
], ['sloomManual', 'sloomQualified', 'kdenliveManual']);

addMany('Color correction & scopes', [
  ['Brightness / exposure control', 'yes', 'Brightness filter and qualified exposure control.', 'yes', 'Brightness, Exposure, Lift/Gamma/Gain, and related effects.'],
  ['Contrast control', 'yes', 'Contrast filter and primary correction.', 'yes', 'Multiple contrast effects.'],
  ['Saturation control', 'yes', 'Saturation filter and primary correction.', 'yes', 'Saturation and color effects.'],
  ['Hue rotation', 'yes', 'Hue-rotate filter.', 'yes', 'Hue Shift and hue/saturation effects.'],
  ['Temperature control', 'no', 'No qualified temperature slider.', 'yes', 'White-balance and temperature effects.'],
  ['Tint control', 'no', 'No qualified tint slider.', 'yes', 'White-balance and color-channel effects.'],
  ['Lift / gamma / gain wheels', 'no', 'No lift/gamma/gain controls.', 'yes', 'Lift/Gamma/Gain effect.'],
  ['RGB curves', 'no', 'No curve editor for color.', 'yes', 'Bezier Curves and Curves effects.'],
  ['Levels', 'no', 'No qualified levels effect.', 'yes', 'Levels effects.'],
  ['White-balance eyedropper', 'no', 'No qualified white-balance sampler.', 'yes', 'White Balance effects.'],
  ['3D LUT import / application', 'no', 'Current runtime does not implement LUT application despite older descriptive copy.', 'yes', 'Apply LUT supports documented LUT formats.'],
  ['Secondary color qualifiers', 'no', 'No HSL qualifier workflow.', 'partial', 'Keying and channel effects can isolate colors; not a full grading-suite qualifier.'],
  ['HDR grading workflow', 'no', 'No qualified HDR/10-bit grading pipeline.', 'partial', '10-bit render profiles exist, but effects support has documented limitations.'],
  ['10-bit processing pipeline', 'no', 'No 10-bit pipeline claim.', 'partial', '10-bit project/render options; effect compatibility varies.'],
  ['Color management / color-space conversion', 'partial', 'Native/browser conversions are bounded by render backend; no full UI color-management claim.', 'yes', 'Project color settings and FFmpeg/MLT color-space effects.'],
  ['Histogram scope', 'yes', 'Decoded-frame histogram on demand.', 'yes', 'Histogram scope/effect.'],
  ['Luma waveform scope', 'yes', 'Decoded-frame waveform on demand.', 'yes', 'Waveform monitor.'],
  ['RGB parade', 'yes', 'Decoded-frame RGB parade on demand.', 'yes', 'RGB Parade.'],
  ['Vectorscope', 'yes', 'Decoded-frame vectorscope on demand.', 'yes', 'Vectorscope.'],
  ['Real-time continuous scopes', 'partial', 'Scopes analyze requested decoded frames rather than a guaranteed continuous live feed.', 'yes', 'Dockable scopes update with monitor frames.'],
  ['Scope source-frame navigation', 'yes', 'Findings navigate to their source and sampled time.', 'yes', 'Scopes follow the selected monitor/playhead.'],
  ['Blur', 'yes', 'Generic bounded blur filter.', 'yes', 'Multiple blur effects.'],
  ['Sharpen', 'no', 'No qualified runtime sharpen filter.', 'yes', 'Multiple sharpen effects.'],
  ['Grayscale', 'yes', 'Grayscale filter and monochrome preset.', 'yes', 'B/W and grayscale effects.'],
  ['Sepia', 'yes', 'Sepia filter.', 'yes', 'Sepia and colorization effects.'],
  ['Invert / negative', 'yes', 'Invert filter.', 'yes', 'Invert/Negate effects.'],
], ['sloomQualified', 'sloomSource', 'kdenliveEffects']);

for (const [filter, kdenliveNote] of [
  ['Brightness', 'Corresponding brightness effects are available.'],
  ['Contrast', 'Corresponding contrast effects are available.'],
  ['Saturation', 'Corresponding saturation effects are available.'],
  ['Blur', 'Multiple corresponding blur effects are available.'],
  ['Grayscale', 'Corresponding black-and-white and grayscale effects are available.'],
  ['Sepia', 'Corresponding sepia effects are available.'],
  ['Invert', 'Corresponding invert and negate effects are available.'],
  ['Hue Rotate', 'Corresponding hue-shift effects are available.'],
]) {
  add('Sloom clip filters · individual', filter, 'yes', `Exact selectable Sloom filter: ${filter}.`, 'yes', kdenliveNote, ['sloomSource', 'kdenliveEffects']);
}

for (const preset of [
  'Neutral / Reset',
  'Balanced Correction',
  'Documentary Warmth',
  'Cinematic Contrast',
  'Monochrome',
  'Green Screen Key',
  'Blue Screen Key',
]) {
  add('Sloom clip effect presets · individual', preset, 'yes', `Exact named Sloom clip preset: ${preset}.`, 'partial', 'Kdenlive can reproduce and save this treatment as a custom effect stack, but does not document the same built-in named preset.', ['sloomSource', 'kdenliveEffects']);
}

for (const [transition, note] of [
  ['None', 'No transition.'],
  ['Fade', 'Fade/cross-dissolve behavior.'],
  ['Slide Left', 'Leftward slide.'],
  ['Slide Right', 'Rightward slide.'],
  ['Slide Up', 'Upward slide.'],
  ['Slide Down', 'Downward slide.'],
]) {
  add('Sloom clip transitions · individual', transition, 'yes', `Exact selectable Sloom transition: ${transition}.`, 'yes', `Kdenlive supports the corresponding option: ${note}`, ['sloomSource', 'kdenliveManual']);
}

addMany('Audio editing, mixing & processing', [
  ['Clip audio waveform', 'yes', 'Timeline and source waveforms.', 'yes', 'Audio thumbnails/waveforms.'],
  ['Embedded video-audio waveform', 'yes', 'Bounded embedded waveform decoding.', 'yes', 'Show audio thumbnails for A/V clips.'],
  ['Clip volume / gain', 'yes', 'Static clip gain and volume automation.', 'yes', 'Volume effects and clip gain.'],
  ['Track volume', 'yes', '64-track bounded mixer volume.', 'yes', 'Mixer track fader.'],
  ['Master volume', 'yes', 'One main-bus gain control.', 'yes', 'Master mixer channel.'],
  ['Clip pan', 'yes', 'Bounded stereo pan.', 'yes', 'Pan effects.'],
  ['Track pan', 'yes', 'Bounded track pan.', 'yes', 'Mixer/effect pan.'],
  ['Master pan', 'yes', 'One main-bus pan control.', 'partial', 'Master-channel processing can pan through effects.'],
  ['Mute clip', 'yes', 'Clip enabled/audio state.', 'yes', 'Disable audio / volume effect.'],
  ['Mute track', 'yes', 'Track mute.', 'yes', 'Mixer/track mute.'],
  ['Solo track', 'yes', 'Track solo.', 'yes', 'Mixer/track solo.'],
  ['Audio-volume keyframes', 'yes', 'Clip/track volume keyframes.', 'yes', 'Keyframable volume effects.'],
  ['Audio-pan keyframes', 'yes', 'Pan keyframes.', 'yes', 'Keyframable pan effects.'],
  ['Audio fade in', 'yes', 'Clip fade handles/transition.', 'yes', 'Fade In effect.'],
  ['Audio fade out', 'yes', 'Clip fade handles/transition.', 'yes', 'Fade Out effect.'],
  ['Equal-power audio crossfade', 'yes', 'Deterministic equal-power curve.', 'yes', 'Mix/audio crossfade workflow.'],
  ['Normalize audio', 'yes', 'Offline loudness normalization and level matching.', 'yes', 'Normalize effects.'],
  ['Two-pass EBU loudness normalization', 'yes', 'Native two-pass loudnorm delivery.', 'yes', 'Loudness normalization effects/render tooling.'],
  ['True-peak limiting during normalization', 'yes', 'Qualified native true-peak target.', 'yes', 'Loudness/limiter effects expose relevant controls.'],
  ['Automatic dialogue ducking', 'yes', 'Native render ducks background tracks from dialogue activity.', 'partial', 'Can be built with keyframes/sidechain-capable plug-ins; no identical one-click documented workflow.'],
  ['High-pass filter', 'yes', 'Dialogue processor.', 'yes', 'High-pass filters.'],
  ['Low-pass filter', 'yes', 'Dialogue processor.', 'yes', 'Low-pass filters.'],
  ['Noise gate', 'yes', 'Dialogue gate.', 'yes', 'Gate/expander plug-ins.'],
  ['Compressor', 'yes', 'Dialogue compressor.', 'yes', 'Compressor plug-ins.'],
  ['Limiter', 'yes', 'Dialogue limiter.', 'yes', 'Limiter plug-ins.'],
  ['Dialogue processor bypass', 'yes', 'Per-chain bypass.', 'yes', 'Individual effects can be disabled.'],
  ['Dialogue Original / Clean level match', 'yes', 'Level-matched before/after comparison.', 'partial', 'Effect bypass and gain matching can be used manually.'],
  ['Parametric equalizer', 'no', 'Only bounded high/low-pass dialogue filters are qualified.', 'yes', 'Equalizer and filter plug-ins.'],
  ['Graphic equalizer', 'no', 'No qualified graphic EQ.', 'yes', 'Multiple equalizer plug-ins.'],
  ['Noise reduction', 'no', 'No qualified general denoiser in Video.', 'yes', 'Wavelet, FFT, neural, and other denoisers depending on package.'],
  ['Reverb', 'no', 'No qualified reverb.', 'setup', 'Multiple LADSPA/audio effects; package availability varies.'],
  ['Delay / echo', 'no', 'No qualified delay/echo.', 'setup', 'Multiple packaged delay/echo plug-ins.'],
  ['Pitch shift', 'no', 'No qualified pitch-shift effect.', 'setup', 'Pitch effects and LADSPA plug-ins.'],
  ['Audio spectrum / spectrogram', 'no', 'No dedicated spectrum analysis panel.', 'yes', 'Audio Spectrum and Spectrogram widgets/effects.'],
  ['Peak meters', 'partial', 'Bounded main/track meter presentation.', 'yes', 'Per-track and master meters.'],
  ['Loudness meter', 'partial', 'Delivery analysis reports loudness/true-peak; no continuous mastering meter claim.', 'yes', 'Loudness analysis/effects are available.'],
  ['Track effect stack', 'partial', 'Dialogue/volume state applies to tracks and clips within bounded mixer behavior.', 'yes', 'Audio effects on clips, tracks, and master.'],
  ['Audio sends / returns', 'no', 'Explicitly not supported.', 'no', 'Kdenlive mixer is not documented as a sends/returns DAW mixer.'],
  ['Submix buses', 'no', 'One main bus only.', 'partial', 'Master plus tracks; not a full DAW submix architecture.'],
  ['Surround-sound mixing', 'no', 'No surround bus or panner.', 'partial', 'Surround export can be constructed with channel mapping; workflow is advanced.'],
  ['Multichannel audio mapping', 'no', 'No qualified channel-map editor.', 'yes', 'Audio channel selection/routing and separate tracks.'],
  ['Separate rendered file per audio track', 'no', 'No dedicated per-track file option.', 'yes', 'Render-dialog option.'],
  ['Voice-over recording to timeline', 'yes', 'Narration recording.', 'yes', 'Audio capture on timeline.'],
  ['Audio capture countdown / controls', 'partial', 'Narration capture controls are bounded.', 'yes', 'Configurable audio-capture workflow; improved in 26.04.'],
  ['Automatic audio sync to reference', 'no', 'No waveform auto-align.', 'yes', 'Set Audio Reference / Align Audio to Reference.'],
  ['Extract audio from video', 'yes', 'Split/detach embedded audio.', 'yes', 'Split Audio.'],
], ['sloomManual', 'sloomQualified', 'kdenliveManual']);

addMany('Generative AI & connected-media workflows', [
  ['Visual node graph', 'yes', 'Flow composes provider, media, logic, and editor nodes.', 'no', 'No generative node graph.'],
  ['Text-to-video generation', 'yes', 'Provider-backed video nodes.', 'no', 'No built-in generative video provider.'],
  ['Image-to-video generation', 'yes', 'Source images can drive capable video models.', 'no', 'No built-in generative video provider.'],
  ['Reference-image video generation', 'yes', 'Capability-gated reference image inputs.', 'no', 'No equivalent.'],
  ['Video-to-video / video editing model calls', 'yes', 'Capability-gated provider operations.', 'no', 'No equivalent.'],
  ['Prompt field', 'yes', 'Text prompts are stored with node runs.', 'no', 'No generative prompt system.'],
  ['Negative prompt', 'yes', 'Shown only for models that support it.', 'no', 'No generative prompt system.'],
  ['Generation seed', 'yes', 'Capability-gated deterministic seed field.', 'no', 'No generative prompt system.'],
  ['Generation duration control', 'yes', 'Model capability determines available seconds/frames.', 'no', 'No generative prompt system.'],
  ['Generation resolution control', 'yes', 'Capability-gated model resolution.', 'no', 'No generative prompt system.'],
  ['Generation aspect-ratio control', 'yes', 'Capability-gated aspect presets.', 'no', 'No generative prompt system.'],
  ['Generated-audio toggle for video models', 'yes', 'Shown for capable provider models.', 'no', 'No generative prompt system.'],
  ['Multiple cloud provider routes', 'yes', 'Direct providers and gateway routes can coexist.', 'no', 'No generative provider layer.'],
  ['Local model route', 'yes', 'Local/open model adapters can participate in Flow.', 'no', 'No generative provider layer.'],
  ['Provider capability discovery', 'yes', 'Model operations and controls are capability-gated.', 'no', 'No generative provider layer.'],
  ['API keys stored locally', 'yes', 'Credentials remain in local browser/desktop storage.', 'na', 'No equivalent generative provider credentials.'],
  ['Generation cancellation', 'yes', 'In-flight media generation can be cancelled.', 'na', 'No equivalent generative job.'],
  ['Generation result cache', 'yes', 'Bounded result/cache reuse.', 'na', 'No equivalent generative job.'],
  ['Generation attempt history', 'yes', 'Node attempts and outputs can be reviewed/reused.', 'na', 'No equivalent generative job.'],
  ['Generated result drag to Video', 'yes', 'Flow outputs become Source Bin/timeline assets.', 'no', 'No sibling generator workspace.'],
  ['Generated result drag to Image / Paper', 'yes', 'Cross-workspace source system.', 'no', 'No sibling Sloom workspaces.'],
  ['Reusable workflow templates', 'yes', 'Standard Flow library and starter graphs.', 'partial', 'Project templates exist, but not generative node templates.'],
  ['Timed ElevenLabs text-to-speech', 'yes', 'Generate dialogue audio into selected sequence/range.', 'no', 'No integrated ElevenLabs TTS.'],
  ['Timed ElevenLabs sound effects', 'yes', 'Generate SFX into selected sequence/range.', 'no', 'No integrated ElevenLabs SFX.'],
  ['Connected speech-to-text', 'yes', 'Flow/provider transcription can create timed transcript data for Video.', 'setup', 'Whisper/Vosk speech recognition requires models and setup.'],
  ['Online stock resources', 'no', 'Generation/provider routes are not a stock catalogue.', 'yes', 'Online Resources for stock media providers.'],
], ['sloomSource', 'sloomQualified', 'kdenliveManual']);

addMany('Review, collaboration, control & interchange', [
  ['Local review snapshots', 'yes', 'Review/approval artifacts remain tied to local project state.', 'partial', 'Project notes/guides and renders can support review, without the same artifact model.'],
  ['Approval state', 'yes', 'Local review can record approval status.', 'no', 'No built-in approval-state workflow.'],
  ['Immutable delivery job snapshot', 'yes', 'Queued delivery captures settings so later edits do not mutate it.', 'yes', 'Submitted render jobs keep their submitted settings.'],
  ['Delivery target bundle', 'yes', 'One job can coordinate review video, captions, and QC outputs.', 'partial', 'Batch render scripts and marker multi-export; no same named multi-artifact bundle.'],
  ['LAN collaboration', 'partial', 'Bounded self-hosted LAN session with explicit write baton/read-only clients.', 'no', 'No built-in collaborative editing server.'],
  ['Self-hosted sync', 'partial', 'Local/self-hosted sync contracts; not a cloud SaaS collaboration suite.', 'no', 'No built-in project sync server.'],
  ['Team review server', 'partial', 'Bounded team-review surface in qualified feature line.', 'no', 'No built-in review server.'],
  ['Comments anchored to time', 'partial', 'Review findings/markers can navigate to time; no universal threaded-comment claim.', 'partial', 'Guides and Project Notes can carry comments/time links.'],
  ['External jog/shuttle control contract', 'setup', 'Play, pause, jog, and shuttle adapter API; no bundled hardware adapter.', 'yes', 'Jog/Shuttle device configuration.'],
  ['Gamepad control', 'partial', 'Global gamepad mappings are available on supported hosts.', 'setup', 'Can be mapped through configurable input/shortcuts; no universal bundled gamepad profile claim.'],
  ['Custom keyboard shortcuts', 'yes', 'Command registry supports remapping.', 'yes', 'Configure Keyboard Shortcuts.'],
  ['Download keyboard schemes', 'no', 'No KDE Store scheme browser.', 'yes', 'Keyboard schemes can be downloaded from KDE Store.'],
  ['FCP 7 XML import / export', 'yes', 'Bounded FCP7 XML interchange.', 'partial', 'Interchange support is centered on MLT/OTIO; FCP XML availability may depend on conversion tools/version.'],
  ['CMX 3600 EDL import / export', 'yes', 'Bounded CMX sequence exchange.', 'partial', 'EDL workflows may require external conversion; not a current universal manual promise.'],
  ['OpenTimelineIO import', 'no', 'No qualified OTIO importer.', 'yes', 'OTIO import.'],
  ['OpenTimelineIO export', 'no', 'No qualified OTIO exporter.', 'yes', 'OTIO export.'],
  ['MLT playlist / project interchange', 'no', 'No MLT project format.', 'yes', '.kdenlive files are MLT XML-based and render scripts use .mlt.'],
  ['AAF binary interchange', 'no', 'Exports Sloom AAF JSON, not a binary AAF file.', 'no', 'No native AAF binary interchange is documented.'],
  ['Sloom AAF JSON handoff', 'yes', 'Deterministic JSON representation with media/timeline metadata.', 'no', 'No Sloom-specific handoff.'],
  ['Subtitle sidecar interchange', 'yes', 'SRT, WebVTT, and TTML.', 'yes', 'Multiple subtitle formats.'],
  ['Project archive interchange', 'yes', 'Project/package and consolidated-media paths.', 'yes', 'Archive Project.'],
  ['Provider-pack SDK', 'partial', 'Bounded provider-pack contract rather than arbitrary in-process editor plug-ins.', 'no', 'Uses MLT/Frei0r/LADSPA ecosystem instead.'],
  ['Third-party video/audio effect plug-ins', 'no', 'No general LADSPA/Frei0r/VST plug-in host.', 'setup', 'MLT, Frei0r, FFmpeg, and LADSPA availability depends on package/OS.'],
], ['sloomQualified', 'sloomSource', 'kdenliveManual']);

addMany('Rendering, export & delivery controls', [
  ['Render full sequence / project', 'yes', 'Export the active sequence.', 'yes', 'Full Project.'],
  ['Render selected In/Out zone', 'yes', 'Range export.', 'yes', 'Selected Zone.'],
  ['Render marker-defined zone', 'yes', 'Range/marker delivery targets.', 'yes', 'Marker Zone.'],
  ['Multi-export marker sections', 'partial', 'Delivery bundles and range outputs exist; no exact all-marker automatic splitter claim.', 'yes', 'Markers Multi-Export.'],
  ['Output file picker', 'yes', 'Native destination selection.', 'yes', 'Output file field.'],
  ['Built-in export presets', 'yes', 'Named delivery presets plus target/back-end validation.', 'yes', 'Grouped render preset catalogue.'],
  ['Create custom render preset', 'partial', 'Delivery targets can persist preset IDs/settings; no free-form FFmpeg preset editor.', 'yes', 'Create New Preset.'],
  ['Save current preset as new', 'partial', 'Duplicate delivery targets/preset configuration.', 'yes', 'Save Current Preset as New Custom Preset.'],
  ['Edit custom render preset', 'partial', 'Bounded target controls rather than raw profile editing.', 'yes', 'Edit custom/downloaded preset.'],
  ['Delete custom render preset', 'partial', 'Delivery targets can be removed.', 'yes', 'Delete custom/downloaded preset.'],
  ['Download render presets from store', 'no', 'No community preset store.', 'yes', 'Download New Render Presets.'],
  ['Render queue', 'yes', 'Restart-persistent queue.', 'yes', 'Job Queue.'],
  ['Queue multiple jobs', 'yes', 'Multiple immutable jobs.', 'yes', 'Multiple queued render jobs and scripts.'],
  ['Resume interrupted render job', 'yes', 'Explicit restart-persistent resume contract.', 'partial', 'Jobs/scripts can be rerun; chunk-level resume is not universally promised.'],
  ['Cancel render job', 'yes', 'Queued/running job cancellation.', 'yes', 'Stop/cancel render.'],
  ['Continue editing during render', 'yes', 'Editing stays available while native render runs.', 'yes', 'Non-blocking render workflow.'],
  ['Generate render script', 'no', 'Queue persists structured jobs, not shell/MLT scripts.', 'yes', 'Generate Script.'],
  ['Batch render scripts', 'no', 'Use Sloom queue instead.', 'yes', 'Scripts tab and Job Queue.'],
  ['Command-line render', 'partial', 'Narrow native service/CLI contract, not a broad public editor CLI.', 'yes', 'Run melt with generated .mlt script.'],
  ['Shutdown computer after render', 'no', 'No qualified shutdown option.', 'yes', 'Job Queue checkbox.'],
  ['Render video toggle', 'yes', 'Video/audio target selection is preset-driven.', 'yes', 'Video checkbox.'],
  ['Render audio toggle', 'yes', 'Preset/target controls include audio policy.', 'yes', 'Audio checkbox.'],
  ['Render at preview resolution', 'partial', 'Preview and delivery resolutions are separately selectable through presets.', 'yes', 'Render at Preview Resolution.'],
  ['Use proxy clips for final render', 'partial', 'Proxy/transcode state exists; final native delivery normally uses source media.', 'yes', 'Use Proxy Clips option.'],
  ['Rescale output', 'yes', 'Preset resolution and direct native GPU scaling.', 'yes', 'Rescale option.'],
  ['Output aspect-ratio crop', 'yes', 'Social/aspect presets and crop/fit controls.', 'yes', 'Aspect Ratio option crops during render.'],
  ['Scaling interpolation: nearest', 'partial', 'Backend chooses bounded scaling; no user-facing nearest selector.', 'yes', 'Nearest-neighbour option.'],
  ['Scaling interpolation: bilinear', 'partial', 'Browser/native backends use bilinear-like scaling where applicable; no exact selector.', 'yes', 'Bilinear option.'],
  ['Scaling interpolation: bicubic', 'no', 'No qualified explicit bicubic selector.', 'yes', 'Bicubic option.'],
  ['Scaling interpolation: Lanczos', 'no', 'No qualified explicit Lanczos selector.', 'yes', 'Lanczos option.'],
  ['Deinterlace: one field', 'no', 'No export deinterlacer selector.', 'yes', 'One-Field option.'],
  ['Deinterlace: linear blend', 'no', 'No export deinterlacer selector.', 'yes', 'Linear Blend option.'],
  ['Deinterlace: YADIF temporal', 'no', 'No export deinterlacer selector.', 'yes', 'YADIF temporal-only option.'],
  ['Deinterlace: YADIF', 'no', 'No export deinterlacer selector.', 'yes', 'YADIF option.'],
  ['Deinterlace: BWDIF', 'no', 'No export deinterlacer selector.', 'yes', 'BWDIF option.'],
  ['Render full color range / 10-bit', 'no', 'No qualified 10-bit/full-range export control.', 'partial', 'Option exists; documentation warns effects may not work with it.'],
  ['Render timecode/frame overlay', 'partial', 'QC/review deliverables carry timing metadata; no universal overlay toggle.', 'yes', 'Render Overlay.'],
  ['Separate file per audio track', 'no', 'No qualified option.', 'yes', 'Render-dialog audio option.'],
  ['Custom quality slider', 'partial', 'Preset-specific quality/bitrate policy; no universal slider.', 'yes', 'Custom Quality.'],
  ['Encoder speed control', 'partial', 'Backend/preset selects encoder; no general very-slow to ultra-fast slider.', 'yes', 'Encoder speed slider.'],
  ['Encoding thread count', 'partial', 'Native service manages execution; no universal user thread selector.', 'yes', 'Encoding Threads option for applicable codecs.'],
  ['Parallel rendering', 'partial', 'Native queues and GPU paths parallelize bounded work; no matching experimental segment toggle.', 'yes', 'Parallel Processing option.'],
  ['Two-pass encoding', 'partial', 'Two-pass loudness analysis exists; video two-pass is not universally exposed.', 'yes', '2 pass option for compatible codecs.'],
  ['Export project metadata into file', 'partial', 'Delivery manifests preserve metadata; container metadata coverage is preset-dependent.', 'yes', 'Export Metadata option.'],
  ['Embed subtitles instead of burn-in', 'partial', 'Plain mov_text in Native CPU MP4/MOV.', 'yes', 'Container-dependent subtitle stream.'],
  ['Open output folder after export', 'yes', 'Native host reveals delivery destination.', 'yes', 'Open Folder After Export.'],
  ['Play file after render', 'yes', 'Rendered preview opens in Program monitor or native destination.', 'yes', 'Play After Render.'],
  ['Keep render log files', 'yes', 'Diagnostics and job logs persist.', 'yes', 'Keep Log Files.'],
  ['Add rendered file to source bin', 'yes', 'Delivery/rendered assets can be re-indexed.', 'yes', 'Add to Project Bin.'],
  ['Email rendered video', 'no', 'No direct system-share action.', 'setup', 'Desktop share service can send via email.'],
  ['Send rendered video to device', 'no', 'No direct system-share action.', 'setup', 'Desktop share service option.'],
  ['Send rendered video by Bluetooth', 'no', 'No direct system-share action.', 'setup', 'Desktop share service option.'],
  ['Upload rendered video to YouTube', 'no', 'No direct YouTube uploader.', 'setup', 'Share action; account/service integration required.'],
  ['Upload rendered video to Nextcloud', 'no', 'No direct Nextcloud uploader.', 'setup', 'Share action; account/service integration required.'],
  ['Send rendered video via Telegram', 'no', 'No direct Telegram desktop handoff.', 'setup', 'Share action opens Telegram when installed.'],
  ['Animated GIF export', 'yes', 'Animated GIF Preview preset.', 'yes', 'GIF presets.'],
  ['Image-sequence export', 'yes', 'PNG and JPEG image-sequence presets.', 'yes', 'Multiple image sequence presets.'],
  ['Web video export', 'yes', 'H.264, HEVC, WebM VP9/Opus, and GIF targets.', 'yes', 'H.264/H.265/VP8/VP9/AV1 presets depending on package.'],
  ['Alpha-channel video export', 'yes', 'WebM VP9 + Alpha preset with backend qualification.', 'yes', 'Alpha MOV/VP8/VP9/Ut Video presets.'],
  ['Professional mezzanine export', 'yes', 'ProRes 422 HQ MOV.', 'yes', 'ProRes, DNxHR, FFV1, Ut Video, and related presets.'],
  ['Broadcast MXF export', 'yes', 'MPEG-2 4:2:2 plus PCM in MXF through Native CPU.', 'partial', 'Backend/custom profiles can render MXF; exact presets depend on build.'],
  ['Hardware-accelerated encode', 'setup', 'VAAPI, NVENC, and QSV after a tiny capability probe.', 'setup', 'NVENC, VAAPI, and VideoToolbox experimental presets.'],
  ['CPU software encode', 'yes', 'Native CPU backend.', 'yes', 'MLT/FFmpeg software rendering.'],
  ['Browser render backend', 'yes', 'Bounded browser/WebGL path for suitable compositions.', 'no', 'Desktop MLT render path.'],
  ['WebGL render backend', 'yes', 'Stage compositor path for supported work.', 'no', 'Desktop/OpenGL monitor acceleration is not a browser renderer.'],
  ['Native long-form render', 'yes', 'Native CPU/GPU delivery path, qualified for at least 30-minute sequences.', 'yes', 'Native render path intended for long-form projects.'],
  ['Delivery QC report', 'yes', 'Sampled checks for black, frozen, silence, and clipping.', 'no', 'No equivalent built-in structural QC report.'],
  ['Loudness delivery report', 'yes', 'Offline loudness/true-peak results accompany qualified delivery.', 'partial', 'Effects/tools can analyze loudness; no same delivery-report bundle.'],
], ['sloomQualified', 'sloomSource', 'kdenliveRender']);

const renderPresets = [
  ['Audio only', 'AC3', 'no'], ['Audio only', 'ALAC', 'no'], ['Audio only', 'FLAC', 'no'], ['Audio only', 'MP3', 'no'], ['Audio only', 'OGG', 'no'], ['Audio only', 'WAV', 'no'],
  ['10 Bit', 'AV1 10-bit', 'no'], ['10 Bit', 'DNxHR-HQ', 'no'], ['10 Bit', 'ProRes 422 10-bit', 'partial'], ['10 Bit', 'ProRes 444', 'no'], ['10 Bit', 'ProRes HQ 10-bit', 'partial'], ['10 Bit', 'SVT-AV1', 'no'], ['10 Bit', 'x264 high10 (manual label reads x261-high10)', 'no'], ['10 Bit', 'x265 main10', 'no'],
  ['Video with Alpha', 'Alpha MOV', 'no'], ['Video with Alpha', 'Alpha VP8', 'no'], ['Video with Alpha', 'Alpha VP9', 'yes'], ['Video with Alpha', 'Ut Video alpha', 'no'],
  ['Image sequence', 'BMP sequence', 'no'], ['Image sequence', 'DPX sequence', 'no'], ['Image sequence', 'GIF sequence', 'partial'], ['Image sequence', 'JPEG sequence', 'yes'], ['Image sequence', 'PNG sequence', 'yes'], ['Image sequence', 'PPM sequence', 'no'], ['Image sequence', 'TGA sequence', 'no'], ['Image sequence', 'TIFF sequence', 'no'], ['Image sequence', 'WebP sequence', 'no'],
  ['Lossless / HQ', 'FFV1 + FLAC', 'no'], ['Lossless / HQ', 'H.264 + AAC high quality', 'yes'], ['Lossless / HQ', 'HuffYUV + FLAC', 'no'], ['Lossless / HQ', 'Ut Video + PCM 24-bit', 'no'],
  ['Generic', 'GIF High Quality', 'yes'], ['Generic', 'MP4 H.264 / AAC', 'yes'], ['Generic', 'MPEG-2', 'partial'], ['Generic', 'WebM VP8 / Vorbis', 'no'],
  ['Ultra-High Definition', 'MP4 H.265 / HEVC', 'yes'], ['Ultra-High Definition', 'WebM AV1 / Opus', 'no'], ['Ultra-High Definition', 'WebM VP9 / Opus', 'yes'],
  ['Old-TV / DVD', 'MPEG-4 ASP / MP3 (DivX compatible)', 'no'], ['Old-TV / DVD', 'VOB (DVD)', 'no'], ['Old-TV / DVD', 'Windows Media Player profile', 'no'],
  ['Hardware accelerated', 'NVENC AV1 variable rate', 'no'], ['Hardware accelerated', 'NVENC H.264 ABR', 'setup'], ['Hardware accelerated', 'NVENC H.264 VBR', 'setup'], ['Hardware accelerated', 'NVENC H.265 ABR', 'setup'], ['Hardware accelerated', 'NVENC H.265 ABR 10-bit', 'no'], ['Hardware accelerated', 'VAAPI AMD H.264', 'setup'], ['Hardware accelerated', 'VAAPI Intel H.264', 'setup'], ['Hardware accelerated', 'VideoToolbox H.264 ABR', 'no'], ['Hardware accelerated', 'VideoToolbox H.265 ABR', 'no'],
];
for (const [group, preset, sloomState] of renderPresets) {
  const noteByState = {
    yes: 'An equivalent named Sloom preset/target is available.',
    partial: 'Sloom covers part of this target, but not the exact Kdenlive profile or bit-depth promise.',
    setup: 'Available only after Sloom\'s native capability probe confirms the hardware path.',
    no: 'No equivalent named Sloom export preset.',
  };
  add(`Kdenlive render presets · ${group}`, preset, sloomState, noteByState[sloomState], group === 'Hardware accelerated' ? 'setup' : 'yes', group === 'Hardware accelerated' ? 'Official experimental preset; hardware, driver, and package dependent.' : 'Named in the official Kdenlive 26.04 rendering preset list.', ['sloomSource', 'kdenliveRender']);
}

for (const [preset, detail] of [
  ['Review H.264 1080p', 'H.264/AAC review target.'],
  ['Social Vertical H.264', 'Vertical H.264 social target.'],
  ['Archive High Quality', 'High-quality archive target.'],
  ['WebM VP9 + Opus', 'VP9/Opus web target.'],
  ['WebM VP9 + Alpha', 'Alpha-capable VP9 target.'],
  ['Animated GIF Preview', 'Short preview GIF.'],
  ['ProRes 422 HQ MOV', 'Professional mezzanine MOV.'],
  ['HEVC/H.265 MP4', 'H.265 MP4 delivery.'],
  ['HEVC/H.265 MOV', 'H.265 MOV delivery.'],
  ['Broadcast MXF handoff (Native CPU)', 'MPEG-2 4:2:2 + PCM MXF target.'],
  ['PNG Image Sequence', 'PNG frame sequence.'],
  ['JPEG Image Sequence', 'JPEG frame sequence.'],
]) {
  add('Sloom export presets · individual', preset, 'yes', detail, 'partial', 'Kdenlive can produce the same broad format through a built-in or custom preset; exact names/settings differ.', ['sloomSource', 'kdenliveRender']);
}

addMany('Reliability, diagnostics & performance', [
  ['Flow / project diagnostics panel', 'yes', 'Structured project/provider/render diagnostics.', 'yes', 'Status, log, job, and project-consistency feedback.'],
  ['Render readiness preflight', 'yes', 'Checks sources, backends, presets, timing, effects, and bounds before render.', 'partial', 'Render dialog validates profiles and missing components; no identical Sloom preflight report.'],
  ['Missing-media diagnostics', 'yes', 'Offline references are identified and relinked.', 'yes', 'Missing clips dialog and placeholders.'],
  ['Backend capability probe', 'yes', 'Tiny CPU/GPU encoder probe before selecting VAAPI/NVENC/QSV.', 'yes', 'Kdenlive setup and render profile support reflect installed MLT/FFmpeg capabilities.'],
  ['Effect/package capability discovery', 'no', 'Fixed qualified effects; no dynamic plug-in inventory.', 'yes', 'Auto-detects supported plug-ins.'],
  ['Crash report stored locally', 'yes', 'Local crash-report artifacts with explicit privacy boundary.', 'partial', 'Platform/KDE crash tooling varies by package.'],
  ['Autosave size budget', 'yes', 'Bounded payload/history size with explicit refusal.', 'partial', 'Autosave exists; no matching public fixed payload budget.'],
  ['Project validation before restore', 'yes', 'Malformed/oversized history entries are refused.', 'partial', 'Project parsing and backup recovery validate files.'],
  ['Large-project bounded operations', 'yes', 'Media probing, history, nested sequences, and QC have explicit ceilings.', 'partial', 'Native resource limits depend on the system.'],
  ['64-track execution', 'yes', 'Qualified hard ceiling.', 'yes', 'Supports at least this many; documented as virtually unlimited.'],
  ['30-minute long-form render qualification', 'yes', 'Native path explicitly qualifies at least 30 minutes.', 'yes', 'Designed for long-form editing; no equivalent fixed marketing threshold needed.'],
  ['GPU scaling for simple native video render', 'setup', 'Direct native GPU scaling/encode path when capability and composition constraints pass.', 'setup', 'GPU encode profiles and monitor acceleration depend on hardware/drivers.'],
  ['CPU fallback', 'yes', 'Native CPU delivery remains the portable path.', 'yes', 'Software MLT/FFmpeg render.'],
  ['Preview cache', 'yes', 'Rendered segments and readiness state.', 'yes', 'Timeline preview cache.'],
  ['Cache management', 'partial', 'Bounded render/source caches and diagnostics.', 'yes', 'Project cache-data tab and manage cached data.'],
  ['Proxy fallback for difficult media', 'yes', 'Proxy/transcode workflow.', 'yes', 'Proxy clips and transcoding.'],
  ['User-visible refusal reasons', 'yes', 'Qualified features return explicit unsupported/budget messages.', 'partial', 'Errors and missing-dependency messages are shown where available.'],
  ['Keyboard-only core editing', 'yes', 'Transport, marks, edits, tools, trims, markers, and commands have keyboard paths.', 'yes', 'Extensive configurable shortcuts.'],
  ['High-DPI interface', 'yes', 'Responsive web/native shell.', 'yes', 'Qt high-DPI support.'],
  ['Screen-reader labels on comparison-critical controls', 'yes', 'Core web controls use semantic labels and keyboard focus.', 'partial', 'Qt accessibility support varies by widget/platform.'],
  ['Reduced-motion UI preference', 'yes', 'Web surfaces can honor prefers-reduced-motion.', 'partial', 'Theme/desktop animation behavior is environment dependent.'],
  ['Bug-report workflow', 'partial', 'Diagnostics can be exported for support.', 'yes', 'Documented bug-report workflow.'],
  ['Installation troubleshooting guide', 'yes', 'Platform installation/support docs.', 'yes', 'Dedicated troubleshooting manual.'],
], ['sloomQualified', 'sloomSource', 'kdenliveManual']);

for (const [name, sloomState, sloomNote] of [
  ['Wipe', 'no', 'No current Sloom wipe transition.'],
  ['Circle Wipe', 'no', 'No exact circular wipe.'],
  ['Dissolve', 'yes', 'Cross dissolve.'],
  ['Horizontal Barn Door Wipe', 'no', 'No exact barn-door wipe.'],
  ['Luma', 'no', 'No custom luma-map transition.'],
  ['Push Down / Up', 'partial', 'Directional slide provides a similar move, without the exact push composition.'],
  ['Push Left / Right', 'partial', 'Directional slide provides a similar move, without the exact push composition.'],
  ['Rectangular Wipe', 'no', 'No current Sloom wipe transition.'],
  ['Slide', 'yes', 'Slide transition.'],
  ['Slide Down / Up', 'yes', 'Directional slide variants.'],
  ['Slide Left / Right', 'yes', 'Directional slide variants.'],
  ['Vertical Barn Door Wipe', 'no', 'No exact barn-door wipe.'],
  ['Wipe Down / Up', 'no', 'No current Sloom wipe transition.'],
  ['Wipe Left / Right', 'no', 'No current Sloom wipe transition.'],
]) {
  add('Kdenlive transitions · individual', name, sloomState, sloomNote, 'yes', 'Individually listed in the official Available Transitions table.', ['sloomSource', 'kdenliveManual']);
}

const titleFromSlug = (slug) => slug
  .split('/').filter(Boolean).at(-1)
  ?.replace(/[_-]+/g, ' ')
  .replace(/\b\w/g, (letter) => letter.toUpperCase()) ?? slug;

const docMarkup = (raw) => {
  const explicit = raw.match(/:doc:`([^`<]+?)\s*<([^>]+)>`/);
  if (explicit) return { name: explicit[1].trim(), target: explicit[2].trim(), explicit: true };
  const implicit = raw.match(/:doc:`([^`]+)`/);
  if (implicit) return { name: titleFromSlug(implicit[1].trim()), target: implicit[1].trim(), explicit: false };
  return { name: raw.trim(), target: '', explicit: true };
};

const cleanRst = (raw = '') => raw
  .replace(/\.\.\s+_[^:]+:/g, ' ')
  .replace(/\.\.\s+(?:image|figure)::[^\s]+/g, ' ')
  .replace(/:doc:`([^`<]+?)\s*<[^>]+>`/g, '$1')
  .replace(/:doc:`([^`]+)`/g, (_, target) => titleFromSlug(target))
  .replace(/:(?:kbd|guilabel|menuselection|file|ref|term|code):`([^`]+)`/g, '$1')
  .replace(/\|([^|]+)\|/g, '$1')
  .replace(/\\([_\-*])/g, '$1')
  .replace(/\[[0-9]+\]_/g, '')
  .replace(/\*\*/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const titleFromDocument = (target, fallback) => {
  if (!target) return fallback;
  try {
    const path = join(docsRoot, `${target.replace(/^\//, '')}.rst`);
    const lines = readFileSync(path, 'utf8').split('\n');
    for (let index = 0; index < lines.length - 1; index += 1) {
      if (lines[index].trim() && /^[-=~^]+\s*$/.test(lines[index + 1])) return cleanRst(lines[index]);
    }
  } catch {
    // Some explicit audio-effect labels point at shared category pages; keep the list label.
  }
  return fallback;
};

const parseListRows = (text, stopAtRule = false) => {
  const lines = (stopAtRule ? text.split(/\n----\s*\n/, 1)[0] : text).split('\n');
  const parsed = [];
  let current = null;
  let heading = '';
  for (let index = 0; index < lines.length; index += 1) {
    const next = lines[index + 1] ?? '';
    if (lines[index].trim() && /^[-=~^]+\s*$/.test(next) && !lines[index].trim().startsWith('..')) {
      heading = cleanRst(lines[index]);
    }
    const start = lines[index].match(/^   \* -\s?(.*)$/);
    if (start) {
      if (current) parsed.push(current);
      current = { heading, cells: [start[1].trim()] };
      continue;
    }
    if (!current) continue;
    const cell = lines[index].match(/^     -\s?(.*)$/);
    if (cell) {
      current.cells.push(cell[1].trim());
      continue;
    }
    if (/^ {7,}\S/.test(lines[index])) {
      current.cells[current.cells.length - 1] += ` ${lines[index].trim()}`;
    }
  }
  if (current) parsed.push(current);
  return parsed;
};

const effectUrl = (target) => {
  if (!target) return sources.kdenliveEffects.href;
  const absolute = target.startsWith('/') ? target : `/${target}`;
  return `https://docs.kdenlive.org/en${absolute}.html`;
};

const availabilityFromOs = (raw, category) => {
  if (/deprecated/i.test(category)) return { state: 'partial', note: 'Documented as deprecated.' };
  const platforms = [];
  if (raw.includes('|linux|')) platforms.push('Linux distribution packages');
  if (raw.includes('|appimage|')) platforms.push('AppImage');
  if (raw.includes('|windows|')) platforms.push('Windows');
  if (raw.includes('|apple|')) platforms.push('macOS');
  if (platforms.length >= 4) return { state: 'yes', note: 'Listed for Linux, AppImage, Windows, and macOS.' };
  return { state: 'setup', note: `Package/OS dependent: ${platforms.join(', ') || 'availability not universally specified'}.` };
};

const normalized = (value) => cleanRst(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const sloomVideoEffect = (name) => {
  const n = normalized(name);
  const exact = new Map([
    ['brightness', ['yes', 'Sloom has an exact brightness filter.']],
    ['contrast', ['yes', 'Sloom has an exact contrast filter.']],
    ['saturation', ['yes', 'Sloom has an exact saturation filter.']],
    ['hue shift', ['yes', 'Sloom has a hue-rotate filter.']],
    ['hue rotation', ['yes', 'Sloom has a hue-rotate filter.']],
    ['sepia', ['yes', 'Sloom has an exact sepia filter.']],
    ['invert', ['yes', 'Sloom has an exact invert filter.']],
    ['negate', ['yes', 'Sloom has an invert/negative filter.']],
    ['chroma key basic', ['yes', 'Sloom has qualified basic chroma keying.']],
    ['chroma key', ['yes', 'Sloom has qualified basic chroma keying.']],
    ['transform', ['yes', 'Sloom has position, scale, rotation, and opacity transforms.']],
    ['opacity', ['yes', 'Sloom has static and keyframed opacity.']],
    ['edge crop', ['yes', 'Sloom has per-edge crop controls.']],
    ['crop scale and tilt', ['partial', 'Sloom covers crop and transform, but not every parameter of this Kdenlive effect.']],
  ]);
  if (exact.has(n)) return exact.get(n);
  if (/^(greyscale|grayscale|black and white|bw0r|binarize)$/.test(n)) return ['partial', 'Sloom has grayscale/monochrome, but not necessarily this exact threshold algorithm.'];
  if (n === 'blur') return ['yes', 'Sloom has a generic blur filter.'];
  if (n.includes('blur')) return ['partial', 'Sloom has generic blur, not this exact blur algorithm.'];
  if (n.includes('chroma key') || n === 'bluescreen0r' || n.includes('color to alpha')) return ['partial', 'Sloom has basic chroma keying, without all controls of this effect.'];
  if (n.includes('alpha shape') || n.includes('mask')) return ['partial', 'Sloom has one rectangle/ellipse mask, not the full effect.'];
  if (n.includes('stabiliz')) return ['partial', 'Sloom has a persisted stabilization artifact, not this exact algorithm/control set.'];
  if (n.includes('motion track') || n.includes('auto mask')) return ['partial', 'Sloom has one bounded tracked rectangle/ellipse mask.'];
  if (n.includes('flip')) return ['partial', 'Sloom has horizontal/vertical flip, not necessarily this effect\'s full parameter set.'];
  if (n.includes('fade from black') || n.includes('fade to black')) return ['yes', 'Sloom has fade-to/from-black transitions.'];
  if (n.includes('fade in') || n.includes('fade out')) return ['partial', 'Sloom can keyframe opacity and apply fade transitions.'];
  if (n.includes('position and zoom') || n.includes('zoom pan')) return ['partial', 'Sloom position/scale keyframes cover the basic motion, not this exact effect.'];
  return ['no', 'No equivalent individually named Sloom video effect.'];
};

const sloomAudioEffect = (name) => {
  const n = normalized(name);
  if (n === 'volume' || n.includes('amplifier') || n === 'gain') return ['partial', 'Sloom has clip/track/main-bus gain and volume automation.'];
  if (n.includes('highpass') || n.includes('high pass')) return ['yes', 'Sloom has a qualified dialogue high-pass filter.'];
  if (n.includes('lowpass') || n.includes('low pass')) return ['yes', 'Sloom has a qualified dialogue low-pass filter.'];
  if (n === 'gate' || n.includes('noise gate')) return ['yes', 'Sloom has a qualified dialogue gate.'];
  if (n.includes('compressor') || n.includes('compress')) return ['partial', 'Sloom has a qualified bounded dialogue compressor, not necessarily this exact plug-in.'];
  if (n.includes('limiter') || n.includes('limit')) return ['partial', 'Sloom has a qualified bounded dialogue limiter, not necessarily this exact plug-in.'];
  if (n.includes('normalize') || n.includes('loudnorm')) return ['partial', 'Sloom has two-pass loudness normalization with a true-peak target.'];
  if (n.includes('pan') && !n.includes('expand')) return ['partial', 'Sloom has bounded stereo pan and keyframes.'];
  if (n.includes('fade')) return ['partial', 'Sloom has audio fades and equal-power crossfades, not this exact plug-in.'];
  return ['no', 'No equivalent individually named Sloom audio effect.'];
};

const parseEffects = (file, kind) => {
  const text = readFileSync(file, 'utf8');
  const parsed = parseListRows(text, true)
    .filter(({ cells }) => !/effect or filter/i.test(cells[0] ?? '') && cells.length >= 4);
  const displayNameCounts = parsed.reduce((counts, { cells }) => {
    const markup = docMarkup(cells[0]);
    const name = markup.explicit ? cleanRst(markup.name) : titleFromDocument(markup.target, cleanRst(markup.name));
    const key = `${normalized(cells[2])}\0${normalized(name)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    return counts;
  }, new Map());
  for (const { cells } of parsed) {
    const markup = docMarkup(cells[0]);
    const baseName = markup.explicit ? cleanRst(markup.name) : titleFromDocument(markup.target, cleanRst(markup.name));
    const os = cells[1];
    const effectCategory = cleanRst(cells[2]) || 'Other';
    const description = cleanRst(cells.slice(3).join(' '));
    const duplicateKey = `${normalized(effectCategory)}\0${normalized(baseName)}`;
    const pluginId = description.match(/\(([^()]+)\)\.?$/)?.[1] ?? titleFromSlug(markup.target);
    const name = (displayNameCounts.get(duplicateKey) ?? 0) > 1 ? `${baseName} — ${pluginId}` : baseName;
    const kdenlive = availabilityFromOs(os, effectCategory);
    const [sloomState, sloomNote] = kind === 'video' ? sloomVideoEffect(baseName) : sloomAudioEffect(baseName);
    add(
      `Kdenlive ${kind} effects · ${effectCategory}`,
      name,
      sloomState,
      sloomNote,
      kdenlive.state,
      `${description}${description && !/[.!?]$/.test(description) ? '.' : ''} ${kdenlive.note}`.trim(),
      ['sloomSource', 'kdenliveEffects'],
      { officialUrl: effectUrl(markup.target), inventory: `${kind}-effect` },
    );
  }
  return parsed.length;
};

const videoEffectCount = parseEffects(join(docsRoot, 'effects_and_filters/lists/video_effects_list.rst'), 'video');
const audioEffectCount = parseEffects(join(docsRoot, 'effects_and_filters/lists/audio_effects_list.rst'), 'audio');

const sloomShortcutBindings = new Map([
  ['play stop', 'Space'], ['pause', 'K'], ['forward', 'L'], ['rewind', 'J'],
  ['forward 1 frame', 'Right'], ['rewind 1 frame', 'Left'], ['forward 1 second', 'Shift+Right'], ['rewind 1 second', 'Shift+Left'],
  ['go to project start', 'Home'], ['go to project end', 'End'], ['set zone in', 'I'], ['set zone out', 'O'],
  ['insert zone in timeline', ','], ['overwrite zone in timeline', '.'], ['razor tool', 'C'], ['selection tool', 'V'],
  ['slip tool', 'Y'], ['add marker guide quickly', 'M'], ['toggle snapping', 'S'],
]);

const parseShortcuts = (file) => {
  const parsed = parseListRows(readFileSync(file, 'utf8'))
    .filter(({ cells }) => !/action name/i.test(cells[0] ?? '') && cells.length >= 2);
  for (const { heading, cells } of parsed) {
    const action = cleanRst(cells[0]);
    const shortcut = cleanRst(cells[1]) || 'Unassigned / pointer gesture';
    const description = cleanRst(cells.slice(2).join(' '));
    if (!action) continue;
    const ours = sloomShortcutBindings.get(normalized(action));
    const sloomState = ours ? (normalized(ours) === normalized(shortcut) ? 'yes' : 'partial') : 'no';
    const sloomNote = ours
      ? (sloomState === 'yes' ? `Same Sloom default: ${ours}.` : `Sloom provides this action with ${ours}, not the documented Kdenlive binding.`)
      : 'No matching Sloom default binding is documented; the action may still be available through UI or remapping.';
    add(`Kdenlive default shortcuts · ${heading || 'Other'}`, `${action} — ${shortcut}`, sloomState, sloomNote, 'yes', description || 'Documented default Kdenlive shortcut or pointer gesture.', ['sloomSource', 'kdenliveShortcuts'], { inventory: 'shortcut' });
  }
  return parsed.length;
};

const shortcutCount = parseShortcuts(join(docsRoot, 'user_interface/shortcuts.rst'));

for (const [action, binding, kdenliveState, kdenliveNote] of [
  ['Select tool', 'V', 'partial', 'Selection Tool exists; its default Kdenlive binding may differ.'],
  ['Cut tool', 'C', 'partial', 'Razor Tool exists; its default Kdenlive binding may differ.'],
  ['Slip tool', 'Y', 'partial', 'Slip Tool exists; its default Kdenlive binding may differ.'],
  ['Hand tool', 'H', 'partial', 'Timeline pan exists; its default binding differs.'],
  ['Toggle snapping', 'S', 'partial', 'Snap toggle exists; its default binding may differ.'],
  ['Ripple trim previous side', 'Q', 'partial', 'Ripple trim exists; its default binding may differ.'],
  ['Ripple trim next side', 'W', 'partial', 'Ripple trim exists; its default binding may differ.'],
  ['Roll edit', 'E', 'partial', 'Roll edit exists; its default binding may differ.'],
  ['Add marker', 'M', 'partial', 'Add Guide/Marker exists; default depends on context.'],
  ['Clear In', 'Alt+I', 'partial', 'Clear Zone In exists; default binding differs.'],
  ['Clear Out', 'Alt+O', 'partial', 'Clear Zone Out exists; default binding differs.'],
  ['Insert edit', ',', 'partial', 'Insert Zone exists; default binding differs.'],
  ['Overwrite edit', '.', 'partial', 'Overwrite Zone exists; default binding differs.'],
]) {
  add('Sloom default shortcuts · individual', `${action} — ${binding}`, 'yes', 'Documented Sloom Video default.', kdenliveState, kdenliveNote, ['sloomManual', 'kdenliveShortcuts'], { inventory: 'shortcut' });
}

const countsByInventory = rows.reduce((acc, row) => {
  if (row.inventory) acc[row.inventory] = (acc[row.inventory] ?? 0) + 1;
  return acc;
}, {});

let docsCommit = '4fbe7947c359307106ac1a57fdb79973b946a3dd';
try {
  const head = readFileSync(join(docsRoot, '.git/HEAD'), 'utf8').trim();
  if (/^[a-f0-9]{40}$/.test(head)) docsCommit = head;
  else if (head.startsWith('ref: ')) {
    const refPath = join(docsRoot, '.git', head.slice(5));
    const ref = readFileSync(refPath, 'utf8').trim();
    if (/^[a-f0-9]{40}$/.test(ref)) docsCommit = ref;
  }
} catch {
  // A source tarball has no .git directory; retain the audited snapshot commit.
}

const data = {
  meta: {
    title: 'Sloom Video vs Kdenlive — full feature matrix',
    generatedOn: '2026-08-27',
    sloomSnapshot: 'Current qualified Sloom Studio source · 2026-08-27',
    kdenliveSnapshot: 'Kdenlive 26.04.3 stable · 26.04 manual',
    kdenliveDocsCommit: docsCommit,
    rowCount: rows.length,
    categoryCount: new Set(rows.map((row) => row.category)).size,
    inventoryCounts: {
      videoEffects: videoEffectCount,
      audioEffects: audioEffectCount,
      shortcuts: shortcutCount,
      ...countsByInventory,
    },
    scope: 'Every independently named, current user-facing feature, control, bundled/manual-listed effect, transition, render preset, and default shortcut found in the audited sources is represented as its own row.',
    limit: 'Kdenlive can discover additional MLT, Frei0r, FFmpeg, and LADSPA capabilities at runtime. Those external/package-dependent universes are not finite product features, so the matrix lists every effect in the official 26.04 manual and marks runtime variability explicitly.',
  },
  states: {
    yes: { label: 'Yes', meaning: 'Available as described in the compared snapshot.' },
    partial: { label: 'Partial', meaning: 'A narrower, qualified, deprecated, or differently shaped implementation.' },
    setup: { label: 'Setup-dependent', meaning: 'Requires compatible hardware, OS package, plug-in, model, adapter, account, or backend.' },
    no: { label: 'No', meaning: 'No equivalent is present in the compared snapshot.' },
    na: { label: 'N/A', meaning: 'The comparison is not applicable to this product.' },
  },
  sources,
  rows,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `/* Generated by ${relative(repoRoot, fileURLToPath(import.meta.url))}. Do not hand-edit. */\nwindow.SLOOM_KDENLIVE_COMPARISON = ${JSON.stringify(data, null, 2)};\n`);
console.log(`Wrote ${relative(repoRoot, outputPath)} with ${rows.length} rows (${videoEffectCount} video effects, ${audioEffectCount} audio effects, ${shortcutCount} shortcut rows).`);
