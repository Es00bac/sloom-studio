const { resolve } = require('node:path');

module.exports = async function verifyBundledFontArtifactBeforePack(context) {
  const projectRoot = resolve(context?.packager?.projectDir || resolve(__dirname, '..'));
  const stagedRoot = resolve(projectRoot, 'build', 'font-library');
  const { verifyFontPackRoot } = await import('./font-pack-verification.mjs');
  const result = await verifyFontPackRoot(stagedRoot, { strictPayload: true });
  process.stdout.write(
    `[font-pack beforePack] verified ${result.sourceLock.fontPackRevision}: 116 families / 430 faces / ${result.checksumCount} payload files\n`,
  );
};
