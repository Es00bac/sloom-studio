#!/usr/bin/env node
import {
  executeProjectCli,
  exitCodeForProjectCliResult,
  formatProjectCliHelp,
  formatProjectCliResult,
} from './sloom-project-cli-lib.mjs';

const result = await executeProjectCli(process.argv.slice(2));

if (result.help) {
  process.stdout.write(`${formatProjectCliHelp()}\n`);
} else {
  process.stdout.write(formatProjectCliResult(result));
}

process.exitCode = exitCodeForProjectCliResult(result);
