import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { requirePermission, UserError, type CommandModule } from '@eiflow/shared';
import { LOG_CATEGORIES, getConfig, setConfig, type LogCategory } from '../lib/store.js';

const CATEGORY_LABELS: Record<LogCategory, string> = {
  messages: 'Message edits and deletions',
  members: 'Members joining and leaving',
  channels: 'Channel creation and deletion',
  roles: 'Role creation and deletion',
  voice: 'Voice join, leave and channel moves',
  moderation: 'Kicks, bans and unbans (audit log)',
};

export const data = new SlashCommandBuilder()
  .setName('logconfig')
  .setDescription('Choose which event categories are logged')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((o) =>
    o
      .setName('event')
      .setDescription('Event category to configure')
      .setRequired(true)
      .addChoices(...LOG_CATEGORIES.map((c) => ({ name: CATEGORY_LABELS[c], value: c }))),
  )
  .addBooleanOption((o) =>
    o.setName('enabled').setDescription('Turn this category on or off').setRequired(true),
  );

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  requirePermission(ctx, PermissionFlagsBits.ManageGuild, 'Manage Server');
  const event = ctx.requiredString('event') as LogCategory;
  const enabled = ctx.interaction.options.getBoolean('enabled', true);

  if (!LOG_CATEGORIES.includes(event)) {
    throw new UserError('Unknown event category.');
  }

  if (!ctx.services.supabase) {
    throw new UserError('Configuration storage is unavailable right now. Please try again later.');
  }

  const current = await getConfig(ctx);
  const saved = await setConfig(ctx, { events: { ...current.events, [event]: enabled } });
  if (!saved) throw new UserError('Could not save that setting. Please try again.');

  const updated = await getConfig(ctx);
  const summary = LOG_CATEGORIES.map(
    (c) => `${(updated.events[c] ?? true) ? '✅' : '❌'} \`${c}\``,
  ).join('\n');

  await ctx.replyEmbed(
    ctx.services.embeds.success(
      `Category ${enabled ? 'enabled' : 'disabled'}`,
      `\`${event}\` — ${CATEGORY_LABELS[event]} is now **${enabled ? 'on' : 'off'}**.`,
      {
        fields: [
          { name: 'All categories', value: summary, inline: false },
          {
            name: 'Log channel',
            value: updated.log_channel ? `<#${updated.log_channel}>` : 'Not set — use `/setlogchannel`.',
            inline: false,
          },
        ],
      },
    ),
  );
}
