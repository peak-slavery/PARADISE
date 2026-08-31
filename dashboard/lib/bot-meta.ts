import type { ConfigField } from './types';

/** The eight bot identifiers, shared with the `bot_id` column in Postgres. */
export type BotId =
  | 'shanks'
  | 'sanji'
  | 'zoro'
  | 'boahancock'
  | 'nami'
  | 'luffy'
  | 'niko-robin'
  | 'cyrene';

export interface BotMeta {
  id: BotId;
  name: string;
  tagline: string;
  description: string;
  /** Brand colour, also used as the accent for the bot's tab and cards. */
  color: string;
  commands: readonly string[];
  fields: readonly ConfigField[];
}
