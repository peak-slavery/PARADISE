// ---------------------------------------------------------------------------
// Card rendering helpers (reusable, embed-agnostic).
// ---------------------------------------------------------------------------

import type { CardInstanceDoc, CardDefinitionDoc, CardPackDoc } from '@eiflow/shared';
import { rarityFor } from './rarity.js';
import { getDefinition } from './catalog.js';

export interface RenderableCard {
  instance: CardInstanceDoc;
  definition: CardDefinitionDoc;
  /** Optional jitter value; if absent we display the rank's base value. */
  marketValue?: number;
}

export function cardEmbedFields(card: RenderableCard): {
  title: string;
  description: string;
  fields: { name: string; value: string; inline: boolean }[];
  color: number;
  image: string | null;
  footer: string;
} {
  const { instance, definition } = card;
  const r = rarityFor(definition.rank);
  const market = card.marketValue ?? r.baseValue;
  const serial = instance.serial_number
    ? ` · Serial #${String(instance.serial_number).padStart(4, '0')}`
    : '';
  return {
    title: `${definition.character} — ${definition.title}`,
    description: `${definition.description}${serial}`,
    color: r.color,
    image: definition.artwork_url,
    footer: `${r.displayName} · ${market.toLocaleString('en-US')} berries`,
    fields: [
      { name: 'Series', value: definition.series, inline: true },
      { name: 'Category', value: definition.category.toUpperCase(), inline: true },
      { name: 'Instance', value: instance.instance_id, inline: false },
    ],
  };
}

/** Compact line for paginated collection listings. */
export function collectionLine(card: RenderableCard, market: number): string {
  const r = rarityFor(card.definition.rank);
  const serial = card.instance.serial_number ? ` #${String(card.instance.serial_number).padStart(3, '0')}` : '';
  return `\`${card.instance.instance_id}\` · **${card.definition.character}** · ${r.displayName}${serial} · ${market.toLocaleString('en-US')}b`;
}

export function packEmbed(pack: CardPackDoc): {
  title: string;
  description: string;
  color: number;
  image: string | null;
  fields: { name: string; value: string; inline: boolean }[];
} {
  const allowedRanks = pack.allowed_ranks.map((rank) => rarityFor(rank).displayName).join(', ');
  return {
    title: `${pack.display_name} · ${pack.price.toLocaleString('en-US')} berries`,
    description: pack.description,
    color: pack.allow_limited_arts ? 0xffd700 : 0x5865f2,
    image: pack.artwork_url,
    fields: [
      { name: 'Cards per pack', value: String(pack.card_count), inline: true },
      { name: 'Ranks', value: allowedRanks || 'catalog default', inline: false },
      { name: 'Limited Arts', value: pack.allow_limited_arts ? 'eligible' : 'not included', inline: true },
    ],
  };
}

export function lookupDefinition(definition_id: string): CardDefinitionDoc | null {
  return getDefinition(definition_id);
}
