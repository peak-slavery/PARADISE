import { SlashCommandBuilder, type APIEmbedField } from 'discord.js';
import type { CommandModule } from '../types.js';
import { escapeMentions, sanitizeText } from '../sanitize.js';

export const data = new SlashCommandBuilder()
  .setName('userinfo')
  .setDescription('Show information about a server member');

export async function execute(ctx: CommandContextLike): Promise<void> {
  const interaction = ctx.interaction;
  const user = interaction.options.getUser('user') ?? interaction.user;
  const member = interaction.options.getMember('user');

  const fields: APIEmbedField[] = [
    { name: 'User ID', value: `\`${user.id}\``, inline: true },
    { name: 'Account created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true },
  ];

  if (member && 'joinedTimestamp' in member && member.joinedTimestamp) {
    fields.push({ name: 'Joined', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true });
  }
  if (member && 'roles' in member && 'cache' in member.roles) {
    const roles = [...member.roles.cache.values()].filter((r) => r.name !== '@everyone');
    fields.push({
      name: `Roles (${roles.length})`,
      value: roles.length ? sanitizeText(roles.slice(0, 10).map((r) => r.name).join(', '), 200) : 'None',
      inline: false,
    });
  }
  if (user.bot) fields.push({ name: 'Bot', value: 'Yes', inline: true });

  await ctx.replyEmbed(
    ctx.services.embeds.build('info', escapeMentions(user.tag), undefined, {
      fields,
      thumbnail: user.displayAvatarURL({ size: 128 }),
    }),
  );
}

type CommandContextLike = Parameters<CommandModule['execute']>[0];
