#!/usr/bin/env python3.11
"""
Real-Chromium round-trip oracle for the shared CSS font-family serializer.

This script is intentionally optional: it only runs when the Python Playwright
bindings, a Chromium build, and the repository's TypeScript tooling (`tsx`) are
already available on the host. It is not invoked by CI and does not introduce a
browser download dependency for the repository.

For each oracle input, the script:
1. Computes the serializer's canonical output via the TypeScript module.
2. Assigns that output to a real Chromium `font-family` inline style.
3. Reads the value back through CSSOM and checks that it round-trips unchanged.

Usage:
    python3.11 scripts/formatFontFamily_chromium_oracle.py

Exit codes:
    0  - success, or the oracle was skipped because Playwright/tsx is missing
    1  - a round-trip value did not match the serializer output
"""

import json
import shutil
import subprocess
import sys
from pathlib import Path

ORACLE_INPUTS = [
    r"Foo\2c Bar, serif",
    r"Foo\41 Bar, serif",
    r"Foo\1F600 Bar, serif",
    r"Foo/**/Bar, serif",
    r"Foo/* comment */Bar, serif",
    r"Foo /* c1 */ /* c2 */ Bar, serif",
    r'"Foo Bar", serif',
    r'"serif", serif',
    r"inherit, serif",
    r"Foo\ Bar, serif",
    r"Foo\,Bar, serif",
    r"Foo\0 Bar, serif",
    r"Foo\7f Bar, serif",
    r"Foo\a Bar, serif",
    r"M PLUS 1, Inter, sans-serif",
    r"Source Sans 3, system-ui, sans-serif",
    r"Inter, system-ui, sans-serif",
]


def serialize_with_typescript(inputs: list[str]) -> list[str]:
    """Call the repository's TypeScript serializer for every oracle input."""
    inputs_json = json.dumps(inputs)
    ts_code = """
import { formatFontFamily } from './src/lib/formatFontFamily.ts';
const inputs = __INPUTS__;
console.log(JSON.stringify(inputs.map((input) => formatFontFamily(input))));
""".replace('__INPUTS__', inputs_json)

    result = subprocess.run(
        ["npx", "tsx", "-e", ts_code],
        cwd=Path(__file__).resolve().parent.parent,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        print("tsx serializer invocation failed:")
        print(result.stderr, file=sys.stderr)
        sys.exit(1)
    return json.loads(result.stdout.strip().splitlines()[-1])


def main() -> int:
    if shutil.which("npx") is None:
        print("npx is not available; skipping Chromium oracle.")
        return 0

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright Python package is not installed; skipping Chromium oracle.")
        return 0

    serialized = serialize_with_typescript(ORACLE_INPUTS)
    results: list[dict] = []
    mismatches: list[str] = []

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page()
        page.set_content("<!DOCTYPE html><html><body></body></html>")

        for original, css_value in zip(ORACLE_INPUTS, serialized):
            escaped = css_value.replace("\\", "\\\\").replace("'", "\\'")
            script = f"""
                () => {{
                    const d = document.createElement('div');
                    document.body.appendChild(d);
                    d.style.fontFamily = '{escaped}';
                    const roundtrip = d.style.fontFamily;
                    d.remove();
                    return roundtrip;
                }}
            """
            roundtrip = page.evaluate(script)
            results.append({
                "input": original,
                "serialized": css_value,
                "chromiumRoundtrip": roundtrip,
                "match": roundtrip == css_value,
            })
            if roundtrip != css_value:
                mismatches.append(
                    f"input={original!r} serialized={css_value!r} roundtrip={roundtrip!r}"
                )

        browser.close()

    print(json.dumps(results, indent=2, ensure_ascii=False))

    if mismatches:
        print("\nMismatches detected:", file=sys.stderr)
        for line in mismatches:
            print(line, file=sys.stderr)
        return 1

    print("\nAll serializer outputs round-trip unchanged in Chromium.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
