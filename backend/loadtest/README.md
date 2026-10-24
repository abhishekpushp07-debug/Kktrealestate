# KKT load test

```bash
cd /app/backend
locust -f loadtest/locustfile.py --headless -u 200 -r 50 -t 60s -H http://localhost:8001 --csv loadtest/out
```

Logs in once (admin@kkt.in) then mixes `/auth/me`, projects list, block grid, flats list, master lists, dashboard and search.
Results (p50/p95) are recorded in `/app/memory/PRD.md`.
