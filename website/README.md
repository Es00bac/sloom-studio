# sloom.studio website

Static pages for the free-software edition. `assets/site.css` is the only stylesheet; fonts are the
Inter and Space Grotesk variable files already served from `/assets/fonts/` on the production host.

| Page | Audience |
|---|---|
| `index.html` | Users: what it is, screenshots, what "free software" means here |
| `download/` | Users and packagers: every format, Gentoo and Arch, verification |
| `docs/` | Users: guide index linking to the repository docs |
| `develop/` | Developers: stack, layout, project model, engine seam, packaging |
| `contribute/` | Contributors: help wanted, first-patch list, review, DCO and CLA |
| `license/` | Everyone: GPL in plain words, trademarks, why Hane's engine is separate |

Deploy: copy this directory over the web root, leaving `/hane/`, `/ja/hane/`, `/forum/`,
`/privacy.html` and `/assets/fonts/` in place. Links to GitHub assume the repository is public
at `Es00bac/sloom-studio`; deploy after it is.
