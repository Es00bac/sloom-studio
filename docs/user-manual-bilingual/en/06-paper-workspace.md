# Paper Workspace

> **Current-source baseline — 0.9.16-b (2026-08-27).** This chapter describes the
> current local Paper implementation. A standalone layout is an editable `.slppr`
> document; it can also live in a `.sloom` project. Output is deliberately
> fail-closed: an unsafe, missing, or unrepresentable input is reported instead of
> silently flattened or represented as press-ready.

The Paper workspace is a desktop publishing environment for multi-page documents, comics, manga, zines, books, and print-ready PDFs. It combines frame-based layout, advanced typography including Japanese vertical writing, color and swatch management, image placement, preflight checks, and a wide range of export formats.

This chapter describes the layout, tools, frame kinds, page management, selection and arrangement, typography, color and print setup, image and asset handling, preflight, export formats, context menus, and shortcuts.

## Current publishing workflow

1. Create or open a layout, then use **File → Save As…** to keep an editable
   `.slppr` copy when the layout needs to travel independently of its parent project.
2. Build pages and spreads with frames, parent layouts, styles, grids, linked or
   managed assets, and the document's text tools. Long documents can use contents,
   index/reference, footnote/endnote, anchored-object, variable, data-merge, book,
   snippet-library, optical-margin, revision, and comment facilities.
3. Set the output intent before export. Press-oriented PDF/X and tagged accessible
   PDF solve different requirements; provide alternative text and document language
   for the latter rather than assuming a visual frame label is usable as alt text.
4. Run Paper's local preflight and repair every strict error. Keep the resulting
   report with the delivered file. Preflight is executable local evidence, not a
   claim that a particular printer, marketplace, or external application accepted
   the file.

### Interchange and delivery boundaries

| Deliverable | What Sloom Studio currently does | Important boundary |
|---|---|---|
| `.slppr` | Saves/reopens an editable Paper document with its managed document state. | Preserve managed fonts/assets/profiles when packaging or moving the work. |
| IDML | Opens the explicitly supported editable subset and writes structured interchange output. | Unsupported archive members, links, styles, or constructs are refused with a reason; this is not a promise of arbitrary InDesign round-trip parity. |
| EPUB 3 | Builds and validates a bounded reflowable EPUB 3 package with navigation and visual fallbacks. | It is not a fixed-layout EPUB or retailer-certification service. |
| ISBN / EAN-13 | Provides retained barcode frames with validation, derived check digit, quiet-zone and physical-size checks. | A valid barcode frame is not proof of retailer registration or scan approval on a particular press. |
| Tagged PDF | Exports the accessible-PDF route after language and authored alternative-text checks. | Accessible PDF is distinct from press-oriented PDF/X. |
| PDF/X and print formats | Runs deterministic local checks for fonts, links, bleed/trim, colour, barcode and export requirements. | A print shop's RIP, stock, finishing, and acceptance remain optional external evidence. |

## Layout and Panels

The Paper workspace is organized into:

- **Top Strip** — Contextual options for the selected tool or frame.
- **Floating Tools Palette** — Contains all layout and drawing tools.
- **Viewport** — The page or spread canvas in the center.
- **Inspector** — Properties for the selected object.
- **Find/Change** — Search and replace text across the document.
- **Preflight** — Lists potential output problems.
- **Linked Assets** — Shows images and assets linked to the document.
- **DTP Parity** — Checks compatibility with other DTP applications.
- **Rulers and Guides** — Horizontal and vertical rulers with draggable guides.
- **Grid and Baseline Grid** — Alignment grids for precise layout.
- **Spreads** — Displays facing pages together.

Panels are dockable and layouts persist per project.

### Touch Navigation

On touch devices, pinch to zoom, two-finger drag to pan, and tap to select. The floating tools palette can be moved to avoid obscuring the page.

### RTL Binding: Right-Side Binding (右綴じ)

Paper supports right-to-left page binding for Japanese and other RTL documents. When right-side binding is enabled, page 1 appears on the right and spreads are arranged accordingly. Set binding direction in **Document Setup** or when creating a new document.

## Tools Palette

The floating tools palette contains the following tools. Shortcuts are shown in parentheses.

### Select (`V`)

Selects and transforms frames. Hold `Shift` to add to the selection. Drag a marquee to select multiple frames.

### Hand (`H`)

Pans the viewport.

### Text (`T`)

Creates text frames. Click and drag to define the frame area, then type.

### Image (`Shift+I`)

Creates image frames for placing source images.

### Comic Panel

Draws rectangular comic panels. Panels can be split with the gutter knife.

### Line

Draws straight lines. Hold `Shift` to constrain to horizontal, vertical, or 45-degree angles.

### Ellipse

