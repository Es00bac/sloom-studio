import { useState } from 'react';
import { DockableDialog } from '../DockablePanel';

const SECTIONS = [
  'Keyboard Shortcuts',
  'Tools',
  'Brush Engines',
  'Selections & Masks',
  'Quick Actions',
  'Layers',
  'Filters',
  'Flow Integration',
  'Tablet & Pen',
];

const SHORTCUTS: [string, string][] = [
  ['V', 'Move tool'],
  ['M', 'Rectangle select'],
  ['B', 'Brush select'],
  ['E', 'Eraser'],
  ['S', 'Clone Stamp'],
  ['J', 'Spot Heal'],
  ['R', 'Blur Brush'],
  ['Shift+R', 'Sharpen Brush'],
  ['U', 'Smudge Brush'],
  ['O', 'Dodge Brush'],
  ['Shift+O', 'Burn Brush'],
  ['P', 'Sponge Saturate'],
  ['Shift+P', 'Sponge Desaturate'],
  ['G', 'Paint Bucket'],
  ['Shift+G', 'Gradient'],
  ['X', 'Rectangle Shape'],
  ['Shift+X', 'Ellipse Shape'],
  ['C', 'Crop'],
  ['T', 'Text'],
  ['I', 'Eyedropper'],
  ['Ctrl+Z', 'Undo'],
  ['Ctrl+Y', 'Redo'],
  ['[ / ]', 'Decrease / Increase brush size'],
  ['Ctrl+C / X / V', 'Copy / Cut / Paste'],
  ['Delete', 'Delete selection'],
  ['Ctrl+A', 'Select all'],
  ['Ctrl+D', 'Deselect'],
  ['Ctrl+Shift+I', 'Invert selection'],
  ['F1', 'Toggle help'],
  ['Esc', 'Close overlay'],
];

