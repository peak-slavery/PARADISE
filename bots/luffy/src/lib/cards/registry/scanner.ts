// ---------------------------------------------------------------------------
// Luffy card filesystem registry.
//
// The registry is the single source of truth for Luffy card definitions.
// Adding a card is a filesystem operation: drop an image (and optionally a
// `.json` metadata sidecar) into the correct rarity folder, commit, push,
// and CI runs this scanner to verify it. At runtime the Luffy bot loads
// the committed manifest instead of rescanning the filesystem on every
// startup, and the registry sync updates `card_definitions` idempotently.
//
// No manual MongoDB inserts. No manual Discord registration. No per-card
// source-code edits.
// ---------------------------------------------------------------------------

import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { z } from 'zod';

import type { CardRank } from '@eiflow/shared';

/* ------------------------------------------------------------------ */
/* Public types                                                        */
/* ------------------------------------------------------------------ */

/** Allowed image extensions (lowercase, no leading dot). */
export const ALLOWED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;
export type AllowedExtension = (typeof ALLOWED_EXTENSIONS)[number];

/** Rarity folder name → CardRank. Folder name is authoritative for rank. */
export const RARITY_FOLDER_TO_RANK: Readonly<Record<string, CardRank>> = Object.freeze({
  Common: 'common',
  Rare: 'rare',
  Elite: 'elite',
  Gold: 'gold',
  EX: 'ex',
  EXX: 'exx',
  S: 's',
  SS: 'ss',
  'SSS+': 'sss_plus',
  Diamond: 'diamond',
  'Limited-Arts': 'limited_arts',
});

/** Rank → folder name. Inverse of RARITY_FOLDER_TO_RANK for display/sorting. */
export const RANK_TO_FOLDER: Readonly<Record<CardRank, string>> = Object.freeze({
  common: 'Common',
  rare: 'Rare',
  elite: 'Elite',
  gold: 'Gold',
  ex: 'EX',
  exx: 'EXX',
  s: 'S',
  ss: 'SS',
  sss_plus: 'SSS+',
  diamond: 'Diamond',
  limited_arts: 'Limited-Arts',
});

/** Maximum allowed artwork file size (256 KiB). */
export const MAX_ARTWORK_BYTES = 256 * 1024;

/** Magic byte signatures for the supported image formats. */
const MAGIC_BYTES: Readonly<Record<AllowedExtension, Buffer>> = Object.freeze({
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  // JPEG: FF D8 FF
  jpg: Buffer.from([0xff, 0xd8, 0xff]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff]),
  // WEBP: "RIFF" .... "WEBP"
  webp: Buffer.from('WEBP', 'ascii'),
});

/* ------------------------------------------------------------------ */
/* Metadata schema                                                     */
/* ------------------------------------------------------------------ */

/**
 * Optional metadata for a card. The schema rejects unknown keys
 * (including `__proto__`, `constructor`, and `prototype`) to harden
 * against prototype pollution from arbitrary JSON.
 */
const CardCategory = z.enum([
  'captain',
  'pirate',
  'marine',
  'warlord',
  'yonko',
  'admiral',
  'legend',
  'event',
]);

const CardMetadataSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]*$/u, 'id must match [a-z0-9][a-z0-9._-]*')
      .optional(),
    name: z.string().min(1).max(120).optional(),
    title: z.string().min(1).max(160).optional(),
    character: z.string().min(1).max(120).optional(),
    series: z.string().min(1).max(120).optional(),
    category: CardCategory.optional(),
    description: z.string().max(2_000).optional(),
    power: z.number().int().min(0).max(1_000_000).optional(),
    is_event_only: z.boolean().optional(),
    is_tradeable: z.boolean().optional(),
    is_sellable: z.boolean().optional(),
    total_supply: z.number().int().min(0).max(1_000_000).optional(),
    enabled: z.boolean().optional(),
  })
  .strict();

export type CardMetadata = z.infer<typeof CardMetadataSchema>;

/* ------------------------------------------------------------------ */
/* Scan result                                                         */
/* ------------------------------------------------------------------ */

export interface ScannedCard {
  definition_id: string;
  rank: CardRank;
  category?: CardMetadata['category'];
  character: string | null;
  title: string | null;
  series: string | null;
  description: string;
  artwork_ref: string;
  artwork_format: AllowedExtension;
  content_hash: string;
  metadata_ref: string | null;
  is_event_only: boolean;
  is_tradeable: boolean;
  is_sellable: boolean;
  total_supply: number;
  enabled: boolean;
}

