# Bundled CMYK ICC output profiles

These ICC print (output/`prtr`) profiles are bundled so Sloom Studio can produce real
color-managed CMYK and conformant PDF/X **out of the box**, for everyone, offline.

## Provenance & license
Every profile here embeds the statement **"This profile is free of known copyright
restrictions"** in its own `cprt` tag (verify with any ICC inspector). They are the
standard characterization-data profiles distributed with the freedesktop `colord` /
shared-color-profiles project and are free to redistribute. The `colord` *daemon* is
GPL, but these profile data files carry their own no-known-copyright statement.

Adobe's profiles (US Web Coated SWOP by Adobe, Japan Color, etc.) are NOT redistributable
and are deliberately NOT bundled — instead the app can load them from the host OS or from a
user-supplied `.icc` (see the ICC profile picker: Bundled / System / Custom).

## Set
US:       GRACoL_TR006_coated, SWOP_TR003_coated_3, SWOP_TR005_coated_5
Europe:   FOGRA39L_coated (= ISO Coated v2), FOGRA27L_coated, FOGRA28L_webcoated,
          FOGRA29L_uncoated, FOGRA47L_uncoated, FOGRA30L_uncoated_yellowish,
          FOGRA40L_SC_paper, FOGRA45L_lwc
Newsprint: SNAP_TR002_newsprint (US), IFRA26S_2004_newsprint (EU)

Japan Color 2001 is not freely redistributable; JP users can select it from the OS
(if Adobe is installed) or supply their own `.icc`.
