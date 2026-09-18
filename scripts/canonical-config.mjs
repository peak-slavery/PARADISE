#!/usr/bin/env node
/**
 * Canonical, secret-free deployment configuration shared by local launchers.
 *
 * The reviewed guild boundary lives in packages/shared/src/guild-policy.ts.
 * Keeping these helpers here lets the shell-facing launchers validate their
 * in-memory environment before a child process is started.
 */
import canonicalIds from './canonical-ids.json' with { type: 'json' };

export const CANONICAL_RUNTIME_ENVIRONMENTS = Object.freeze([
  'production',
  'development',
]);

export function canonicalRuntimeEnvironment(value) {
  const normalized = value?.trim().toLowerCase();
  if (!CANONICAL_RUNTIME_ENVIRONMENTS.includes(normalized)) {
    throw new Error('EIFLOW_ENV must be explicitly set to either production or development');
  }
  return normalized;
}

export function canonicalId(name, value, expected) {
  const normalized = value?.trim();
  if (normalized !== expected) {
    throw new Error(`${name} must be the canonical ${expected}`);
  }
  return normalized;
}

export function canonicalSnowflake(name, value, { required = true } = {}) {
  const normalized = value?.trim();
  if (!normalized && !required) return undefined;
  if (!/^\d{17,20}$/.test(normalized ?? '')) {
    throw new Error(`${name} must be a Discord snowflake`);
  }
  return normalized;
}

export function assignmentValue(raw, name) {
  return raw.match(new RegExp(`(?:^|\\n)\\s*(?:-\\s*)?${name}\\s*=\\s*"?([^"\\r\\n]+)`, 'm'))?.[1]?.trim() ?? '';
}

export function canonicalIdsFrom(raw) {
  return {
    devGuildId: raw.match(/^#dev server=(\d+)/m)?.[1]?.trim() ?? '',
    mainGuildId: raw.match(/^#main server=(\d+)/m)?.[1]?.trim() ?? '',
    devAuthChannelId: raw.match(/^#auth channel=(\d+)/m)?.[1]?.trim() ?? '',
    masterDiscordId: raw.match(/^#master id=(\d+)/m)?.[1]?.trim() ?? '',
  };
}

export const {
  APPROVED_DEVELOPMENT_GUILD_ID,
  APPROVED_PRODUCTION_GUILD_ID,
  MASTER_OPERATOR_DISCORD_ID,
} = canonicalIds;
