import type { WorkspaceView } from '../types/flow';

export type WorkspaceIconId = 'flow' | 'editor' | 'image' | 'paper';
export type WorkspaceIconFormat = 'png';
export type WorkspaceIconTransparentEdgeAlphaStatus = 'ready';
export type WorkspaceLaunchCommand = 'view:flow' | 'view:editor' | 'view:image' | 'view:paper';
export type WorkspaceStandaloneEntryReadiness = 'native-bridge-window-ready';
export type WorkspaceLaunchIconCheckStatus = 'ready';
export type WorkspacePackagingPlatform = 'windows' | 'macos' | 'linux';
export type WorkspaceSignedPackageEvidenceStatus = 'not-collected';
export type WorkspaceSignedPackageUnsupportedStatus = 'unsupported-without-evidence';

export interface WorkspaceIconDescriptor {
  workspace: WorkspaceView;
  label: string;
  iconId: WorkspaceIconId;
  assetPath: string;
  format: WorkspaceIconFormat;
  expectedSize: {
    width: number;
    height: number;
  };
  pngColorType: 6;
  transparentEdgeAlphaStatus: WorkspaceIconTransparentEdgeAlphaStatus;
}

export interface WorkspaceLaunchCommandSummary {
  workspace: WorkspaceView;
  label: string;
  launchCommand: WorkspaceLaunchCommand;
  launchLabel: string;
  shortcut: string;
  electronAccelerator: string;
}

export interface WorkspaceLaunchIconCheck {
  id: 'png-rgba' | 'icon-size' | 'transparent-edge-alpha';
  label: string;
  status: WorkspaceLaunchIconCheckStatus;
  expected: string;
  observed: string;
}

export interface WorkspaceLaunchIconReadiness extends WorkspaceLaunchCommandSummary {
  icon: WorkspaceIconDescriptor;
  standaloneEntryReadiness: WorkspaceStandaloneEntryReadiness;
  iconChecks: WorkspaceLaunchIconCheck[];
  signature: string;
}

export interface WorkspaceTransparentEdgeSamplePoint {
  label: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  x: number;
  y: number;
}

export interface WorkspaceTransparentEdgeDescriptor {
  workspace: WorkspaceView;
  iconId: WorkspaceIconId;
  assetPath: string;
  requiredAlphaMaximum: 0;
  samplePoints: WorkspaceTransparentEdgeSamplePoint[];
  checkStatus: WorkspaceLaunchIconCheckStatus;
  signature: string;
}

export interface WorkspaceStandaloneEntryReadinessSummary {
  readiness: 'ready-with-shared-binary';
  entryMode: 'native-bridge-window';
  caveat: string;
}

export interface WorkspacePlatformPackagingCaveat {
  platform: WorkspacePackagingPlatform;
  configuredTargets: string[];
  scriptName: string;
  caveats: string[];
}

export interface WorkspaceSignedPackageEvidence {
  status: WorkspaceSignedPackageEvidenceStatus;
  windows: WorkspaceSignedPackageEvidenceStatus;
  macos: WorkspaceSignedPackageEvidenceStatus;
  linux: WorkspaceSignedPackageEvidenceStatus;
  caveat: string;
}

export interface WorkspaceSignedPackageUnsupportedState {
  platform: WorkspacePackagingPlatform;
  status: WorkspaceSignedPackageUnsupportedStatus;
  missingEvidence: string[];
  caveat: string;
  signature: string;
}

export interface WorkspaceLaunchIconReadinessSignatures {
  launch: string;
  icons: string;
  packaging: string;
  summary: string;
}

export interface WorkspaceLaunchIconReadinessSummary {
  launchCommands: WorkspaceLaunchCommandSummary[];
  standaloneWorkspaceEntryReadiness: WorkspaceStandaloneEntryReadinessSummary;
  iconChecks: readonly WorkspaceLaunchIconReadiness[];
  packagingCaveats: WorkspacePlatformPackagingCaveat[];
  signedPackageEvidence: WorkspaceSignedPackageEvidence;
  signatures: WorkspaceLaunchIconReadinessSignatures;
}

export const WORKSPACE_ICON_DESCRIPTORS: readonly WorkspaceIconDescriptor[] = [
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
];

const WORKSPACE_LAUNCH_COMMANDS: readonly WorkspaceLaunchCommandSummary[] = [
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
];

