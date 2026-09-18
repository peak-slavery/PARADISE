#!/usr/bin/env node
/**
 * Audit slash-command duplication for all 8 bots across scopes:
 * global + dev guild + main guild. Prints per-scope counts and overlap.
 * Uses each bot's token from temp cred.txt. Delete after use.
 */
import { readFileSync } from 'node:fs';

const cred = readFileSync(new URL('../temp cred.txt', import.meta.url), 'utf8').replace(/\r/g, '');
const GUILDS = { dev: '1444582621417046071', main: '848841415940898827' };

const BOTS = [
  ['niko-robin', 'Niko Robin'],
  ['boahancock', 'Boa hancock'],
  ['nami', 'Nami'],
  ['cyrene', 'Cyrene'],
  ['zoro', 'Zoro'],
  ['shanks', 'Shanks'],
  ['luffy', 'Luffy'],
  ['sanji', 'Sanji'],
];

function section(header) {
  const m = cred.match(new RegExp(`^${header}\\b`, 'm'));
  if (!m) throw new Error('missing ' + header);
  const rest = cred.slice(m.index + m[0].length);
  const stop = rest.search(/^[-A-Z#\n]/m);
  return rest.slice(0, stop > 0 ? stop : 500);
}
const pick = (src, label) => src.match(new RegExp(`${label}=?\\s*([^\\n]+)`))?.[1]?.trim() ?? null;

const api = 'https://discord.com/api/v10';
async function get(token, path) {
  const r = await fetch(api + path, { headers: { Authorization: `Bot ${token}` } });
  if (!r.ok) return { err: r.status };
  return r.json();
}

for (const [id, header] of BOTS) {
  const sec = section(header);
  const token = pick(sec, 'token');
  const clientId = pick(sec, 'client id') || pick(sec, 'application id');
  if (!token || !clientId) { console.log(`${id}: missing creds`); continue; }
  const globalCmds = await get(token, `/applications/${clientId}/commands`);
  const out = { global: Array.isArray(globalCmds) ? globalCmds.map(c => c.name) : `err ${globalCmds.err}` };
  for (const [gname, gid] of Object.entries(GUILDS)) {
    const g = await get(token, `/applications/${clientId}/guilds/${gid}/commands`);
    out[gname] = Array.isArray(g) ? g.map(c => c.name) : `err ${g.err}`;
  }
  const gLen = Array.isArray(out.global) ? out.global.length : '?';
  const dLen = Array.isArray(out.dev) ? out.dev.length : '?';
  const mLen = Array.isArray(out.main) ? out.main.length : '?';
  console.log(`${id}: global=${gLen} dev-guild=${dLen} main-guild=${mLen}`);
  if (Array.isArray(out.global) && Array.isArray(out.dev)) {
    const dup = out.global.filter(n => out.dev.includes(n));
    if (dup.length) console.log(`   DUPLICATED in both scopes (${dup.length}): ${dup.slice(0, 12).join(', ')}${dup.length > 12 ? '…' : ''}`);
  }
  await new Promise(r => setTimeout(r, 400));
}
