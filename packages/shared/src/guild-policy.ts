import canonicalIds from '../../../scripts/canonical-ids.json';

export const {
  APPROVED_PRODUCTION_GUILD_ID,
  APPROVED_DEVELOPMENT_GUILD_ID,
  MASTER_OPERATOR_DISCORD_ID,
} = canonicalIds;
export const APPROVED_GUILD_IDS = [
  APPROVED_PRODUCTION_GUILD_ID,
  APPROVED_DEVELOPMENT_GUILD_ID,
] as const;

export type GuildEnvironment = 'production' | 'development';

export interface GuildPolicyEnv {
  runtimeEnvironment?: string;
}

const GUILD_ID = /^\d{17,20}$/;

export function normalizeGuildEnvironment(value?: string): GuildEnvironment {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'production' || normalized === 'development') return normalized;
  throw new Error('EIFLOW_ENV must be either production or development');
}

/**
 * Evaluate the environment-scoped bot boundary. The canonical production guild
 * is available only to production runtimes and the canonical development guild
 * only to development runtimes. Future expansion requires a code review that
 * updates this module; no client or database value can extend the set.
 */
export function isApprovedGuild(
  guildId: string,
  environment?: string | GuildPolicyEnv,
): boolean {
  if (!GUILD_ID.test(guildId)) return false;

  const policy = typeof environment === 'string'
    ? { runtimeEnvironment: environment }
    : environment ?? {};
  try {
    const runtimeEnvironment = normalizeGuildEnvironment(
      policy.runtimeEnvironment ?? process.env.EIFLOW_ENV,
    );
    if (guildId === APPROVED_PRODUCTION_GUILD_ID) return runtimeEnvironment === 'production';
    if (guildId === APPROVED_DEVELOPMENT_GUILD_ID) return runtimeEnvironment === 'development';
    return false;
  } catch {
    return false;
  }
}

export function isMasterOperator(userId: string | undefined): boolean {
  return userId === MASTER_OPERATOR_DISCORD_ID;
}
