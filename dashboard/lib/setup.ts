import { credentials } from './demo';

/**
 * Live readiness for the Ei Point control plane.
 *
 * This is the single place the dashboard reads *deployment* env vars to tell an
 * operator what is wired up and what is missing. It is evaluated per call (not
 * cached) so dropping a `.env.local` in and reloading reflects instantly.
 *
 * Model names are read straight from env with safe fallbacks — no key value is
 * ever surfaced, only the configured model id and which provider serves it.
 */

export type ReadinessGroup = 'datastore' | 'ai' | 'bot';

export interface ReadinessItem {
  key: string;
  label: string;
  ready: boolean;
  detail: string;
  envVar: string;
  group: ReadinessGroup;
}

export interface ModelRoute {
  route: string;
  model: string;
  via: string;
  envVar: string;
  ready: boolean;
}

export interface SetupReadiness {
  items: ReadinessItem[];
  modelRouting: ModelRoute[];
  allLive: boolean;
  demo: boolean;
}

const present = (value: string | undefined): boolean =>
  typeof value === 'string' && value.trim().length > 0;

export function getSetupReadiness(): SetupReadiness {
  const creds = credentials();

  const redis = present(process.env.UPSTASH_REDIS_REST_URL) && present(process.env.UPSTASH_REDIS_REST_TOKEN);
  const mistral = present(process.env.MISTRAL_API_KEY);
  const groqCyrene = present(process.env.GROQ_API_KEY);
  const groqAutomod = present(process.env.GROQ_AUTOMOD_API_KEY);

  const items: ReadinessItem[] = [
    {
      key: 'supabase',
      label: 'Supabase',
      ready: creds.supabase,
      detail: creds.supabase ? 'Connected — bot config + security events' : 'Set SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY',
      envVar: 'SUPABASE_*',
      group: 'datastore',
    },
    {
      key: 'mongo',
      label: 'MongoDB',
      ready: creds.mongo,
      detail: creds.mongo ? 'Connected — per-member trust + config snapshots' : 'Set MONGODB_URI',
      envVar: 'MONGODB_URI',
      group: 'datastore',
    },
    {
      key: 'redis',
      label: 'Upstash Redis',
      ready: redis,
      detail: redis ? 'Connected — raid sliding-window counter' : 'Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN',
      envVar: 'UPSTASH_REDIS_*',
      group: 'datastore',
    },
    {
      key: 'mistral',
      label: 'Mistral — AI assistant',
      ready: mistral,
      detail: mistral ? `Connected — ${process.env.ASSISTANT_MODEL ?? 'mistral-small-latest'}` : 'Set MISTRAL_API_KEY',
      envVar: 'MISTRAL_API_KEY',
      group: 'ai',
    },
    {
      key: 'groqCyrene',
      label: 'Groq — Cyrene (gpt-oss)',
      ready: groqCyrene,
      detail: groqCyrene ? `Connected — ${process.env.CYRENE_MODEL ?? 'openai/gpt-oss-20b'}` : 'Set GROQ_API_KEY',
      envVar: 'GROQ_API_KEY',
      group: 'ai',
    },
    {
      key: 'groqAutomod',
      label: 'Groq — AutoMod SLM',
      ready: groqAutomod,
      detail: groqAutomod
        ? `Connected — ${process.env.AUTOMOD_SLM_MODEL ?? 'llama-3.1-8b-instant'} (isolated from chat quota)`
        : 'Set GROQ_AUTOMOD_API_KEY — dedicated key so SLM traffic never touches the chat quota',
      envVar: 'GROQ_AUTOMOD_API_KEY',
      group: 'ai',
    },
    {
      key: 'hmac',
      label: 'HMAC — bot ↔ dashboard',
      ready: creds.hmac,
      detail: creds.hmac ? 'Shared secret configured' : 'Set HMAC_SECRET — must match every bot exactly',
      envVar: 'HMAC_SECRET',
      group: 'bot',
    },
  ];

  const modelRouting: ModelRoute[] = [
    {
      route: '/cyrene',
      model: process.env.CYRENE_MODEL ?? 'openai/gpt-oss-20b',
      via: 'Groq',
      envVar: 'GROQ_API_KEY',
      ready: groqCyrene,
    },
    {
      route: '/ask',
      model: process.env.ASSISTANT_MODEL ?? 'mistral-small-latest',
      via: 'Mistral',
      envVar: 'MISTRAL_API_KEY',
      ready: mistral,
    },
    {
      route: 'AutoMod SLM',
      model: process.env.AUTOMOD_SLM_MODEL ?? 'llama-3.1-8b-instant',
      via: 'Groq',
      envVar: 'GROQ_AUTOMOD_API_KEY',
      ready: groqAutomod,
    },
  ];

  const allLive = items.every((item) => item.ready);
  return { items, modelRouting, allLive, demo: creds.demo };
}
