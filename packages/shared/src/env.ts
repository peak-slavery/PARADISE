import { existsSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

/**
 * Loads .env.local / .env if present. Uses Node 22's built-in parser so we do
 * not ship a dotenv dependency. On Render/Vercel the platform injects real env
 * vars and no file exists, which is fine.
 */
function loadDotEnvFiles(): void {
  for (const file of ['.env.local', '.env']) {
    const abs = path.resolve(process.cwd(), file);
    if (!existsSync(abs)) continue;
    try {
      process.loadEnvFile(abs);
    } catch {
      // A malformed .env should never prevent boot; platform env vars may already be set.
    }
    return;
  }
}

loadDotEnvFiles();

const emptyToUndefined = (v: unknown): unknown =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

const optString = z.preprocess(emptyToUndefined, z.string().optional());
const optionalHttpsUrl = z.preprocess(
  emptyToUndefined,
  z.string().url().refine((value) => new URL(value).protocol === 'https:', 'must use HTTPS').optional(),
);
const csvIds = z.preprocess(
  (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []),
  z.array(z.string().regex(/^\d{5,25}$/, 'must be a Discord snowflake')),
);
const optionalDiscordId = z.preprocess(
  emptyToUndefined,
  z.string().regex(/^\d{17,20}$/, 'must be a Discord snowflake').optional(),
);

const DeployEnvSchema = z.object({
  BOT_ID: z.string().min(1),
  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),
});

export interface DeployEnv {
  botId: string;
  discordToken: string;
  discordClientId: string;
}

const EnvSchema = z.object({
  BOT_ID: z.string().min(1),
  BOT_NAME: z.string().min(1),
  BOT_VERSION: z.string().default('1.0.0'),
  EMBED_COLOR: z
    .string()
    .regex(/^#?[0-9a-fA-F]{6}$/, 'EMBED_COLOR must be a 6-digit hex colour')
    .default('#5865F2'),

  DISCORD_TOKEN: z.string().min(1, 'DISCORD_TOKEN is required'),
  DISCORD_CLIENT_ID: z.string().min(1, 'DISCORD_CLIENT_ID is required'),

  OWNER_IDS: csvIds,
  MASTER_DISCORD_ID: optionalDiscordId,
  HMAC_SECRET: z.preprocess(
    emptyToUndefined,
    z.string().min(32, 'HMAC_SECRET must be at least 32 characters').optional(),
  ).default(''),
  DEV_GUILD_ID: z.preprocess(emptyToUndefined, z.string().regex(/^\d{17,20}$/).optional()),
  MAIN_GUILD_ID: z.preprocess(emptyToUndefined, z.string().regex(/^\d{17,20}$/).optional()),
  DEV_AUTH_CHANNEL_ID: z.preprocess(emptyToUndefined, z.string().regex(/^\d{17,20}$/).optional()),

  SUPABASE_URL: optionalHttpsUrl,
  SUPABASE_SERVICE_ROLE_KEY: optString,

  MONGODB_URI: optString,
  MONGODB_DB: z.string().default('eiflow'),
  MONGODB_SECONDARY_URI: optString,
  MONGODB_SECONDARY_DB: z.string().default('eipointsecurity'),

  UPSTASH_REDIS_REST_URL: optionalHttpsUrl,
  UPSTASH_REDIS_REST_TOKEN: optString,

  SENTRY_DSN: optString,
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  REDIS_DAILY_COMMAND_BUDGET: z.coerce.number().int().positive().default(8000),

  BRAVE_SEARCH_API_KEY: optString,
  SERPAPI_KEY: optString,
  GROQ_API_KEY: optString,
  GEMINI_API_KEY: optString,
  OPENROUTER_API_KEY: optString,
  AGNES_IMAGE_API_KEY: optString,

  // --- Model routing (Ei Flow) -------------------------------------------
  /** Mistral API key — powers the general AI assistant. */
  MISTRAL_API_KEY: optString,
  /** NVIDIA NIM key — Shanks bad-words classifier primary. */
  NVIDIA_NIM_API_KEY: optString,
  /** Cerebras key — Shanks bad-words classifier fallback. */
  CEREBRAS_API_KEY: optString,
  /** ModelScope key — Niko Robin search-result summarizer. */
  MODELSCOPE_API_KEY: optString,

  /** gpt-oss, served by Groq — the Cyrene persona. */
  CYRENE_MODEL: z.string().default('openai/gpt-oss-20b'),
  /** Mistral, served by mistral.ai — the general assistant. */
  ASSISTANT_MODEL: z.string().default('ministral-8b-latest'),
  /** Agnes image-generation model used by Cyrene. */
  AGNES_IMAGE_MODEL: z.string().default('agnes-image-2.5-flash'),
  /** Optional OpenRouter TTS model and voice used by Cyrene. */
  CYRENE_TTS_MODEL: optString,
  CYRENE_TTS_VOICE: optString,
  /** 0..1 confidence the SLM must report before AutoMod acts. */
  AUTOMOD_SLM_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),
  /** Cerebras model used by Zoro for content classification. */
  ZORO_SLM_MODEL: z.string().default('qwen-3.8-27b'),
  /** Maximum output tokens allowed for Zoro's classifier. */
  ZORO_SLM_MAX_TOKENS: z.coerce.number().int().min(1).max(64).default(64),
  /** Maximum input characters sent to Zoro's classifier. */
  ZORO_SLM_CONTEXT_CHARS: z.coerce.number().int().min(1).max(2000).default(2000),
  /** NVIDIA NIM content-safety model — Shanks primary classifier. */
  SECURITY_SLM_MODEL: z.string().default('nvidia/nemotron-3.5-content-safety'),
  /** Cerebras fallback model for the same classifier. */
  SECURITY_SLM_FALLBACK_MODEL: z.string().default('qwen-3.8-27b'),
  /** ModelScope Qwen model — Niko Robin search summarizer. */
  SEARCH_SLM_MODEL: z.string().default('Qwen/Qwen3.5-35B-A3B'),
});