Draws ellipses and circles. Hold `Shift` for circles.

### Triangle / Pentagon / Hexagon

Draws regular polygons. Use the Tool Options to set the number of sides.

### Free Polygon

Draws custom polygons by clicking vertices. Double-click or press `Enter` to close the shape.

### Speech Bubble

Draws speech bubbles with a tail. Drag the tail handle to point at the speaker.

### Thought Bubble

Draws cloud-shaped thought bubbles with a tail.

### Caption

Draws caption frames for explanatory text or comic narration.

### Eyedropper (`I`)

Samples a color from the page or an image.

### Gutter Knife (`K`)

Splits comic panels by drawing a cut line. Useful for adjusting panel layouts after initial creation.

### Comic SFX Presets

Inserts pre-made sound effect graphics such as "BAM," "POW," and Japanese manga SFX. Presets can be customized.

## Frame Kinds

Frames are the basic building blocks of a Paper document. Each frame has a specific content type.

| Frame Kind | Purpose |
|------------|---------|
| Text | Contains flowing text. |
| Image | Displays a placed image. |
| Document | Embeds another Paper document or page. |
| Panel | Comic panel, usually contains images or text. |
| Shape | Vector shape with fill and stroke. |
| Speech bubble | Comic dialogue with tail. |
| Thought bubble | Comic thought with cloud tail. |
| Caption | Explanatory or narration text. |

Each frame kind exposes different inspector options. For example, an image frame shows fit and crop options, while a text frame shows typography options.

## Tables

Paper supports simple tables inside text frames or as standalone objects. Create a table from the Insert menu and set rows, columns, and cell styles. Tables can be styled with borders, fills, and paragraph styles.

## Comic SFX Decals

SFX decals are decorative text objects used in comics. They differ from regular text frames because they:

- Use bold, stylized fonts.
- Can be warped or angled.
- Have preset color combinations.
- Are designed to break panel boundaries.

Apply a preset from the Comic SFX panel and edit the text.

## Pages and Parent Pages

### Pages Panel

The Pages panel shows thumbnails of every page and parent page. From here you can:

- Add a new page.
- Duplicate a page.
- Delete a page.
- Reorder pages by dragging.
- Apply parent pages.

### Parent Pages

Parent pages are templates that provide common elements such as page numbers, headers, running titles, and guides. Changes to a parent page apply to all child pages that use it.

To create a parent page:

1. Open the Pages panel menu.
2. Choose **New Parent Page**.
3. Design the parent layout.
4. Drag the parent page onto a regular page to apply it.

### Page Presets

Page presets define common sizes and settings:

- A4, A5, B5
- US Letter, US Legal
- Manga digest (B6)
- Comic book (US standard)
- Custom

### Margins and Columns

Set margins and columns in **Layout > Margins and Columns**. Margins define the safe content area. Columns divide text frames into multiple flowing columns.

### Grid and Baseline Grid

- **Document Grid** — Visible alignment grid for objects.
- **Baseline Grid** — Invisible grid for aligning text baselines across frames and pages.

Enable snapping to grids and guides from the View menu.

## Selection and Arrangement

### Multi-Select

Hold `Shift` and click frames to add or remove them from the selection. Drag a marquee to select frames that intersect it.

### Invert Selection

Choose **Select > Invert** to select all frames except the current selection.

### Copy, Cut, Paste, Duplicate

Use standard shortcuts:

- `Ctrl+C` / `Cmd+C` — Copy
- `Ctrl+X` / `Cmd+X` — Cut
- `Ctrl+V` / `Cmd+V` — Paste
- `Ctrl+D` / `Cmd+D` — Duplicate

### Lock

Lock a frame to prevent accidental edits. Locked frames show a small lock icon. Unlock from the context menu or Inspector.

### Style Clipboard

Copy formatting from one frame and apply it to another with the style clipboard. The exact shortcut depends on settings; common defaults are:

- Copy style: `Ctrl+Alt+C` / `Cmd+Option+C`
- Paste style: `Ctrl+Alt+V` / `Cmd+Option+V`

### Align and Distribute

Align selected frames to left, center, right, top, middle, or bottom. Distribute frames evenly horizontally or vertically.

### Nudge

Use arrow keys to nudge selected frames by one unit. Hold `Shift` for larger nudges, `Alt` for smaller nudges.

### Rotate

Drag the rotation handle to rotate a frame. Hold `Shift` to constrain to 15-degree increments. Enter an exact angle in the Inspector.

### Image Crop

Select an image frame and choose **Crop** to adjust which portion of the image is visible. Drag the image inside the frame to pan.

### Vertex Editing

Select a shape, polygon, or freeform frame and enter vertex editing mode to move individual points, add points, or convert curves.

## Typography

