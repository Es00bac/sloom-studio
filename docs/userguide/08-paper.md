# 8. Paper workspace

**Paper** is page-based publishing — the place to lay out comics, books, zines, and long-form
documents and export print-ready files. It's the layout end of the suite: where the images you
generated and edited become finished pages.

A Paper layout can be saved on its own as a `.slppr` file (**File → Save As…**) or kept inside the
`.sloom` project.

## Pages and frames

- **Pages** are the canvas. Start from a preset (US Letter and others), add pages, and duplicate
  them. Work in single pages or **Spreads** (facing pages) for books and comics.
- **Frames** are the content boxes you place on a page — image frames, text frames, and shapes.
  Drop an asset from the **Source Bin** straight into a frame.
- **Linked frames** let text flow from one frame to the next, the way professional layout tools
  thread a story across columns and pages.

## Precision layout

Paper has the alignment tooling you'd expect from a publishing app:

- **Rulers**, **Guides**, and a **Grid**, with **Snap to Guides** and **Snap to Grid** so frames
  line up exactly.
- Place an external **PDF or document** into the layout as a reference or as content.
- **Speech tooling** for comic work — balloons and lettering.

## Built for comics and books

Paper is tuned for sequential art and publishing: spreads, consistent gutters, page-to-page
threading, and the export targets that printers and storefronts actually ask for.

Long-document tools include authored tables of contents, index markers and cross-references;
footnotes/endnotes; anchored objects; bounded GREP and nested styles; variables and conditional
text; CSV data merge; ordered multi-document book files; a local object/snippet library; optical
margin alignment; tracked revisions; and page/frame review comments. The Inspector or the relevant
Paper panel exposes each catalog. Exact steps and limits are in the
[Paper feature guide](15-qualified-missing-hundred-features.md#paper).

## Export

**Export Document** offers a deep set of print- and web-ready targets:

| Target | Use |
|---|---|
| **Print PDF** | Standard print-ready PDF. |
| **KDP / Spread PDF**, **Booklet Proof PDF** | Amazon KDP assets and imposed booklet proofs. |
| **Reader Spreads** (PDF/HTML) | Two-up reading layouts. |
| **Webcomic Page Images / Web PNG** | Per-page images for posting online. |
| **CBZ** | Comic book archive. |
| **IDML** | Hand off to InDesign. |
| **IDML import** | Open the supported editable subset; unsafe or unrepresentable packages are refused rather than flattened. |
| **EPUB 3** | Validated bounded reflowable ebook output with navigation and visual fallbacks. |
| **Accessible PDF** | Tagged reading order, text semantics, document language, and authored alternative text. |
| **Print / Reader HTML** | HTML output. |
| **Stories: TXT / HTML / RTF / DOCX** | Export the text content of your layout. |
| **Package for Print** | Bundle everything a printer needs. |
| **Paper JSON** | Import/export the raw layout data. |

ISBN-10/ISBN-13/EAN-13 barcode frames include check-digit validation, quiet zones, scale presets,
and preflight. Accessible PDF is separate from press-oriented PDF/X: choose the output that matches
the job, supply alternative text for printable visual frames, and run preflight before delivery.

Because Paper reads from the same source library as the rest of the suite, the path from "generate
a panel in Flow → paint it in Image → place it in Paper → export a CBZ or print PDF" never leaves
the one project.

---

Next: [The source library →](09-source-library.md)
