import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { requireManageGuild, UserError, type CommandModule } from '@eiflow/shared';
import { getConfig, setConfig } from '../lib/store.js';

export const data = new SlashCommandBuilder()
  .setName('antinuke')
  .setDescription('Enable or disable raid and permission-abuse protection')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) =>
    sub
      .setName('enable')
      .setDescription('Turn antinuke on')
      .addChannelOption((o) =>
        o
          .setName('channel')
          .setDescription('Channel to post raid alerts in (optional)')
          .setRequired(false)
          .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
      ),
  )
  .addSubcommand((sub) =>
    sub.setName('disable').setDescription('Turn antinuke off'),
  );

async function enable(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  if (!ctx.services.supabase) {
    throw new UserError('Configuration storage is unavailable right now. Please try again later.');
  }

  const channel = ctx.interaction.options.getChannel('channel');
  const patch = channel ? { enabled: true, alert_channel: channel.id } : { enabled: true };

  const saved = await setConfig(ctx, patch);
  if (!saved) throw new UserError('Could not save that setting. Please try again.');

  const config = await getConfig(ctx);

  await ctx.replyEmbed(
    ctx.services.embeds.success('Antinuke enabled', 'Destructive actions are now monitored.', {
      fields: [
        { name: 'Status', value: config.enabled ? 'Active' : 'Inactive', inline: true },
        {
          name: 'Alert channel',
          value: config.alert_channel ? `<#${config.alert_channel}>` : 'Not set',
          inline: true,
        },
        {
          name: 'Bypass',
          value: 'Server owners, bot owners and whitelisted users/roles are never punished.',
          inline: false,
        },
      ],
    }),
  );
}

async function disable(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  if (!ctx.services.supabase) {
    throw new UserError('Configuration storage is unavailable right now. Please try again later.');
  }

  const saved = await setConfig(ctx, { enabled: false });
  if (!saved) throw new UserError('Could not save that setting. Please try again.');

  await ctx.replyEmbed(
    ctx.services.embeds.warning('Antinuke disabled', 'Destructive actions are no longer monitored.', {
      fields: [{ name: 'Status', value: 'Inactive', inline: true }],
    }),
  );
}

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  requireManageGuild(ctx);
  const sub = ctx.interaction.options.getSubcommand();
  if (sub === 'enable') return enable(ctx);
  if (sub === 'disable') return disable(ctx);
  throw new UserError('Unknown subcommand.');
}
