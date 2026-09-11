module.exports = async function verifyBundledFontArtifactAfterPack(context) {
  if (typeof context?.appOutDir !== 'string' || !context.appOutDir) {
    throw new Error('electron-builder afterPack did not provide an application output directory.');
  }
  const { smokePackagedFontLibraries } = await import('./package-font-library-smoke-lib.mjs');
  const results = await smokePackagedFontLibraries(context.appOutDir);
  for (const result of results) {
    process.stdout.write(
      `[font-pack afterPack] exact face and license request passed in ${result.root}\n`,
    );
  }
};
