# Paradise Engine Operator Notes

## PM2 Services

| Port | Name | Type |
|---:|---|---|
| 3000 | paradise-dashboard | Next.js dashboard |
| 3101 | paradise-shanks | Discord bot |
| 3102 | paradise-sanji | Discord bot |
| 3103 | paradise-zoro | Discord bot |
| 3104 | paradise-boahancock | Discord bot |
| 3105 | paradise-nami | Discord bot |
| 3106 | paradise-luffy | Discord bot |
| 3107 | paradise-niko-robin | Discord bot |
| 3108 | paradise-cyrene | Discord bot |

Credentials remain in the gitignored `temp cred.txt` and are loaded in memory by the existing launchers. PM2 never receives credential values from this file.

```powershell
pm2 start ecosystem.config.cjs   # First time
pm2 start all                     # After first time
pm2 stop all
pm2 restart all
pm2 status
pm2 logs
pm2 monit
pm2 save                         # Save the verified process list
pm2 resurrect                     # Restore the saved list
```

Use `npm run check:bots` after startup. A healthy local liveness response is HTTP 200; `status=degraded` means the process is alive but one or more backing services are unavailable or not ready.