Typography is one of Paper's strongest features. It supports both Western and Japanese text with advanced controls.

### Font Family

Choose fonts from the system and imported font lists. Imported fonts are embedded in the project or document.

### Imported Fonts

Add custom fonts from the Source Bin or file system. Paper supports TrueType, OpenType, and variable fonts. Ensure you have distribution rights for any font you embed.

### Size, Leading, and Tracking

- **Size** — Type size in points or Q units.
- **Leading** (行送り) — Space between lines.
- **Tracking** (字送り) — Space between characters.

For vertical Japanese text, leading controls vertical line spacing and tracking controls horizontal character spacing.

### Color and Highlight

Set fill color, stroke color, and highlight color for text. Highlights appear behind characters.

### Stroke and Shadow

Add outlines and drop shadows to text. Set stroke width, color, and shadow offset, blur, and color.

### Effects

Text effects include underline, strikethrough, all caps, small caps, and OpenType features such as ligatures and alternate glyphs.

### Paragraph and Character Styles

Save formatting as reusable styles:

- **Paragraph styles** — Apply to entire paragraphs. Include alignment, indentation, spacing, and hyphenation.
- **Character styles** — Apply to selected characters. Include font, size, color, and OpenType features.
- **Object styles** — Apply to frames. Include fill, stroke, and corner options.

### Rich Text

Edit text directly on the page with rich formatting. Use the floating toolbar for quick changes to font, size, color, and style.

### Vertical Writing (縦書き)

Enable vertical writing for a text frame from the Inspector. In vertical mode:

- Text flows top to bottom, right to left.
- Punctuation rotates.
- Latin text can be rotated or left horizontal.

### Ruby / Furigana (ルビ)

Add ruby text to kanji with the syntax `漢字《かんじ》`. The text inside `《》` becomes ruby. Adjust ruby size, offset, and font in the Inspector.

### Emphasis Dots (圏点)

Add emphasis dots around text with the syntax `《《強調》》`. Choose the dot style from the Inspector.

### Tate-Chu-Yoko (縦中横)

Tate-chu-yoko makes a short run of horizontal text within vertical writing. Select the characters and choose **Tate-Chu-Yoko** from the text menu. Use it for numbers, abbreviations, and short Latin words.

### Kinsoku Shori (禁則処理)

Kinsoku shori prevents forbidden characters from starting or ending a line. It is enabled by default for Japanese text. Adjust strictness in the paragraph style options.

### Text Threading

Thread text frames so overflow text flows from one frame to the next. Click the out-port of a text frame and then click another frame to link them.

### Text Wrap

Make text wrap around images and shapes. Set wrap offset and side preferences in the Inspector.

### Folios

Insert automatic page numbers with the `{page}` variable. Use `{pagecount}` for total pages. Format folios on parent pages so they update across the document.

### Hyperlinks

Add hyperlinks to text or frames. Hyperlinks are preserved in interactive PDF and webcomic exports.

## Color, Swatches, and Print

### Default Swatches

Paper provides default color swatches for common print and screen uses.

### Custom and Spot Swatches

Create custom colors and save them as swatches. Spot colors represent custom inks and are preserved in PDF/X output.

### Spot Plates

Spot plates show how spot colors will separate for print. Use the Separations Preview panel to inspect spot plates.

### Print-Safe Palettes

Enable print-safe palettes to limit colors to process and spot inks that are safe for your target output.

### Fill and Stroke

Apply fill and stroke colors to shapes, text outlines, and frames. Stroke options include width, cap, join, dash, and arrowheads.

### PDF Target

Choose the PDF target for export:

- **Browser PDF** — General-purpose PDF for screen viewing.
- **PDF/X-4** — Print-ready PDF with live transparency.
- **PDF/X-1a** — Print-ready PDF with all transparency flattened and fonts subset.

### Output Intent ICC Profiles

Set the output intent ICC profile so the PDF declares its intended color space. Common profiles include FOGRA, GRACoL, and Japan Color.

### Ink Limit

Set the maximum total ink coverage as a percentage. Values around 300% are common for coated stock; 240% for uncoated.

### Black Handling

Choose how black is generated:

- **Rich black** — Uses a mix of CMYK for deep blacks.
- **Pure black** — Uses only K channel.

### Spot Color Policy

Choose how spot colors are handled on export:

- Preserve as spot.
- Convert to process.
- Map to nearest process color.

### Overprint Preview

Enable overprint preview to see how overlapping inks will print. This is especially important for spot colors and trapping.

## Images and Assets

### Place Source

Place an image from the Source Bin into an image frame with **File > Place** or by dragging from the Source Bin.

### Drag-and-Drop Import

Drag image files from your file manager onto the page. Paper creates an image frame at the drop location.

