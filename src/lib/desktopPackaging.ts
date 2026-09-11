import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

export type DesktopWorkspaceId = 'flow' | 'editor' | 'image' | 'paper';
export type DesktopWorkspaceLaunchCommand = 'view:flow' | 'view:editor' | 'view:image' | 'view:paper';
export type DesktopPackageSurface = 'electron-native-menu';
export type DesktopPackagingReadiness = 'ready' | 'configured-with-caveats' | 'blocked';
export type DesktopPackagingPlatform = 'windows' | 'macos' | 'linux';
export type DesktopPackagingHostRequirement =
  | 'linux-cross-build-supported'
  | 'macos-required-for-final-package'
  | 'native-linux-build-host';

export interface DesktopWorkspaceLaunchReadiness {
  workspace: DesktopWorkspaceId;
  appName: string;
  menuLabel: string;
  launchLabel: string;
  launchCommand: DesktopWorkspaceLaunchCommand;
  accelerator: string;
  packageSurface: DesktopPackageSurface;
  readiness: Extract<DesktopPackagingReadiness, 'ready'>;
  caveats: string[];
}

export interface DesktopPlatformPackagingReadiness {
  platform: DesktopPackagingPlatform;
  scriptName: string;
  script: string | undefined;
  configuredTargets: string[];
  processDocumentPath: string;
  hostRequirement: DesktopPackagingHostRequirement;
  readiness: Extract<DesktopPackagingReadiness, 'configured-with-caveats'>;
  caveats: string[];
  artifactExpectations: string[];
  signingCaveats: string[];
}

export interface DesktopPackagingDependencyReadiness {
  packageName: 'electron' | 'electron-builder';
  versionRange: string | undefined;
  role: 'desktop-runtime' | 'installer-builder';
  limitation: string;
  bundledBy: string;
}

export interface DesktopPackagingChecklistItem {
  id: 'desktop-app-files' | 'native-render-resource' | 'bundled-font-library-resource' | 'windows-installer-dependencies';
  label: string;
  readiness: Extract<DesktopPackagingReadiness, 'ready' | 'blocked'>;
  evidence: string[];
  blockers?: string[];
}

export interface StagedFontLibraryReadiness {
  readiness: Extract<DesktopPackagingReadiness, 'ready' | 'blocked'>;
  evidence: string[];
  blockers: string[];
}

export interface DesktopPackagingReadinessSummary {
  productName: string | undefined;
  appId: string | undefined;
  workspaceLaunchSurface: DesktopPackageSurface;
  platforms: DesktopPlatformPackagingReadiness[];
  dependencies: DesktopPackagingDependencyReadiness[];
  dependencyChecklist: DesktopPackagingChecklistItem[];
  installerLimitations: string[];
}

export interface DesktopPackagingReadinessOptions {
  stagedFontLibraryRoot?: string;
}

interface ElectronBuilderTargetObject {
  target?: string;
  arch?: string[];
}

type ElectronBuilderTarget =
  | string
  | ElectronBuilderTargetObject
  | Array<string | ElectronBuilderTargetObject>
  | undefined;

interface DesktopPackagingPackageMetadata {
  build?: {
    appId?: string;
    productName?: string;
    files?: string[];
    extraResources?: Array<{
      from?: string;
      to?: string;
    }>;
    win?: {
      target?: ElectronBuilderTarget;
    };
    mac?: {
      target?: string[];
    };
    linux?: {
      target?: string[];
    };
  };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}

