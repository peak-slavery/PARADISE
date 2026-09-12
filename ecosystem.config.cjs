const root = __dirname;
const node = process.execPath;
const bots = [
  ['shanks', 3101],
  ['sanji', 3102],
  ['zoro', 3103],
  ['boahancock', 3104],
  ['nami', 3105],
  ['luffy', 3106],
  ['niko-robin', 3107],
  ['cyrene', 3108],
];

module.exports = {
  apps: [
    {
      name: 'paradise-dashboard',
      cwd: root,
      script: 'scripts/run-dashboard.mjs',
      interpreter: node,
      env: { NODE_ENV: 'development', LOCAL_ONLY: 'true' },
      autorestart: true,
      restart_delay: 3000,
      max_memory_restart: '500M',
    },
    ...bots.map(([id, port]) => ({
      name: `paradise-${id}`,
      cwd: root,
      script: 'scripts/run-bot.mjs',
      args: id,
      interpreter: node,
      env: { NODE_ENV: 'development', LOCAL_ONLY: 'true', PORT: String(port) },
      autorestart: true,
      restart_delay: 3000,
      max_memory_restart: '500M',
    })),
  ],
};
