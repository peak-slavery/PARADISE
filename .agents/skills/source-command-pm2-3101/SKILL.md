---
name: "source-command-pm2-3101"
description: "Migrated source command `pm2-3101`"
---

# source-command-pm2-3101

Use this skill when the user asks to run the migrated source command `pm2-3101`.

## Command Template

Start Shanks on port 3101 and follow its logs.

```powershell
Set-Location "D:\Github\paradise engine"
pm2 start ecosystem.config.cjs --only paradise-shanks
pm2 logs paradise-shanks
```
