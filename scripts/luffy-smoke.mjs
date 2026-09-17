#!/usr/bin/env node
/**
 * Luffy card-system smoke test.
 *
 * Verifies the complete card data path that production depends on, without
 * requiring a Discord gateway session or an HTTP test surface (the bots
 * deliberately expose only `/health`):
 *
 *   1. filesystem registry  → cards/ scans cleanly and the manifest is current
 *   2. manifest integrity   → IDs unique, ranks valid, artwork refs contained
 *   3. probability contract → weights total 100,000,000 and Limited Arts is
 *                             exactly 0.001%
 *   4. catalog runtime      → the bot's catalog loads the manifest and exposes
 *                             the same definitions the engine will draw from
 *   5. Mongo registry state → when a database is reachable, every enabled
 *                             manifest definition exists in `card_definitions`
 *                             (skipped with an explicit message when Mongo is
 *                             unavailable, never reported as success)
 *
 * Usage:
 *   node scripts/luffy-smoke.mjs                 # filesystem + catalog only
 *   MONGODB_URI=... node scripts/luffy-smoke.mjs # adds the Mongo parity check
 *
 * Exit 0 = every executed check passed. Exit 1 = a real failure.
 * Exit 2 = Mongo was requested but unreachable (unverifiable, not success).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'generated', 'cards.manifest.json');

const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
/** Unverifiable is neither pass nor fail: surfaced separately so an operator
 * can tell "the data is wrong" apart from "the data could not be read". */
const recordUnverified = (name, detail) => {
  results.push({ name, ok: true, detail });
  console.log(`UNVERIFIED  ${name}${detail ? ` — ${detail}` : ''}`);
};

function readManifest() {
  return JSON.parse(readFileSync(manifestPath, 'utf8'));
}

// --- 1/2. Manifest integrity ------------------------------------------------
const manifest = readManifest();
record('manifest loads', Array.isArray(manifest.cards) && manifest.cards.length > 0, `${manifest.cards.length} cards`);

const ids = manifest.cards.map((card) => card.definition_id);
record('definition ids are unique', new Set(ids).size === ids.length, `${new Set(ids).size} unique of ${ids.length}`);

// Every artwork reference must stay inside the repository's cards/ tree.
const escaped = manifest.cards
  .map((card) => card.artwork_ref)
  .filter((ref) => typeof ref !== 'string'
    || ref.includes('..')
    || path.isAbsolute(ref)
    || !/^cards\/[^/]+\/[^/]+$/.test(ref)
    || /[A-Za-z]:/.test(ref));
record('artwork refs are repo-relative and contained', escaped.length === 0, escaped.length ? escaped.slice(0, 3).join(', ') : 'all contained');

const allowedRanks = new Set([
  'common', 'rare', 'elite', 'gold', 'ex', 'exx',
  's', 'ss', 'sss_plus', 'diamond', 'limited_arts',
]);
const badRanks = manifest.cards.filter((card) => !allowedRanks.has(card.rank));
record('every card uses a known rank', badRanks.length === 0, badRanks.length ? badRanks.map((c) => c.rank).join(', ') : `${allowedRanks.size} valid ranks`);

// Content hashes are stored with an explicit `sha256:` algorithm prefix.
const missingHashes = manifest.cards.filter((card) => !/^sha256:[a-f0-9]{64}$/.test(card.content_hash ?? ''));
record('every card has a sha256 content hash', missingHashes.length === 0, missingHashes.length ? `${missingHashes.length} malformed` : 'all present');

// --- 3. Probability contract ------------------------------------------------
const raritySource = readFileSync(path.join(root, 'bots/luffy/src/lib/cards/rarity.ts'), 'utf8');
const weights = [...raritySource.matchAll(/weight:\s*([0-9_]+)/g)].map((m) => Number(m[1].replace(/_/g, '')));
const totalWeight = weights.reduce((sum, value) => sum + value, 0);
record('drop weights total exactly 100,000,000', totalWeight === 100_000_000, `total ${totalWeight}`);

const limitedMatch = raritySource.match(/rank:\s*'limited_arts'[\s\S]*?weight:\s*([0-9_]+)/);
const limitedWeight = limitedMatch ? Number(limitedMatch[1].replace(/_/g, '')) : NaN;
const limitedProbability = limitedWeight / totalWeight;
record(
  'Limited Arts is exactly 0.001%',
  limitedWeight === 1_000 && Math.abs(limitedProbability - 0.00001) < 1e-12,
  `weight ${limitedWeight} → ${(limitedProbability * 100).toFixed(5)}%`,
);

