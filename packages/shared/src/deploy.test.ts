import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock('discord.js', () => ({
  REST: class { setToken() { return this; } get = mocks.get; put = mocks.put; },
  Routes: { oauth2CurrentApplication: () => '/application', applicationCommands: () => '/global', applicationGuildCommands: () => '/guild' },
}));
vi.mock('./env.js', () => ({ loadEnv: () => ({ botId: 'shanks', discordToken: 'test-token', discordClientId: '123' }) }));
vi.mock('./commands.js', () => ({ loadAllCommandModules: async () => [{ data: { toJSON: () => ({ name: 'help' }) } }] }));
import { registerCommands } from './deploy.js';

describe('registration verification', () => {
  beforeEach(() => vi.resetAllMocks());
  it('deduplicates commands and verifies the guild registration', async () => {
    mocks.get.mockResolvedValueOnce({ id: '123' }).mockResolvedValueOnce([{ name: 'help', type: 1 }]);
    expect(await registerCommands(['bot', 'universal'], '456')).toEqual({ botId: 'shanks', count: 1, scope: 'guild' });
    expect(mocks.put).toHaveBeenCalledWith('/guild', { body: [{ name: 'help' }] });
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
