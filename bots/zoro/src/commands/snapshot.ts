import { SlashCommandBuilder } from 'discord.js';
import { UserError, type CommandModule } from '@eiflow/shared';
import { assertManager } from '../lib/store.js';
import { captureSnapshot, latestSnapshot, revertFromSnapshot } from '../lib/snapshot.js';

export const data = new SlashCommandBuilder()
  .setName('snapshot')
  .setDescription('Capture or restore server config snapshots (Zoro)')
  .addSubcommand((s) => s.setName('capture').setDescription('Store a snapshot of roles + channels now'))
  .addSubcommand((s) => s.setName('restore').setDescription('Recreate any roles/channels missing from the latest snapshot'))
  .addSubcommand((s) => s.setName('list').setDescription('Show when the latest snapshot was taken'));

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  assertManager(ctx);

  const guild = ctx.interaction.guild;
  if (!guild) throw new UserError('This command must be used inside a server.');

  const sub = ctx.interaction.options.getSubcommand();
  await ctx.defer(false);

  if (sub === 'capture') {
    const doc = await captureSnapshot(ctx.services, ctx.log, guild, `Manual capture by <@${ctx.userId}>`, ctx.userId);
    if (!doc) throw new UserError('Could not capture a snapshot — the database may be unavailable.');
    const ts = Math.floor(doc.created_at.getTime() / 1000);
    await ctx.replyEmbed(
      ctx.services.embeds.success('📸 Snapshot captured', `Roles and channels stored at <t:${ts}:f>.`, {
        fields: [
          { name: 'Roles', value: String(doc.payload.roles.length), inline: true },
          { name: 'Channels', value: String(doc.payload.channels.length), inline: true },
        ],
      }),
    );
    return;
  }

  if (sub === 'restore') {
    const doc = await latestSnapshot(ctx.services, ctx.log, guild.id);
    if (!doc) throw new UserError('No snapshot found to restore from.');
    const res = await revertFromSnapshot(ctx.services, ctx.log, guild, doc);
    await ctx.replyEmbed(
      ctx.services.embeds.info('🔧 Snapshot restored', 'Recreated missing roles/channels from the snapshot.', {
        fields: [
          { name: 'Restored', value: String(res.restored), inline: true },
          { name: 'Failed', value: String(res.failed), inline: true },
        ],
      }),
    );
    return;
  }

  const doc = await latestSnapshot(ctx.services, ctx.log, guild.id);
  if (!doc) {
    await ctx.info('No snapshots', 'No configuration snapshot has been captured yet.');
    return;
  }
  const ts = Math.floor(doc.created_at.getTime() / 1000);
  await ctx.replyEmbed(
    ctx.services.embeds.info('Latest snapshot', `Captured at <t:${ts}:f> by ${doc.created_by ? `<@${doc.created_by}>` : 'system'}.`, {
      fields: [
        { name: 'Reason', value: doc.reason || '—', inline: false },
        { name: 'Roles', value: String(doc.payload.roles.length), inline: true },
        { name: 'Channels', value: String(doc.payload.channels.length), inline: true },
      ],
    }),
  );
}
