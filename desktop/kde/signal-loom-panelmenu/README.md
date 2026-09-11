# Signal Loom Global Menu (KDE Plasma 6 applet)

Shows Signal Loom's application menu (**File · Edit · View · …**) in the Plasma panel **while the app
keeps hardware acceleration on native Wayland** — the "global menu *and* GPU" combination that the stock
KDE global menu can't give an Electron app.

## Why this exists

KDE's built‑in global menu learns a window's menu from the **AppMenu registrar**, which is keyed on an
**X11 window id**. An Electron/Chromium app only has an X11 window id when it runs under **XWayland**, and
on AMD/Mesa hardware forcing XWayland drops the GPU to software rendering (`No suitable EGL configs
found` → SwiftShader → ~1 fps sketching). So historically you had to choose: global menu *or* GPU.

There is no way to make Chromium register its menu over the native‑Wayland `org_kde_kwin_appmenu`
protocol without patching Chromium. This applet takes the other road — **it doesn't need any window id at
all**:

```
 Signal Loom (native Wayland, GPU intact)          this applet (in the panel)
 ────────────────────────────────────────          ──────────────────────────
 exports org.signalloom.PanelMenu on the   ───►     polls State() every ~350ms
 session bus:                                        when a SL window is focused:
   • State()   → "<active>:<revision>"                 fetches GetMenu(), draws the
   • GetMenu() → base64(menu JSON)                     menu bar; on a click calls
   • Activate(command) → runs it                       Activate(command)
```

No X11 window id is involved anywhere, so Signal Loom stays a native‑Wayland toplevel and the GPU is
never touched. The menu content is built from the exact same `shared/workspaceMenus.json` as the
in‑window menu, so the two can't drift.

It is pure QML (talks to the service through `gdbus`, which ships with glib2 on every KDE install), so it
installs with `kpackagetool6` — no compiler, no dev headers.

## Install

```bash
./install.sh
```

Then:

1. **Enable the service in Signal Loom.** Launch it with the opt‑in flag (this flag does **not** force
   XWayland — verify with `chrome://gpu` that the GPU is still on):

   ```bash
   SIGNAL_LOOM_ELECTRON_PANEL_MENU=1 signal-loom
   ```

   To make it permanent, add `Environment=SIGNAL_LOOM_ELECTRON_PANEL_MENU=1` to the app's `.desktop`
   file, or export the variable from your shell profile.

2. **Add the widget.** Right‑click the panel → *Add or Manage Widgets…* → search **“Signal Loom Global
   Menu”** → drag it onto the panel. If it doesn't appear in the list yet, restart the shell:

   ```bash
   kquitapp6 plasmashell && kstart plasmashell
   ```

3. Focus a Signal Loom window — its menu bar appears in the panel and disappears when you focus another
   app.

## Verify it's working (without the applet)

You can confirm the service side independently:

```bash
# Is a Signal Loom window focused? → "1:<rev>" active, "0:<rev>" not.
gdbus call --session --dest org.signalloom.PanelMenu \
  --object-path /org/signalloom/PanelMenu \
  --method org.signalloom.PanelMenu.State

# Dump the current menu (base64 → JSON):
gdbus call --session --dest org.signalloom.PanelMenu \
  --object-path /org/signalloom/PanelMenu \
  --method org.signalloom.PanelMenu.GetMenu \
  | sed -E "s/^\('//; s/',\)$//" | base64 -d | head -c 400; echo
```

If `State` returns an error like *“The name org.signalloom.PanelMenu was not provided by any .service
files”*, the app isn't running with `SIGNAL_LOOM_ELECTRON_PANEL_MENU=1`.

## Troubleshooting

- **Nothing in the panel, but `State` works.** The applet is present but not added to the panel, or the
  shell needs a restart (`kquitapp6 plasmashell && kstart plasmashell`).
- **Menu shows but a Signal Loom window has to be focused.** That's by design — it's a *global* menu; it
  follows focus. Opening the applet's own menu briefly steals focus, which the app tolerates with a short
  grace window so the menu doesn't flicker away mid‑click.
- **`gdbus: command not found`.** Install glib2 (`sudo pacman -S glib2` / `sudo apt install
  libglib2.0-bin`). It's normally already present on KDE.
- **GPU still software after enabling.** This applet's flag never forces XWayland; if the GPU is off,
  something *else* is (e.g. the older `SIGNAL_LOOM_ELECTRON_GLOBAL_MENU=1` or
  `SIGNAL_LOOM_ELECTRON_FORCE_XWAYLAND=1` — remove those).

## Uninstall

```bash
./install.sh --remove
```

## Notes

- Poll interval defaults to 350 ms. It's a single trivial D‑Bus method call per tick; the heavier
  `GetMenu` only runs when the menu actually changes (focus/workspace/shortcut change bumps a revision).
- The applet is display‑only. Accelerators shown next to items are still handled by the focused Signal
  Loom window, not by the panel.
- Original code (MIT); it interoperates with KDE only through public QML APIs and `gdbus`.
