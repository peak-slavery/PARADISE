/**
 * Canonical eight-bot fleet manifest.
 *
 * Every script that enumerates the fleet must import from here instead of
 * re-declaring its own list. Two sources are reconciled:
 *
 *   bots/              — authoritative for which bots exist. A directory that
 *                        is not a bot package (e.g. a generated artifact folder)
 *                        is rejected, not silently counted.
 *   render.yaml        — authoritative for deployed service names and URLs.
 *
 * Per-bot display names and local PM2 ports live in one table below so the
 * credential-file section headers and local stack stay in sync with the fleet.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const EXPECTED_BOTS = [
  'shanks', 'sanji', 'zoro', 'boahancock',
  'nami', 'luffy', 'niko-robin', 'cyrene',
];

const BOT_META = {
  shanks: { header: 'Shanks', port: 3101, service: 'eiflow-shanks', url: 'https://eiflow-shanks.onrender.com' },
  sanji: { header: 'Sanji', port: 3102, service: 'eiflow-sanji', url: 'https://eiflow-sanji.onrender.com' },
  zoro: { header: 'Zoro', port: 3103, service: 'eiflow-zoro', url: 'https://eiflow-zoro.onrender.com' },
  boahancock: { header: 'Boa hancock', port: 3104, service: 'eiflow-boahancock', url: 'https://royal-paradise-v2-4ery.onrender.com' },
  nami: { header: 'Nami', port: 3105, service: 'eiflow-nami', url: 'https://eiflow-nami.onrender.com' },
  luffy: { header: 'Luffy', port: 3106, service: 'eiflow-luffy', url: 'https://eiflow-luffy.onrender.com' },
  'niko-robin': { header: 'Niko Robin', port: 3107, service: 'eiflow-niko-robin', url: 'https://eiflow-niko-robin.onrender.com' },
  cyrene: { header: 'Cyrene', port: 3108, service: 'eiflow-cyrene', url: 'https://cyrene-2ukf.onrender.com' },
};

function isBotPackage(name) {
  const dir = path.join(ROOT, 'bots', name);
  try {
    if (!statSync(dir).isDirectory()) return false;
    // A real bot package declares itself; a stray generated folder does not.
    return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')).name?.startsWith('@eiflow/bot-') ?? false;
  } catch {
    return false;
  }
}

/**
 * Bot ids in canonical fleet order, derived from bots/. Throws if the on-disk
 * fleet disagrees with the manifest, so adding or removing a bot is a
 * deliberate change to this file rather than a silent drift.
 */
export function botIds() {
  const onDisk = readdirSync(path.join(ROOT, 'bots')).filter(isBotPackage).sort();
  const expected = [...EXPECTED_BOTS].sort();
  const missing = expected.filter((id) => !onDisk.includes(id));
  const extra = onDisk.filter((id) => !expected.includes(id));
  if (missing.length || extra.length) {
    const parts = [];
    if (missing.length) parts.push(`missing bots: ${missing.join(', ')}`);
    if (extra.length) parts.push(`unexpected bot packages: ${extra.join(', ')}`);
    throw new Error(`fleet manifest out of sync with bots/ — ${parts.join('; ')}`);
  }
  return [...EXPECTED_BOTS];
}

/** Render service names in canonical fleet order. */
export function botServices() {
  return botIds().map((id) => BOT_META[id].service);
}

/** Per-bot health probe descriptors: { id, url, header }. */
export function botServicesWithUrls() {
  return botIds().map((id) => ({ id, url: BOT_META[id].url, header: BOT_META[id].header }));
}

/** Local PM2 stack descriptors: { id, header, port }. */
export function localBots() {
  return botIds().map((id) => ({ id, header: BOT_META[id].header, port: BOT_META[id].port }));
}

/** Legacy tuple shape for scripts that destructure [id, header, port]. */
export function localBotTuples() {
  return localBots().map(({ id, header, port }) => [id, header, port]);
}

export { EXPECTED_BOTS, BOT_META };