### Fit, Crop, Pan, Scale, Rotate, and Flip

Select an image frame to control the placed image:

- **Fit** — Scale to fit inside the frame.
- **Crop** — Fill the frame, cropping excess.
- **Pan** — Move the image within the frame.
- **Scale, Rotate, Flip** — Transform the image.

### Quick Edit Image

Open a placed image in the Image Editor workspace with **Edit Image** from the context menu. Changes update the linked asset.

### AI Fix Frame

Use AI to fix or enhance an image frame. Options include denoising, sharpening, and color correction.

### Print Upscale

Increase image resolution for print using AI upscaling. This is useful when a source image is too small for the printed size.

### Send to Other Workspaces

Send an image or a page to Flow, Video, or Image workspaces:

- **Send to Flow** — Creates a Source Bin node.
- **Send to Video** — Adds to the Video Source Bin.
- **Send to Image** — Opens in the Image Editor.

## Exports

Paper supports many export formats.

### PDF/X-4

Print-ready PDF with transparency, layers, and ICC profiles. Suitable for professional print workflows.

### PDF/X-1a

Print-ready PDF with flattened transparency and subset fonts. Required by some print-on-demand services.

### Browser PDF

General-purpose PDF optimized for screen and web.

### KDP PDF

PDF preset tuned for Amazon Kindle Direct Publishing paperback requirements, including bleed and embedded fonts.

### KDP Assets

Exports cover, interior, and metadata files in the layout KDP expects.

### Reader Spreads

Exports pages as reader-order spreads, often used for digital comics and proofs.

### Booklet Proof

Exports pages arranged for booklet printing and folding.

### Webcomic Images

Exports each page or spread as an image file optimized for webcomic platforms. Options include width, format, and quality.

### IDML

Exports an InDesign Markup Language file for interchange with Adobe InDesign. Some advanced features may not translate exactly.

### CBZ

Exports pages as a comic book archive (CBZ) of images, suitable for e-comic readers.

### Story Text

Exports the text content of the document in a plain or structured format for scripting and translation.

### JSON

Exports document structure and metadata as JSON for integration with other tools.

### Package for Print

Collects the document, all linked images, fonts, and profiles into a single folder for delivery to a printer.

### Flattened Page to Source Library / Image

Export a flattened version of the current page or spread directly to the Source Library or as a new image asset.

## Soft Proof

Soft proofing simulates final output on screen. Choose a profile and rendering intent, then enable soft proof from the View menu. Use soft proof before exporting print PDFs.

## Preflight

Preflight checks the document for problems before export. In a strict export path,
blocking findings must be repaired or the export is refused; do not treat a warning
badge as a press approval. Categories include:

- Missing fonts
- Missing or modified linked images
- Overset text (text that does not fit)
- Low-resolution images
- Color space mismatches
- Bleed and trim issues
- Spot color problems
- Accessibility issues

Open the Preflight panel from **Window > Preflight**. Click an entry to navigate to the problem.

## Context Menus

Right-click the page for page-level options:

- Add page
- Apply parent page
- Page setup
- Paste in place
- Show/hide guides and grids

Right-click a frame for object-level options:

- Cut / Copy / Paste
- Duplicate
- Lock / Unlock
- Group / Ungroup
- Arrange (bring forward, send backward)
- Fit content
- Edit image
- Convert frame kind
- Add to library

## Shortcuts Summary

| Action | Shortcut |
|--------|----------|
| Select | `V` |
| Hand | `H` |
| Text | `T` |
| Image | `Shift+I` |
| Eyedropper | `I` |
| Gutter Knife | `K` |
| Duplicate | `Ctrl+D` / `Cmd+D` |
| Group | `Ctrl+G` / `Cmd+G` |
| Ungroup | `Ctrl+Shift+G` / `Cmd+Shift+G` |
| Lock | `Ctrl+L` / `Cmd+L` |
| Nudge | Arrow keys |
| Toggle guides | `Ctrl+;` / `Cmd+;` |
| Toggle grids | `Ctrl+'` / `Cmd+'` |

For a full shortcut list, see `09-shortcuts.md`.

## Caveats

- Japanese vertical typography features depend on font support. Some fonts may not render ruby or emphasis dots correctly.
- IDML is bounded structured interchange. Unsupported constructs are named and refused rather
  than being silently flattened; validate the receiving application's result when that external
  handoff matters.
- EPUB is bounded reflowable EPUB 3, not fixed-layout EPUB or a storefront certification.
- Local preflight and export proof are the product's completion evidence. A physical press,
  print shop, Acrobat, retailer, or other external service is outside the local workflow and can
  add optional delivery evidence only.
- Large documents with many high-resolution managed assets can require substantial memory and
  storage; package the layout and its assets before moving it.