export const DESKTOP_WORKSPACE_LAUNCH_READINESS: readonly DesktopWorkspaceLaunchReadiness[] = [
  {
    workspace: 'flow',
    appName: 'Flow',
    menuLabel: 'Flow',
    launchLabel: 'Open/Focus Flow Window',
    launchCommand: 'view:flow',
    accelerator: 'CommandOrControl+1',
    packageSurface: 'electron-native-menu',
    readiness: 'ready',
    caveats: ['Launches the Flow workspace through the shared Sloom Studio desktop binary.'],
  },
  {
    workspace: 'editor',
    appName: 'Video',
    menuLabel: 'Video',
    launchLabel: 'Open/Focus Video Window',
    launchCommand: 'view:editor',
    accelerator: 'CommandOrControl+2',
    packageSurface: 'electron-native-menu',
    readiness: 'ready',
    caveats: ['Launches the Video workspace through the shared Sloom Studio desktop binary.'],
  },
  {
    workspace: 'image',
    appName: 'Image',
    menuLabel: 'Image',
    launchLabel: 'Open/Focus Image Window',
    launchCommand: 'view:image',
    accelerator: 'CommandOrControl+3',
    packageSurface: 'electron-native-menu',
    readiness: 'ready',
    caveats: ['Launches the Image workspace through the shared Sloom Studio desktop binary.'],
  },
  {
    workspace: 'paper',
    appName: 'Paper',
    menuLabel: 'Paper',
    launchLabel: 'Open/Focus Paper Window',
    launchCommand: 'view:paper',
    accelerator: 'CommandOrControl+4',
    packageSurface: 'electron-native-menu',
    readiness: 'ready',
    caveats: ['Launches the Paper workspace through the shared Sloom Studio desktop binary.'],
  },
];

export function getDesktopWorkspaceLaunchReadiness(workspace: DesktopWorkspaceId): DesktopWorkspaceLaunchReadiness {
  const descriptor = DESKTOP_WORKSPACE_LAUNCH_READINESS.find((entry) => entry.workspace === workspace);
  if (!descriptor) {
    throw new Error(`Unknown desktop workspace launch readiness: ${workspace}`);
  }
  return descriptor;
}

export function buildDesktopPackagingReadinessSummary(
  packageJson: DesktopPackagingPackageMetadata,
  options: DesktopPackagingReadinessOptions = {},
): DesktopPackagingReadinessSummary {
  const windowsCaveat =
    'Windows installer packaging can be prepared on Linux, but signing credentials and final validation still need a Windows-oriented release step.';
  const macNotarizationCaveat = 'Notarization requires Apple credentials outside package metadata.';

  return {
    productName: packageJson.build?.productName,
    appId: packageJson.build?.appId,
    workspaceLaunchSurface: 'electron-native-menu',
    platforms: [
      {
        platform: 'windows',
        scriptName: 'dist:win',
        script: packageJson.scripts?.['dist:win'],
        configuredTargets: normalizeElectronBuilderTargets(packageJson.build?.win?.target),
        processDocumentPath: 'docs/packaging/windows-installer.md',
        hostRequirement: 'linux-cross-build-supported',
        readiness: 'configured-with-caveats',
        caveats: [
          'NSIS packaging is configured for x64 only.',
          windowsCaveat,
        ],
        artifactExpectations: [
          'Expected configured artifact type: NSIS installer for x64.',
          'Do not claim a signed installer artifact exists until an actual release build produces it.',
        ],
        signingCaveats: ['Windows code signing credentials are not represented in package metadata.'],
      },
      {
        platform: 'macos',
        scriptName: 'dist:mac',
        script: packageJson.scripts?.['dist:mac'],
        configuredTargets: packageJson.build?.mac?.target ?? [],
        processDocumentPath: 'docs/packaging/macos-build.md',
        hostRequirement: 'macos-required-for-final-package',
        readiness: 'configured-with-caveats',
        caveats: [
          'Final DMG packaging requires a macOS build host.',
          'Linux can only smoke-check the unsigned ZIP path and cannot replace the Mac packaging/signing/notarization process.',
          'Gatekeeper assessment is disabled for local packaging.',
        ],
        artifactExpectations: [
          'Expected configured artifact types: DMG and ZIP app packages.',
          'Do not claim a notarized app package exists until a macOS release build completes successfully.',
        ],
        signingCaveats: [
          macNotarizationCaveat,
          'A Developer ID Application certificate is required for signed distribution builds.',
        ],
      },
      {
        platform: 'linux',
        scriptName: 'dist:linux',
        script: packageJson.scripts?.['dist:linux'],
        configuredTargets: packageJson.build?.linux?.target ?? [],
        processDocumentPath: 'docs/packaging/linux-build.md',
        hostRequirement: 'native-linux-build-host',
        readiness: 'configured-with-caveats',
        caveats: [
          'AppImage, deb, and Snap targets are configured; Flatpak and RPM targets are not represented.',
          'The user-local desktop entry installer is separate from electron-builder packages.',
        ],
        artifactExpectations: ['Expected configured artifact types: AppImage, deb, and Snap packages.'],
        signingCaveats: [],
      },
    ],
    dependencies: [
      {
        packageName: 'electron',
        versionRange: getPackageVersionRange(packageJson, 'electron'),
        role: 'desktop-runtime',
        limitation: 'Native launch depends on installed npm dependencies; no Electron binary is vendored in the repository.',
        bundledBy: 'electron-builder files packaging',
      },
      {
        packageName: 'electron-builder',
        versionRange: getPackageVersionRange(packageJson, 'electron-builder'),
        role: 'installer-builder',
        limitation: 'Installer creation depends on host toolchains and signing/notarization credentials outside package metadata.',
        bundledBy: 'build-time host dependency only',
      },
    ],
    dependencyChecklist: buildDesktopPackagingDependencyChecklist(packageJson, options.stagedFontLibraryRoot),
    installerLimitations: [
      'Flow, Video, Image, and Paper are focusable workspaces inside one Sloom Studio desktop app, not separate packaged executables.',
      'Provider credentials, model downloads, and Android accelerator setup remain runtime/user configuration and are not bundled in desktop installers.',
    ],
  };
}