export type RawEnv = z.input<typeof EnvSchema>;

export function loadDeployEnv(overrides: Partial<z.input<typeof DeployEnvSchema>> = {}): DeployEnv {
  const parsed = DeployEnvSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid deploy environment configuration:\n${issues}`);
  }

  return {
    botId: parsed.data.BOT_ID,
    discordToken: parsed.data.DISCORD_TOKEN,
    discordClientId: parsed.data.DISCORD_CLIENT_ID,
  };
}

export interface Env {
  botId: string;
  botName: string;
  botVersion: string;
  /** Parsed to a numeric Discord colour. */
  embedColor: number;

  discordToken: string;
  discordClientId: string;

  ownerIds: string[];
  masterDiscordId: string | undefined;
  hmacSecret: string;
  devGuildId: string | undefined;
  mainGuildId: string | undefined;
  devAuthChannelId: string | undefined;

  supabaseUrl: string | undefined;
  supabaseServiceRoleKey: string | undefined;

  mongodbUri: string | undefined;
  mongodbDb: string;
  mongodbSecondaryUri: string | undefined;
  mongodbSecondaryDb: string;

  upstashUrl: string | undefined;
  upstashToken: string | undefined;

  sentryDsn: string | undefined;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

  port: number;
  redisDailyCommandBudget: number;

  braveSearchApiKey: string | undefined;
  serpapiKey: string | undefined;
  groqApiKey: string | undefined;
  geminiApiKey: string | undefined;
  openrouterApiKey: string | undefined;
  agnesImageApiKey: string | undefined;

  mistralApiKey: string | undefined;
  nvidiaNimApiKey: string | undefined;
  cerebrasApiKey: string | undefined;
  modelScopeApiKey: string | undefined;
  cyreneModel: string;
  assistantModel: string;
  agnesImageModel: string;
  cyreneTtsModel: string | undefined;
  cyreneTtsVoice: string | undefined;
  zoroSlmModel: string;
  zoroSlmMaxTokens: number;
  zoroSlmContextChars: number;
  automodSlmThreshold: number;
  securitySlmModel: string;
  securitySlmFallbackModel: string;
  searchSlmModel: string;

  /** True when both Supabase values are present. */
  hasSupabase: boolean;
  /** True when the Mongo URI is present. */
  hasMongo: boolean;
  /** True when the optional secondary audit Mongo URI is present. */
  hasSecondaryMongo: boolean;
  /** True when both Upstash values are present. */
  hasRedis: boolean;
  /** True when the Mistral API key is present. */
  hasMistral: boolean;
  /** True when the NVIDIA NIM or Cerebras security-classifier key is present. */
  hasSecuritySlm: boolean;
  /** True when the ModelScope search-summarizer key is present. */
  hasSearchSlm: boolean;
  /** True when the Cerebras API key is present. */
  hasCerebras: boolean;
  /** True when the Agnes image API key is present. */
  hasAgnesImage: boolean;
  /** True when the TTS API key is present. */
  hasTts: boolean;
}

let cached: Env | undefined;

export function loadEnv(overrides: Partial<RawEnv> = {}): Env {
  if (cached) return cached;

  const parsed = EnvSchema.safeParse({ ...process.env, ...overrides });
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  const d = parsed.data;
  const supabaseUrl = d.SUPABASE_URL;
  const supabaseServiceRoleKey = d.SUPABASE_SERVICE_ROLE_KEY;
  const mongodbUri = d.MONGODB_URI;
  const mongodbSecondaryUri = d.MONGODB_SECONDARY_URI;
  const upstashUrl = d.UPSTASH_REDIS_REST_URL;
  const upstashToken = d.UPSTASH_REDIS_REST_TOKEN;

  const env: Env = {
    botId: d.BOT_ID,
    botName: d.BOT_NAME,
    botVersion: d.BOT_VERSION,
    embedColor: parseInt(d.EMBED_COLOR.replace('#', ''), 16),
    discordToken: d.DISCORD_TOKEN,
    discordClientId: d.DISCORD_CLIENT_ID,
    ownerIds: d.OWNER_IDS,
    masterDiscordId: d.MASTER_DISCORD_ID,
    hmacSecret: d.HMAC_SECRET,
    devGuildId: d.DEV_GUILD_ID,
    mainGuildId: d.MAIN_GUILD_ID,
    devAuthChannelId: d.DEV_AUTH_CHANNEL_ID,
    supabaseUrl,
    supabaseServiceRoleKey,
    mongodbUri,
    mongodbDb: d.MONGODB_DB,
    mongodbSecondaryUri,
    mongodbSecondaryDb: d.MONGODB_SECONDARY_DB,
    upstashUrl,
    upstashToken,
    sentryDsn: d.SENTRY_DSN,
    logLevel: d.LOG_LEVEL,
    port: d.PORT,
    redisDailyCommandBudget: d.REDIS_DAILY_COMMAND_BUDGET,
    braveSearchApiKey: d.BRAVE_SEARCH_API_KEY,
    serpapiKey: d.SERPAPI_KEY,
    groqApiKey: d.GROQ_API_KEY,
    geminiApiKey: d.GEMINI_API_KEY,
    openrouterApiKey: d.OPENROUTER_API_KEY,
    agnesImageApiKey: d.AGNES_IMAGE_API_KEY,
    mistralApiKey: d.MISTRAL_API_KEY,
    nvidiaNimApiKey: d.NVIDIA_NIM_API_KEY,
    cerebrasApiKey: d.CEREBRAS_API_KEY,
    modelScopeApiKey: d.MODELSCOPE_API_KEY,
    cyreneModel: d.CYRENE_MODEL,
    assistantModel: d.ASSISTANT_MODEL,
    agnesImageModel: d.AGNES_IMAGE_MODEL,
    cyreneTtsModel: d.CYRENE_TTS_MODEL,
    cyreneTtsVoice: d.CYRENE_TTS_VOICE,
    zoroSlmModel: d.ZORO_SLM_MODEL,
    zoroSlmMaxTokens: d.ZORO_SLM_MAX_TOKENS,
    zoroSlmContextChars: d.ZORO_SLM_CONTEXT_CHARS,
    automodSlmThreshold: d.AUTOMOD_SLM_THRESHOLD,
    securitySlmModel: d.SECURITY_SLM_MODEL,
    securitySlmFallbackModel: d.SECURITY_SLM_FALLBACK_MODEL,
    searchSlmModel: d.SEARCH_SLM_MODEL,
    hasSupabase: Boolean(supabaseUrl && supabaseServiceRoleKey),
    hasMongo: Boolean(mongodbUri),
    hasSecondaryMongo: Boolean(mongodbSecondaryUri),
    hasRedis: Boolean(upstashUrl && upstashToken),
    hasMistral: Boolean(d.MISTRAL_API_KEY),
    hasSecuritySlm: Boolean(d.NVIDIA_NIM_API_KEY || d.CEREBRAS_API_KEY),
    hasSearchSlm: Boolean(d.MODELSCOPE_API_KEY),
    hasCerebras: Boolean(d.CEREBRAS_API_KEY),
    hasAgnesImage: Boolean(d.AGNES_IMAGE_API_KEY),
    hasTts: Boolean(d.OPENROUTER_API_KEY && d.CYRENE_TTS_MODEL && d.CYRENE_TTS_VOICE),
  };
  cached = env;
  return env;
}

/** Test seam: drop the memoised env so a fresh load picks up new process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
