# Screen waterfall — http://localhost:8002 · 7 runs each · 2026-10-26 00:40

| Screen | Requests (first paint, bootstrap excl.) | Bytes | Σ p50 ms | Σ p95 ms | Slowest call | p95 ms | Status |
|---|---|---|---|---|---|---|---|
| Home | 1 | 27.9 KB | 66 | 67 | `/api/dashboard/home` | 67 | 200 |
| Projects list | 1 | 13.9 KB | 6 | 6 | `/api/projects?page_size=50` | 6 | 200 |
| Project workspace | 3 | 73.1 KB | 27 | 28 | `/api/projects/c683ce83-6b1d-4808-ad8e-f89791d45a9c` | 16 | 200,200,200 |
| Inventory grid | 2 | 53.7 KB | 15 | 16 | `/api/flats?block_id=96acf466-5975-4377-89bf-989a50e08e60&page_size=200` | 9 | 200,200 |
| Customers list | 1 | 55.9 KB | 14 | 15 | `/api/customers?page_size=50` | 15 | 200 |
| Customers search | 1 | 56.1 KB | 21 | 64 | `/api/customers?search=Sinha&page_size=50` | 64 | 200 |
| Customer 360 | 3 | 10.4 KB | 28 | 36 | `/api/customers/3dbbf479-8f13-4583-94ec-f2a4e3fa6a22/timeline?limit=20` | 22 | 200,200,200 |
| Bookings list | 1 | 130.5 KB | 26 | 26 | `/api/bookings?page_size=50` | 26 | 200 |
| Booking detail (3 ledgers) | 4 | 60.0 KB | 26 | 28 | `/api/bookings/00245431-d08d-4ef9-b92f-3c6a63ab5024` | 10 | 200,200,200,200 |
| Payments | 2 | 71.1 KB | 194 | 197 | `/api/payments?page_size=50` | 137 | 200,200 |
| Leads board | 2 | 281.4 KB | 42 | 47 | `/api/leads/board` | 34 | 200,200 |
| Site visits | 1 | 42.5 KB | 9 | 9 | `/api/site-visits?page_size=50` | 9 | 200 |
| Service | 1 | 65.0 KB | 14 | 15 | `/api/service-requests?page_size=50` | 15 | 200 |
| Reports | 2 | 1.3 KB | 7 | 7 | `/api/reports/collections?page_size=50` | 4 | 200,400 |
| Catalogues | 1 | 66.1 KB | 12 | 12 | `/api/catalogues` | 12 | 200 |
| Users | 2 | 6.9 KB | 11 | 11 | `/api/users?page_size=50` | 6 | 200,200 |
| Settings | 2 | 1.3 KB | 3307 | 3442 | `/api/admin/integrity-report` | 3438 | 200,200 |
| Global search | 1 | 0.0 KB | 10 | 28 | `/api/search?q=Sinha` | 28 | 200 |

<details><summary>Per-request detail</summary>

