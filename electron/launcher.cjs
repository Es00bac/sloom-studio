const { spawnSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join, resolve } = require('node:path');
const {
  buildElectronEnvironment,
  getElectronLaunchArgs,
} = require('./linux-windowing.cjs');
const DEV_RENDERER_URL = 'http://127.0.0.1:5173';
const ENABLE_GPU_OPT_IN = 'SIGNAL_LOOM_ELECTRON_ENABLE_GPU';
const LOCAL_NPM_BIN = 'SIGNAL_LOOM_NPM_BIN';
// The terminal wrapper cd's into the project root before launching, so it exports the
// invoking directory here; relative file arguments resolve against it, not the repo root.
const LAUNCH_CWD_ENV = 'SIGNAL_LOOM_LAUNCH_CWD';

function getElectronRendererUrl(mode) {
  return mode === 'dev' ? DEV_RENDERER_URL : undefined;
}

// Forward file/URL arguments to the Electron process (the packaged binary gets them in argv
// natively; the dev launcher used to drop them — AUD-040). Flags stay launcher-owned, URLs pass
// through untouched, and relative paths are pinned to the invoking cwd before the app launches.
function getLauncherForwardedOpenTargets(argv, options = {}) {
  const { cwd = process.cwd() } = options;

  return argv
    .filter((token) => typeof token === 'string' && token.trim() !== '' && !token.startsWith('-'))
    .map((token) => (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(token) ? token : resolve(cwd, token)));
}

function runCommand(command, args, env) {
  const result = spawnSync(command, args, {
    env,
    stdio: 'inherit',
  });

  if (result.error) {
    throw result.error;
  }

  return result.status ?? (result.signal ? 1 : 0);
}

function runBuild(baseEnv = process.env, platform = process.platform) {
  const projectRoot = process.cwd();
  const localNpmCli = join(projectRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js');
  const configuredNpm = (baseEnv[LOCAL_NPM_BIN] || '').trim();
  const npmCandidates = [
    configuredNpm ? (
      configuredNpm.endsWith('.js')
        ? { command: process.execPath, args: [configuredNpm, 'run', 'build'] }
        : { command: configuredNpm, args: ['run', 'build'] }
    ) : null,
    existsSync(localNpmCli)
      ? { command: process.execPath, args: [localNpmCli, 'run', 'build'] }
      : null,
    { command: platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', 'build'] },
  ].filter(Boolean);

  for (const candidate of npmCandidates) {
    try {
      return runCommand(candidate.command, candidate.args, baseEnv);
    } catch (error) {
      if (error && error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  console.error(
    'Unable to run the Electron build step: `npm` is unavailable. Set `SIGNAL_LOOM_NPM_BIN` or ensure npm is on PATH.',
  );
  return 1;
}

function hasUsableProductionBundle() {
  return existsSync(join(process.cwd(), 'dist', 'index.html'));
}

function main(argv = process.argv.slice(2)) {
  const mode = argv.includes('--dev') ? 'dev' : 'production';
  const baseEnv = { ...process.env };
  const openTargets = getLauncherForwardedOpenTargets(argv, {
    cwd: baseEnv[LAUNCH_CWD_ENV] || process.cwd(),
  });

  if (mode !== 'dev') {
    const buildStatus = runBuild(baseEnv, process.platform);

    if (buildStatus !== 0) {
      if (!hasUsableProductionBundle()) {
        console.error(
          'Unable to build the production bundle and no usable existing `dist/index.html` was found.',
        );
        return buildStatus;
      }

      console.error(
        'Production build failed. Continuing launch with existing built assets in `dist`.',
      );
    }
  }

  const electronEnv = buildElectronEnvironment(baseEnv, process.platform);
  const rendererUrl = getElectronRendererUrl(mode);

  if (rendererUrl) {
    electronEnv.ELECTRON_RENDERER_URL = rendererUrl;
  }

  return runCommand(require('electron'), getElectronLaunchArgs(electronEnv, process.platform, openTargets), electronEnv);
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  buildElectronEnvironment,
  getElectronLaunchArgs,
  getElectronRendererUrl,
  getLauncherForwardedOpenTargets,
  main,
};