export interface ScanError {
  code:
    | 'root_missing'
    | 'invalid_folder'
    | 'unsupported_extension'
    | 'bad_magic_bytes'
    | 'corrupt_image'
    | 'too_large'
    | 'symlink_or_special'
    | 'path_traversal'
    | 'duplicate_id'
    | 'duplicate_content'
    | 'metadata_parse'
    | 'metadata_validation'
    | 'metadata_id_mismatch'
    | 'invalid_filename'
    | 'empty_root';
  message: string;
  path: string;
}

export interface ScanWarning {
  code: 'orphan_metadata' | 'invalid_rarity_folder' | 'duplicate_fileless_basename';
  message: string;
  path: string;
}

export interface ScanResult {
  cards: ScannedCard[];
  errors: ScanError[];
  warnings: ScanWarning[];
  /** Sorted, deterministic. */
  folders: string[];
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function normalizeId(stem: string): string {
  return stem
    .toLowerCase()
    .replace(/\s+/gu, '-')
    .replace(/[^a-z0-9._-]/gu, '')
    .replace(/^[._-]+|[._-]+$/gu, '');
}

function detectFormat(filename: string, head: Buffer): AllowedExtension | null {
  const ext = path.extname(filename).slice(1).toLowerCase();
  if (!isAllowedExtension(ext)) return null;
  if (ext === 'png' && head.length >= MAGIC_BYTES.png.length && head.subarray(0, MAGIC_BYTES.png.length).equals(MAGIC_BYTES.png)) {
    return 'png';
  }
  if ((ext === 'jpg' || ext === 'jpeg') && head.length >= MAGIC_BYTES.jpg.length && head.subarray(0, MAGIC_BYTES.jpg.length).equals(MAGIC_BYTES.jpg)) {
    return ext === 'jpeg' ? 'jpeg' : 'jpg';
  }
  if (ext === 'webp' && head.length >= 12) {
    const riff = head.subarray(0, 4).toString('ascii');
    const webp = head.subarray(8, 12).toString('ascii');
    if (riff === 'RIFF' && webp === 'WEBP') return 'webp';
  }
  return null;
}

/**
 * Validate container structure after the cheap extension/signature check.
 * This deliberately does not decode pixels, but it rejects truncated files,
 * invalid chunk lengths, missing terminators, and unsupported WEBP chunks.
 */
function validateImage(format: AllowedExtension, bytes: Buffer): { ok: true } | { ok: false; error: string } {
  if (format === 'png') {
    if (bytes.length < 33 || !bytes.subarray(0, 8).equals(MAGIC_BYTES.png)) {
      return { ok: false, error: 'PNG is truncated' };
    }
    let offset = 8;
    let sawHeader = false;
    let sawEnd = false;
    while (offset < bytes.length) {
      if (offset + 12 > bytes.length) return { ok: false, error: 'PNG chunk header is truncated' };
      const length = bytes.readUInt32BE(offset);
      const chunkEnd = offset + 12 + length;
      if (chunkEnd > bytes.length) return { ok: false, error: 'PNG chunk exceeds file length' };
      const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
      if (!/^[A-Za-z]{4}$/u.test(type)) return { ok: false, error: 'PNG chunk type is invalid' };
      if (type === 'IHDR') {
        if (sawHeader || length !== 13) return { ok: false, error: 'PNG IHDR is invalid' };
        const width = bytes.readUInt32BE(offset + 8);
        const height = bytes.readUInt32BE(offset + 12);
        if (width === 0 || height === 0 || width > 8192 || height > 8192) {
          return { ok: false, error: 'PNG dimensions are invalid or exceed 8192px' };
        }
        sawHeader = true;
      }
      if (type === 'IEND') {
        if (!sawHeader || length !== 0 || chunkEnd !== bytes.length) return { ok: false, error: 'PNG IEND is invalid' };
        sawEnd = true;
        break;
      }
      offset = chunkEnd;
    }
    return sawEnd ? { ok: true } : { ok: false, error: 'PNG is missing IEND' };
  }

  if (format === 'jpg' || format === 'jpeg') {
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      return { ok: false, error: 'JPEG is truncated' };
    }
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) return { ok: false, error: 'JPEG marker is invalid' };
      while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) return { ok: false, error: 'JPEG marker is truncated' };
      const marker = bytes[offset++];
      if (marker === undefined) return { ok: false, error: 'JPEG marker is truncated' };
      if (marker === 0xd9) return { ok: true };
      if (marker === 0xda) {
        // Scan data until the required end marker. Stuffed FF00 bytes are
        // allowed; an unescaped marker terminates the compressed stream.
        for (let i = offset; i + 1 < bytes.length; i += 1) {
          if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) return { ok: true };
        }
        return { ok: false, error: 'JPEG is missing EOI' };
      }
      if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) return { ok: false, error: 'JPEG segment length is truncated' };
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) return { ok: false, error: 'JPEG segment exceeds file length' };
      offset += length;
    }
    return { ok: false, error: 'JPEG is missing EOI' };
  }

  if (bytes.length < 20 || bytes.subarray(0, 4).toString('ascii') !== 'RIFF' || bytes.subarray(8, 12).toString('ascii') !== 'WEBP') {
    return { ok: false, error: 'WEBP header is invalid' };
  }
  const riffLength = bytes.readUInt32LE(4) + 8;
  if (riffLength > bytes.length || riffLength < 20) return { ok: false, error: 'WEBP RIFF length is invalid' };
  let offset = 12;
  let sawImageChunk = false;
  while (offset + 8 <= bytes.length && offset < riffLength) {
    const type = bytes.subarray(offset, offset + 4).toString('ascii');
    const length = bytes.readUInt32LE(offset + 4);
    const chunkEnd = offset + 8 + length + (length % 2);
    if (chunkEnd > bytes.length || chunkEnd > riffLength) return { ok: false, error: 'WEBP chunk exceeds file length' };
    if (type === 'VP8 ' || type === 'VP8L' || type === 'VP8X') sawImageChunk = true;
    offset = chunkEnd;
  }
  return sawImageChunk ? { ok: true } : { ok: false, error: 'WEBP has no supported image chunk' };
}

