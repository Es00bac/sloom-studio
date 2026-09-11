#!/usr/bin/env node

import { resolve } from 'node:path';
import { verifyFontPackRoot } from './font-pack-verification.mjs';

const sourceMode = process.argv.includes('--source');
const rootArgument = process.argv.slice(2).find((argument) => argument !== '--source');
const root = resolve(rootArgument || resolve(process.cwd(), 'build', 'font-library'));

verifyFontPackRoot(root, { strictPayload: !sourceMode }).then((result) => {
  process.stdout.write(
    `Verified font pack ${result.sourceLock.fontPackRevision}: 116 families / 430 faces / ${result.checksumCount} checksummed files at ${root}\n`,
  );
}).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
