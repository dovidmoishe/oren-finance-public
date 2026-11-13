import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const helpers = require(path.join(path.dirname(require.resolve('eslint/package.json')), 'lib/eslint/eslint-helpers.js'));

// One eslint process for the whole tree peaked at 1087 MiB. A single file and
// one directory both peaked near 440 MiB, so sequential chunks stay inside
// the 768 MiB light cap while using the same config and the same file set.
const CHUNK_SIZE = 12;

export async function listDefaultLintFiles(cwd = process.cwd()) {
  const linter = helpers.createLinter({ cwd, flags: [] }, { emit() {} });
  const configLoader = helpers.createConfigLoader({
    cwd,
    baseConfig: null,
    overrideConfig: null,
    configFile: null,
    ignore: true,
  }, helpers.createDefaultConfigs(), linter, { emit() {} });
  return helpers.findFiles({
    patterns: ['.'],
    cwd,
    globInputPaths: true,
    configLoader,
    errorOnUnmatchedPattern: true,
  });
}

export function chunkFiles(files, size = CHUNK_SIZE) {
  if (!Number.isInteger(size) || size < 1) throw new Error('invalid chunk size');
  const chunks = [];
  for (let index = 0; index < files.length; index += size) {
    chunks.push(files.slice(index, index + size));
  }
  return chunks;
}

function eslintBin() {
  const manifest = require.resolve('eslint/package.json');
  const relative = require(manifest).bin.eslint;
  return path.join(path.dirname(manifest), relative);
}

export function lintChunks(chunks, spawn = spawnSync) {
  let failed = 0;
  for (const chunk of chunks) {
    const result = spawn(process.execPath, [eslintBin(), ...chunk], {
      cwd: process.cwd(),
      stdio: 'inherit',
    });
    if (result.status !== 0) failed = result.status || 1;
  }
  return failed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const files = await listDefaultLintFiles();
  if (!files.length) {
    console.error('bounded lint found no files');
    process.exit(1);
  }
  process.exit(lintChunks(chunkFiles(files)));
}
