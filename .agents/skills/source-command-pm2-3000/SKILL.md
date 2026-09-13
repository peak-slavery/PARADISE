---
name: "source-command-pm2-3000"
description: "Migrated source command `pm2-3000`"
---

# source-command-pm2-3000

Use this skill when the user asks to run the migrated source command `pm2-3000`.

## Command Template

Start the dashboard on port 3000 and follow its logs.

```powershell
Set-Location "D:\Github\paradise engine"
pm2 start ecosystem.config.cjs --only paradise-dashboard
pm2 logs paradise-dashboard
```
