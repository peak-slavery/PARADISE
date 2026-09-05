import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAllCommandModules } from './commands.js';

describe('command deployment loading', () => {
  it('fails when a command file has a missing transitive dependency', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'eiflow-commands-'));
    try {
      await writeFile(path.join(dir, 'broken.js'), "import 'missing-command-dependency';\nexport const data = {}; export const execute = async () => {};\n");
      await expect(loadAllCommandModules(dir)).rejects.toThrow('Unable to load command module broken');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
