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

Each local service has `max_memory_restart: '500M'`. The requested `0.1 CPU core` target cannot be hard-enforced by PM2 on Windows; use a Windows Job Object, container, or VM if a strict CPU quota is required.

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
npm run test:local                # Start, probe localhost, and always clean up
```

`npm run test:local` refuses to start if one of its named services already exists, runs only against localhost, and deletes its nine test services in cleanup. Verify `pm2 status` is empty afterward.