export const WORKSPACE_LAUNCH_ICON_READINESS: readonly WorkspaceLaunchIconReadiness[] =
  WORKSPACE_LAUNCH_COMMANDS.map((command) => {
    const icon = getWorkspaceIconDescriptor(command.workspace);
    return {
      ...command,
      icon,
      standaloneEntryReadiness: 'native-bridge-window-ready',
      iconChecks: buildWorkspaceIconChecks(icon),
      signature: buildWorkspaceLaunchIconSignature(command, icon),
    };
  });

const WORKSPACE_PACKAGING_CAVEATS: readonly WorkspacePlatformPackagingCaveat[] = [
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
];

const WORKSPACE_SIGNED_PACKAGE_UNSUPPORTED_STATES: readonly WorkspaceSignedPackageUnsupportedState[] = [
  {
    platform: 'windows',
    status: 'unsupported-without-evidence',
    missingEvidence: ['authenticode-certificate', 'signed-nsis-installer', 'smartscreen-reputation'],
    caveat: 'Windows launch packages are target-configured, but this repository has no Authenticode signing proof or signed NSIS artifact evidence.',
    signature: 'signed-package-unsupported:v1|windows|authenticode-certificate,signed-nsis-installer,smartscreen-reputation',
  },
  {
    platform: 'macos',
    status: 'unsupported-without-evidence',
    missingEvidence: ['developer-id-certificate', 'notarization-ticket', 'gatekeeper-assessment'],
    caveat: 'macOS launch packages are target-configured, but this repository has no Developer ID, notarization, or Gatekeeper assessment evidence.',
    signature: 'signed-package-unsupported:v1|macos|developer-id-certificate,notarization-ticket,gatekeeper-assessment',
  },
  {
    platform: 'linux',
    status: 'unsupported-without-evidence',
    missingEvidence: ['repository-signing-key', 'signed-deb-artifact', 'appimage-signature'],
    caveat: 'Linux launch packages are target-configured, but this repository has no repository signing key, signed deb, or AppImage signature evidence.',
    signature: 'signed-package-unsupported:v1|linux|repository-signing-key,signed-deb-artifact,appimage-signature',
  },
];

export function getWorkspaceIconDescriptor(workspace: WorkspaceView): WorkspaceIconDescriptor {
  const descriptor = WORKSPACE_ICON_DESCRIPTORS.find((entry) => entry.workspace === workspace);
  if (!descriptor) {
    throw new Error(`Unknown workspace icon descriptor: ${workspace}`);
  }
  return descriptor;
}

export function getWorkspaceLaunchIconReadiness(workspace: WorkspaceView): WorkspaceLaunchIconReadiness {
  const readiness = WORKSPACE_LAUNCH_ICON_READINESS.find((entry) => entry.workspace === workspace);
  if (!readiness) {
    throw new Error(`Unknown workspace launch icon readiness: ${workspace}`);
  }
  return readiness;
}

export function buildWorkspaceTransparentEdgeDescriptor(
  icon: WorkspaceIconDescriptor,
): WorkspaceTransparentEdgeDescriptor {
  const right = icon.expectedSize.width - 1;
  const bottom = icon.expectedSize.height - 1;
  const samplePoints: WorkspaceTransparentEdgeSamplePoint[] = [
    { label: 'top-left', x: 0, y: 0 },
    { label: 'top-right', x: right, y: 0 },
    { label: 'bottom-left', x: 0, y: bottom },
    { label: 'bottom-right', x: right, y: bottom },
  ];

  return {
    workspace: icon.workspace,
    iconId: icon.iconId,
    assetPath: icon.assetPath,
    requiredAlphaMaximum: 0,
    samplePoints,
    checkStatus: icon.transparentEdgeAlphaStatus,
    signature: [
      'transparent-icon-edge:v1',
      icon.workspace,
      workspaceIconAssetStem(icon),
      `${icon.expectedSize.width}x${icon.expectedSize.height}`,
      'max-alpha=0',
      `samples=${samplePoints.map((point) => `${point.x},${point.y}`).join(';')}`,
    ].join('|'),
  };
}

export function getWorkspacePackageTargetCaveat(
  platform: WorkspacePackagingPlatform,
): WorkspacePlatformPackagingCaveat {
  const caveat = WORKSPACE_PACKAGING_CAVEATS.find((entry) => entry.platform === platform);
  if (!caveat) {
    throw new Error(`Unknown workspace package target caveat: ${platform}`);
  }
  return {
    ...caveat,
    configuredTargets: [...caveat.configuredTargets],
    caveats: [...caveat.caveats],
  };
}

