import { PermissionFlagsBits, SlashCommandBuilder, type GuildTextBasedChannel } from 'discord.js';
import { requirePermission, UserError, type CommandModule } from '@eiflow/shared';
import { recordAction } from '../lib/store.js';

const MAX_PURGE = 100;
const TWO_WEEKS_MS = 14 * 24 * 60 * 60 * 1000;
const MAX_MEMBER_PURGE = 200;

export const data = new SlashCommandBuilder()
  .setName('purge')
  .setDescription('Bulk-delete messages or remove members by role')
  .addSubcommand((sub) =>
    sub
      .setName('messages')
      .setDescription('Delete recent messages')
      .addIntegerOption((o) =>
        o.setName('amount').setDescription('Messages to scan (1–100)').setRequired(true).setMinValue(1).setMaxValue(MAX_PURGE),
      )
      .addUserOption((o) =>
        o.setName('user').setDescription('Only delete messages from this user').setRequired(false),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('members')
      .setDescription('Kick every member with a role (dry run unless confirmed)')
      .addRoleOption((o) => o.setName('role').setDescription('Role to target').setRequired(true))
      .addBooleanOption((o) =>
        o.setName('confirm').setDescription('Actually kick. Omit to preview only.').setRequired(false),
      )
      .addStringOption((o) => o.setName('reason').setDescription('Kick reason').setRequired(false).setMaxLength(512)),
  )
  .addSubcommand((sub) =>
    sub
      .setName('bots')
      .setDescription('Delete recent bot messages')
      .addIntegerOption((o) =>
        o.setName('amount').setDescription('Messages to scan (1–100)').setRequired(true).setMinValue(1).setMaxValue(MAX_PURGE),
      ),
  );

function getTextChannel(ctx: Parameters<CommandModule['execute']>[0]): GuildTextBasedChannel {
  const channel = ctx.interaction.channel;
  if (!channel || channel.isDMBased() || !('bulkDelete' in channel)) {
    throw new UserError('This command only works in a server text channel.');
  }
  return channel as GuildTextBasedChannel;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function purgeMessages(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  const amount = ctx.requiredInt('amount');
  const user = ctx.interaction.options.getUser('user');
  const channel = getTextChannel(ctx);

  await ctx.defer(true);

  const fetched = await channel.messages.fetch({ limit: amount });
  const cutoff = Date.now() - TWO_WEEKS_MS; // Discord refuses bulk deletes older than 14 days

  let candidates = [...fetched.values()].filter((m) => m.createdTimestamp > cutoff);
  if (user) candidates = candidates.filter((m) => m.author.id === user.id);

  if (candidates.length === 0) {
    await ctx.info('Nothing to purge', 'No messages matched, or they are older than 14 days.');
    return;
  }

  const deleted = await channel.bulkDelete(candidates, true);
  const skipped = candidates.length - deleted.size;

  await recordAction(ctx, {
    action: 'purge',
    targetId: user ? user.id : ctx.guildId,
    reason: `Purged ${deleted.size} message(s)`,
    meta: { requested: amount, deleted: deleted.size, filterUser: user?.id ?? null },
  });

  await ctx.success(
    'Purge complete',
    `Deleted **${deleted.size}** message(s).${skipped > 0 ? ` ${skipped} skipped (too old or inaccessible).` : ''}`,
  );
}

async function purgeBots(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  const amount = ctx.requiredInt('amount');
  const channel = getTextChannel(ctx);

  await ctx.defer(true);

  const fetched = await channel.messages.fetch({ limit: amount });
  const cutoff = Date.now() - TWO_WEEKS_MS;
  const candidates = [...fetched.values()].filter((m) => m.author.bot && m.createdTimestamp > cutoff);

  if (candidates.length === 0) {
    await ctx.info('Nothing to purge', 'No recent bot messages found.');
    return;
  }

  const deleted = await channel.bulkDelete(candidates, true);

  await recordAction(ctx, {
    action: 'purge',
    targetId: ctx.guildId,
    reason: `Purged ${deleted.size} bot message(s)`,
    meta: { deleted: deleted.size },
  });

  await ctx.success('Purge complete', `Deleted **${deleted.size}** bot message(s).`);
}

async function purgeMembers(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  requirePermission(ctx, PermissionFlagsBits.KickMembers, 'Kick Members');
  const guild = ctx.interaction.guild;
  if (!guild) throw new UserError('This command can only be used inside a server.');

  const role = ctx.interaction.options.getRole('role');
  if (!role) throw new UserError('You must specify a role.');

  const confirm = ctx.interaction.options.getBoolean('confirm') ?? false;
  const reason = ctx.reason();

  await guild.members.fetch();

  const targets = guild.members.cache.filter((m) => m.roles.cache.has(role.id) && m.id !== guild.ownerId);
  const limited = [...targets.values()].slice(0, MAX_MEMBER_PURGE);

  if (!confirm) {
    await ctx.replyEmbed(
      ctx.services.embeds.warning(
        'Dry run — nothing was changed',
        `**${targets.size}** member(s) have ${role.name}.`,
        { fields: [{ name: 'To proceed', value: 'Re-run with `confirm: True`.' }] },
      ),
    );
    return;
  }

  if (limited.length === 0) {
    await ctx.info('Nothing to do', `No kickable members have ${role.name}.`);
    return;
  }

  await ctx.defer(true);

  let kicked = 0;
  let failed = 0;
  for (const member of limited) {
    try {
      await member.kick(reason);
      kicked += 1;
    } catch {
      failed += 1;
    }
    // Paced to stay well inside Discord's kick rate limit.
    await sleep(250);
  }

  await recordAction(ctx, {
    action: 'kick',
    targetId: role.id,
    reason: `Role purge: ${role.name} — ${reason}`,
    meta: { roleId: role.id, kicked, failed },
  });

  await ctx.replyEmbed(
    ctx.services.embeds.success('Role purge complete', undefined, {
      fields: [
        { name: 'Kicked', value: String(kicked), inline: true },
        { name: 'Failed', value: String(failed), inline: true },
        { name: 'Role', value: role.name, inline: true },
      ],
    }),
  );
}

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  const subcommand = ctx.interaction.options.getSubcommand();
  if (subcommand !== 'members') {
    requirePermission(ctx, PermissionFlagsBits.ManageMessages, 'Manage Messages');
  }
  switch (subcommand) {
    case 'messages':
      return purgeMessages(ctx);
    case 'bots':
      return purgeBots(ctx);
    case 'members':
      return purgeMembers(ctx);
    default:
      throw new UserError('Unknown subcommand.');
  }
}