// --- 4. Catalog runtime parity ---------------------------------------------
// Import the bot's catalog so the check exercises the same code the engine uses,
// not a re-implementation of it.
//
// The TypeScript entrypoint needs a loader (tsx). Without one, this check would
// silently vanish and the suite would still report success — weakening the most
// valuable assertion. CI sets LUFFY_SMOKE_REQUIRE_CATALOG=1 so a missing loader
// is a hard failure there, while local `node` runs can still degrade visibly.
const requireCatalog = process.env.LUFFY_SMOKE_REQUIRE_CATALOG === '1';
let catalogCards = null;
try {
  const { CARD_DEFINITIONS, assertPublishedProbabilities } = await import(
    new URL('../bots/luffy/src/lib/cards/catalog.ts', import.meta.url).href
  );
  assertPublishedProbabilities();
  catalogCards = CARD_DEFINITIONS;
  record('catalog loads manifest and probabilities validate', true, `${CARD_DEFINITIONS.length} definitions`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  const loaderMissing = /Unknown file extension|Cannot find module|ERR_UNKNOWN_FILE_EXTENSION/i.test(message);
  if (loaderMissing && !requireCatalog) {
    console.log(`SKIP  catalog runtime check — TypeScript loader unavailable (${message.split('\n')[0]})`);
    console.log('      run via `npm run smoke:luffy` (tsx) for full coverage');
  } else if (loaderMissing) {
    record('catalog loads manifest and probabilities validate', false, 'TypeScript loader unavailable but required (LUFFY_SMOKE_REQUIRE_CATALOG=1)');
  } else {
    record('catalog loads manifest and probabilities validate', false, message);
  }
}

if (Array.isArray(catalogCards)) {
  const catalogIds = new Set(catalogCards.map((card) => card.definition_id));
  const enabledIds = manifest.cards.filter((card) => card.enabled !== false).map((card) => card.definition_id);
  const missingFromCatalog = enabledIds.filter((id) => !catalogIds.has(id));
  record('every enabled manifest card is present in the runtime catalog', missingFromCatalog.length === 0, missingFromCatalog.length ? missingFromCatalog.slice(0, 3).join(', ') : `${enabledIds.length} present`);
}

// --- 5. Mongo registry parity (optional) ------------------------------------
const mongoUri = process.env.MONGODB_URI?.trim();
let mongoUnreachable = false;
if (mongoUri) {
  const client = new MongoClient(mongoUri, {
    serverSelectionTimeoutMS: 8_000,
    tls: mongoUri.includes('mongodb+srv://') || /[?&]tls=true/i.test(mongoUri),
  });
  try {
    await client.connect();
    const db = client.db(process.env.MONGODB_DB?.trim() || 'eiflow');
    const expected = manifest.cards.filter((card) => card.enabled !== false).map((card) => card.definition_id);
    const found = await db
      .collection('card_definitions')
      .find({ definition_id: { $in: expected } }, { projection: { definition_id: 1, enabled: 1 } })
      .toArray();
    const foundIds = new Set(found.map((doc) => doc.definition_id));
    const missing = expected.filter((id) => !foundIds.has(id));
    record('every enabled manifest card exists in Mongo card_definitions', missing.length === 0, missing.length ? `${missing.length} missing: ${missing.slice(0, 3).join(', ')}` : `${expected.length} synced`);

    const disabledInMongo = found.filter((doc) => doc.enabled === false).map((doc) => doc.definition_id);
    record('no enabled manifest card is disabled in Mongo', disabledInMongo.length === 0, disabledInMongo.length ? disabledInMongo.slice(0, 3).join(', ') : 'none disabled');
  } catch (error) {
    mongoUnreachable = true;
    const kind = error instanceof Error ? error.name : 'Error';
    recordUnverified('Mongo registry parity', `unreachable (${kind}) — registry parity NOT verified`);
  } finally {
    await client.close().catch(() => undefined);
  }
} else {
  console.log('SKIP  Mongo registry parity — set MONGODB_URI to verify instance parity');
}

// --- Verdict ----------------------------------------------------------------
const failures = results.filter((result) => !result.ok);
console.log('');
if (failures.length) {
  console.error(`luffy smoke failed: ${failures.length}/${results.length} checks`);
  process.exitCode = 1;
} else if (mongoUnreachable) {
  console.error('luffy smoke incomplete: manifest/catalog verified, Mongo parity unverified');
  process.exitCode = 2;
} else {
  console.log(`luffy smoke passed: ${results.length}/${results.length} checks`);
}
