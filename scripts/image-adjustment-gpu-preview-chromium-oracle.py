#!/usr/bin/env python3.11
"""Exercise the actual MH-052 WebGL2 adjustment module in headless Chromium.

This oracle intentionally bundles the production TypeScript module and invokes
`tryApplyAdjustmentGpu` in Chromium rather than reimplementing its shader in a
test fixture. The input is a non-symmetric multi-row bitmap containing several
weighted-luma half-byte ties. Both sides use the production integer byte-domain
contract.

Usage:
    python3.11 scripts/image-adjustment-gpu-preview-chromium-oracle.py
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
MODULE = REPO_ROOT / "src/components/ImageEditor/ImageAdjustmentGpuPreview.ts"


def bundle_preview_module(output: Path) -> None:
    result = subprocess.run(
        [
            "npx",
            "esbuild",
            str(MODULE),
            "--bundle",
            "--platform=browser",
            "--format=iife",
            "--global-name=MH052GpuPreview",
            "--target=es2020",
            f"--outfile={output}",
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"esbuild could not bundle the production GPU module:\n{result.stderr}")


def main() -> int:
    if shutil.which("npx") is None:
        print(json.dumps({"skipped": "npx is unavailable"}))
        return 0
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print(json.dumps({"skipped": "Python Playwright is unavailable"}))
        return 0
    chromium = shutil.which("chromium") or shutil.which("chromium-browser") or shutil.which("google-chrome")
    if chromium is None:
        print(json.dumps({"skipped": "system Chromium is unavailable"}))
        return 0

    with tempfile.TemporaryDirectory(prefix="mh052-gpu-oracle-") as temporary:
        bundle = Path(temporary) / "gpu-preview.js"
        bundle_preview_module(bundle)
        source = bundle.read_text(encoding="utf-8")

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(
                headless=True,
                executable_path=chromium,
                args=["--use-angle=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"],
            )
            page = browser.new_page()
            page.set_content("<!doctype html><html><body></body></html>")
            page.add_script_tag(content=source)
            result = page.evaluate(
                """() => {
                  const width = 13;
                  const height = 9;
                  const halfTies = [
                    [0, 41, 44], [0, 42, 228], [0, 69, 196], [0, 96, 164],
                    [0, 123, 132], [0, 177, 68], [0, 178, 252], [0, 205, 220],
                    [0, 231, 4], [0, 232, 188], [1, 15, 77], [1, 42, 45], [0, 68, 12],
                  ];
                  const source = new ImageData(width, height);
                  const expected = new Uint8ClampedArray(source.data.length);
                  const rowSignatures = [];
                  let halfTieCount = 0;
                  const probe = new OffscreenCanvas(1, 1).getContext('webgl2');
                  const debugRenderer = probe?.getExtension('WEBGL_debug_renderer_info');
                  const renderer = probe
                    ? String(probe.getParameter(debugRenderer?.UNMASKED_RENDERER_WEBGL ?? probe.RENDERER))
                    : '';

                  for (let y = 0; y < height; y += 1) {
                    let rowSignature = '';
                    for (let x = 0; x < width; x += 1) {
                      const index = y * width + x;
                      const offset = index * 4;
                      const tie = index < halfTies.length ? halfTies[index] : null;
                      const red = tie ? tie[0] : (x * 37 + y * 13 + 19) % 256;
                      const green = tie ? tie[1] : (x * 11 + y * 59 + 7) % 256;
                      const blue = tie ? tie[2] : (x * 83 + y * 17 + 41) % 256;
                      const alpha = (x * 29 + y * 47 + 53) % 256;
                      const weighted = red * 2126 + green * 7152 + blue * 722;
                      const luma = Math.floor((weighted + 5000) / 10000);

                      if (weighted % 10000 === 5000) halfTieCount += 1;
                      source.data[offset] = red;
                      source.data[offset + 1] = green;
                      source.data[offset + 2] = blue;
                      source.data[offset + 3] = alpha;
                      expected[offset] = luma;
                      expected[offset + 1] = luma;
                      expected[offset + 2] = luma;
                      expected[offset + 3] = alpha;
                      rowSignature += `${red},${green},${blue},${alpha};`;
                    }
                    rowSignatures.push(rowSignature);
                  }

                  const output = globalThis.MH052GpuPreview.tryApplyAdjustmentGpu(source, { kind: 'blackWhite' });
                  if (!output) return { gpuAvailable: false, halfTieCount, rowCount: new Set(rowSignatures).size, renderer };

                  const mismatches = [];
                  for (let index = 0; index < expected.length; index += 1) {
                    if (output.data[index] !== expected[index]) {
                      mismatches.push({ index, expected: expected[index], actual: output.data[index] });
                      if (mismatches.length === 8) break;
                    }
                  }
                  return {
                    gpuAvailable: true,
                    width,
                    height,
                    halfTieCount,
                    distinctInputRows: new Set(rowSignatures).size,
                    renderer,
                    mismatches,
                  };
                }"""
            )
            browser.close()

    print(json.dumps(result, sort_keys=True))
    valid = (
        result.get("gpuAvailable")
        and result.get("halfTieCount", 0) >= 12
        and result.get("distinctInputRows", 0) == 9
        and result.get("renderer")
        and not result.get("mismatches")
    )
    if valid:
        return 0
    print("MH-052 Chromium WebGL2 CPU/GPU parity oracle failed", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
