import { randomUUID } from 'node:crypto';

const MAX_EVENT_BYTES = 32 * 1024;

function redisConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}

export async function publishDashboardEmbed(input: {
  botId: string;
  guildId: string;
  channelId: string;
  title: string;
  description: string;
  url: string;
  color: string;
  thumbnail: string;
  image: string;
  author: { name: string; url: string; iconUrl: string };
  footer: string;
  fields: { name: string; value: string; inline: boolean }[];
  buttons: { label: string; url: string }[];
}): Promise<{ eventId: string }> {
  const config = redisConfig();
  if (!config) throw new Error('Redis interlink is not configured');

  const event = {
    id: randomUUID(),
    type: 'dashboard.send_embed',
    sourceBot: 'dashboard',
    targetBot: input.botId,
    guildId: input.guildId,
    createdAt: new Date().toISOString(),
    payload: {
      channelId: input.channelId,
      title: input.title,
      description: input.description,
      url: input.url,
      color: input.color,
      thumbnail: input.thumbnail,
      image: input.image,
      author: input.author,
      footer: input.footer,
      fields: input.fields,
      buttons: input.buttons,
    },
  };
  const serialized = JSON.stringify(event);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_EVENT_BYTES) {
    throw new Error('Embed payload exceeds 32 KiB');
  }

  const channel = `bot:${input.botId}`;
  const key = `bot:interlink:${channel}`;
  const response = await fetch(`${config.url}/pipeline`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify([
      ['PUBLISH', channel, serialized],
      ['SET', key, serialized, 'EX', '120'],
    ]),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('Redis interlink publication failed');
  return { eventId: event.id };
}