function buildDesktopPackagingDependencyChecklist(
  packageJson: DesktopPackagingPackageMetadata,
  stagedFontLibraryRoot = join(process.cwd(), 'build', 'font-library'),
): DesktopPackagingChecklistItem[] {
  const packagedFiles = packageJson.build?.files ?? [];
  const extraResources = packageJson.build?.extraResources ?? [];
  const stagedFontLibrary = verifyStagedFontLibrary(stagedFontLibraryRoot);

  return [
    {
      id: 'desktop-app-files',
      label: 'Desktop build includes renderer, Electron entrypoints, shared code, and package metadata.',
      readiness: 'ready',
      evidence: ['dist/**/*', 'electron/**/*', 'shared/**/*', 'package.json'].filter((entry) => packagedFiles.includes(entry)),
    },
    {
      id: 'native-render-resource',
      label: 'Desktop build includes the native render helper as an extra resource.',
      readiness: 'ready',
      evidence: extraResources
        .filter((resource) => resource.from === 'ops/native-render' && resource.to === 'ops/native-render')
        .map((resource) => `${resource.from} -> ${resource.to}`),
    },
    {
      id: 'bundled-font-library-resource',
      label: 'Desktop build includes the audited managed font library as a read-only extra resource.',
      readiness: stagedFontLibrary.readiness,
      evidence: [
        ...extraResources
        .filter((resource) => resource.from === 'build/font-library' && resource.to === 'font-library')
        .map((resource) => `${resource.from} -> ${resource.to}`),
        ...stagedFontLibrary.evidence,
      ],
      ...(stagedFontLibrary.blockers.length ? { blockers: stagedFontLibrary.blockers } : {}),
    },
    {
      id: 'windows-installer-dependencies',
      label: 'Windows installer readiness depends on installed Electron and Electron Builder packages before packaging.',
      readiness: 'ready',
      evidence: [
        formatDependencyEvidence('electron', getPackageVersionRange(packageJson, 'electron')),
        formatDependencyEvidence('electron-builder', getPackageVersionRange(packageJson, 'electron-builder')),
      ],
    },
  ];
}

