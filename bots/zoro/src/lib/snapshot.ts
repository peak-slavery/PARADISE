import type { Guild, GuildChannel } from 'discord.js';
import type { BotServices, Logger } from '@eiflow/shared';
import type { GuildSnapshotDoc, GuildSnapshotPayload } from './model.js';
import { zoroCollections } from './mongo.js';

/**
 * Configuration snapshots — the rollback backbone of Zoro.
 *
 * Before any revert we stash the guild's roles and channels (permissions,
 * colours, positions, overwrites) into `guild_snapshots`. A later revert
 * recreates anything that is missing, so a botched raid cleanup can be undone
 * without a full manual rebuild.
 *
 * Recreation is best-effort and fully guarded: a single failed role or channel
 * must never abort the rest, and a missing permission bit must never grant a
 * role more power than it had. If Mongo is down we simply skip — the raid is
 * still reverted/quarantined, we just lose the paper trail for undo.
 */

const MAX_SNAPSHOTS = 20;

export async function captureSnapshot(
  services: BotServices,
  log: Logger,
  guild: Guild,
  reason: string,
  createdBy: string | null,
): Promise<GuildSnapshotDoc | null> {
  const cols = await zoroCollections(services, log);
  if (!cols) return null;

  try {
    const roles: GuildSnapshotPayload['roles'] = guild.roles.cache
      .filter((r) => !r.managed && r.id !== guild.roles.everyone.id)
      .map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color,
        permissions: r.permissions.bitfield.toString(),
        position: r.position,
        hoist: r.hoist,
        mentionable: r.mentionable,
        managed: r.managed,
      }));

    const channels: GuildSnapshotPayload['channels'] = guild.channels.cache
      .filter((c) => c.type === 0 || c.type === 5 || c.type === 4) // text, announcement, category
      .map((c) => {
        const ch = c as GuildChannel & { topic?: string; nsfw?: boolean; parentId?: string | null };
        return {
          id: c.id,
          name: c.name,
          type: c.type,
          parent_id: c.parentId ?? null,
          position: c.position,
          topic: typeof ch.topic === 'string' ? ch.topic.slice(0, 512) : null,
          nsfw: Boolean(ch.nsfw),
          overwrites: c.permissionOverwrites.cache.map((o) => ({
            id: o.id,
            type: o.type === 1 ? 'role' : 'member',
            allow: o.allow.bitfield.toString(),
            deny: o.deny.bitfield.toString(),
          })),
        };
      });

    const payload: GuildSnapshotPayload = {
      guild: {
        name: guild.name,
        verification_level: guild.verificationLevel,
        default_message_notifications: guild.defaultMessageNotifications,
        explicit_content_filter: guild.explicitContentFilter,
        afk_channel_id: guild.afkChannelId,
        afk_timeout: guild.afkTimeout,
        system_channel_id: guild.systemChannelId,
        rules_channel_id: guild.rulesChannelId,
      },
      roles,
      channels,
    };

    const doc: GuildSnapshotDoc = {
      guild_id: guild.id,
      reason: reason.slice(0, 200),
      created_by: createdBy,
      created_at: new Date(),
      payload,
    };

    await cols.guild_snapshots.insertOne(doc);
    // Keep at most MAX_SNAPSHOTS per guild.
    const excess = await cols.guild_snapshots.countDocuments({ guild_id: guild.id });
    if (excess > MAX_SNAPSHOTS) {
      const toDrop = await cols.guild_snapshots
        .find({ guild_id: guild.id })
        .sort({ created_at: 1 })
        .limit(excess - MAX_SNAPSHOTS)
        .toArray();
      if (toDrop.length > 0) {
        await cols.guild_snapshots.deleteMany({ _id: { $in: toDrop.map((d) => d._id) } });
      }
    }

    return doc;
  } catch (err) {
    log.warn({ err, guildId: guild.id }, 'snapshot capture failed');
    return null;
  }
}

export async function latestSnapshot(
  services: BotServices,
  log: Logger,
  guildId: string,
): Promise<GuildSnapshotDoc | null> {
  const cols = await zoroCollections(services, log);
  if (!cols) return null;
  try {
    return (await cols.guild_snapshots.findOne({ guild_id: guildId })) ?? null;
  } catch (err) {
    log.warn({ err, guildId }, 'latest snapshot read failed');
    return null;
  }
}

/**
 * Recreates any role/channel from the snapshot that is missing in the live
 * guild. Best-effort: collects a report of what was restored vs failed.
 */
export async function revertFromSnapshot(
  services: BotServices,
  log: Logger,
  guild: Guild,
  doc: GuildSnapshotDoc,
): Promise<{ restored: number; failed: number }> {
  let restored = 0;
  let failed = 0;

  for (const role of doc.payload.roles) {
    if (guild.roles.cache.has(role.id)) continue;
    try {
      await guild.roles.create({
        name: role.name,
        color: role.color,
        permissions: BigInt(role.permissions) as unknown as bigint,
        hoist: role.hoist,
        mentionable: role.mentionable,
        position: role.position,
        reason: 'Zoro rollback: recreate role from snapshot',
      });
      restored += 1;
    } catch (err) {
      failed += 1;
      log.warn({ err, role: role.name }, 'snapshot role recreate failed');
    }
  }

  for (const channel of doc.payload.channels) {
    if (guild.channels.cache.has(channel.id)) continue;
    try {
      await guild.channels.create({
        name: channel.name,
        type: channel.type as 0 | 4 | 5,
        topic: channel.topic ?? undefined,
        nsfw: channel.nsfw,
        parent: channel.parent_id ?? undefined,
        position: channel.position,
        reason: 'Zoro rollback: recreate channel from snapshot',
      });
      restored += 1;
    } catch (err) {
      failed += 1;
      log.warn({ err, channel: channel.name }, 'snapshot channel recreate failed');
    }
  }

  return { restored, failed };
}
