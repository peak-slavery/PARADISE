---
name: "source-command-pm2-all-restart"
description: "Migrated source command `pm2-all-restart`"
---

# source-command-pm2-all-restart

Use this skill when the user asks to run the migrated source command `pm2-all-restart`.

## Command Template

Restart the dashboard and all eight bots under PM2.

```powershell
Set-Location "D:\Github\paradise engine"
pm2 restart all
```
