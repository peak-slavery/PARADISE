import { SlashCommandBuilder } from 'discord.js';

import type { CommandModule } from '../types.js';
import { removeGuildWhitelist, writeGuildWhitelist } from '../whitelist.js';

const MASTER_DISCORD_ID = '1479589523426902208';

export const data = new SlashCommandBuilder()
  .setName('authorize')
  .setDescription('Manage guild command authorization')
  .addSubcommandGroup((group) => group
    .setName('add')
    .setDescription('Add a guild whitelist')
    .addSubcommand((subcommand) => subcommand
      .setName('full')
      .setDescription('Grant permanent access')
      .addStringOption((option) => option.setName('guild_id').setDescription('Discord guild ID').setRequired(true))
      .addStringOption((option) => option.setName('note').setDescription('Internal note').setRequired(false)))
    .addSubcommand((subcommand) => subcommand
      .setName('temp')
      .setDescription('Grant temporary access')
      .addStringOption((option) => option.setName('guild_id').setDescription('Discord guild ID').setRequired(true))
      .addIntegerOption((option) => option.setName('hours').setDescription('Duration in hours').setMinValue(1).setMaxValue(720).setRequired(true))
      .addStringOption((option) => option.setName('note').setDescription('Internal note').setRequired(false))))
  .addSubcommand((subcommand) => subcommand
    .setName('remove')
    .setDescription('Revoke guild access')
    .addStringOption((option) => option.setName('guild_id').setDescription('Discord guild ID').setRequired(true)))
  .addSubcommand((subcommand) => subcommand.setName('list').setDescription('List active whitelist rows'));

function validGuildId(value: string): boolean {
  return /^\d{17,20}$/.test(value);
}

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  if (ctx.userId !== MASTER_DISCORD_ID) {
    await ctx.error('Master access required', 'Only the master operator can manage guild authorization.', true);
    return;
  }
  const supabase = ctx.services.requireSupabase();
  const group = ctx.interaction.options.getSubcommandGroup(false);
  const subcommand = ctx.interaction.options.getSubcommand();

  if (subcommand === 'list') {
    const { data, error } = await supabase.from('guild_whitelists').select('guild_id,whitelist_type,expires_at,note').is('removed_at', null).order('created_at', { ascending: false });
    if (error) throw error;
    await ctx.info('Active guild whitelist', data?.length ? data.map((row) => `\`${row.guild_id}\` · ${row.whitelist_type}${row.expires_at ? ` · expires ${row.expires_at}` : ''}`).join('\n') : 'No active whitelist rows.', true);
    return;
  }

  const guildId = ctx.interaction.options.getString('guild_id', true);
  if (!validGuildId(guildId)) {
    await ctx.error('Invalid guild ID', 'Provide a 17–20 digit Discord snowflake.', true);
    return;
  }
  if (guildId === ctx.services.env.devGuildId || guildId === ctx.services.env.mainGuildId) {
    await ctx.error('Fixed guild', 'The configured dev and main guilds are immutable.', true);
    return;
  }

  if (group === 'add') {
    const type = subcommand === 'temp' ? 'temp' : 'full';
    const hours = type === 'temp' ? ctx.interaction.options.getInteger('hours', true) : undefined;
    const expiresAt = hours ? new Date(Date.now() + hours * 60 * 60_000).toISOString() : null;
    const note = ctx.interaction.options.getString('note');
    await writeGuildWhitelist(supabase, { guildId, type, expiresAt, note });
    await supabase.from('servers').update({ authorized: true }).eq('guild_id', guildId);
    await ctx.success('Guild authorized', type === 'temp' ? `Temporary access granted for ${hours} hour(s).` : 'Full access granted.', true);
    return;
  }

  await removeGuildWhitelist(supabase, guildId);
  await supabase.from('servers').update({ authorized: false }).eq('guild_id', guildId);
  await ctx.success('Guild unauthorized', 'Commands are now locked for this guild.', true);
}
