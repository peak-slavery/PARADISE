import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CommandModule } from './types.js';

/** Discord command names are lowercase alnum + `_` `-`. Enforce before building a path. */
const SAFE_NAME = /^[a-z0-9_-]{1,32}$/;

/**
 * Location of the universal commands (`/userinfo`, `/serverinfo`, `/about`,
 * `/help`) that every one of the 8 bots exposes.
 */
export const UNIVERSAL_COMMANDS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'universal');

function isModuleNotFound(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'ERR_MODULE_NOT_FOUND' || code === 'ENOENT' || code === 'MODULE_NOT_FOUND';
}

/**
 * Imports a single command module on demand.
 *
 * Bots boot with ZERO command handlers loaded — this is what keeps each Render
 * instance comfortably under the 512MB RAM cap. Handlers are imported the first
 * time the command fires and cached for the process lifetime.
 */
export class LazyCommandRunner {
  private readonly cache = new Map<string, CommandModule>();

  constructor(private readonly dirs: string[]) {}

  async load(name: string): Promise<CommandModule> {
    if (!SAFE_NAME.test(name)) throw new Error(`Unsafe command name: ${name}`);

    const cached = this.cache.get(name);
    if (cached) return cached;

    let mod: unknown;
    outer: for (const dir of this.dirs) {
      for (const ext of ['.ts', '.js']) {
        try {
          mod = await import(pathToFileURL(path.join(dir, `${name}${ext}`)).href);
          break outer;
        } catch (err) {
          if (!isModuleNotFound(err)) throw err;
        }
      }
    }

    if (!mod) throw new Error(`Command module not found: ${name}`);

    const candidate = mod as Partial<CommandModule> & { default?: Partial<CommandModule> };
    const command = (candidate.data && candidate.execute ? candidate : candidate.default) as
      | CommandModule
      | undefined;

    if (!command?.data || typeof command.execute !== 'function') {
      throw new Error(`Command module ${name} must export \`data\` and \`execute\``);
    }

    this.cache.set(name, command);
    return command;
  }

  async execute(name: string, ctx: Parameters<CommandModule['execute']>[0]): Promise<void> {
    const command = await this.load(name);
    await command.execute(ctx);
  }

  get loaded(): string[] {
    return [...this.cache.keys()];
  }
}

/**
 * Eagerly imports every command module. Only used by the offline
 * `deploy-commands` script, where RAM and boot time do not matter.
 */
export async function loadAllCommandModules(dir: string): Promise<CommandModule[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = entries
    .filter((e) => e.isFile() && /\.(ts|js)$/.test(e.name) && !e.name.endsWith('.d.ts'))
    .map((e) => e.name.replace(/\.(ts|js)$/, ''))
    .filter((n) => SAFE_NAME.test(n))
    .sort();

  const runner = new LazyCommandRunner([dir]);
  const modules: CommandModule[] = [];
  for (const name of files) {
    try {
      modules.push(await runner.load(name));
    } catch (err) {
      console.warn(`[commands] skipping ${name}: ${String(err)}`);
    }
  }
  return modules;
}
