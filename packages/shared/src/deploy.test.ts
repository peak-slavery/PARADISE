import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandModule } from './types.js';
import { APPROVED_DEVELOPMENT_GUILD_ID, APPROVED_PRODUCTION_GUILD_ID } from './guild-policy.js';

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
interface DeployEnvStub {
  botId: string;
  discordToken: string;
  discordClientId: string;
  runtimeEnvironment: 'production' | 'development';
  devGuildId?: string;
  mainGuildId?: string;
}
const envState = vi.hoisted(() => ({ env: undefined as unknown as DeployEnvStub }));
const moduleState = vi.hoisted(() => ({ modules: [] as CommandModule[] }));

vi.mock('discord.js', () => ({
  REST: class { setToken() { return this; } get = mocks.get; put = mocks.put; },
  Routes: { oauth2CurrentApplication: () => '/application', applicationCommands: () => '/global', applicationGuildCommands: () => '/guild' },
}));
vi.mock('./env.js', () => ({
  loadDeployEnv: () => envState.env,
  validateCanonicalDeployConfig: () => undefined,
}));
vi.mock('./commands.js', () => ({ loadAllCommandModules: async () => moduleState.modules }));

import { registerCommands } from './deploy.js';

const devModule = (name: string, access?: 'public' | 'dev'): CommandModule => ({
  data: { name, toJSON: () => ({ name }) },
  access,
  async execute() {}
});

describe('registration verification', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    envState.env = {
      botId: 'shanks',
      discordToken: 'test-token',
      discordClientId: '123',
      runtimeEnvironment: 'production',
      devGuildId: APPROVED_DEVELOPMENT_GUILD_ID,
      mainGuildId: APPROVED_PRODUCTION_GUILD_ID,
    };
    moduleState.modules = [devModule('help')];
  });

  it('guild scope installs only dev-access commands in the canonical development guild', async () => {
    envState.env = {
      ...envState.env,
      runtimeEnvironment: 'development',
    };
    moduleState.modules = [devModule('help'), devModule('authorize', 'dev')];
    mocks.get.mockResolvedValueOnce({ id: '123' }).mockResolvedValueOnce([{ name: 'authorize', type: 1 }]);
    expect(await registerCommands(['bot', 'universal'], APPROVED_DEVELOPMENT_GUILD_ID)).toEqual({
      botId: 'shanks', count: 1, scope: 'guild',
    });
    expect(mocks.put).toHaveBeenCalledWith('/guild', { body: [{ name: 'authorize' }] });
  });

  it('rejects an arbitrary explicit guild scope', async () => {
    await expect(registerCommands(['bot', 'universal'], '456')).rejects.toThrow('canonical development guild');
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('global scope installs public commands and clears the canonical main guild', async () => {
    moduleState.modules = [devModule('help'), devModule('authorize', 'dev')];
    mocks.get
      .mockResolvedValueOnce({ id: '123' })
      .mockResolvedValueOnce([{ name: 'help', type: 1 }]);
    const result = await registerCommands(['bot', 'universal']);
    expect(result).toEqual({ botId: 'shanks', count: 1, scope: 'global', clearedGuilds: [APPROVED_PRODUCTION_GUILD_ID] });
    expect(mocks.put).toHaveBeenCalledWith('/global', { body: [{ name: 'help' }] });
    expect(mocks.put).toHaveBeenNthCalledWith(2, '/guild', { body: [] });
  });

  it('registers dev commands only in the canonical development environment', async () => {
    envState.env = {
      ...envState.env,
      runtimeEnvironment: 'development',
    };
    moduleState.modules = [devModule('help'), devModule('authorize', 'dev')];
    mocks.get
      .mockResolvedValueOnce({ id: '123' })
      .mockResolvedValueOnce([{ name: 'help', type: 1 }])
      .mockResolvedValueOnce([{ name: 'authorize', type: 1 }]);
    const result = await registerCommands(['bot', 'universal']);
    expect(result).toEqual({ botId: 'shanks', count: 2, scope: 'global', clearedGuilds: [APPROVED_PRODUCTION_GUILD_ID] });
    expect(mocks.put).toHaveBeenCalledWith('/global', { body: [{ name: 'help' }] });
    expect(mocks.put).toHaveBeenNthCalledWith(2, '/guild', { body: [{ name: 'authorize' }] });
  });

  it('does not register when the token belongs to another application', async () => {
    mocks.get.mockResolvedValueOnce({ id: 'different' });
    await expect(registerCommands(['bot'])).rejects.toThrow('does not match');
    expect(mocks.put).not.toHaveBeenCalled();
  });

  it('fails when Discord readback is missing a command', async () => {
    mocks.get.mockResolvedValueOnce({ id: '123' }).mockResolvedValueOnce([]);
    await expect(registerCommands(['bot'])).rejects.toThrow('verification failed');
  });
});
