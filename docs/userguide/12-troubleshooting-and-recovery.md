# 12. Troubleshooting & recovery

Start with the least destructive action. Do not overwrite the only copy of a project while
diagnosing it; export or duplicate the current `.sloom` file and keep its scratch folder nearby.

## Recover work after a crash or forced close

1. Reopen Sloom Studio and open **Project Library**.
2. Find the recovery entry for the project. The timestamp identifies when the complete project
   serializer last captured it.
3. Choose **Export** if you want to inspect a copy first, or **Recover** to open it as the active
   project.
4. Check Flow, Image, Video, Paper, and the Source Library before saving over an older file.
5. Once the project is healthy, create a named snapshot in **Project → History**.

Autosave normally captures changes after they settle for about 30 seconds and at focus/lifecycle
boundaries. A recovery entry is not proof that an external provider job completed; check the node or
job status and Source Library receipt before spending again.

## Restore an earlier project version

Open **Project → History**, select a retained version or named snapshot, and preview its timestamp
and label. Restore into the current session only after saving/exporting any work you still need.
History is project state, while `.bak-…` files beside a desktop project are filesystem-level save
backups. Keep both when diagnosing possible corruption.

## Missing or offline media

- For a desktop Video source marked offline, use **Relink** and choose the intended original. Sloom
  validates the candidate rather than silently accepting a same-named file.
- Use **Consolidate used media** when you want linked sources copied into managed project storage.
- Move a lean `.sloom` together with its `…signal-loom-scratch` directory. Use a portable project
  export when handing the project to another machine.
- Browser session-linked media, especially files at least 512 MB, may need to be selected again
  after the browser session closes. Use desktop linked ingest for durable feature-length work.

## Video preview or render fails

1. Read the exact message in the Program Monitor or render queue; do not substitute a different
   source, model, codec, or render preset without choosing it deliberately.
2. Confirm every timeline source is online and that a desktop project has a writable scratch
   directory.
3. Seek the playhead and verify the Program Monitor before export. A source monitor preview is not
   the final composition.
4. For a simple unmodified one-video sequence, desktop can use direct FFmpeg and VA-API when the
   host supports it. Effects, overlays, transforms, multi-clip composites, or an unavailable GPU
   use the general/native CPU route instead.
5. For sequences of 30 minutes or more, use desktop native export. The browser per-frame route is
   deliberately refused to avoid materializing feature-length media in browser memory.
6. Open the durable render queue after restart to inspect, retry, or cancel retained jobs.

## Flow generation fails or costs are unknown

- Open the node and confirm provider, exact model, required inputs, and credential status.
- Test the provider connection from Settings. An HTTP or semantic provider error is a failed run
  even if an underlying process exited normally.
- With a Flow spend cap enabled, unknown pricing is refused before dispatch. Either select a route
  with known pricing or deliberately clear/change the cap.
- Re-running an unchanged graph can use a validated cache receipt. Use **Regenerate** only when you
  intend to force a new provider call.
- Scheduled runs require the app and project session to remain open. Missed intervals are not
  replayed after restart; resumable batches reopen paused.

## Image or Paper import/export refuses a file

Some professional routes fail closed so structure is not silently lost. Read the named limitation:
high-bit or CMYK Image documents, PSD/XCF interchange, IDML import, PDF/X, EPUB, and accessible PDF
all validate supported precision, profiles, archive paths, assets, or document structure. Convert or
simplify a copy only when that loss is acceptable. The
[qualified-feature guide](15-qualified-missing-hundred-features.md) states each supported subset.

## Report a reproducible problem safely

Use the local crash/problem report export. Review it before sharing: reports are designed to omit
provider secrets and project content, but file paths, system details, or filenames can still be
sensitive. Include the Sloom version, platform, exact action, exact error text, whether the project
reopens, and the smallest non-private reproduction you can provide. Never paste an API key into a
report or screenshot.

---

Next: [Accessibility, collaboration & automation →](13-accessibility-collaboration-and-automation.md)
