// Read credentials only in-process. Output contains readiness, never values.
import { readFileSync } from 'node:fs';
import { resolveCredential } from './credential-keys.mjs';

const raw = readFileSync(new URL('../temp cred.txt', import.meta.url), 'utf8');
const field = (key) => process.env[key]?.trim() || raw.match(new RegExp(`(?:^|\\n)(?:- )?${key}\\s*=\\s*"?([^"\\r\\n]+)`, 'i'))?.[1]?.trim();
const credential = (name, descriptive) => resolveCredential({ raw, name, environment: process.env[name], descriptive });
const providers = {
  GROQ_API_KEY: credential('GROQ_API_KEY', /"gpt oss"\s*=\s*(\S+)/),
  MISTRAL_API_KEY: credential('MISTRAL_API_KEY', /"Ministral 3 8B"\s*=\s*(\S+)/),
  NVIDIA_NIM_API_KEY: credential('NVIDIA_NIM_API_KEY', /nemotron-3\.5-content-safety" on nvidia nim\s*=\s*(\S+)/),
  CEREBRAS_API_KEY: credential('CEREBRAS_API_KEY', /"qwen-3\.8-27b" with limit[^=]*=\s*(\S+)/),
};
for (const [name, value] of Object.entries(providers)) console.log(`${name}: ${value ? 'present' : 'missing'}`);

const url = field('NEXT_PUBLIC_SUPABASE_URL');
const key = field('NEXT_PUBLIC_SUPABASE_ANON_KEY');
if (url && key) {
  try {
    const response = await fetch(`${new URL(url).origin}/auth/v1/settings`, {
      headers: { apikey: key }, signal: AbortSignal.timeout(10000),
    });
    const body = await response.json();
    console.log(`Supabase Discord OAuth: ${response.ok ? body.external?.discord ? 'enabled' : 'disabled in Supabase' : `HTTP ${response.status}`}`);
  } catch { console.log('Supabase Discord OAuth: unreachable'); }
}

if (process.argv.includes('--providers')) {
  for (const [name, url] of [
    ['GROQ_API_KEY', 'https://api.groq.com/openai/v1/models'],
    ['MISTRAL_API_KEY', 'https://api.mistral.ai/v1/models'],
    ['NVIDIA_NIM_API_KEY', 'https://integrate.api.nvidia.com/v1/models'],
    ['CEREBRAS_API_KEY', 'https://api.cerebras.ai/v1/models'],
  ]) {
    const key = process.env[name] || providers[name];
    if (!key) continue;
    try {
      const response = await fetch(url, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
      console.log(`${name} provider authentication: HTTP ${response.status}`);
      if (response.ok) {
        const models = await response.json();
        const defaults = { GROQ_API_KEY: ['CYRENE_MODEL', 'openai/gpt-oss-20b'], MISTRAL_API_KEY: ['ASSISTANT_MODEL', 'ministral-8b-latest'], NVIDIA_NIM_API_KEY: ['SECURITY_SLM_MODEL', 'nvidia/nemotron-3.5-content-safety'], CEREBRAS_API_KEY: ['SECURITY_SLM_FALLBACK_MODEL', 'qwen-3.8-27b'] };
        const [setting, fallback] = defaults[name];
        const model = process.env[setting] || field(setting) || fallback;
        console.log(`${setting}: ${(models.data ?? []).some((item) => item.id === model) ? 'model available' : 'configured model not listed'}`);
      }
    } catch { console.log(`${name} provider authentication: unreachable`); }
  }
}
