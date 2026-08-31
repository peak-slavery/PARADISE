import { SlashCommandBuilder } from 'discord.js';
import { UserError, type CommandModule } from '@eiflow/shared';
import { assertManager, readConfig, writeConfig, type AntinukeConfig } from '../lib/store.js';

type Preset = 'paranoid' | 'balanced' | 'relaxed';

/** One-tap configurations so a non-expert admin can pick a sane posture. */
const PRESETS: Record<Preset, Partial<AntinukeConfig>> = {
  paranoid: {
    enabled: true,
    mode: 'revert',
    banThreshold: 2,
    channelThreshold: 1,
    roleThreshold: 2,
    windowSeconds: 30,
    punishment: 'ban',
    protectWebhooks: true,
    automodSlm: true,
    slmThreshold: 0.6,
    lockdownOnRaid: true,
    snapshotOnChange: true,
    trustMode: true,
  },
  balanced: {
    enabled: true,
    mode: 'revert',
    banThreshold: 3,
    channelThreshold: 2,
    roleThreshold: 3,
    windowSeconds: 60,
    punishment: 'kick',
    protectWebhooks: true,
    automodSlm: true,
    slmThreshold: 0.75,
    lockdownOnRaid: false,
    snapshotOnChange: true,
    trustMode: true,
  },
  relaxed: {
    enabled: true,
    mode: 'notify',
    banThreshold: 5,
    channelThreshold: 4,
    roleThreshold: 5,
    windowSeconds: 120,
    punishment: 'none',
    protectWebhooks: true,
    automodSlm: true,
    slmThreshold: 0.85,
    lockdownOnRaid: false,
    snapshotOnChange: false,
    trustMode: false,
  },
};

export const data = new SlashCommandBuilder()
  .setName('zoro')
  .setDescription('Zoro control panel')
  .addSubcommand((s) => s.setName('status').setDescription('Show Zoro status'))
  .addSubcommand((s) =>
    s
      .setName('preset')
      .setDescription('Apply a preset configuration')
      .addStringOption((o) =>
        o
          .setName('name')
          .setDescription('Preset')
          .setRequired(true)
          .addChoices(
            { name: 'Paranoid', value: 'paranoid' },
            { name: 'Balanced', value: 'balanced' },
            { name: 'Relaxed', value: 'relaxed' },
          ),
      ),
  )
  .addSubcommand((s) => s.setName('enable').setDescription('Enable Zoro'))
  .addSubcommand((s) => s.setName('disable').setDescription('Disable Zoro'));

export async function execute(ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
  assertManager(ctx);

  const sub = ctx.interaction.options.getSubcommand();
  await ctx.defer(true);

  if (sub === 'status') {
    const c = await readConfig(ctx.services, ctx.guildId);
    const slm = ctx.services.env.hasAutomodSlm;
    await ctx.replyEmbed(
      ctx.services.embeds.brand('Zoro · status', undefined, {
        fields: [
          { name: 'Enabled', value: c.enabled ? 'Yes' : 'No', inline: true },
          { name: 'Mode', value: c.mode, inline: true },
          { name: 'Punishment', value: c.punishment, inline: true },
          { name: 'SLM engine', value: slm ? `on · ${ctx.services.env.automodSlmModel}` : 'off (no key)', inline: true },
          { name: 'Trust', value: c.trustMode ? 'on' : 'off', inline: true },
          { name: 'Lockdown on raid', value: c.lockdownOnRaid ? 'on' : 'off', inline: true },
          { name: 'Snapshot', value: c.snapshotOnChange ? 'on' : 'off', inline: true },
          { name: 'Mongo', value: ctx.services.env.hasMongo ? 'on' : 'off', inline: true },
        ],
      }),
    );
    return;
  }

  if (sub === 'preset') {
    const name = ctx.interaction.options.getString('name') as Preset | null;
    const preset = name ? PRESETS[name] : undefined;
    if (!preset) throw new UserError('Unknown preset.');
    const ok = await writeConfig(ctx.services, ctx.guildId, preset);
    if (!ok) throw new UserError('Could not save the preset.');
    await ctx.replyEmbed(
      ctx.services.embeds.success('Preset applied', `Applied the **${name}** configuration.`, {
        fields: [
          { name: 'Mode', value: preset.mode ?? '—', inline: true },
          { name: 'Punishment', value: preset.punishment ?? '—', inline: true },
        ],
      }),
    );
    return;
  }

  if (sub === 'enable') {
    const ok = await writeConfig(ctx.services, ctx.guildId, { enabled: true });
    await ctx.replyEmbed(
      ok
        ? ctx.services.embeds.success('Zoro enabled', 'Destructive actions are now monitored.')
        : ctx.services.embeds.error('Failed', 'Could not enable Zoro.'),
    );
    return;
  }

  const ok = await writeConfig(ctx.services, ctx.guildId, { enabled: false });
  await ctx.replyEmbed(
    ok
      ? ctx.services.embeds.warning('Zoro disabled', 'Destructive actions are no longer monitored.')
      : ctx.services.embeds.error('Failed', 'Could not disable Zoro.'),
  );
}