function isAllowedExtension(value: string): value is AllowedExtension {
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(value);
}

function hashContent(bytes: Buffer): string {
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function ensureWithinRoot(rootReal: string, candidate: string): boolean {
  // Use case-insensitive comparison on Windows since path comparison
  // through fs.realpathSync preserves the platform's case semantics.
  const rel = path.relative(rootReal, candidate);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Metadata parsing                                                    */
/* ------------------------------------------------------------------ */

export function parseMetadata(raw: string): { ok: true; data: CardMetadata } | { ok: false; error: string } {
  // Prototype-pollution guard: inspect parsed own keys before zod sees them.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'invalid JSON' };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'metadata must be a JSON object' };
  }

  for (const key of ['__proto__', 'constructor', 'prototype'] as const) {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      return { ok: false, error: `metadata contains forbidden key "${key}"` };
    }
  }

  const result = CardMetadataSchema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`).join('; ') };
  }
  return { ok: true, data: result.data };
}

/* ------------------------------------------------------------------ */
/* Scanner                                                             */
/* ------------------------------------------------------------------ */

/**
 * Walk `rootDir` and build a deterministic list of card definitions.
 *
 * The walk is synchronous so the CLI script and tests stay simple, and
 * because the entire registry is small (handful of folders, dozens of
 * files). Any error or invalid file is reported, not thrown, so the
 * CI can list every problem in one pass.
 */
export function scanCards(rootDir: string): ScanResult {
  const errors: ScanError[] = [];
  const warnings: ScanWarning[] = [];
  const cards: ScannedCard[] = [];

  if (!fs.existsSync(rootDir)) {
    return {
      cards,
      errors: [{ code: 'root_missing', message: `card root does not exist: ${rootDir}`, path: rootDir }],
      warnings,
      folders: [],
    };
  }

  const rootStat = fs.lstatSync(rootDir);
  if (!rootStat.isDirectory()) {
    return {
      cards,
      errors: [{ code: 'root_missing', message: `card root is not a directory: ${rootDir}`, path: rootDir }],
      warnings,
      folders: [],
    };
  }

  const rootReal = fs.realpathSync(rootDir);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(rootReal, { withFileTypes: true });
  } catch (err) {
    return {
      cards,
      errors: [
        {
          code: 'root_missing',
          message: err instanceof Error ? err.message : 'cannot read card root',
          path: rootReal,
        },
      ],
      warnings,
      folders: [],
    };
  }

  if (entries.length === 0) {
    errors.push({ code: 'empty_root', message: 'card root is empty', path: rootReal });
  }

  // Track first-seen id → path to detect duplicates deterministically.
  const idsByKey = new Map<string, string>();
  const contentByHash = new Map<string, string>();

  const folders = entries
    .filter((e) => e.isDirectory() || e.isSymbolicLink())
    .map((e) => e.name)
    .sort();

  for (const folderName of folders) {
    const folderPath = path.join(rootReal, folderName);
    const folderStat = fs.lstatSync(folderPath);
    if (folderStat.isSymbolicLink()) {
      errors.push({
        code: 'symlink_or_special',
        message: 'rarity folder must not be a symlink',
        path: folderPath,
      });
      continue;
    }
    if (!folderStat.isDirectory()) continue;

    const rank = RARITY_FOLDER_TO_RANK[folderName];
    if (!rank) {
      warnings.push({
        code: 'invalid_rarity_folder',
        message: `unknown rarity folder "${folderName}" (expected one of ${Object.keys(RARITY_FOLDER_TO_RANK).join(', ')})`,
        path: folderPath,
      });
      continue;
    }

    const realFolder = fs.realpathSync(folderPath);
    if (!ensureWithinRoot(rootReal, realFolder)) {
      errors.push({
        code: 'path_traversal',
        message: 'rarity folder escapes card root',
        path: realFolder,
      });
      continue;
    }

    let folderEntries: fs.Dirent[];
    try {
      folderEntries = fs.readdirSync(realFolder, { withFileTypes: true });
    } catch (err) {
      errors.push({
        code: 'root_missing',
        message: err instanceof Error ? err.message : 'cannot read rarity folder',
        path: realFolder,
      });
      continue;
    }

    // Sort entries by filename (with extension) for deterministic ordering.
    const sorted = folderEntries.slice().sort((a, b) => a.name.localeCompare(b.name));

    // Two-pass walk: artwork files first, metadata sidecars second. This
    // avoids false "orphan metadata" warnings caused by alphabetical order
    // (`.json` < `.png`) and lets metadata validation re-use the artwork
    // basename without a second filesystem trip.
    const artworkEntries: fs.Dirent[] = [];
    const sidecarEntries: fs.Dirent[] = [];
    for (const entry of sorted) {
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).slice(1).toLowerCase();
      if (ext === 'json') sidecarEntries.push(entry);
      else artworkEntries.push(entry);
    }

    // Track which basenames we saw an artwork file for, so we can flag
    // orphan metadata sidecars in the second pass.
    const seenBasenames = new Set<string>();

    for (const entry of artworkEntries) {
      const full = path.join(realFolder, entry.name);
      const lstat = fs.lstatSync(full);
      if (lstat.isSymbolicLink()) {
        errors.push({
          code: 'symlink_or_special',
          message: 'card entries must not be symlinks',
          path: full,
        });
        continue;
      }
      if (!lstat.isFile()) continue;

      if (!ensureWithinRoot(rootReal, full)) {
        errors.push({
          code: 'path_traversal',
          message: 'card entry escapes card root',
          path: full,
        });
        continue;
      }

      const ext = path.extname(entry.name).slice(1).toLowerCase();

      if (!isAllowedExtension(ext)) {
        errors.push({
          code: 'unsupported_extension',
          message: `unsupported extension ".${ext}"`,
          path: full,
        });
        continue;
      }

      if (lstat.size > MAX_ARTWORK_BYTES) {
        errors.push({
          code: 'too_large',
          message: `artwork exceeds ${MAX_ARTWORK_BYTES} bytes`,
          path: full,
        });
        continue;
      }

      let bytes: Buffer;
      try {
        bytes = fs.readFileSync(full);
      } catch (err) {
        errors.push({
          code: 'root_missing',
          message: err instanceof Error ? err.message : 'cannot read file',
          path: full,
        });
        continue;
      }

      const format = detectFormat(entry.name, bytes.subarray(0, 16));
      if (!format) {
        errors.push({
          code: 'bad_magic_bytes',
          message: 'file is not a valid PNG, JPEG, or WEBP image',
          path: full,
        });
        continue;
      }
      const integrity = validateImage(format, bytes);
      if (!integrity.ok) {
        errors.push({
          code: 'corrupt_image',
          message: integrity.error,
          path: full,
        });
        continue;
      }

      const stem = entry.name.slice(0, entry.name.length - ext.length - 1);
      const definitionId = normalizeId(stem);
      if (!definitionId) {
        errors.push({
          code: 'invalid_filename',
          message: `filename "${entry.name}" normalises to an empty id`,
          path: full,
        });
        continue;
      }

      const contentHash = hashContent(bytes);

      const baseNoExt = entry.name.slice(0, entry.name.length - ext.length - 1);
      seenBasenames.add(baseNoExt);

      // Optional sidecar metadata.
      const metaPath = path.join(realFolder, `${baseNoExt}.json`);
      let metadata: CardMetadata | null = null;
      if (fs.existsSync(metaPath) && fs.lstatSync(metaPath).isFile()) {
        const raw = fs.readFileSync(metaPath, 'utf8');
        const parsed = parseMetadata(raw);
        if (!parsed.ok) {
          errors.push({
            code: parsed.error.includes('forbidden key') ? 'metadata_validation' : 'metadata_parse',
            message: parsed.error,
            path: metaPath,
          });
        } else {
          metadata = parsed.data;
          if (metadata.id !== undefined && metadata.id !== definitionId) {
            errors.push({
              code: 'metadata_id_mismatch',
              message: `metadata id "${metadata.id}" does not match filename-derived id "${definitionId}"`,
              path: metaPath,
            });
            continue;
          }
        }
      }

      const existingIdPath = idsByKey.get(definitionId);
      if (existingIdPath !== undefined) {
        errors.push({
          code: 'duplicate_id',
          message: `duplicate definition id "${definitionId}" (also at ${existingIdPath})`,
          path: full,
        });
        continue;
      }
      const existingHashPath = contentByHash.get(contentHash);
      if (existingHashPath !== undefined) {
        errors.push({
          code: 'duplicate_content',
          message: `duplicate artwork content (also at ${existingHashPath})`,
          path: full,
        });
        continue;
      }

      idsByKey.set(definitionId, full);
      contentByHash.set(contentHash, full);

      // Compute the public (POSIX) artwork reference for the manifest.
      const artworkRef = `cards/${folderName}/${entry.name}`;
      const metadataRef = metadata ? `cards/${folderName}/${baseNoExt}.json` : null;

      cards.push({
        definition_id: definitionId,
        rank,
        category: metadata?.category,
        character: metadata?.character ?? metadata?.name ?? null,
        title: metadata?.title ?? null,
        series: metadata?.series ?? null,
        description: metadata?.description ?? '',
        artwork_ref: artworkRef,
        artwork_format: format,
        content_hash: contentHash,
        metadata_ref: metadataRef,
        is_event_only: metadata?.is_event_only ?? rank === 'limited_arts',
        is_tradeable: metadata?.is_tradeable ?? true,
        is_sellable: metadata?.is_sellable ?? true,
        total_supply: metadata?.total_supply ?? 0,
        enabled: metadata?.enabled ?? true,
      });
    }

    // Second pass: orphan metadata sidecars (no matching artwork file).
    for (const entry of sidecarEntries) {
      const full = path.join(realFolder, entry.name);
      const lstat = fs.lstatSync(full);
      if (lstat.isSymbolicLink() || !lstat.isFile()) continue;
      const base = entry.name.slice(0, -'.json'.length);
      if (!seenBasenames.has(base)) {
        warnings.push({
          code: 'orphan_metadata',
          message: `metadata file "${entry.name}" has no matching artwork file`,
          path: full,
        });
      }
    }
  }

  // Final sort by definition_id for determinism.
  cards.sort((a, b) => a.definition_id.localeCompare(b.definition_id));

  return { cards, errors, warnings, folders };
}

/* ------------------------------------------------------------------ */
/* Manifest                                                            */
/* ------------------------------------------------------------------ */

export const MANIFEST_SCHEMA_VERSION = 1;
export const MANIFEST_GENERATED_BY = 'bots/luffy/src/lib/cards/registry/scanner.ts';

export interface ManifestDocument {
  schema_version: number;
  generated_by: string;
  cards: ScannedCard[];
}

export function buildManifest(result: ScanResult): ManifestDocument {
  return {
    schema_version: MANIFEST_SCHEMA_VERSION,
    generated_by: MANIFEST_GENERATED_BY,
    cards: result.cards,
  };
}

/** Write the manifest deterministically (sorted JSON, no trailing junk). */
export function serializeManifest(manifest: ManifestDocument): string {
  const sorted: ManifestDocument = {
    schema_version: manifest.schema_version,
    generated_by: manifest.generated_by,
    cards: manifest.cards
      .slice()
      .sort((a, b) => a.definition_id.localeCompare(b.definition_id))
      .map((c) => ({ ...c })),
  };
  return JSON.stringify(sorted, null, 2) + '\n';
}

/** Parse and validate a manifest JSON string. */
export function parseManifest(raw: string): { ok: true; manifest: ManifestDocument } | { ok: false; error: string } {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'invalid JSON' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'manifest root must be an object' };
  }
  const obj = value as Record<string, unknown>;
  if (obj.schema_version !== MANIFEST_SCHEMA_VERSION) {
    return { ok: false, error: `unsupported manifest schema_version: ${String(obj.schema_version)}` };
  }
  if (!Array.isArray(obj.cards)) {
    return { ok: false, error: 'manifest.cards must be an array' };
  }
  return { ok: true, manifest: { schema_version: MANIFEST_SCHEMA_VERSION, generated_by: String(obj.generated_by ?? ''), cards: obj.cards as ScannedCard[] } };
}