// ---------------------------------------------------------------------------
// Card catalogue and pack catalog.
//
// Definitions are sourced from the committed card manifest at
// `generated/cards.manifest.json` (built by the registry scanner and
// validated in CI). The runtime exports below are byte-compatible with the
// original hardcoded catalog, so commands, the engine, the store, and
// existing tests stay source-compatible.
//
// Adding a new card is a filesystem operation: drop an image (and
// optionally a `.json` sidecar) into the matching rarity folder under
// `cards/`, commit, push. CI regenerates the manifest and runs the
// registry test suite; Luffy picks the card up automatically.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CardDefinitionDoc, CardPackDoc } from '@eiflow/shared';

import { loadRegistry, assertPublishedProbabilities as assertRegistryProbabilities } from './registry/loader.js';
import { parseManifest } from './registry/scanner.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// bots/luffy/src/lib/cards/catalog.ts → repo root is five levels up.
const repoRoot = path.resolve(here, '..', '..', '..', '..', '..');
const manifestPath = path.join(repoRoot, 'generated', 'cards.manifest.json');

function loadManifestAtStartup(): ReturnType<typeof loadRegistry> {
  // The manifest is generated and committed at build time. If it is
  // missing in a deployed artefact (e.g. an old Render cache), Luffy
  // refuses to start with a clear error rather than silently serving
  // an empty catalog.
  if (!fs.existsSync(manifestPath)) {
    throw new Error(
      `card manifest missing at ${path.relative(repoRoot, manifestPath)}; ` +
        `run \`npm run cards:check -w @eiflow/bot-luffy\` (or \`node --import tsx bots/luffy/scripts/check-cards.ts --write\`) to regenerate it.`,
    );
  }
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const parsed = parseManifest(raw);
  if (!parsed.ok) {
    throw new Error(`card manifest is invalid: ${parsed.error}`);
  }
  return loadRegistry(parsed.manifest, new Date());
}

const loaded = loadManifestAtStartup();

export const CARD_DEFINITIONS: readonly CardDefinitionDoc[] = loaded.definitions;
export const CARD_PACKS: readonly CardPackDoc[] = loaded.packs;

/* -- Lookup helpers ------------------------------------------------------- */

const DEFINITION_INDEX: ReadonlyMap<string, CardDefinitionDoc> = new Map(
  CARD_DEFINITIONS.map((def) => [def.definition_id, def]),
);

const PACK_INDEX: ReadonlyMap<string, CardPackDoc> = new Map(
  CARD_PACKS.map((pack) => [pack.pack_id, pack]),
);

export function getDefinition(definition_id: string): CardDefinitionDoc | null {
  return DEFINITION_INDEX.get(definition_id) ?? null;
}

export function getPack(pack_id: string): CardPackDoc | null {
  return PACK_INDEX.get(pack_id) ?? null;
}

export function definitionsByRank(rank: CardDefinitionDoc['rank']): readonly CardDefinitionDoc[] {
  // Archived definitions remain addressable through getDefinition() so owned
  // instances can render, but they must never enter new pack draws.
  return CARD_DEFINITIONS.filter((def) => def.rank === rank && def.enabled !== false);
}

/** Used in tests to assert the published 0.001% Limited Arts probability. */
export function assertPublishedProbabilities(): void {
  assertRegistryProbabilities();
}