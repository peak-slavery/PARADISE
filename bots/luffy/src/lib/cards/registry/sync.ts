// ---------------------------------------------------------------------------
// Card registry → MongoDB synchronisation.
//
// The sync is idempotent and owner-safe:
//
//   * Definitions present in the manifest are upserted (with enabled,
//     artwork, hash, and metadata refreshed).
//   * Definitions that disappear from the manifest are archived
//     (`enabled: false`, `archived_at: <now>`). They are NEVER deleted.
//   * Player-owned `card_instances`, `card_acquisitions`,
//     `card_transactions`, and `card_trades` are never touched.
//
// The archive step is critical for the "removed artwork must not delete
// owned cards" contract. Permanent deletion requires an explicit admin
// command and is intentionally out of scope here.
// ---------------------------------------------------------------------------

import type { CardDefinitionDoc, MongoCollections } from '@eiflow/shared';

import type { ManifestDocument } from './scanner.js';
import { loadRegistry } from './loader.js';

export interface SyncSummary {
  scanned: number;
  upserted: number;
  unchanged: number;
  archived: number;
  reactivated: number;
  errors: Array<{ definition_id: string; message: string }>;
}

export interface SyncOptions {
  collections: Pick<MongoCollections, 'card_definitions'>;
  manifest: ManifestDocument;
  dryRun?: boolean;
  now?: Date;
  /** When true, also re-activate previously archived definitions. Default true. */
  reactivate?: boolean;
}

interface StoredDefinition {
  definition_id: string;
  content_hash?: string;
  enabled?: boolean;
  archived_at?: Date | null;
  artwork_url?: string | null;
  rank?: string;
}

function toStored(def: CardDefinitionDoc, hash: string | undefined, now: Date): Record<string, unknown> {
  return {
    definition_id: def.definition_id,
    character: def.character,
    title: def.title,
    series: def.series,
    category: def.category,
    rank: def.rank,
    artwork_url: def.artwork_url,
    description: def.description,
    base_value: def.base_value,
    min_value: def.min_value,
    max_value: def.max_value,
    is_event_only: def.is_event_only,
    is_tradeable: def.is_tradeable,
    is_sellable: def.is_sellable,
    total_supply: def.total_supply,
    content_hash: hash ?? null,
    enabled: def.enabled !== false,
    archived_at: null,
    updated_at: now,
  };
}

/**
 * Upsert every manifest definition and archive any definition that's no
 * longer present. Returns a deterministic summary.
 */
export async function syncRegistry(opts: SyncOptions): Promise<SyncSummary> {
  const { collections, manifest, dryRun = false, now = new Date(), reactivate = true } = opts;
  const defs = collections.card_definitions;
  const summary: SyncSummary = {
    scanned: manifest.cards.length,
    upserted: 0,
    unchanged: 0,
    archived: 0,
    reactivated: 0,
    errors: [],
  };

  const desired = loadRegistry(manifest, now);

  for (const def of desired.definitions) {
    try {
      const scanned = manifest.cards.find((c) => c.definition_id === def.definition_id);
      const incomingHash = scanned?.content_hash;
      const existing = (await defs.findOne({ definition_id: def.definition_id })) as StoredDefinition | null;

      if (!existing) {
        if (!dryRun) {
          await defs.updateOne(
            { definition_id: def.definition_id },
            { $set: toStored(def, incomingHash, now), $setOnInsert: { created_at: now } },
            { upsert: true },
          );
        }
        summary.upserted += 1;
        continue;
      }

      const sameHash = existing.content_hash === incomingHash;
      const archived = existing.archived_at != null;

      const desiredEnabled = def.enabled !== false;
      if (sameHash && existing.enabled === desiredEnabled && !archived) {
        summary.unchanged += 1;
        continue;
      }

      if (!dryRun) {
        if (archived && reactivate) {
          await defs.updateOne(
            { definition_id: def.definition_id },
            {
              $set: {
                ...toStored(def, incomingHash, now),
                enabled: desiredEnabled,
                archived_at: null,
              },
            },
          );
          summary.reactivated += 1;
        } else if (archived) {
          summary.unchanged += 1;
        } else {
          await defs.updateOne(
            { definition_id: def.definition_id },
            {
              $set: {
                ...toStored(def, incomingHash, now),
                enabled: desiredEnabled,
                archived_at: null,
              },
            },
          );
          summary.upserted += 1;
        }
      } else if (archived && reactivate) {
        summary.reactivated += 1;
      } else {
        summary.upserted += 1;
      }
    } catch (err) {
      summary.errors.push({
        definition_id: def.definition_id,
        message: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }

  // Archive: every definition not present in the manifest and currently
  // enabled becomes archived. Already-archived rows stay archived (no-op).
  const desiredIds = new Set(desired.definitions.map((d) => d.definition_id));
  if (!dryRun) {
    const cursor = defs.find(
      { definition_id: { $nin: Array.from(desiredIds) }, archived_at: null },
      { projection: { definition_id: 1 } },
    ) as unknown as { toArray(): Promise<StoredDefinition[]> };
    const toArchive = await cursor.toArray();
    for (const row of toArchive) {
      try {
        await defs.updateOne(
          { definition_id: row.definition_id },
          { $set: { enabled: false, archived_at: now, updated_at: now } },
        );
        summary.archived += 1;
      } catch (err) {
        summary.errors.push({
          definition_id: row.definition_id,
          message: err instanceof Error ? err.message : 'unknown error',
        });
      }
    }
  } else {
    summary.archived = await defs.countDocuments({
      definition_id: { $nin: Array.from(desiredIds) },
      archived_at: null,
    });
  }

  return summary;
}