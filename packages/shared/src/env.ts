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
const csvIds = z.preprocess(
  (v) => (typeof v === 'string' ? v.split(',').map((s) => s.trim()).filter(Boolean) : []),
  z.array(z.string().regex(/^\d{5,25}$/, 'must be a Discord snowflake')),
);

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
  HMAC_SECRET: z.preprocess(
    emptyToUndefined,
    z.string().min(32, 'HMAC_SECRET must be at least 32 characters').optional(),
  ).default(''),

  SUPABASE_URL: optString,
  SUPABASE_SERVICE_ROLE_KEY: optString,

  MONGODB_URI: optString,
  MONGODB_DB: z.string().default('eiflow'),

  UPSTASH_REDIS_REST_URL: optString,
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

  // --- Model routing (Ei Flow) -------------------------------------------
  /** Mistral API key — powers the general AI assistant. */
  MISTRAL_API_KEY: optString,
  /** Dedicated Groq key for the AutoMod SLM, isolated from the chat quota. */
  GROQ_AUTOMOD_API_KEY: optString,

  /** gpt-oss, served by Groq — the Cyrene persona. */
  CYRENE_MODEL: z.string().default('openai/gpt-oss-20b'),
  /** Mistral, served by mistral.ai — the general assistant. */
  ASSISTANT_MODEL: z.string().default('mistral-small-latest'),
  /** Small fast model used by Zoro for content classification. */
  AUTOMOD_SLM_MODEL: z.string().default('llama-3.1-8b-instant'),
  /** 0..1 confidence the SLM must report before AutoMod acts. */
  AUTOMOD_SLM_THRESHOLD: z.coerce.number().min(0).max(1).default(0.75),
});

export type RawEnv = z.input<typeof EnvSchema>;

export interface Env {
  botId: string;
  botName: string;
  botVersion: string;
  /** Parsed to a numeric Discord colour. */
  embedColor: number;

  discordToken: string;
  discordClientId: string;

  ownerIds: string[];
  hmacSecret: string;

  supabaseUrl: string | undefined;
  supabaseServiceRoleKey: string | undefined;

  mongodbUri: string | undefined;
  mongodbDb: string;

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

  mistralApiKey: string | undefined;
  groqAutomodApiKey: string | undefined;
  cyreneModel: string;
  assistantModel: string;
  automodSlmModel: string;
  automodSlmThreshold: number;

  /** True when both Supabase values are present. */
  hasSupabase: boolean;
  /** True when the Mongo URI is present. */
  hasMongo: boolean;
  /** True when both Upstash values are present. */
  hasRedis: boolean;
  /** True when the Mistral API key is present. */
  hasMistral: boolean;
  /** True when the dedicated AutoMod Groq key is present. */
  hasAutomodSlm: boolean;
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
  const upstashUrl = d.UPSTASH_REDIS_REST_URL;
  const upstashToken = d.UPSTASH_REDIS_REST_TOKEN;

  cached = {
    botId: d.BOT_ID,
    botName: d.BOT_NAME,
    botVersion: d.BOT_VERSION,
    embedColor: parseInt(d.EMBED_COLOR.replace('#', ''), 16),
    discordToken: d.DISCORD_TOKEN,
    discordClientId: d.DISCORD_CLIENT_ID,
    ownerIds: d.OWNER_IDS,
    hmacSecret: d.HMAC_SECRET,
    supabaseUrl,
    supabaseServiceRoleKey,
    mongodbUri,
    mongodbDb: d.MONGODB_DB,
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
    mistralApiKey: d.MISTRAL_API_KEY,
    groqAutomodApiKey: d.GROQ_AUTOMOD_API_KEY,
    cyreneModel: d.CYRENE_MODEL,
    assistantModel: d.ASSISTANT_MODEL,
    automodSlmModel: d.AUTOMOD_SLM_MODEL,
    automodSlmThreshold: d.AUTOMOD_SLM_THRESHOLD,
    hasSupabase: Boolean(supabaseUrl && supabaseServiceRoleKey),
    hasMongo: Boolean(mongodbUri),
    hasRedis: Boolean(upstashUrl && upstashToken),
    hasMistral: Boolean(d.MISTRAL_API_KEY),
    hasAutomodSlm: Boolean(d.GROQ_AUTOMOD_API_KEY),
  };

  return cached;
}

/** Test seam: drop the memoised env so a fresh load picks up new process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