/** Verify the staged electron-builder font payload, not merely its package.json declaration. */
export function verifyStagedFontLibrary(root: string): StagedFontLibraryReadiness {
  const manifestPath = join(root, 'inventory', 'font-inventory.json');
  const sumsPath = join(root, 'inventory', 'SHA256SUMS');
  const blockers: string[] = [];

  if (!existsSync(manifestPath)) blockers.push('Staged font manifest is missing.');
  if (!existsSync(sumsPath)) blockers.push('Staged font checksum manifest is missing.');
  if (blockers.length) return { readiness: 'blocked', evidence: [], blockers };

  try {
    const inventory = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      catalogFamilyCount?: unknown;
      faceCount?: unknown;
      fontFileCount?: unknown;
      criticalErrorCount?: unknown;
      families?: unknown;
    };
    const families = Array.isArray(inventory.families) ? inventory.families : [];
    const faces = families.flatMap((family) => (
      isRecord(family) && Array.isArray(family.faces) ? family.faces : []
    ));
    const declaredFaceCount = typeof inventory.faceCount === 'number' ? inventory.faceCount : 0;
    const declaredFontFileCount = typeof inventory.fontFileCount === 'number' ? inventory.fontFileCount : 0;

    if (inventory.catalogFamilyCount !== 116 || families.length !== 116) {
      blockers.push('Staged font manifest does not contain the approved 116 families.');
    }
    if (declaredFaceCount !== 430 || declaredFontFileCount !== 430 || faces.length !== 430) {
      blockers.push('Staged font manifest does not contain the approved 430 faces.');
    }
    if (inventory.criticalErrorCount !== 0) {
      blockers.push('Staged font manifest reports critical font validation errors.');
    }

    const checksums = new Map<string, string>();
    for (const line of readFileSync(sumsPath, 'utf8').trim().split(/\r?\n/).filter(Boolean)) {
      const match = /^([0-9a-f]{64}) {2}(.+)$/i.exec(line);
      if (!match || !isSafeRelativePath(match[2])) {
        blockers.push('Staged font checksum manifest contains an invalid entry.');
        continue;
      }
      checksums.set(match[2], match[1].toLowerCase());
    }

    for (const face of faces) {
      if (!isRecord(face) || typeof face.file !== 'string' || typeof face.sha256 !== 'string' || !isSafeRelativePath(face.file)) {
        blockers.push('Staged font manifest contains an invalid face entry.');
        continue;
      }
      if (checksums.get(face.file) !== face.sha256.toLowerCase()) {
        blockers.push(`Staged font checksum manifest does not match ${face.file}.`);
      }
    }

    for (const [relativePath, expectedHash] of checksums) {
      const path = join(root, relativePath);
      if (!existsSync(path) || !statSync(path).isFile() || statSync(path).size === 0) {
        blockers.push(`Staged font bytes are missing for ${relativePath}.`);
        continue;
      }
      const actualHash = createHash('sha256').update(readFileSync(path)).digest('hex');
      if (actualHash !== expectedHash) {
        blockers.push(`Staged font bytes fail checksum verification for ${relativePath}.`);
      }
    }
  } catch {
    blockers.push('Staged font manifest could not be parsed or verified.');
  }

  return blockers.length
    ? { readiness: 'blocked', evidence: [], blockers: [...new Set(blockers)] }
    : {
      readiness: 'ready',
      evidence: ['Staged 116-family/430-face font manifest and all checksummed font bytes verified.'],
      blockers: [],
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isSafeRelativePath(value: string): boolean {
  return Boolean(value)
    && !isAbsolute(value)
    && !value.replace(/\\/g, '/').split('/').some((part) => !part || part === '.' || part === '..');
}

function normalizeElectronBuilderTargets(targets: ElectronBuilderTarget): string[] {
  const entries = Array.isArray(targets) ? targets : targets ? [targets] : [];
  return entries.map((entry) => {
    if (typeof entry === 'string') {
      return entry;
    }
    const target = entry.target ?? 'unknown';
    const arch = entry.arch?.join(',') ?? '';
    return arch ? `${target}:${arch}` : target;
  });
}

function getPackageVersionRange(
  packageJson: DesktopPackagingPackageMetadata,
  packageName: 'electron' | 'electron-builder',
): string | undefined {
  return packageJson.devDependencies?.[packageName] ?? packageJson.dependencies?.[packageName];
}

function formatDependencyEvidence(packageName: 'electron' | 'electron-builder', versionRange: string | undefined): string {
  return versionRange ? `${packageName}@${versionRange}` : `${packageName}@missing`;
}
