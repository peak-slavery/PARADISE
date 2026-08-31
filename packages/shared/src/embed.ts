import { EmbedBuilder, type APIEmbedField } from 'discord.js';
import type { Env } from './env.js';

/** Standard palette — every bot reply is an embed, never raw text. */
export const EMBED_COLORS = {
  success: 0x57f287,
  error: 0xed4245,
  info: 0x5865f2,
  warning: 0xfee75c,
} as const;

export type EmbedKind = keyof typeof EMBED_COLORS | 'brand';

export interface EmbedOptions {
  fields?: APIEmbedField[];
  /** Appended to the standard "BotName v1.0.0" footer. */
  footerSuffix?: string;
  thumbnail?: string | null;
  image?: string | null;
  author?: { name: string; iconUrl?: string } | null;
}

export interface EmbedFactory {
  success(title: string, description?: string, opts?: EmbedOptions): EmbedBuilder;
  error(title: string, description?: string, opts?: EmbedOptions): EmbedBuilder;
  info(title: string, description?: string, opts?: EmbedOptions): EmbedBuilder;
  warning(title: string, description?: string, opts?: EmbedOptions): EmbedBuilder;
  /** Neutral embed tinted with this bot's own brand colour. */
  brand(title: string, description?: string, opts?: EmbedOptions): EmbedBuilder;
  /** Generic builder for bots that need to pick a kind dynamically. */
  build(kind: EmbedKind, title: string, description?: string, opts?: EmbedOptions): EmbedBuilder;
  unavailable(service: string): EmbedBuilder;
}

export function createEmbedFactory(env: Env): EmbedFactory {
  const build = (kind: EmbedKind, title: string, description?: string, opts: EmbedOptions = {}): EmbedBuilder => {
    const embed = new EmbedBuilder()
      .setColor(kind === 'brand' ? env.embedColor : EMBED_COLORS[kind])
      .setTitle(title)
      .setTimestamp();

    if (description) embed.setDescription(description);
    if (opts.fields?.length) embed.addFields(opts.fields);
    if (opts.thumbnail) embed.setThumbnail(opts.thumbnail);
    if (opts.image) embed.setImage(opts.image);
    if (opts.author) embed.setAuthor({ name: opts.author.name, iconURL: opts.author.iconUrl });

    embed.setFooter({
      text: opts.footerSuffix
        ? `${env.botName} v${env.botVersion} • ${opts.footerSuffix}`
        : `${env.botName} v${env.botVersion}`,
    });

    return embed;
  };

  return {
    build,
    success: (t, d, o) => build('success', t, d, o),
    error: (t, d, o) => build('error', t, d, o),
    info: (t, d, o) => build('info', t, d, o),
    warning: (t, d, o) => build('warning', t, d, o),
    brand: (t, d, o) => build('brand', t, d, o),
    unavailable: (service) =>
      build(
        'warning',
        'Temporarily unavailable',
        `${service} is not responding right now. This has been logged — please try again shortly.`,
      ),
  };
}

/**
 * Discord caps embed descriptions at 4096 chars and field values at 1024.
 * Truncate instead of throwing a 400 from the API.
 */
export function truncateEmbedText(text: string, max = 4096): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function truncateFieldValue(text: string, max = 1024): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

export function chunkFields(fields: APIEmbedField[], max = 25): APIEmbedField[][] {
  const chunks: APIEmbedField[][] = [];
  for (let i = 0; i < fields.length; i += max) chunks.push(fields.slice(i, i + max));
  return chunks;
}
