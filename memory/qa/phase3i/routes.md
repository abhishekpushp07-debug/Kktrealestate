# 3I route change (warm, in-app navigation, 1440 px)

| Route | median ms | max ms |
|---|---|---|
| `/` | 47 | 76 |
| `/bookings` | 39 | 60 |
| `/payments` | 67 | 92 |
| `/customers` | 44 | 91 |
| `/leads` | 15 | 19 |
| `/inventory` | 19 | 21 |
| `/reports/v3` | 56 | 71 |
| `/reports/v3/collections` | 54 | 101 |
| `/reports/v3/customer-status` | 37 | 68 |
| `/admin/system-health` | 27 | 54 |

All: median 38 ms, max 101 ms (network idle = every API call answered).
