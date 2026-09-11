#!/usr/bin/env node

import { resolve } from 'node:path';
import { smokePackagedFontLibraries } from './package-font-library-smoke-lib.mjs';

const searchRoot = resolve(process.argv[2] || resolve(process.cwd(), 'release'));

smokePackagedFontLibraries(searchRoot).then((results) => {
  for (const result of results) {
    process.stdout.write(
      `Packaged font smoke passed: ${result.requestUrl} -> ${result.byteLength} bytes (${result.sha256}); license ${result.licenseByteLength} bytes (${result.licenseSha256}) in ${result.root}\n`,
    );
  }
}).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