const SECTION_CONTENT: Record<string, React.ReactNode> = {
  'Keyboard Shortcuts': (
    <table className="w-full text-xs">
      {SHORTCUTS.map(([key, desc]) => (
        <tr key={key} className="border-b border-cyan-300/5">
          <td className="px-2 py-1 font-mono text-cyan-100">{key}</td>
          <td className="px-2 py-1 text-cyan-100/60">{desc}</td>
        </tr>
      ))}
    </table>
  ),
  Tools: (
    <div className="space-y-2 text-xs text-cyan-100/60">
      <p><strong className="text-cyan-100">Move (V):</strong> Select and drag objects on the canvas.</p>
      <p><strong className="text-cyan-100">Marquee (M):</strong> Drag to create a rectangular selection. Shift+drag for square. Shift+click to add to selection. Alt+click to subtract.</p>
      <p><strong className="text-cyan-100">Brush (B):</strong> Paint a freeform selection mask. Pressure-sensitive with tablet. Eraser (E) removes mask areas.</p>
      <p><strong className="text-cyan-100">Eraser (E):</strong> Remove painted mask areas or erase content.</p>
      <p><strong className="text-cyan-100">Clone Stamp (S):</strong> Alt-click a source point, then paint sampled pixels elsewhere.</p>
      <p><strong className="text-cyan-100">Spot Heal (J):</strong> Paint over small defects to blend them from surrounding pixels.</p>
      <p><strong className="text-cyan-100">Blur Brush (R):</strong> Paint to soften local detail with brush size and opacity.</p>
      <p><strong className="text-cyan-100">Sharpen Brush (Shift+R):</strong> Paint to add local contrast with brush size and opacity.</p>
      <p><strong className="text-cyan-100">Smudge Brush (U):</strong> Drag pixels along a stroke with brush size and opacity.</p>
      <p><strong className="text-cyan-100">Dodge / Burn (O / Shift+O):</strong> Paint local brightening or darkening with brush size and opacity.</p>
      <p><strong className="text-cyan-100">Sponge (P / Shift+P):</strong> Paint local saturation up or down with brush size and opacity.</p>
      <p><strong className="text-cyan-100">Paint Bucket (G):</strong> Fill a contiguous color region with the active brush color and Magic Wand tolerance.</p>
      <p><strong className="text-cyan-100">Gradient (Shift+G):</strong> Drag a foreground-to-transparent linear gradient on the active layer.</p>
      <p><strong className="text-cyan-100">Shapes (X / Shift+X):</strong> Draw filled raster rectangles or ellipses on the active layer.</p>
      <p><strong className="text-cyan-100">Crop (C):</strong> Crop the canvas to a selected region.</p>
      <p><strong className="text-cyan-100">Text (T):</strong> Add text to the canvas.</p>
      <p><strong className="text-cyan-100">Eyedropper (I):</strong> Pick a color from the canvas.</p>
    </div>
  ),
  'Brush Engines': (
    <div className="space-y-2 text-xs text-cyan-100/60">
      <p><strong className="text-cyan-100">Studio Brush:</strong> The Community engine. It remains the default and includes Image&apos;s normal size, flow, pressure, tilt, texture, symmetry, masks, and mixer controls.</p>
      <p><strong className="text-cyan-100">Tiltmark Brush:</strong> Included with Sloom Studio Pro and powered by Hane&apos;s Rust/WASM Tiltmark V3 engine. It adds physical graphite, chisel, bristle, particle, ribbon, wet-material, solvent, pickup, spray-paint, and persistent implement behavior.</p>
      <p>Select the engine in Brush Properties. Tiltmark loads only after the offline license is verified; removing the key immediately returns Image to Studio Brush.</p>
      <p>Use the Tiltmark Brush Library to choose a Hane preset. Open Brush Lab for material interaction and implement-care actions such as Reload, Rinse, Rewet, Wipe, and Dry.</p>
      <p>The first Tiltmark stroke creates a transparent Tiltmark group and physical surface layer. The layer retains its dry base, wet substrate field, paper profile, and stroke metadata across undo, save/open, snapshots, and linked-device editing.</p>
      <p>Use <strong className="text-cyan-100">Convert to Raster Layer</strong> in Layers when you intentionally want to bake the rendered result into ordinary pixels. Destructive crop, document-pixel resize, and upscale stay unavailable until that explicit conversion; non-destructive canvas framing remains available.</p>
    </div>
  ),
  'Selections & Masks': (
    <div className="space-y-2 text-xs text-cyan-100/60">
      <p>Create selections with the Marquee or Brush tool, then export as masks for AI nodes.</p>
      <p><strong className="text-cyan-100">Binary mask:</strong> Black = excluded, White = included. Clean edges.</p>
      <p><strong className="text-cyan-100">Feathered mask:</strong> Gradient edges for smooth blending. Adjustable feather radius.</p>
      <p>Exported masks go to the Source Bin and can be connected to inpainting or style transfer nodes.</p>
    </div>
  ),
  'Quick Actions': (
    <div className="space-y-2 text-xs text-cyan-100/60">
      <p>Right-click the image canvas to open quick actions for selection cleanup, grid and edge selections, pixel clearing, layer duplication, layer ordering, nudging, alignment, fitting, opacity and blend presets, scaling, color inversion, brightness shifts, desaturation, alpha changes, and canvas trimming.</p>
      <p>Quick actions use the same undo/redo history as brush strokes, selections, layer edits, and crop operations.</p>
      <p>Selection-only actions need an active selection. Layer and pixel actions use the active layer in the Layers panel.</p>
    </div>
  ),
  Layers: (
    <div className="space-y-2 text-xs text-cyan-100/60">
      <p>Layer types: Image, Mask, Adjustment. Each has its own visibility, opacity, and blend mode.</p>
      <p>Layer masks can be created from the active selection, revealed, hidden, inverted, applied, or deleted from the Layers panel.</p>
      <p>Adjustment layers apply filters non-destructively. Toggle visibility to compare.</p>
      <p>Blend modes: Normal, Multiply, Screen, Overlay, and more.</p>
    </div>
  ),
  Filters: (
    <div className="space-y-2 text-xs text-cyan-100/60">
      <p>Built-in filters applied as non-destructive adjustment layers:</p>
      <p>Brightness, Contrast, Saturation, Hue, Blur, Sharpen, Grayscale, Invert, Sepia, Noise, Pixelate, Color Matrix.</p>
    </div>
  ),
  'Flow Integration': (
    <div className="space-y-2 text-xs text-cyan-100/60">
      <p><strong className="text-cyan-100">Bridge node:</strong> Drop an Advanced Image Editor node on the flow canvas. Connect a source image. Click &quot;Open in Image Editor&quot; to edit in the full editor tab.</p>
      <p>Use &quot;Export Visible&quot; to flatten the current document into a durable PNG asset without overwriting the original source.</p>
      <p>Use &quot;Send to Flow&quot; to save the edited image, create an imported image node on the canvas, and keep the node backed by the same Source Bin asset.</p>
      <p>Use &quot;Send to Video&quot; to save the edited image and switch to the video workspace&apos;s Editor Assets tab, where it can be placed on visual tracks like other source-bin images.</p>
      <p>Masks exported from the editor are saved as normal image assets in the Source Bin for inpainting or style-transfer workflows.</p>
    </div>
  ),
  'Tablet & Pen': (
    <div className="space-y-2 text-xs text-cyan-100/60">
      <p><strong className="text-cyan-100">Pressure sensitivity:</strong> Brush size scales with pen pressure.</p>
      <p><strong className="text-cyan-100">Pen button:</strong> Opens context menu (right-click equivalent).</p>
      <p><strong className="text-cyan-100">Eraser end:</strong> Automatically switches to eraser tool.</p>
      <p><strong className="text-cyan-100">Tilt:</strong> Brush angle follows pen tilt (when supported).</p>
      <p><strong className="text-cyan-100">Tiltmark pose:</strong> Pressure, altitude, azimuth, barrel twist, tangential pressure, and eraser state are sent to the Rust engine when the device/browser exposes them.</p>
      <p><strong className="text-cyan-100">Hover:</strong> Shows cursor preview before touching.</p>
    </div>
  ),
};

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function ImageEditorHelp({ visible, onClose }: Props) {
  const [activeSection, setActiveSection] = useState(SECTIONS[0]);

  return (
    <DockableDialog
      defaultFloatingRect={{ x: 140, y: 96, width: 700, height: 560 }}
      dialogId="image-help"
      minSize={{ width: 420, height: 320 }}
      onClose={onClose}
      open={visible}
      title="Image Editor Help"
      workspaceId="image"
    >
      <div className="flex h-full min-h-0 overflow-hidden bg-[#0f1018]">
        <div className="w-36 flex-shrink-0 border-r border-cyan-300/10 bg-[#14151d] p-2">
          {SECTIONS.map((s) => (
            <button
              key={s}
              className={`mb-0.5 block w-full rounded px-2 py-1.5 text-left text-xs ${
                activeSection === s
                  ? 'bg-cyan-400/10 text-cyan-400'
                  : 'text-cyan-100/50 hover:bg-cyan-400/5 hover:text-white'
              }`}
              onClick={() => setActiveSection(s)}
              type="button"
            >
              {s}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-cyan-100">Image Editor Help</span>
            <button
              className="text-xs text-cyan-100/30 hover:text-white"
              onClick={onClose}
              type="button"
            >
              Close (Esc)
            </button>
          </div>
          {SECTION_CONTENT[activeSection]}
        </div>
      </div>
    </DockableDialog>
  );
}
