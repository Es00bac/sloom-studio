import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_ICON_DESCRIPTORS,
  WORKSPACE_LAUNCH_ICON_READINESS,
  buildWorkspaceLaunchIconReadinessSummary,
  buildWorkspaceTransparentEdgeDescriptor,
  getWorkspacePackageTargetCaveat,
  getWorkspaceIconDescriptor,
  getWorkspaceLaunchIconReadiness,
  getWorkspaceSignedPackageUnsupportedState,
} from './workspaceIcons';
import type {
  WorkspaceLaunchIconCheck,
  WorkspaceLaunchIconReadiness,
} from './workspaceIcons';

interface PngInfo {
  colorType: number;
  height: number;
  pixels: Uint8Array;
  path: string;
  width: number;
}

function readPngInfo(path: string): PngInfo {
  const buffer = readFileSync(path);
  expect(buffer.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const colorType = buffer.readUInt8(25);
  const idatChunks: Buffer[] = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const dataStart = offset + 8;
    if (type === 'IDAT') {
      idatChunks.push(buffer.subarray(dataStart, dataStart + length));
    }
    offset = dataStart + length + 4;
  }

  return {
    path,
    width,
    height,
    colorType,
    pixels: colorType === 6 ? decodeRgbaPng(width, height, Buffer.concat(idatChunks)) : new Uint8Array(),
  };
}

function decodeRgbaPng(width: number, height: number, compressedData: Uint8Array): Uint8Array {
  const channels = 4;
  const stride = width * channels;
  const inflated = inflateSync(compressedData);
  const pixels = new Uint8Array(width * height * channels);
  let sourceOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated[sourceOffset];
    sourceOffset += 1;
    const row = inflated.subarray(sourceOffset, sourceOffset + stride);
    sourceOffset += stride;

    const outputOffset = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[outputOffset + x - channels] : 0;
      const up = y > 0 ? pixels[outputOffset + x - stride] : 0;
      const upLeft = y > 0 && x >= channels ? pixels[outputOffset + x - stride - channels] : 0;
      pixels[outputOffset + x] = (row[x] + pngFilterDelta(filter, left, up, upLeft)) & 0xff;
    }
  }

  return pixels;
}

function pngFilterDelta(filter: number, left: number, up: number, upLeft: number): number {
  if (filter === 0) return 0;
  if (filter === 1) return left;
  if (filter === 2) return up;
  if (filter === 3) return Math.floor((left + up) / 2);
  if (filter === 4) return paethPredictor(left, up, upLeft);
  throw new Error(`Unsupported PNG filter: ${filter}`);
}

function paethPredictor(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  return upDistance <= upLeftDistance ? up : upLeft;
}

function alphaAt(icon: PngInfo, x: number, y: number): number {
  return icon.pixels[((y * icon.width + x) * 4) + 3];
}

