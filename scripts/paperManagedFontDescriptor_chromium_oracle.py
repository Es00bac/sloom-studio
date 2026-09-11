#!/usr/bin/env python3.11
"""Real-Chromium parser check for Paper's exact managed-font load descriptors."""

import json
import shutil
import subprocess
import sys
from pathlib import Path


def descriptors_from_typescript() -> list[str]:
    stretches = [50, 62.5, 75, 87.5, 100, 112.5, 125, 150, 200]
    code = f"""
import {{ paperManagedFontDescriptor }} from './src/lib/paperExactManagedFonts.ts';
const stretches = {json.dumps(stretches)};
console.log(JSON.stringify(stretches.map((stretchPercent, index) => paperManagedFontDescriptor({{
  identity: `face-${{index}}`, familyAlias: `exact-${{index}}`, postscriptName: `Exact-${{index}}`,
  weight: 400, style: 'normal', stretchPercent, format: 'truetype', collectionIndex: 0,
}}))));
"""
    result = subprocess.run(
        ["npx", "tsx", "-e", code],
        cwd=Path(__file__).resolve().parent.parent,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        print(result.stderr, file=sys.stderr)
        raise RuntimeError("TypeScript descriptor generation failed")
    return json.loads(result.stdout.strip().splitlines()[-1])


def main() -> int:
    if shutil.which("npx") is None:
        print(json.dumps({"skipped": "npx is unavailable"}))
        return 0
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(json.dumps({"skipped": "Python Playwright is unavailable"}))
        return 0

    descriptors = descriptors_from_typescript()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content("<!doctype html><html><body></body></html>")
        parsed = page.evaluate(
            """async (values) => Promise.all(values.map(async (value) => {
              try {
                await document.fonts.load(value, 'WMWMWMiiiii012345');
                return { value, accepted: true };
              } catch (error) {
                return { value, accepted: false, error: String(error) };
              }
            }))""",
            descriptors,
        )
        old_percentage = page.evaluate(
            """async () => {
              try {
                await document.fonts.load('normal 400 100% 16px "old-percentage"');
                return true;
              } catch {
                return false;
              }
            }"""
        )
        browser.close()

    print(json.dumps({"descriptors": parsed, "oldPercentageAccepted": old_percentage}))
    return 0 if all(item["accepted"] for item in parsed) and not old_percentage else 1


if __name__ == "__main__":
    sys.exit(main())
