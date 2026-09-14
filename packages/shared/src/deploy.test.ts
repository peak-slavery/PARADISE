import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandModule } from './types.js';

const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
interface DeployEnvStub {
  botId: string;
  discordToken: string;
  discordClientId: string;
  devGuildId?: string;
  mainGuildId?: string;
}
const envState = vi.hoisted(() => ({ env: undefined as unknown as DeployEnvStub }));
const moduleState = vi.hoisted(() => ({ modules: [] as CommandModule[] }));

vi.mock('discord.js', () => ({
  REST: class { setToken() { return this; } get = mocks.get; put = mocks.put; },
  Routes: { oauth2CurrentApplication: () => '/application', applicationCommands: () => '/global', applicationGuildCommands: () => '/guild' },
}));
vi.mock('./env.js', () => ({ loadDeployEnv: () => envState.env }));
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
    envState.env = { botId: 'shanks', discordToken: 'test-token', discordClientId: '123' };
    moduleState.modules = [devModule('help')];
  });

  it('guild scope installs only dev-access commands', async () => {
    moduleState.modules = [devModule('help'), devModule('authorize', 'dev')];
    mocks.get.mockResolvedValueOnce({ id: '123' }).mockResolvedValueOnce([{ name: 'authorize', type: 1 }]);
    expect(await registerCommands(['bot', 'universal'], '456')).toEqual({ botId: 'shanks', count: 1, scope: 'guild' });
    expect(mocks.put).toHaveBeenCalledWith('/guild', { body: [{ name: 'authorize' }] });
  });

  it('global scope installs public commands, dev scope the dev set, and clears main', async () => {
    envState.env = { ...envState.env, devGuildId: '999', mainGuildId: '888' };
    moduleState.modules = [devModule('help'), devModule('authorize', 'dev')];
    mocks.get
      .mockResolvedValueOnce({ id: '123' })
      .mockResolvedValueOnce([{ name: 'help', type: 1 }])
      .mockResolvedValueOnce([{ name: 'authorize', type: 1 }]);
    const result = await registerCommands(['bot', 'universal']);
    expect(result).toEqual({ botId: 'shanks', count: 2, scope: 'global', clearedGuilds: ['888'] });
    expect(mocks.put).toHaveBeenCalledWith('/global', { body: [{ name: 'help' }] });
    expect(mocks.put).toHaveBeenNthCalledWith(2, '/guild', { body: [{ name: 'authorize' }] });
    expect(mocks.put).toHaveBeenNthCalledWith(3, '/guild', { body: [] });
  });

  it('skips dev commands with a warning when no dev guild is configured', async () => {
    moduleState.modules = [devModule('authorize', 'dev')];
    mocks.get.mockResolvedValueOnce({ id: '123' }).mockResolvedValueOnce([]);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await registerCommands(['universal']);
    warn.mockRestore();
    expect(result.count).toBe(0);
    expect(mocks.put).toHaveBeenCalledTimes(1);
    expect(mocks.put).toHaveBeenCalledWith('/global', { body: [] });
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
