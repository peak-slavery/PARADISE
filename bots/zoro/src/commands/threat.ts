import { SlashCommandBuilder } from 'discord.js';
import { UserError, type CommandModule } from '@eiflow/shared';
import { assertManager, readConfig } from '../lib/store.js';
import { computeTrust } from '../lib/trust.js';

export const data = new SlashCommandBuilder()
  .setName('threat')
  .setDescription('Inspect Zoro threat config and per-member trust (Zoro)')
  .addSubcommand((s) => s.setName('config').setDescription('Show current raid thresholds and modes'))
  .addSubcommand((s) =>
    s
      .setName('user')
      .setDescription("Show a member's trust score")
      .addUserOption((o) => o.setName('user').setDescription('Member to inspect').setRequired(true)),
  )
  .addSubcommand((s) => s.setName('lockdown').setDescription('Show whether a Zoro lockdown is currently recorded'));

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  assertManager(ctx);

  const sub = ctx.interaction.options.getSubcommand();
  await ctx.defer(true);

  if (sub === 'config') {
    const c = await readConfig(ctx.services, ctx.guildId);
    await ctx.replyEmbed(
      ctx.services.embeds.brand('Zoro threat config', undefined, {
        fields: [
          { name: 'Enabled', value: c.enabled ? 'Yes' : 'No', inline: true },
          { name: 'Mode', value: c.mode, inline: true },
          { name: 'Punishment', value: c.punishment, inline: true },
          { name: 'Ban threshold', value: String(c.banThreshold), inline: true },
          { name: 'Channel threshold', value: String(c.channelThreshold), inline: true },
          { name: 'Role threshold', value: String(c.roleThreshold), inline: true },
          { name: 'Window (s)', value: String(c.windowSeconds), inline: true },
          { name: 'SLM', value: c.automodSlm ? `on @ ${(c.slmThreshold * 100).toFixed(0)}%` : 'off', inline: true },
          { name: 'Trust mode', value: c.trustMode ? 'on' : 'off', inline: true },
          { name: 'Lockdown on raid', value: c.lockdownOnRaid ? 'on' : 'off', inline: true },
          { name: 'Snapshot on change', value: c.snapshotOnChange ? 'on' : 'off', inline: true },
        ],
      }),
    );
    return;
  }

  if (sub === 'user') {
    const user = ctx.interaction.options.getUser('user');
    if (!user) throw new UserError('Specify a user.');
    const guild = ctx.interaction.guild;
    const member = guild ? await guild.members.fetch(user.id).catch(() => null) : null;
    const t = await computeTrust(ctx.services, ctx.log, ctx.guildId, user.id, member?.joinedAt ?? null);
    await ctx.replyEmbed(
      ctx.services.embeds.info(`Trust · <@${user.id}>`, `Tier: **${t.tier}** (score ${t.score}/100)`, {
        fields: [
          { name: 'Clean messages', value: String(t.cleanMessages), inline: true },
          {
            name: 'Incidents',
            value: `L${t.incidents.low}/M${t.incidents.medium}/H${t.incidents.high}/C${t.incidents.critical}`,
            inline: true,
          },
          { name: 'Days in guild', value: t.daysInGuild != null ? String(t.daysInGuild) : 'unknown', inline: true },
        ],
      }),
    );
    return;
  }

  const active = await ctx.services.redis.get<number>(`an:lockdown:${ctx.guildId}`).catch(() => null);
  await ctx.replyEmbed(
    ctx.services.embeds.info(
      'Lockdown status',
      active != null ? 'A lockdown is currently recorded as active.' : 'No active lockdown recorded.',
      { fields: [{ name: 'Stored level', value: active != null ? String(active) : '—', inline: true }] },
    ),
  );
}