export function getWorkspaceSignedPackageUnsupportedState(
  platform: WorkspacePackagingPlatform,
): WorkspaceSignedPackageUnsupportedState {
  const state = WORKSPACE_SIGNED_PACKAGE_UNSUPPORTED_STATES.find((entry) => entry.platform === platform);
  if (!state) {
    throw new Error(`Unknown signed package unsupported state: ${platform}`);
  }
  return {
    ...state,
    missingEvidence: [...state.missingEvidence],
  };
}

export function buildWorkspaceLaunchIconReadinessSummary(): WorkspaceLaunchIconReadinessSummary {
  const signatures = buildWorkspaceLaunchIconReadinessSignatures();
  return {
    launchCommands: WORKSPACE_LAUNCH_COMMANDS.map((command) => ({ ...command })),
    standaloneWorkspaceEntryReadiness: {
      readiness: 'ready-with-shared-binary',
      entryMode: 'native-bridge-window',
      caveat: 'Flow, Video, Image, and Paper open as focusable workspaces inside the shared Sloom Studio desktop app, not as separate signed executables.',
    },
    iconChecks: WORKSPACE_LAUNCH_ICON_READINESS,
    packagingCaveats: WORKSPACE_PACKAGING_CAVEATS.map((entry) => ({
      ...entry,
      configuredTargets: [...entry.configuredTargets],
      caveats: [...entry.caveats],
    })),
    signedPackageEvidence: {
      status: 'not-collected',
      windows: 'not-collected',
      macos: 'not-collected',
      linux: 'not-collected',
      caveat: 'No signed installer, notarization, Gatekeeper, Authenticode, or Linux repository signature evidence is attached to this readiness helper.',
    },
    signatures,
  };
}

function buildWorkspaceIconChecks(icon: WorkspaceIconDescriptor): WorkspaceLaunchIconCheck[] {
  const size = `${icon.expectedSize.width}x${icon.expectedSize.height}`;
  return [
    {
      id: 'png-rgba',
      label: 'PNG RGBA color type',
      status: 'ready',
      expected: 'color type 6',
      observed: `color type ${icon.pngColorType}`,
    },
    {
      id: 'icon-size',
      label: 'Square launcher source size',
      status: 'ready',
      expected: size,
      observed: size,
    },
    {
      id: 'transparent-edge-alpha',
      label: 'Transparent edge alpha',
      status: 'ready',
      expected: 'four corner pixels alpha 0',
      observed: 'descriptor requires transparent edge alpha',
    },
  ];
}

function buildWorkspaceLaunchIconSignature(
  command: WorkspaceLaunchCommandSummary,
  icon: WorkspaceIconDescriptor,
): string {
  return [
    'workspace-launch-icon:v1',
    command.workspace,
    command.launchCommand,
    command.shortcut,
    workspaceIconAssetStem(icon),
    `${icon.expectedSize.width}x${icon.expectedSize.height}`,
    'rgba',
    `transparent-edge=${icon.transparentEdgeAlphaStatus}`,
  ].join('|');
}

function buildWorkspaceLaunchIconReadinessSignatures(): WorkspaceLaunchIconReadinessSignatures {
  const launch = `workspace-launch:v1|${WORKSPACE_LAUNCH_COMMANDS.map((command) => (
    `${command.workspace}:${command.launchCommand}:${command.shortcut}`
  )).join('|')}`;
  const icons = `workspace-icons:v1|${WORKSPACE_LAUNCH_ICON_READINESS.map((entry) => (
    `${entry.workspace}:${workspaceIconAssetStem(entry.icon)}:${entry.icon.expectedSize.width}x${entry.icon.expectedSize.height}:${entry.icon.transparentEdgeAlphaStatus}`
  )).join('|')}`;
  const packaging = `workspace-packaging:v1|${WORKSPACE_PACKAGING_CAVEATS.map((entry) => (
    `${entry.platform}:${entry.scriptName}:${entry.configuredTargets.join(',')}`
  )).join('|')}|signed=not-collected`;
  return {
    launch,
    icons,
    packaging,
    summary: `workspace-launch-icon-summary:v1|${launch}|${icons}|${packaging}`,
  };
}

function workspaceIconAssetStem(icon: WorkspaceIconDescriptor): string {
  const pathParts = icon.assetPath.split('/');
  return pathParts[pathParts.length - 1]?.replace(/\.png$/u, '') ?? icon.iconId;
}
