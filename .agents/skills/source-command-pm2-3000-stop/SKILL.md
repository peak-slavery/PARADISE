---
name: "source-command-pm2-3000-stop"
description: "Migrated source command `pm2-3000-stop`"
---

# source-command-pm2-3000-stop

Use this skill when the user asks to run the migrated source command `pm2-3000-stop`.

## Command Template

Stop the dashboard PM2 service on port 3000.

```powershell
Set-Location "D:\Github\paradise engine"
pm2 stop paradise-dashboard
```
