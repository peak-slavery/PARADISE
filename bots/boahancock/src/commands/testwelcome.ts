import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { requireManageGuild, UserError, type CommandModule } from '@eiflow/shared';
import {
  channelFor,
  defaultTemplate,
  getConfig,
  isCustom,
  renderTemplate,
  templateFor,
  type MessageKind,
} from '../lib/store.js';

type Ctx = Parameters<CommandModule['execute']>[0];

export const data = new SlashCommandBuilder()
  .setName('testwelcome')
  .setDescription('Preview the join or leave message without anyone joining')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((sub) => sub.setName('welcome').setDescription('Preview the join message'))
  .addSubcommand((sub) => sub.setName('leave').setDescription('Preview the leave message'));

export async function execute(ctx: Ctx): Promise<void> {
  requireManageGuild(ctx);
  const guild = ctx.interaction.guild;
  if (!guild) throw new UserError('This command can only be used inside a server.');

  const sub = ctx.interaction.options.getSubcommand();
  if (sub !== 'welcome' && sub !== 'leave') throw new UserError('Unknown subcommand.');
  const kind: MessageKind = sub;

  const config = await getConfig(ctx);
  const channelId = channelFor(config, kind);
  if (!channelId) {
    throw new UserError(
      `No ${kind} channel is set yet. Use ${kind === 'welcome' ? '/setwelcome' : '/setleave'} first.`,
    );
  }

  // Rendered with the invoking member so an admin sees the real thing.
  const template = templateFor(config, kind);
  const rendered = renderTemplate(template, {
    userId: ctx.userId,
    username: ctx.interaction.user.tag,
    serverName: guild.name,
    memberCount: guild.memberCount,
  });

  await ctx.replyEmbed(
    ctx.services.embeds.brand(
      kind === 'welcome' ? 'Join message preview' : 'Leave message preview',
      rendered.length > 0 ? rendered : 'The template rendered empty — check the message you configured.',
      {
        fields: [
          { name: 'Channel', value: `<#${channelId}>`, inline: true },
          { name: 'Format', value: isCustom(config, kind) ? 'Plain text' : 'Embed', inline: true },
          {
            name: 'Template',
            value: template === defaultTemplate(kind) ? 'Default' : template,
            inline: false,
          },
        ],
        footerSuffix: 'Only you can see this preview',
      },
    ),
    true,
  );
}
