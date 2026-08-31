import { DiscordAPIError, type Channel, type CommandInteraction, type EmbedBuilder } from 'discord.js';
import type { Logger } from './logger.js';

/** Discord returns these once an interaction token or message no longer exists. */
const UNKNOWN_INTERACTION = 10062;
const UNKNOWN_MESSAGE = 10008;

export interface InteractionReplyPayload {
  embeds: EmbedBuilder[];
  content?: string;
  ephemeral?: boolean;
}

function isExpired(err: unknown): boolean {
  return (
    err instanceof DiscordAPIError &&
    (err.code === UNKNOWN_INTERACTION || err.code === UNKNOWN_MESSAGE)
  );
}

/**
 * Replies to an interaction, transparently recovering when the interaction
 * token has already expired.
 *
 * This happens routinely in production: a slow AI or search response passes the
 * 15-minute interaction lifetime, or the interaction was already acknowledged
 * elsewhere. Without the downgrade the user sees "The application did not
 * respond" even though the work completed successfully.
 *
 * Returns false when delivery failed entirely — callers should log, not throw.
 */
export async function replyOrFollowUp(
  interaction: CommandInteraction,
  payload: InteractionReplyPayload,
  log: Logger,
): Promise<boolean> {
  const body = { ...payload, allowedMentions: { parse: [] as never[] } };

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(body);
    } else {
      await interaction.reply(body);
    }
    return true;
  } catch (err) {
    if (!isExpired(err)) {
      log.warn({ err, command: interaction.commandName }, 'failed to send interaction reply');
      return false;
    }

    try {
      // Follow-ups can still succeed when the interaction was merely
      // mis-sequenced; if the token is truly gone this throws too.
      await interaction.followUp({ ...body, ephemeral: false });
      return true;
    } catch (followUpErr) {
      log.warn(
        { err: followUpErr, command: interaction.commandName },
        'interaction token expired before a reply could be delivered',
      );
      return false;
    }
  }
}

/**
 * Sends an embed to a channel, swallowing every failure.
 *
 * Used by bots that post unprompted messages (welcome greetings, level-up
 * announcements, antinuke alerts) where a missing channel or revoked permission
 * must never surface as an error to a user or crash the process.
 */
export async function sendChannelEmbed(
  channel: Channel | null | undefined,
  embed: EmbedBuilder,
  log: Logger,
): Promise<boolean> {
  if (!channel || !channel.isTextBased() || channel.isDMBased() || !('send' in channel)) return false;

  try {
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    return true;
  } catch (err) {
    log.warn({ err, channelId: channel.id }, 'failed to send channel embed');
    return false;
  }
}
