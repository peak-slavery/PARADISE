# Luffy Card Registry

> Verified 2026-09-16. Filesystem-driven registry is implemented and locally validated. This document describes the real implementation, not a future design.

## Source workflow

1. Add an image to the canonical repo-root `cards/<Rarity>/` folder.
2. Use PNG, JPG, JPEG, or WEBP.
3. Optionally add a same-basename JSON sidecar.
4. Run `npm run cards:check -w @eiflow/bot-luffy` locally.
5. CI validates the scanner, rarity probability contract, and committed manifest.
6. The deterministic manifest is generated at `generated/cards.manifest.json`.
7. Luffy loads the manifest at module startup and synchronizes Mongo `card_definitions` after Mongo connects.
8. No manual Mongo insert, Discord registration, or per-card source edit is required.

## Canonical folders

- `cards/Common/`
- `cards/Rare/`
- `cards/Elite/`
- `cards/Gold/`
- `cards/EX/`
- `cards/EXX/`
- `cards/S/`
- `cards/SS/`
- `cards/SSS+/`
- `cards/Diamond/`
- `cards/Limited-Arts/`

The folder name is authoritative for rank. The scanner rejects symlinked folders/files, path escapes, unsupported extensions, malformed metadata, duplicate IDs, and duplicate artwork hashes. It enforces a 256 KiB artwork limit and performs bounded structural checks for PNG, JPEG, and WEBP containers after magic-byte validation.

## IDs and metadata

The filename stem is normalized to lowercase `[a-z0-9][a-z0-9._-]*`; whitespace becomes `-`, and unsafe characters are removed. An explicit metadata `id`, when present, must equal the filename-derived ID. A rename is therefore a new identity and must be treated as an explicit content migration if ownership continuity is required.

Metadata is optional. Supported fields include `character`, `title`, `series`, `category`, `description`, `power`, `enabled`, `is_event_only`, `is_tradeable`, `is_sellable`, and `total_supply`. The schema is strict and rejects `__proto__`, `constructor`, and `prototype` keys.

## Manifest

`generated/cards.manifest.json` is deterministic: cards are sorted by definition ID, references are repository-relative (`cards/<Rarity>/<file>`), and no timestamps or absolute workstation paths are included. Each entry contains the stable ID, rank, metadata, enabled state, artwork format/reference, and SHA-256 content hash.

The current seed registry contains 18 non-copyrighted generated PNG fixtures preserving the existing stable definition IDs, including `captain.straw.luffy`, `standard` pack compatibility, and the Limited Arts definition. These fixtures are placeholders, not bundled One Piece artwork.

## Runtime and Mongo synchronization

`bots/luffy/src/lib/cards/catalog.ts` preserves the existing runtime API: `CARD_DEFINITIONS`, `CARD_PACKS`, `getDefinition`, `getPack`, `definitionsByRank`, and `assertPublishedProbabilities`.

`syncRegistry()` upserts definitions by stable ID, refreshes metadata/artwork/hash, and archives source definitions removed from the manifest by setting `enabled=false` and `archived_at`. It never deletes `card_instances`, acquisitions, trades, or transaction history. A returning definition can be reactivated. Archived definitions remain lookup/renderable for existing ownership, but are excluded from pack draws and admin issuance.

The sync runs in Luffy's shared `createBot` setup hook after the primary Mongo connection is established. If Mongo is unavailable, the bot logs a degraded sync skip and does not fabricate registry state.

## Rarity and economy invariants

The centralized rarity table remains authoritative. Its weights total 100,000,000 and Limited Arts remains exactly 1,000 / 100,000,000 = 0.001%. Pack opening, selling, trading, currency, ownership, and instance state remain server-authoritative and are not changed by the filesystem registry.

## Validation

- `npm run cards:check -w @eiflow/bot-luffy` passes for 18 cards and 11 folders.
- Luffy test suite: 79 tests across engine, rarity, store, scanner, manifest, loader, and sync behavior.
- Adversarial coverage includes duplicate IDs/content, malformed image containers, metadata pollution, deterministic manifests, removed-card archival, reactivation, and idempotent sync.

Live Discord and authenticated production registry smoke tests remain blocked by paused MongoDB Atlas clusters and exhausted Upstash capacity; see `KNOWN_ISSUES.md`.
