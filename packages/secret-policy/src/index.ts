export const BOT_IDS = [
  'shanks',
  'sanji',
  'zoro',
  'boahancock',
  'nami',
  'luffy',
  'niko-robin',
  'cyrene',
] as const;

export type BotId = (typeof BOT_IDS)[number];

const COMMON_MAPPINGS = [
  ['mongodb.primary.uri', 'MONGODB_URI'],
  ['mongodb.primary.database', 'MONGODB_DB'],
  ['mongodb.secondary.uri', 'MONGODB_SECONDARY_URI'],
  ['mongodb.secondary.database', 'MONGODB_SECONDARY_DB'],
  ['redis.primary.url', 'UPSTASH_REDIS_REST_URL'],
  ['redis.primary.token', 'UPSTASH_REDIS_REST_TOKEN'],
  ['supabase.runtime.url', 'SUPABASE_URL'],
  ['supabase.runtime.service_key', 'SUPABASE_SERVICE_ROLE_KEY'],
] as const;

const EXTRA_MAPPINGS: Record<BotId, readonly (readonly [string, string])[]> = {
  shanks: [],
  sanji: [],
  zoro: [['provider.groq_automod.api_key', 'GROQ_AUTOMOD_API_KEY']],
  boahancock: [],
  nami: [],
  luffy: [],
  'niko-robin': [
    ['provider.brave.api_key', 'BRAVE_SEARCH_API_KEY'],
    ['provider.serpapi.api_key', 'SERPAPI_KEY'],
  ],
  cyrene: [
    ['provider.groq.api_key', 'GROQ_API_KEY'],
    ['provider.gemini.api_key', 'GEMINI_API_KEY'],
    ['provider.openrouter.api_key', 'OPENROUTER_API_KEY'],
    ['provider.mistral.api_key', 'MISTRAL_API_KEY'],
  ],
};

export type RuntimeSecretName =
  | (typeof COMMON_MAPPINGS)[number][0]
  | (typeof EXTRA_MAPPINGS[BotId][number])[0];

export interface RuntimeSecretMapping {
  readonly name: RuntimeSecretName;
  readonly envName: string;
}

const POLICY: Record<BotId, readonly RuntimeSecretMapping[]> = Object.fromEntries(
  BOT_IDS.map((botId) => [
    botId,
    [...COMMON_MAPPINGS, ...EXTRA_MAPPINGS[botId]].map(([name, envName]) => ({ name, envName })),
  ]),
) as unknown as Record<BotId, readonly RuntimeSecretMapping[]>;

export function isBotId(value: string | undefined | null): value is BotId {
  return typeof value === 'string' && (BOT_IDS as readonly string[]).includes(value);
}

/** Return a fresh immutable view so callers cannot mutate the policy globally. */
export function getRuntimeSecretMappings(botId: string | undefined | null): readonly RuntimeSecretMapping[] {
  return isBotId(botId) ? POLICY[botId] : [];
}

export function getAllowedRuntimeSecrets(botId: string | undefined | null): readonly RuntimeSecretName[] {
  return getRuntimeSecretMappings(botId).map(({ name }) => name);
}
