#!/usr/bin/env -S node --import tsx
// CI entry point for the Luffy filesystem card registry.
//
// Walks `cards/` (relative to repo root), generates `generated/cards.manifest.json`
// deterministically, and exits non-zero on any scanner error or probability
// drift. CI runs this on every push and pull request; the manifest must
// match the committed one byte-for-byte.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  scanCards,
  buildManifest,
  serializeManifest,
  parseManifest,
} from '../src/lib/cards/registry/scanner.js';
import { assertPublishedProbabilities } from '../src/lib/cards/registry/loader.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// bots/luffy/scripts/check-cards.ts → repo root is three levels up.
const repoRoot = path.resolve(here, '..', '..', '..');
const cardsRoot = path.join(repoRoot, 'cards');
const generatedDir = path.join(repoRoot, 'generated');
const manifestPath = path.join(generatedDir, 'cards.manifest.json');

const result = scanCards(cardsRoot);

const RARITY_FOLDERS = ['Common', 'Rare', 'Elite', 'Gold', 'EX', 'EXX', 'S', 'SS', 'SSS+', 'Diamond', 'Limited-Arts'];
for (const folder of RARITY_FOLDERS) {
  const full = path.join(cardsRoot, folder);
  if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
    result.errors.push({
      code: 'empty_root',
      message: `missing rarity folder: ${folder}`,
      path: full,
    });
  }
}

const manifest = buildManifest(result);
const serialized = serializeManifest(manifest);

let mismatched = false;
let existingRaw = null;
if (fs.existsSync(manifestPath)) {
  existingRaw = fs.readFileSync(manifestPath, 'utf8');
  if (existingRaw !== serialized) {
    mismatched = true;
  }
}

if (process.argv.includes('--write')) {
  fs.mkdirSync(generatedDir, { recursive: true });
  fs.writeFileSync(manifestPath, serialized);
  console.log(`Wrote ${path.relative(repoRoot, manifestPath)} (${result.cards.length} cards).`);
} else if (mismatched) {
  console.error(`Manifest drift detected.`);
  console.error(`  committed: ${existingRaw?.length ?? 0} bytes`);
  console.error(`  expected:  ${serialized.length} bytes`);
  console.error(`Run \`node scripts/check-cards.mjs --write\` to refresh.`);
  process.exitCode = 2;
}

if (result.errors.length > 0) {
  console.error(`Scanner reported ${result.errors.length} error(s):`);
  for (const err of result.errors) {
    console.error(`  [${err.code}] ${err.path}: ${err.message}`);
  }
  process.exitCode = process.exitCode ?? 1;
}

if (result.warnings.length > 0) {
  console.warn(`Scanner reported ${result.warnings.length} warning(s):`);
  for (const w of result.warnings) {
    console.warn(`  [${w.code}] ${w.path}: ${w.message}`);
  }
}

try {
  assertPublishedProbabilities();
} catch (err) {
  console.error(`Probability check failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = process.exitCode ?? 1;
}

if (!process.argv.includes('--write') && existingRaw !== null) {
  const parsed = parseManifest(existingRaw);
  if (!parsed.ok) {
    console.error(`Committed manifest failed to parse: ${parsed.error}`);
    process.exitCode = process.exitCode ?? 1;
  }
}

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}

console.log(`Scanned ${result.cards.length} cards across ${result.folders.length} rarity folders.`);