# Origin multiplayer website

The live static page is https://sloom.studio/origin/. Source lives in this
repository under website/origin; preserve every other Sloom route.

The 16 October 2026 design replaces the earlier illustrated rig/infestation
presentation at the owner's request. It uses the established bitmap title,
Unbounded/Barlow fonts, current native map photography and eight newly captured
adult crew portraits. current-imagery.json records the exact source captures.
The two released films and their narration subtitles remain unchanged.

index.html presents the multiplayer game, both factions, three current maps,
all eight crew, five chassis, closed testing status and the supplied NS/NS2
history. field-guide.html retains detailed abilities, controls, structures and
technology. No App ID, Steam store link, release date or Deck certification is
invented. No private download URL is embedded in the public site.

Preview on qinda with python3 -m http.server 18874 --bind 127.0.0.1 --directory
website. Publish index.html, field-guide.html, origin.css, origin.js and
assets/current/ to the existing VPS /var/www/sloom.studio/html/origin/. Keep
existing assets/media, subtitle MIME rules and the rest of Sloom unchanged.
Old artwork, motion sources and scripts remain in history and on disk.

Browser verification used native Firefox on qinda at 1440 pixels and a real
390-pixel child viewport (desktop Firefox has a 500-pixel minimum window).
Both pages have no broken images or horizontal overflow, all 13 cast files
and local links resolve, mobile navigation opens/closes, reduced motion is
honored, and both films decode metadata. Evidence lives under validation/.
