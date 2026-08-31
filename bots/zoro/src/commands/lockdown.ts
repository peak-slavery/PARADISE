import { SlashCommandBuilder } from 'discord.js';
import { UserError, type CommandModule } from '@eiflow/shared';
import { assertManager } from '../lib/store.js';
import { applyLockdown, liftLockdown } from '../lib/lockdown.js';

export const data = new SlashCommandBuilder()
  .setName('lockdown')
  .setDescription('Emergency server lockdown (Zoro)')
  .addSubcommand((s) => s.setName('on').setDescription('Lock the server down — raise verification + revoke @everyone send'))
  .addSubcommand((s) => s.setName('off').setDescription('Lift the lockdown Zoro applied'));

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  assertManager(ctx);

  const guild = ctx.interaction.guild;
  if (!guild) throw new UserError('This command must be used inside a server.');

  await ctx.defer(false);

  const sub = ctx.interaction.options.getSubcommand();
  if (sub === 'on') {
    const res = await applyLockdown(ctx.services, ctx.log, guild, `Manual lockdown by <@${ctx.userId}>`);
    await ctx.replyEmbed(
      ctx.services.embeds.warning('🔒 Server locked down', 'Verification level raised and @everyone send permissions revoked on text channels.', {
        fields: [
          { name: 'Verification raised', value: res.verification ? 'Yes' : 'Failed', inline: true },
          { name: 'Channels touched', value: String(res.channelsTouched), inline: true },
          { name: 'Note', value: 'Use /lockdown off to restore. Raids may also trigger this automatically.', inline: false },
        ],
      }),
    );
  } else {
    const res = await liftLockdown(ctx.services, ctx.log, guild);
    await ctx.replyEmbed(
      ctx.services.embeds.success('🔓 Lockdown lifted', 'Restoring prior verification level and send permissions.', {
        fields: [
          { name: 'Verification restored', value: res.restored ? 'Yes' : 'Failed', inline: true },
          { name: 'Channels touched', value: String(res.channelsTouched), inline: true },
        ],
      }),
    );
  }
}
