import { existsSync, readFileSync } from 'node:fs';
import { extname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const LOCAL_ASSET_ATTRIBUTE = /\b(?:href|src)="([^"]+)"/g;

function normalizeLocalAssetPath(distRoot, rawReference) {
  if (
    !rawReference
    || rawReference.startsWith('#')
    || rawReference.startsWith('data:')
    || rawReference.startsWith('http:')
    || rawReference.startsWith('https:')
  ) {
    return null;
  }

  const pathOnly = rawReference.split(/[?#]/u, 1)[0];
  const absolute = resolve(distRoot, pathOnly.replace(/^\.\//u, '').replace(/^\//u, ''));
  const relativePath = relative(distRoot, absolute);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    throw new Error(`Packaged asset escapes dist/: ${rawReference}`);
  }
  return { absolute, relativePath };
}

export function verifyChromeOsWebAssets(distDirectory = resolve('dist')) {
  const distRoot = resolve(distDirectory);
  const indexPath = resolve(distRoot, 'index.html');
  if (!existsSync(indexPath)) {
    throw new Error(`Missing built entry point: ${indexPath}`);
  }

  const html = readFileSync(indexPath, 'utf8');
  const referencedAssets = [];
  for (const match of html.matchAll(LOCAL_ASSET_ATTRIBUTE)) {
    const asset = normalizeLocalAssetPath(distRoot, match[1]);
    if (asset) {
      referencedAssets.push(asset);
    }
  }

  const missing = referencedAssets.filter(({ absolute }) => !existsSync(absolute));
  if (missing.length > 0) {
    throw new Error(`Missing packaged web assets:\n${missing.map(({ relativePath }) => `- ${relativePath}`).join('\n')}`);
  }

  const stylesheets = referencedAssets.filter(({ absolute }) => extname(absolute) === '.css');
  if (stylesheets.length === 0) {
    throw new Error('The built entry point does not reference a stylesheet.');
  }

  const cssSources = stylesheets.map(({ absolute, relativePath }) => ({
    relativePath,
    css: readFileSync(absolute, 'utf8'),
  }));
  const applicationStylesheet = cssSources.find(({ relativePath }) => /(?:^|[/\\])index-[^/\\]+\.css$/u.test(relativePath));
  if (!applicationStylesheet || applicationStylesheet.css.length < 100_000) {
    throw new Error('The compiled Sloom application stylesheet is absent or unexpectedly small.');
  }

  for (const { relativePath, css } of cssSources) {
    if (/@layer\b/u.test(css)) {
      throw new Error(`${relativePath} still contains @layer; older ChromeOS WebViews will discard Sloom's rules.`);
    }
  }

  const applicationCss = applicationStylesheet.css;
  if (!applicationCss.includes(':not(#\\#)')) {
    throw new Error('The application stylesheet does not contain the cascade-layer compatibility transform.');
  }
  if (!/--color-cyan-500:#[0-9a-f]{6}/iu.test(applicationCss)) {
    throw new Error('The application stylesheet does not contain a legacy RGB/hex Tailwind color fallback.');
  }
  if (applicationCss.includes('color-mix(') && !/@supports\s*\(color:\s*color-mix\(/u.test(applicationCss)) {
    throw new Error('Modern color-mix declarations are not protected by a feature query.');
  }

  return {
    referencedAssetCount: referencedAssets.length,
    stylesheetCount: stylesheets.length,
    applicationStylesheet: applicationStylesheet.relativePath,
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  const result = verifyChromeOsWebAssets(process.argv[2] ? resolve(process.argv[2]) : resolve('dist'));
  process.stdout.write(
    `ChromeOS web assets verified: ${result.referencedAssetCount} references, `
    + `${result.stylesheetCount} stylesheets, ${result.applicationStylesheet}\n`,
  );
}
