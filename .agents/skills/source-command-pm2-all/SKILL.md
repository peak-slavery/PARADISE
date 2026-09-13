---
name: "source-command-pm2-all"
description: "Migrated source command `pm2-all`"
---

# source-command-pm2-all

Use this skill when the user asks to run the migrated source command `pm2-all`.

## Command Template

Start the dashboard and all eight bots under PM2.

```powershell
Set-Location "D:\Github\paradise engine"
pm2 start ecosystem.config.cjs
```
