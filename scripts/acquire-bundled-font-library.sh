#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
METADATA_ROOT="$ROOT/resources/font-pack"
PACK_ROOT=${SLOOM_FONT_PACK_BUILD_ROOT:-"$ROOT/build/font-pack-source"}
CATALOG=${CATALOG:-"$METADATA_ROOT/catalog/families.tsv"}
SOURCE_DIR=${SOURCE_DIR:-"$ROOT/.cache/font-sources/google-fonts"}
DEST_DIR="$PACK_ROOT/collection"
GOOGLE_FONTS_SHA=${GOOGLE_FONTS_SHA:-26c5c976d82d50c24a8f0a7ac455e0a7c639c226}
LIBERATION_VERSION=2.1.5
LIBERATION_SHA256=7191c669bf38899f73a2094ed00f7b800553364f90e2637010a69c0e268f25d0
LIBERATION_URL=https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz
MPLUS_LICENSE_COMMIT=0d4459efc913a91f33c3f08b219a5a95d282c7b8
MPLUS_LICENSE_SHA256=1bd6eceefce3edcb25cad3d5a4fbec6405d66946a6672daf69fe667c7e52f591

mkdir -p "$(dirname "$SOURCE_DIR")" "$PACK_ROOT"
rm -rf "$DEST_DIR"
mkdir -p "$DEST_DIR" "$PACK_ROOT/catalog" "$PACK_ROOT/inventory"
cp "$METADATA_ROOT/README.md" "$PACK_ROOT/README.md"
cp "$METADATA_ROOT/DISTRIBUTION.md" "$PACK_ROOT/DISTRIBUTION.md"
cp "$METADATA_ROOT/source-artifact.json" "$PACK_ROOT/source-artifact.json"
cp "$METADATA_ROOT/catalog/families.tsv" "$PACK_ROOT/catalog/families.tsv"
cp "$METADATA_ROOT/inventory/README.md" "$PACK_ROOT/inventory/README.md"
cp "$METADATA_ROOT/inventory/SHA256SUMS" "$PACK_ROOT/inventory/SHA256SUMS"
cp "$METADATA_ROOT/inventory/font-inventory.json" "$PACK_ROOT/inventory/font-inventory.json"

if [[ ! -d "$SOURCE_DIR/.git" ]]; then
  git clone --filter=blob:none --no-checkout https://github.com/google/fonts.git "$SOURCE_DIR"
fi

git -C "$SOURCE_DIR" fetch --depth=1 origin "$GOOGLE_FONTS_SHA"
git -C "$SOURCE_DIR" sparse-checkout init --cone

paths_file=$(mktemp)
resolved_file=$(mktemp)
missing_file=$(mktemp)
extract_dir=$(mktemp -d)
trap 'rm -f "$paths_file" "$resolved_file" "$missing_file"; rm -rf "$extract_dir"' EXIT

while IFS=$'\t' read -r collection family slug; do
  [[ "$collection" == "collection" ]] && continue
  resolved=""
  for license_root in ofl apache ufl; do
    if git -C "$SOURCE_DIR" cat-file -e "$GOOGLE_FONTS_SHA:$license_root/$slug" 2>/dev/null; then
      resolved="$license_root/$slug"
      break
    fi
  done
  if [[ -z "$resolved" ]]; then
    printf '%s\t%s\t%s\n' "$collection" "$family" "$slug" >> "$missing_file"
    continue
  fi
  printf '%s\n' "$resolved" >> "$paths_file"
  printf '%s\t%s\t%s\t%s\n' "$collection" "$family" "$slug" "$resolved" >> "$resolved_file"
done < "$CATALOG"

sort -u -o "$paths_file" "$paths_file"
git -C "$SOURCE_DIR" sparse-checkout set --stdin < "$paths_file"
git -C "$SOURCE_DIR" checkout --detach "$GOOGLE_FONTS_SHA"

while IFS=$'\t' read -r collection family slug resolved; do
  family_dest="$DEST_DIR/$collection/$slug"
  rm -rf "$family_dest"
  mkdir -p "$family_dest"
  cp -a "$SOURCE_DIR/$resolved/." "$family_dest/"
  printf '%s\n' "$family" > "$family_dest/FAMILY_NAME.txt"
  printf '%s\n' "https://github.com/google/fonts/tree/$GOOGLE_FONTS_SHA/$resolved" > "$family_dest/SOURCE_URL.txt"
  printf '%s\n' "$GOOGLE_FONTS_SHA" > "$family_dest/SOURCE_COMMIT.txt"
done < "$resolved_file"

