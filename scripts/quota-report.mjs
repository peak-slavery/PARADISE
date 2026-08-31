#!/usr/bin/env node
/**
 * Weekly free-tier quota report.
 *
 * Polls every bot's /health endpoint, flags anything at or above 80% of its
 * free-tier ceiling, and posts a summary to a Discord webhook (typically the
 * logging bot's dashboard channel).
 *
 * Env:
 *   BOT_HEALTH_URLS          comma-separated base URLs, e.g. https://bot-a.onrender.com
 *   REDIS_DAILY_COMMAND_BUDGET  Upstash free-tier allowance (default 8000)
 *   DISCORD_REPORT_WEBHOOK   optional; without it the report is printed to stdout
 */
const urls = (process.env.BOT_HEALTH_URLS ?? '')
  .split(',')
  .map((u) => u.trim())
  .filter(Boolean);

const budget = Number(process.env.REDIS_DAILY_COMMAND_BUDGET ?? 8000);
const webhook = process.env.DISCORD_REPORT_WEBHOOK;
const ALERT_RATIO = 0.8;

async function fetchHealth(base) {
  const url = `${base.replace(/\/$/, '')}/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { url, ok: false, error: `HTTP ${res.status}` };
    return { url, ok: true, data: await res.json() };
  } catch (err) {
    return { url, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const results = await Promise.all(urls.map(fetchHealth));

const lines = [];
let alerts = 0;

for (const r of results) {
  if (!r.ok || !r.data) {
    alerts += 1;
    lines.push(`**OFFLINE** \`${r.url}\` — ${r.error ?? 'unknown'}`);
    continue;
  }

  const d = r.data;
  const redisPct = budget > 0 ? (d.redis_commands_today / budget) * 100 : 0;
  const down = Object.entries(d.db_connections ?? {})
    .filter(([, v]) => v === false)
    .map(([k]) => k);

  const flags = [];
  if (redisPct >= ALERT_RATIO * 100) flags.push(`Redis ${redisPct.toFixed(0)}% of daily budget`);
  if (down.length) flags.push(`down: ${down.join(', ')}`);
  if (flags.length) alerts += 1;

  lines.push(
    [
      flags.length ? '**ALERT**' : 'OK',
      `\`${d.bot_id ?? r.url}\` v${d.version ?? '?'}`,
      `uptime ${d.uptime ?? 0}s`,
      `${d.ram_mb ?? 0}MB RAM`,
      `redis ${d.redis_commands_today ?? 0}/${budget}`,
      `writes/h ${d.db_write_count_1h ?? 0}`,
      flags.length ? `— ${flags.join('; ')}` : '',
    ]
      .join(' ')
      .trim(),
  );
}

const summary = lines.length ? lines.join('\n') : '_No bot URLs configured._';

const payload = {
  embeds: [
    {
      title: alerts > 0 ? `Free-tier report — ${alerts} item(s) need attention` : 'Free-tier report — all clear',
      description: summary.slice(0, 4096),
      color: alerts > 0 ? 0xfee75c : 0x57f287,
      timestamp: new Date().toISOString(),
      footer: { text: 'Ei Flow quota monitor' },
    },
  ],
};

if (webhook) {
  const res = await fetch(webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error(`webhook delivery failed: HTTP ${res.status}`);
    process.exitCode = 1;
  } else {
    console.log('quota report delivered');
  }
} else {
  console.log(summary);
}
