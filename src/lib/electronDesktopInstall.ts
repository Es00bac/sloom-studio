export interface DesktopLauncherInstallPlanOptions {
  homeDir: string;
  projectRoot: string;
}

export interface DesktopLauncherInstallPlan {
  binTarget: string;
  desktopTarget: string;
  desktopEntry: string;
  launcherSource: string;
}

export function buildDesktopLauncherInstallPlan({
  homeDir,
  projectRoot,
}: DesktopLauncherInstallPlanOptions): DesktopLauncherInstallPlan {
  const normalizedHome = trimTrailingSlash(homeDir);
  const normalizedProject = trimTrailingSlash(projectRoot);
  const binTarget = `${normalizedHome}/.local/bin/signal-loom-electron`;
  const desktopTarget = `${normalizedHome}/.local/share/applications/signal-loom.desktop`;
  return {
    binTarget,
    desktopTarget,
    launcherSource: `${normalizedProject}/scripts/signal-loom-electron`,
    desktopEntry: [
      '[Desktop Entry]',
      'Type=Application',
      'Version=1.0',
      'Name=Sloom Studio',
      'GenericName=Multimedia Editor',
      'Comment=Multimedia editor, media flow builder, and timeline editor',
      `Exec=${binTarget}`,
      'Icon=signal-loom',
      'Terminal=false',
      'Categories=AudioVideo;AudioVideoEditing;',
      'Keywords=video;audio;multimedia;editor;timeline;comic;manga;publishing;',
      'StartupNotify=true',
      'StartupWMClass=Sloom Studio',
      '',
    ].join('\n'),
  };
}

function trimTrailingSlash(path: string): string {
  return path.replace(/\/+$/, '') || '/';
}