# The current Google Fonts Inconsolata package contains a variable font whose
# default PostScript name collides with its included static Regular face.
# Retain the complete static set and omit only that redundant variable file so
# installing the whole family directory cannot create a name collision.
inconsolata_variable="$DEST_DIR/base/inconsolata/Inconsolata[wdth,wght].ttf"
if [[ -f "$inconsolata_variable" ]]; then
  rm "$inconsolata_variable"
  printf '%s\n' \
    'The redundant variable font was omitted because its default PostScript name collides with the included Inconsolata-Regular.ttf. All upstream static faces are retained.' \
    > "$DEST_DIR/base/inconsolata/PACKAGING_NOTE.txt"
fi

# Google Fonts metadata marks M PLUS Rounded 1c as OFL, but the pinned family
# directory omits the actual license text. Add the matching upstream OFL file
# and pin both its commit and checksum.
mplus_dir="$DEST_DIR/base/mplusrounded1c"
mplus_license_url="https://raw.githubusercontent.com/rayshan/mplus-fonts/$MPLUS_LICENSE_COMMIT/OFL.txt"
curl --fail --location --silent --show-error "$mplus_license_url" -o "$mplus_dir/OFL.txt"
printf '%s  %s\n' "$MPLUS_LICENSE_SHA256" "$mplus_dir/OFL.txt" | sha256sum --check --status
printf '%s\n' "$mplus_license_url" > "$mplus_dir/LICENSE_SOURCE_URL.txt"
printf '%s\n' "$MPLUS_LICENSE_COMMIT" > "$mplus_dir/LICENSE_SOURCE_COMMIT.txt"
printf '%s\n' "$MPLUS_LICENSE_SHA256" > "$mplus_dir/LICENSE_SHA256.txt"

# Liberation 2.1 is no longer carried by Google Fonts. Acquire the official
# 2.1.5 release archive and keep its OFL license and project documentation with
# each of the three selected families.
upstream_dir="$(dirname "$SOURCE_DIR")/upstream"
liberation_archive="$upstream_dir/liberation-fonts-ttf-$LIBERATION_VERSION.tar.gz"
mkdir -p "$upstream_dir"
if [[ ! -f "$liberation_archive" ]] || ! printf '%s  %s\n' "$LIBERATION_SHA256" "$liberation_archive" | sha256sum --check --status; then
  curl --fail --location --silent --show-error "$LIBERATION_URL" -o "$liberation_archive"
fi
printf '%s  %s\n' "$LIBERATION_SHA256" "$liberation_archive" | sha256sum --check --status
tar -xzf "$liberation_archive" -C "$extract_dir"
liberation_root="$extract_dir/liberation-fonts-ttf-$LIBERATION_VERSION"
while IFS=$'\t' read -r family slug prefix; do
  family_dest="$DEST_DIR/base/$slug"
  rm -rf "$family_dest"
  mkdir -p "$family_dest"
  cp "$liberation_root/$prefix"*.ttf "$family_dest/"
  cp "$liberation_root/LICENSE" "$liberation_root/README.md" "$liberation_root/ChangeLog" "$liberation_root/AUTHORS" "$family_dest/"
  printf '%s\n' "$family" > "$family_dest/FAMILY_NAME.txt"
  printf '%s\n' 'https://github.com/liberationfonts/liberation-fonts' > "$family_dest/SOURCE_URL.txt"
  printf '%s\n' "$LIBERATION_VERSION" > "$family_dest/SOURCE_VERSION.txt"
  printf '%s\n' "$LIBERATION_SHA256" > "$family_dest/SOURCE_ARCHIVE_SHA256.txt"
done <<'LIBERATION_FAMILIES'
Liberation Sans	liberationsans	LiberationSans-
Liberation Serif	liberationserif	LiberationSerif-
Liberation Mono	liberationmono	LiberationMono-
LIBERATION_FAMILIES

cp "$resolved_file" "$DEST_DIR/google-fonts-resolved.tsv"
cp "$missing_file" "$DEST_DIR/google-fonts-missing.tsv"

resolved_count=$(wc -l < "$resolved_file")
missing_count=$(wc -l < "$missing_file")
printf 'Resolved %s families from google/fonts @ %s\n' "$resolved_count" "$GOOGLE_FONTS_SHA"
printf 'Missing %s families from google/fonts (resolved from authoritative upstream releases)\n' "$missing_count"
if [[ "$missing_count" -gt 0 ]]; then
  sed -n '1,200p' "$missing_file"
fi

node "$ROOT/scripts/verify-bundled-font-library.mjs" --source "$PACK_ROOT"
printf 'Acquired immutable Sloom font pack at %s\n' "$PACK_ROOT"
