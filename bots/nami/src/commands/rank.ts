import { SlashCommandBuilder } from 'discord.js';
import { escapeMarkdown, formatDuration, UserError, type CommandModule } from '@eiflow/shared';
import { levelProgress, progressBar } from '../lib/levels.js';
import { getXpDoc, membersAhead } from '../lib/store.js';
import { getXpTracker } from '../lib/xp.js';

type Ctx = Parameters<CommandModule['execute']>[0];

export const data = new SlashCommandBuilder()
  .setName('rank')
  .setDescription('Show XP, level, message count and voice time for a member')
  .addUserOption((o) => o.setName('user').setDescription('Member to look up (defaults to you)').setRequired(false));

export async function execute(ctx: Ctx): Promise<void> {
  const guild = ctx.interaction.guild;
  if (!guild) throw new UserError('This command can only be used inside a server.');

  // Optional target: ctx.targetUser() would throw when the option is omitted.
  const user = ctx.interaction.options.getUser('user') ?? ctx.interaction.user;

  await ctx.defer();

  const doc = await getXpDoc(ctx, guild.id, user.id);
  // Buffered XP is not on disk yet, but hiding it would make /rank look stale.
  const pending = getXpTracker()?.peek(guild.id, user.id) ?? { xp: 0, messages: 0, voiceSeconds: 0 };

  const xp = (doc?.xp ?? 0) + pending.xp;
  const messages = (doc?.messages ?? 0) + pending.messages;
  const voiceSeconds = (doc?.voice_seconds ?? 0) + pending.voiceSeconds;
  const progress = levelProgress(xp);

  const ahead = await membersAhead(ctx, guild.id, xp).catch(() => null);

  await ctx.replyEmbed(
    ctx.services.embeds.brand(
      escapeMarkdown(user.tag),
      `${progressBar(progress.percent)} **${progress.percent}%**`,
      {
        fields: [
          { name: 'Level', value: String(progress.level), inline: true },
          { name: 'XP', value: String(xp), inline: true },
          { name: 'Rank', value: ahead === null ? 'Unavailable' : `#${ahead + 1}`, inline: true },
          {
            name: 'Next level',
            value: `${progress.into}/${progress.needed} XP — ${progress.remaining} to go`,
            inline: false,
          },
          { name: 'Messages', value: String(messages), inline: true },
          { name: 'Voice time', value: formatDuration(voiceSeconds), inline: true },
        ],
        thumbnail: user.displayAvatarURL({ size: 128 }),
        footerSuffix: pending.xp > 0 ? 'Includes XP not yet saved' : undefined,
      },
    ),
  );
}
