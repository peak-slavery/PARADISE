import { SlashCommandBuilder, type APIEmbedField } from 'discord.js';
import { UserError, type CommandModule } from '@eiflow/shared';
import { assertManager } from '../lib/store.js';
import { gainedDangerousPermissions } from '../lib/enforce.js';

const VLEVEL = ['None', 'Low', 'Medium (verified email)', 'High (member > 5 min)', 'Very High (phone)'];

export const data = new SlashCommandBuilder()
  .setName('scan')
  .setDescription('Security posture scan of this server (Zoro)');

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  assertManager(ctx);

  const guild = ctx.interaction.guild;
  if (!guild) throw new UserError('This command must be used inside a server.');

  await ctx.defer(true);

  // Roles that currently hold a dangerous permission — reuse the audit-log
  // "gained" helper with a zero baseline to read the *present* grants.
  const dangerous = guild.roles.cache
    .filter((r) => !r.managed)
    .map((r) => ({ role: r, gained: gainedDangerousPermissions('0', r.permissions.bitfield.toString()) }))
    .filter((x) => x.gained.length > 0)
    .sort((a, b) => b.role.position - a.role.position);

  const webhooks = await guild.fetchWebhooks().catch(() => null);
  const bots = guild.members.cache.filter((m) => m.user.bot).size;

  const fields: APIEmbedField[] = [
    {
      name: 'Verification level',
      value: VLEVEL[guild.verificationLevel] ?? String(guild.verificationLevel),
      inline: true,
    },
    { name: 'Members', value: String(guild.memberCount), inline: true },
    { name: 'Bots', value: String(bots), inline: true },
    { name: 'Webhooks', value: webhooks ? String(webhooks.size) : 'unknown', inline: true },
    { name: 'Roles w/ dangerous perms', value: String(dangerous.length), inline: true },
  ];

  if (dangerous.length > 0) {
    fields.push({
      name: '⚠️ Risky roles',
      value: dangerous
        .slice(0, 10)
        .map((d) => `<@&${d.role.id}> — ${d.gained.join(', ')}`)
        .join('\n') || 'none',
      inline: false,
    });
  }

  const recommendation =
    dangerous.length > 3 || guild.verificationLevel < 2
      ? 'Consider tightening verification and auditing roles that grant Manage Roles / Administrator.'
      : 'Posture looks reasonable. Keep AutoMod + Zoro enabled.';

  await ctx.replyEmbed(
    ctx.services.embeds.info(`Security scan · ${guild.name}`, recommendation, {
      fields,
      footerSuffix: 'point-in-time snapshot',
    }),
  );
}
