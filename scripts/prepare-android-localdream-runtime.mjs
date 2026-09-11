import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';

const LOCAL_DREAM_VERSION = 'v2.6.4';
const LOCAL_DREAM_APK_NAME = 'LocalDream_armv8a_2.6.4.apk';
const LOCAL_DREAM_APK_URL = `https://github.com/xororz/local-dream/releases/download/${LOCAL_DREAM_VERSION}/${LOCAL_DREAM_APK_NAME}`;
const LOCAL_DREAM_LICENSE = 'CC-BY-NC-4.0';

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, 'output/android-localdream-runtime');
const apkPath = path.join(outputDir, LOCAL_DREAM_APK_NAME);
const nativeLibTarget = path.join(repoRoot, 'android/app/src/main/jniLibs/arm64-v8a/libstable_diffusion_core.so');
const qnnAssetsDir = path.join(repoRoot, 'android/app/src/main/assets/qnnlibs');
const provenancePath = path.join(repoRoot, 'android/app/src/main/assets/localdream-runtime-provenance.json');
const force = process.argv.includes('--force');

if (!force && existsSync(nativeLibTarget) && existsSync(path.join(qnnAssetsDir, 'libQnnHtp.so'))) {
  console.log('Local Dream runtime assets already present. Use --force to refresh.');
  process.exit(0);
}

mkdirSync(outputDir, { recursive: true });
mkdirSync(path.dirname(nativeLibTarget), { recursive: true });
mkdirSync(qnnAssetsDir, { recursive: true });

if (!existsSync(apkPath) || force) {
  console.log(`Downloading ${LOCAL_DREAM_APK_URL}`);
  const response = await fetch(LOCAL_DREAM_APK_URL, {
    headers: { 'User-Agent': 'Signal-Loom-Android-Build' },
  });
  if (!response.ok) {
    throw new Error(`Could not download Local Dream APK (${response.status}): ${await response.text()}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(apkPath, buffer);
  console.log(`Saved ${apkPath} (${buffer.length} bytes)`);
}

const entries = unzipSync(new Uint8Array(readFileSync(apkPath)));
const nativeEntry = entries['lib/arm64-v8a/libstable_diffusion_core.so'];
if (!nativeEntry) {
  throw new Error('Local Dream APK did not contain lib/arm64-v8a/libstable_diffusion_core.so');
}
writeFileSync(nativeLibTarget, Buffer.from(nativeEntry));

let qnnAssetCount = 0;
for (const [entryName, bytes] of Object.entries(entries)) {
  if (!entryName.startsWith('assets/qnnlibs/') || entryName.endsWith('/')) continue;
  const fileName = path.basename(entryName);
  writeFileSync(path.join(qnnAssetsDir, fileName), Buffer.from(bytes));
  qnnAssetCount += 1;
}

if (qnnAssetCount === 0) {
  throw new Error('Local Dream APK did not contain assets/qnnlibs runtime files.');
}

writeFileSync(provenancePath, `${JSON.stringify({
  source: 'Local Dream Android release APK',
  version: LOCAL_DREAM_VERSION,
  apkUrl: LOCAL_DREAM_APK_URL,
  license: LOCAL_DREAM_LICENSE,
  extracted: [
    'lib/arm64-v8a/libstable_diffusion_core.so',
    'assets/qnnlibs/*',
  ],
  notes: [
    'Used by Signal Loom Android for in-app Local Dream-style QNN image upscaling.',
    'Upscaler model files are downloaded at runtime into Signal Loom app-private storage.',
  ],
}, null, 2)}\n`);

console.log(`Prepared bundled Local Dream runtime: ${nativeLibTarget}`);
console.log(`Prepared ${qnnAssetCount} QNN runtime asset(s): ${qnnAssetsDir}`);
console.log(`Wrote provenance: ${provenancePath}`);