```json
{
 "Home": [
  {
   "url": "/api/dashboard/home",
   "status": [
    200
   ],
   "bytes": 28571,
   "p50": 66.14444100705441,
   "p95": 67.04485800582916,
   "server_timing": "db;dur=56.4;desc=\"11 ops\", app;dur=9.3"
  }
 ],
 "Projects list": [
  {
   "url": "/api/projects?page_size=50",
   "status": [
    200
   ],
   "bytes": 14190,
   "p50": 6.1370010080281645,
   "p95": 6.172218010760844,
   "server_timing": "db;dur=1.8;desc=\"3 ops\", app;dur=3.3"
  }
 ],
 "Project workspace": [
  {
   "url": "/api/projects/c683ce83-6b1d-4808-ad8e-f89791d45a9c",
   "status": [
    200
   ],
   "bytes": 41779,
   "p50": 15.491084006498568,
   "p95": 15.638975004549138,
   "server_timing": "db;dur=8.5;desc=\"10 ops\", app;dur=6.2"
  },
  {
   "url": "/api/blocks?project_id=c683ce83-6b1d-4808-ad8e-f89791d45a9c&page_size=100",
   "status": [
    200
   ],
   "bytes": 28592,
   "p50": 7.23331599147059,
   "p95": 7.478273997548968,
   "server_timing": "db;dur=2.0;desc=\"5 ops\", app;dur=4.1"
  },
  {
   "url": "/api/projects/c683ce83-6b1d-4808-ad8e-f89791d45a9c/summary",
   "status": [
    200
   ],
   "bytes": 4495,
   "p50": 4.694818999269046,
   "p95": 5.023418998462148,
   "server_timing": "db;dur=0.6;desc=\"2 ops\", app;dur=3.5"
  }
 ],
 "Inventory grid": [
  {
   "url": "/api/blocks/96acf466-5975-4377-89bf-989a50e08e60",
   "status": [
    200
   ],
   "bytes": 4053,
   "p50": 6.067301001166925,
   "p95": 6.324627000140026,
   "server_timing": "db;dur=2.2;desc=\"7 ops\", app;dur=3.2"
  },
  {
   "url": "/api/flats?block_id=96acf466-5975-4377-89bf-989a50e08e60&page_size=200",
   "status": [
    200
   ],
   "bytes": 50886,
   "p50": 8.962642008555122,
   "p95": 9.282201004680246,
   "server_timing": "db;dur=2.9;desc=\"5 ops\", app;dur=5.4"
  }
 ],
 "Customers list": [
  {
   "url": "/api/customers?page_size=50",
   "status": [
    200
   ],
   "bytes": 57218,
   "p50": 14.299996997579001,
   "p95": 14.880089001962915,
   "server_timing": "db;dur=7.4;desc=\"6 ops\", app;dur=6.1"
  }
 ],
 "Customers search": [
  {
   "url": "/api/customers?search=Sinha&page_size=50",
   "status": [
    200
   ],
   "bytes": 57435,
   "p50": 21.14880499721039,
   "p95": 64.03258800855838,
   "server_timing": "db;dur=13.2;desc=\"6 ops\", app;dur=6.0"
  }
 ],
 "Customer 360": [
  {
   "url": "/api/customers/3dbbf479-8f13-4583-94ec-f2a4e3fa6a22",
   "status": [
    200
   ],
   "bytes": 2626,
   "p50": 8.579895991715603,
   "p95": 8.917162005673163,
   "server_timing": "db;dur=4.0;desc=\"7 ops\", app;dur=3.9"
  },
  {
   "url": "/api/customers/3dbbf479-8f13-4583-94ec-f2a4e3fa6a22/timeline?limit=20",
   "status": [
    200
   ],
   "bytes": 5117,
   "p50": 13.922504003858194,
   "p95": 21.71662700129673,
   "server_timing": "db;dur=7.7;desc=\"14 ops\", app;dur=5.3"
  },
  {
   "url": "/api/bookings?customer_id=3dbbf479-8f13-4583-94ec-f2a4e3fa6a22&page_size=20",
   "status": [
    200
   ],
   "bytes": 2897,
   "p50": 5.0416699959896505,
   "p95": 5.758378989412449,
   "server_timing": "db;dur=1.3;desc=\"3 ops\", app;dur=2.7"
  }
 ],
 "Bookings list": [
  {
   "url": "/api/bookings?page_size=50",
   "status": [
    200
   ],
   "bytes": 133675,
   "p50": 25.84229900094215,
   "p95": 26.171493998845108,
   "server_timing": "db;dur=7.0;desc=\"3 ops\", app;dur=10.4"
  }
 ],
 "Booking detail (3 ledgers)": [
  {
   "url": "/api/bookings/00245431-d08d-4ef9-b92f-3c6a63ab5024",
   "status": [
    200
   ],
   "bytes": 25117,
   "p50": 8.476178991259076,
   "p95": 9.571917995344847,
   "server_timing": "db;dur=7.5;desc=\"8 ops\", app;dur=0.0"
  },
  {
   "url": "/api/bookings/00245431-d08d-4ef9-b92f-3c6a63ab5024/ledger?book=cash",
   "status": [
    200
   ],
   "bytes": 12107,
   "p50": 5.9666890010703355,
   "p95": 6.114224990596995,
   "server_timing": "db;dur=1.3;desc=\"3 ops\", app;dur=3.4"
  },
  {
   "url": "/api/bookings/00245431-d08d-4ef9-b92f-3c6a63ab5024/ledger?book=account",
   "status": [
    200
   ],
   "bytes": 12107,
   "p50": 5.667020988767035,
   "p95": 5.848212997079827,
   "server_timing": "db;dur=1.5;desc=\"3 ops\", app;dur=3.4"
  },
  {
   "url": "/api/bookings/00245431-d08d-4ef9-b92f-3c6a63ab5024/ledger?book=other",
   "status": [
    200
   ],
   "bytes": 12107,
   "p50": 5.709946999559179,
   "p95": 6.016682003973983,
   "server_timing": "db;dur=1.2;desc=\"3 ops\", app;dur=3.4"
  }
 ],
 "Payments": [
  {
   "url": "/api/payments?page_size=50",
   "status": [
    200
   ],
   "bytes": 72491,
   "p50": 135.5795989948092,
   "p95": 136.81788599933498,
   "server_timing": "db;dur=127.0;desc=\"4 ops\", app;dur=7.2"
  },
  {
   "url": "/api/payments/summary",
   "status": [
    200
   ],
   "bytes": 286,
   "p50": 57.989200999145396,
   "p95": 60.129457997391,
   "server_timing": "db;dur=56.1;desc=\"2 ops\", app;dur=2.9"
  }
 ],
 "Leads board": [
  {
   "url": "/api/leads/board",
   "status": [
    200
   ],
   "bytes": 246450,
   "p50": 29.896018997533247,
   "p95": 34.27073601051234,
   "server_timing": "db;dur=6.3;desc=\"3 ops\", app;dur=22.1"
  },
  {
   "url": "/api/leads?page_size=50",
   "status": [
    200
   ],
   "bytes": 41754,
   "p50": 11.920092001673765,
   "p95": 12.42679700953886,
   "server_timing": "db;dur=2.3;desc=\"3 ops\", app;dur=4.8"
  }
 ],
 "Site visits": [
  {
   "url": "/api/site-visits?page_size=50",
   "status": [
    200
   ],
   "bytes": 43516,
   "p50": 8.53426598769147,
   "p95": 8.747578991460614,
   "server_timing": "db;dur=2.2;desc=\"4 ops\", app;dur=5.2"
  }
 ],
 "Service": [
  {
   "url": "/api/service-requests?page_size=50",
   "status": [
    200
   ],
   "bytes": 66532,
   "p50": 14.05860300292261,
   "p95": 14.826630998868495,
   "server_timing": "db;dur=4.6;desc=\"4 ops\", app;dur=10.0"
  }
 ],
 "Reports": [
  {
   "url": "/api/reports",
   "status": [
    200
   ],
   "bytes": 957,
   "p50": 3.1062719936016947,
   "p95": 3.266729007009417,
   "server_timing": "db;dur=0.6;desc=\"1 ops\", app;dur=1.6"
  },
  {
   "url": "/api/reports/collections?page_size=50",
   "status": [
    400
   ],
   "bytes": 405,
   "p50": 3.460534004261717,
   "p95": 3.6900010018143803,
   "server_timing": "db;dur=0.4;desc=\"1 ops\", app;dur=2.0"
  }
 ],
 "Catalogues": [
  {
   "url": "/api/catalogues",
   "status": [
    200
   ],
   "bytes": 67695,
   "p50": 11.72897100332193,
   "p95": 12.200980010675266,
   "server_timing": "db;dur=3.2;desc=\"3 ops\", app;dur=6.7"
  }
 ],
 "Users": [
  {
   "url": "/api/users?page_size=50",
   "status": [
    200
   ],
   "bytes": 3052,
   "p50": 5.274711002130061,
   "p95": 5.743564004660584,
   "server_timing": "db;dur=1.4;desc=\"4 ops\", app;dur=3.1"
  },
  {
   "url": "/api/roles",
   "status": [
    200
   ],
   "bytes": 3984,
   "p50": 5.43685800221283,
   "p95": 5.501979991095141,
   "server_timing": "db;dur=1.5;desc=\"4 ops\", app;dur=3.1"
  }
 ],
 "Settings": [
  {
   "url": "/api/settings/company",
   "status": [
    200
   ],
   "bytes": 1210,
   "p50": 3.483950989902951,
   "p95": 3.706527000758797,
   "server_timing": "db;dur=0.5;desc=\"2 ops\", app;dur=1.7"
  },
  {
   "url": "/api/admin/integrity-report",
   "status": [
    200
   ],
   "bytes": 126,
   "p50": 3303.662706995965,
   "p95": 3438.0991159996483,
   "server_timing": "db;dur=1753.9;desc=\"6018 ops\", app;dur=1271.9"
  }
 ],
 "Global search": [
  {
   "url": "/api/search?q=Sinha",
   "status": [
    200
   ],
   "bytes": 43,
   "p50": 9.513445998891257,
   "p95": 28.23014199384488,
   "server_timing": "db;dur=14.4;desc=\"8 ops\", app;dur=0.0"
  }
 ]
}
```
</details>