describe('workspace launcher icons', () => {
  it('publishes deterministic transparent-icon readiness descriptors', () => {
    expect(WORKSPACE_ICON_DESCRIPTORS).toEqual([
      {
        workspace: 'flow',
        label: 'Flow',
        iconId: 'flow',
        assetPath: 'src/assets/icon-flow.png',
        format: 'png',
        expectedSize: { width: 1254, height: 1254 },
        pngColorType: 6,
        transparentEdgeAlphaStatus: 'ready',
      },
      {
        workspace: 'editor',
        label: 'Video',
        iconId: 'editor',
        assetPath: 'src/assets/icon-editor.png',
        format: 'png',
        expectedSize: { width: 1254, height: 1254 },
        pngColorType: 6,
        transparentEdgeAlphaStatus: 'ready',
      },
      {
        workspace: 'image',
        label: 'Image',
        iconId: 'image',
        assetPath: 'src/assets/icon-image.png',
        format: 'png',
        expectedSize: { width: 1254, height: 1254 },
        pngColorType: 6,
        transparentEdgeAlphaStatus: 'ready',
      },
      {
        workspace: 'paper',
        label: 'Paper',
        iconId: 'paper',
        assetPath: 'src/assets/icon-paper.png',
        format: 'png',
        expectedSize: { width: 1254, height: 1254 },
        pngColorType: 6,
        transparentEdgeAlphaStatus: 'ready',
      },
    ]);
    expect(getWorkspaceIconDescriptor('image')).toBe(WORKSPACE_ICON_DESCRIPTORS[2]);
  });

  it('uses existing transparent PNG assets for all workspace launch tabs', () => {
    const iconPaths = WORKSPACE_ICON_DESCRIPTORS.map((descriptor) => resolve(descriptor.assetPath));

    const icons = iconPaths.map((path) => {
      expect(existsSync(path), path).toBe(true);
      return readPngInfo(path);
    });

    expect(WORKSPACE_ICON_DESCRIPTORS.map((descriptor) => descriptor.transparentEdgeAlphaStatus)).toEqual([
      'ready',
      'ready',
      'ready',
      'ready',
    ]);
    expect(icons.map((icon) => icon.path.endsWith('.png'))).toEqual([true, true, true, true]);
    expect(icons.map((icon) => [icon.width, icon.height])).toEqual(
      WORKSPACE_ICON_DESCRIPTORS.map((descriptor) => [
        descriptor.expectedSize.width,
        descriptor.expectedSize.height,
      ]),
    );
    expect(icons.map((icon) => icon.colorType)).toEqual(
      WORKSPACE_ICON_DESCRIPTORS.map((descriptor) => descriptor.pngColorType),
    );
    expect(icons.map((icon) => [
      alphaAt(icon, 0, 0),
      alphaAt(icon, icon.width - 1, 0),
      alphaAt(icon, 0, icon.height - 1),
      alphaAt(icon, icon.width - 1, icon.height - 1),
    ])).toEqual([
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ]);
  });

  it('describes transparent edge samples without requiring raster IO callers', () => {
    expect(buildWorkspaceTransparentEdgeDescriptor(getWorkspaceIconDescriptor('flow'))).toEqual({
      workspace: 'flow',
      iconId: 'flow',
      assetPath: 'src/assets/icon-flow.png',
      requiredAlphaMaximum: 0,
      samplePoints: [
        { label: 'top-left', x: 0, y: 0 },
        { label: 'top-right', x: 1253, y: 0 },
        { label: 'bottom-left', x: 0, y: 1253 },
        { label: 'bottom-right', x: 1253, y: 1253 },
      ],
      checkStatus: 'ready',
      signature: 'transparent-icon-edge:v1|flow|icon-flow|1254x1254|max-alpha=0|samples=0,0;1253,0;0,1253;1253,1253',
    });
  });

  it('summarizes standalone launch commands and icon metadata with stable signatures', () => {
    expect(WORKSPACE_LAUNCH_ICON_READINESS.map((entry: WorkspaceLaunchIconReadiness) => ({
      workspace: entry.workspace,
      label: entry.label,
      launchCommand: entry.launchCommand,
      shortcut: entry.shortcut,
      electronAccelerator: entry.electronAccelerator,
      standaloneEntryReadiness: entry.standaloneEntryReadiness,
      iconAssetPath: entry.icon.assetPath,
      transparentEdgeCheck: entry.iconChecks.find((check: WorkspaceLaunchIconCheck) => (
        check.id === 'transparent-edge-alpha'
      ))?.status,
      signature: entry.signature,
    }))).toEqual([
      {
        workspace: 'flow',
        label: 'Flow',
        launchCommand: 'view:flow',
        shortcut: 'Ctrl+1',
        electronAccelerator: 'CommandOrControl+1',
        standaloneEntryReadiness: 'native-bridge-window-ready',
        iconAssetPath: 'src/assets/icon-flow.png',
        transparentEdgeCheck: 'ready',
        signature: 'workspace-launch-icon:v1|flow|view:flow|Ctrl+1|icon-flow|1254x1254|rgba|transparent-edge=ready',
      },
      {
        workspace: 'editor',
        label: 'Video',
        launchCommand: 'view:editor',
        shortcut: 'Ctrl+2',
        electronAccelerator: 'CommandOrControl+2',
        standaloneEntryReadiness: 'native-bridge-window-ready',
        iconAssetPath: 'src/assets/icon-editor.png',
        transparentEdgeCheck: 'ready',
        signature: 'workspace-launch-icon:v1|editor|view:editor|Ctrl+2|icon-editor|1254x1254|rgba|transparent-edge=ready',
      },
      {
        workspace: 'image',
        label: 'Image',
        launchCommand: 'view:image',
        shortcut: 'Ctrl+3',
        electronAccelerator: 'CommandOrControl+3',
        standaloneEntryReadiness: 'native-bridge-window-ready',
        iconAssetPath: 'src/assets/icon-image.png',
        transparentEdgeCheck: 'ready',
        signature: 'workspace-launch-icon:v1|image|view:image|Ctrl+3|icon-image|1254x1254|rgba|transparent-edge=ready',
      },
      {
        workspace: 'paper',
        label: 'Paper',
        launchCommand: 'view:paper',
        shortcut: 'Ctrl+4',
        electronAccelerator: 'CommandOrControl+4',
        standaloneEntryReadiness: 'native-bridge-window-ready',
        iconAssetPath: 'src/assets/icon-paper.png',
        transparentEdgeCheck: 'ready',
        signature: 'workspace-launch-icon:v1|paper|view:paper|Ctrl+4|icon-paper|1254x1254|rgba|transparent-edge=ready',
      },
    ]);

    expect(getWorkspaceLaunchIconReadiness('image')).toBe(WORKSPACE_LAUNCH_ICON_READINESS[2]);
    expect(WORKSPACE_LAUNCH_ICON_READINESS[2].iconChecks).toEqual([
      {
        id: 'png-rgba',
        label: 'PNG RGBA color type',
        status: 'ready',
        expected: 'color type 6',
        observed: 'color type 6',
      },
      {
        id: 'icon-size',
        label: 'Square launcher source size',
        status: 'ready',
        expected: '1254x1254',
        observed: '1254x1254',
      },
      {
        id: 'transparent-edge-alpha',
        label: 'Transparent edge alpha',
        status: 'ready',
        expected: 'four corner pixels alpha 0',
        observed: 'descriptor requires transparent edge alpha',
      },
    ]);
  });

  it('builds a deterministic suite readiness summary without claiming signed package evidence', () => {
    expect(buildWorkspaceLaunchIconReadinessSummary()).toEqual({
      launchCommands: [
        {
          workspace: 'flow',
          label: 'Flow',
          launchCommand: 'view:flow',
          launchLabel: 'Open/Focus Flow Window',
          shortcut: 'Ctrl+1',
          electronAccelerator: 'CommandOrControl+1',
        },
        {
          workspace: 'editor',
          label: 'Video',
          launchCommand: 'view:editor',
          launchLabel: 'Open/Focus Video Window',
          shortcut: 'Ctrl+2',
          electronAccelerator: 'CommandOrControl+2',
        },
        {
          workspace: 'image',
          label: 'Image',
          launchCommand: 'view:image',
          launchLabel: 'Open/Focus Image Window',
          shortcut: 'Ctrl+3',
          electronAccelerator: 'CommandOrControl+3',
        },
        {
          workspace: 'paper',
          label: 'Paper',
          launchCommand: 'view:paper',
          launchLabel: 'Open/Focus Paper Window',
          shortcut: 'Ctrl+4',
          electronAccelerator: 'CommandOrControl+4',
        },
      ],
      standaloneWorkspaceEntryReadiness: {
        readiness: 'ready-with-shared-binary',
        entryMode: 'native-bridge-window',
        caveat: 'Flow, Video, Image, and Paper open as focusable workspaces inside the shared Sloom Studio desktop app, not as separate signed executables.',
      },
      iconChecks: WORKSPACE_LAUNCH_ICON_READINESS,
      packagingCaveats: [
        {
          platform: 'windows',
          configuredTargets: ['nsis:x64'],
          scriptName: 'dist:win',
          caveats: [
            'NSIS packaging is configured for x64 only.',
            'Windows code signing credentials are not represented in package metadata.',
          ],
        },
        {
          platform: 'macos',
          configuredTargets: ['dmg', 'zip'],
          scriptName: 'dist:mac',
          caveats: [
            'DMG packaging requires a macOS build host.',
            'Notarization requires Apple credentials outside package metadata.',
            'Gatekeeper assessment is disabled for local packaging.',
          ],
        },
        {
          platform: 'linux',
          configuredTargets: ['AppImage', 'deb'],
          scriptName: 'dist:linux',
          caveats: [
            'AppImage and deb targets are configured; Snap, Flatpak, and RPM targets are not represented.',
            'The user-local desktop entry installer is separate from electron-builder packages.',
          ],
        },
      ],
      signedPackageEvidence: {
        status: 'not-collected',
        windows: 'not-collected',
        macos: 'not-collected',
        linux: 'not-collected',
        caveat: 'No signed installer, notarization, Gatekeeper, Authenticode, or Linux repository signature evidence is attached to this readiness helper.',
      },
      signatures: {
        launch: 'workspace-launch:v1|flow:view:flow:Ctrl+1|editor:view:editor:Ctrl+2|image:view:image:Ctrl+3|paper:view:paper:Ctrl+4',
        icons: 'workspace-icons:v1|flow:icon-flow:1254x1254:ready|editor:icon-editor:1254x1254:ready|image:icon-image:1254x1254:ready|paper:icon-paper:1254x1254:ready',
        packaging: 'workspace-packaging:v1|windows:dist:win:nsis:x64|macos:dist:mac:dmg,zip|linux:dist:linux:AppImage,deb|signed=not-collected',
        summary: 'workspace-launch-icon-summary:v1|workspace-launch:v1|flow:view:flow:Ctrl+1|editor:view:editor:Ctrl+2|image:view:image:Ctrl+3|paper:view:paper:Ctrl+4|workspace-icons:v1|flow:icon-flow:1254x1254:ready|editor:icon-editor:1254x1254:ready|image:icon-image:1254x1254:ready|paper:icon-paper:1254x1254:ready|workspace-packaging:v1|windows:dist:win:nsis:x64|macos:dist:mac:dmg,zip|linux:dist:linux:AppImage,deb|signed=not-collected',
      },
    });
  });

  it('publishes package target caveats and signed-package unsupported states separately', () => {
    expect(getWorkspacePackageTargetCaveat('macos')).toEqual({
      platform: 'macos',
      configuredTargets: ['dmg', 'zip'],
      scriptName: 'dist:mac',
      caveats: [
        'DMG packaging requires a macOS build host.',
        'Notarization requires Apple credentials outside package metadata.',
        'Gatekeeper assessment is disabled for local packaging.',
      ],
    });

    expect(getWorkspaceSignedPackageUnsupportedState('windows')).toEqual({
      platform: 'windows',
      status: 'unsupported-without-evidence',
      missingEvidence: ['authenticode-certificate', 'signed-nsis-installer', 'smartscreen-reputation'],
      caveat: 'Windows launch packages are target-configured, but this repository has no Authenticode signing proof or signed NSIS artifact evidence.',
      signature: 'signed-package-unsupported:v1|windows|authenticode-certificate,signed-nsis-installer,smartscreen-reputation',
    });
  });
});
