#!/usr/bin/env node
// Seed the `cards/` directory with the 18 legacy card definitions and their
// metadata sidecars. Run from the repo root: `node scripts/seed-card-fixtures.mjs`.
//
// The script writes tiny PNG fixtures (different colours → different
// content hashes for duplicate detection) into the matching rarity folder
// and writes a JSON sidecar with the legacy category/character/title/series.
// Re-running is idempotent: existing seeded files are overwritten; files
// the operator added manually (i.e. not on the known seed list) are kept.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const cardsRoot = path.join(repoRoot, 'cards');

const LEGACY = [
  { id: 'captain.straw.luffy',  rank: 'Rare',          metadata: { character: 'Monkey D. Luffy', title: 'Captain of the Straw Hat Pirates', series: 'Grand Line Saga', category: 'captain', description: 'A spirited captain with an unbreakable will.' } },
  { id: 'captain.straw.zoro',   rank: 'Rare',          metadata: { character: 'Roronoa Zoro', title: 'Master Swordsman', series: 'Grand Line Saga', category: 'captain', description: 'Three-sword style swordsman bound by honour.' } },
  { id: 'captain.buggy',        rank: 'Common',        metadata: { character: 'Buggy the Clown', title: 'Captain of the Buggy Pirates', series: 'East Blue Saga', category: 'captain', description: 'A captain of legend (in his own mind).' } },
  { id: 'pirate.sanji',         rank: 'Elite',         metadata: { character: 'Vinsmoke Sanji', title: 'Black Leg of the Straw Hat Pirates', series: 'Whole Cake Island', category: 'pirate', description: 'A chef whose kicks carry the fire of dreams.' } },
  { id: 'pirate.usopp',         rank: 'Elite',         metadata: { character: 'Usopp', title: 'Sniper King of the Straw Hat Pirates', series: 'Dressrosa Arc', category: 'pirate', description: 'A storyteller who becomes a hero when it counts.' } },
  { id: 'pirate.nami',          rank: 'Rare',          metadata: { character: 'Nami', title: 'Navigator of the Straw Hat Pirates', series: 'Weatheria', category: 'pirate', description: 'A cartographer who turns storms to her advantage.' } },
  { id: 'marine.akainu',        rank: 'SS',            metadata: { character: 'Sakazuki (Akainu)', title: 'Fleet Admiral of the Marines', series: 'Marineford', category: 'marine', description: 'Absolute justice, scorched across the seas.' } },
  { id: 'marine.aokiji',        rank: 'S',             metadata: { character: 'Kuzan (Aokiji)', title: 'Former Admiral of the Marines', series: 'Post-War', category: 'marine', description: 'A lazy justice that froze time itself.' } },
  { id: 'marine.smoker',        rank: 'Rare',          metadata: { character: 'Smoker', title: 'Vice Admiral of the G-5 Branch', series: 'Punk Hazard', category: 'marine', description: 'A man of few words, a fist of white smoke.' } },
  { id: 'warlord.doflamingo',   rank: 'SS',            metadata: { character: 'Donquixote Doflamingo', title: 'Former Warlord of the Sea', series: 'Dressrosa Arc', category: 'warlord', description: 'A smile stitched from strings of cruelty.' } },
  { id: 'warlord.mihawk',       rank: 'S',             metadata: { character: 'Dracule Mihawk', title: 'Warlord of the Sea', series: 'Marineford', category: 'warlord', description: 'The world\u2019s greatest swordsman.' } },
  { id: 'yonko.shanks',         rank: 'SSS+',          metadata: { character: 'Shanks', title: 'One of the Four Emperors', series: 'Wano Saga', category: 'yonko', description: 'A legend whose very presence stills the sea.' } },
  { id: 'yonko.bartholomew',    rank: 'EXX',           metadata: { character: 'Bartholomew Kuma', title: 'Former Warlord, Former Yonko Emissary', series: 'Post-War', category: 'yonko', description: 'A man stripped of his will, weaponised by science.' } },
  { id: 'admiral.kizaru',       rank: 'S',             metadata: { character: 'Borsalino (Kizaru)', title: 'Admiral of the Marines', series: 'Marineford', category: 'admiral', description: 'A light-speed justice in a trench coat.' } },
  { id: 'legend.robeard',       rank: 'EX',            metadata: { character: 'Silvers Rayleigh', title: 'Dark King of the Pirates', series: 'Sabaody Archipelago', category: 'legend', description: 'The right hand of the Pirate King.' } },
  { id: 'legend.kozuki',        rank: 'Diamond',       metadata: { character: 'Kozuki Oden', title: 'Legend of Wano', series: 'Wano Saga', category: 'legend', description: 'A samurai who boiled for a decade and laughed.' } },
  { id: 'event.laughtale',      rank: 'Diamond',       metadata: { character: 'Straw Hat at Laugh Tale', title: 'Reached Laugh Tale Together', series: 'Grand Final Saga', category: 'event', description: 'A commemorative piece for the era of the Dream.', is_event_only: true, total_supply: 200 } },
  { id: 'limited.luffy.solo',   rank: 'Limited-Arts',  metadata: { character: 'Monkey D. Luffy \u2014 Will of D.', title: 'Painted by Royal Calligrapher', series: 'Masterpiece Limited', category: 'event', description: 'The rarest card in the entire collection.', is_event_only: true, total_supply: 100 } },
];

const RARITY_FOLDERS = ['Common', 'Rare', 'Elite', 'Gold', 'EX', 'EXX', 'S', 'SS', 'SSS+', 'Diamond', 'Limited-Arts'];

const KNOWN_BASENAMES = new Set(LEGACY.map((c) => c.id));

/* 1x1 RGBA PNG with a controllable RGB triplet, so every card has a
 * distinct content hash and duplicate-content detection can be tested. */
function makePng(r, g, b) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(1, 0);
  ihdrData.writeUInt32BE(1, 4);
  ihdrData[8] = 8;   // bit depth
  ihdrData[9] = 6;   // color type RGBA
  ihdrData[10] = 0;  // compression
  ihdrData[11] = 0;  // filter
  ihdrData[12] = 0;  // interlace
  const ihdr = chunk('IHDR', ihdrData);
  const rawPixel = Buffer.from([0, r, g, b, 0xff]);
  const idatData = zlib.deflateSync(rawPixel);
  const idat = chunk('IDAT', idatData);
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

let removed = 0;
for (const folder of RARITY_FOLDERS) {
  const dir = path.join(cardsRoot, folder);
  fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(dir)) {
    const baseNoExt = name.replace(/\.(png|jpg|jpeg|webp|json)$/i, '');
    if (KNOWN_BASENAMES.has(baseNoExt)) {
      fs.unlinkSync(path.join(dir, name));
      removed += 1;
    }
  }
}

let written = 0;
for (let i = 0; i < LEGACY.length; i++) {
  const card = LEGACY[i];
  const folder = card.rank;
  const dir = path.join(cardsRoot, folder);
  const pngPath = path.join(dir, `${card.id}.png`);
  const jsonPath = path.join(dir, `${card.id}.json`);

  const h = createHash('sha256').update(card.id).digest();
  const r = h[0], g = h[1], b = h[2];
  fs.writeFileSync(pngPath, makePng(r, g, b));
  fs.writeFileSync(jsonPath, JSON.stringify(card.metadata, null, 2) + '\n');
  written += 1;
}

console.log(`Seeded ${written} cards across ${RARITY_FOLDERS.length} rarity folders (cleaned ${removed} stale seed files).`);