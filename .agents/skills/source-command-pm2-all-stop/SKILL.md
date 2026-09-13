---
name: "source-command-pm2-all-stop"
description: "Migrated source command `pm2-all-stop`"
---

# source-command-pm2-all-stop

Use this skill when the user asks to run the migrated source command `pm2-all-stop`.

## Command Template

Stop all Paradise Engine PM2 services.

```powershell
Set-Location "D:\Github\paradise engine"
pm2 stop all
```
