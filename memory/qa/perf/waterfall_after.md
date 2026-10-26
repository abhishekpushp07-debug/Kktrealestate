# Screen waterfall — http://localhost:8002 · 7 runs each · 2026-10-26 01:23

| Screen | Requests (first paint, bootstrap excl.) | Bytes | Σ p50 ms | Σ p95 ms | Slowest call | p95 ms | Status |
|---|---|---|---|---|---|---|---|
| Home | 1 | 27.7 KB | 60 | 61 | `/api/dashboard/home` | 61 | 200 |
| Projects list | 1 | 14.2 KB | 5 | 5 | `/api/projects?page_size=50` | 5 | 200 |
| Project workspace | 3 | 73.1 KB | 25 | 25 | `/api/projects/c683ce83-6b1d-4808-ad8e-f89791d45a9c` | 14 | 200,200,200 |
| Inventory grid | 2 | 53.7 KB | 14 | 14 | `/api/flats?block_id=96acf466-5975-4377-89bf-989a50e08e60&page_size=200` | 7 | 200,200 |
| Customers list | 1 | 55.9 KB | 12 | 13 | `/api/customers?page_size=50` | 13 | 200 |
| Customers search | 1 | 56.1 KB | 15 | 15 | `/api/customers?search=Sinha&page_size=50` | 15 | 200 |
| Customer 360 | 3 | 10.4 KB | 27 | 29 | `/api/customers/3dbbf479-8f13-4583-94ec-f2a4e3fa6a22/timeline?limit=20` | 16 | 200,200,200 |
| Bookings list | 1 | 130.5 KB | 17 | 17 | `/api/bookings?page_size=50` | 17 | 200 |
| Booking detail (3 ledgers) | 4 | 60.0 KB | 23 | 24 | `/api/bookings/00245431-d08d-4ef9-b92f-3c6a63ab5024` | 7 | 200,200,200,200 |
| Payments | 2 | 71.1 KB | 76 | 76 | `/api/payments?page_size=50` | 53 | 200,200 |
| Leads board | 2 | 189.9 KB | 27 | 27 | `/api/leads/board` | 20 | 200,200 |
| Site visits | 1 | 42.5 KB | 7 | 8 | `/api/site-visits?page_size=50` | 8 | 200 |
| Service | 1 | 65.0 KB | 13 | 13 | `/api/service-requests?page_size=50` | 13 | 200 |
| Reports | 2 | 1.3 KB | 7 | 7 | `/api/reports/collections?page_size=50` | 4 | 200,400 |
| Catalogues | 1 | 66.1 KB | 11 | 11 | `/api/catalogues` | 11 | 200 |
| Users | 2 | 7.1 KB | 10 | 10 | `/api/roles` | 5 | 200,200 |
| Settings | 2 | 1.3 KB | 8 | 8 | `/api/admin/integrity-report` | 4 | 200,200 |
| Global search | 1 | 0.0 KB | 9 | 10 | `/api/search?q=Sinha` | 10 | 200 |

<details><summary>Per-request detail</summary>

```json
{
 "Home": [
  {
   "url": "/api/dashboard/home",
   "status": [
    200
   ],
   "bytes": 28411,
   "p50": 59.86994599516038,
   "p95": 60.645222998573445,
   "server_timing": "db;dur=51.2;desc=\"11 ops\", app;dur=7.9"
  }
 ],
 "Projects list": [
  {
   "url": "/api/projects?page_size=50",
   "status": [
    200
   ],
   "bytes": 14538,
   "p50": 4.695727999205701,
   "p95": 5.176307007786818,
   "server_timing": "db;dur=1.4;desc=\"3 ops\", app;dur=2.4"
  }
 ],
 "Project workspace": [
  {
   "url": "/api/projects/c683ce83-6b1d-4808-ad8e-f89791d45a9c",
   "status": [
    200
   ],
   "bytes": 41779,
   "p50": 13.850884002749808,
   "p95": 14.051053993171081,
   "server_timing": "db;dur=8.0;desc=\"10 ops\", app;dur=4.9"
  },
  {
   "url": "/api/blocks?project_id=c683ce83-6b1d-4808-ad8e-f89791d45a9c&page_size=100",
   "status": [
    200
   ],
   "bytes": 28592,
   "p50": 6.197800990776159,
   "p95": 6.338392995530739,
   "server_timing": "db;dur=2.1;desc=\"5 ops\", app;dur=3.4"
  },
  {
   "url": "/api/projects/c683ce83-6b1d-4808-ad8e-f89791d45a9c/summary",
   "status": [
    200
   ],
   "bytes": 4495,
   "p50": 4.829420009627938,
   "p95": 5.047692990046926,
   "server_timing": "db;dur=0.8;desc=\"2 ops\", app;dur=2.8"
  }
 ],
 "Inventory grid": [
  {
   "url": "/api/blocks/96acf466-5975-4377-89bf-989a50e08e60",
   "status": [
    200
   ],
   "bytes": 4053,
   "p50": 6.350885989377275,
   "p95": 6.484161000116728,
   "server_timing": "db;dur=2.1;desc=\"7 ops\", app;dur=3.6"
  },
  {
   "url": "/api/flats?block_id=96acf466-5975-4377-89bf-989a50e08e60&page_size=200",
   "status": [
    200
   ],
   "bytes": 50886,
   "p50": 7.360725008766167,
   "p95": 7.497578000766225,
   "server_timing": "db;dur=2.3;desc=\"5 ops\", app;dur=3.9"
  }
 ],
 "Customers list": [
  {
   "url": "/api/customers?page_size=50",
   "status": [
    200
   ],
   "bytes": 57218,
   "p50": 12.308040997595526,
   "p95": 12.560215996927582,
   "server_timing": "db;dur=7.1;desc=\"6 ops\", app;dur=4.1"
  }
 ],
 "Customers search": [
  {
   "url": "/api/customers?search=Sinha&page_size=50",
   "status": [
    200
   ],
   "bytes": 57435,
   "p50": 14.595542001188733,
   "p95": 14.94810899021104,
   "server_timing": "db;dur=13.4;desc=\"6 ops\", app;dur=0.1"
  }
 ],
 "Customer 360": [
  {
   "url": "/api/customers/3dbbf479-8f13-4583-94ec-f2a4e3fa6a22",
   "status": [
    200
   ],
   "bytes": 2626,
   "p50": 7.856748998165131,
   "p95": 8.28284899762366,
   "server_timing": "db;dur=4.3;desc=\"7 ops\", app;dur=3.6"
  },
  {
   "url": "/api/customers/3dbbf479-8f13-4583-94ec-f2a4e3fa6a22/timeline?limit=20",
   "status": [
    200
   ],
   "bytes": 5117,
   "p50": 14.879665992339142,
   "p95": 15.59777298825793,
   "server_timing": "db;dur=7.9;desc=\"15 ops\", app;dur=6.1"
  },
  {
   "url": "/api/bookings?customer_id=3dbbf479-8f13-4583-94ec-f2a4e3fa6a22&page_size=20",
   "status": [
    200
   ],
   "bytes": 2897,
   "p50": 4.618313003447838,
   "p95": 4.795512999407947,
   "server_timing": "db;dur=1.3;desc=\"3 ops\", app;dur=2.3"
  }
 ],
 "Bookings list": [
  {
   "url": "/api/bookings?page_size=50",
   "status": [
    200
   ],
   "bytes": 133675,
   "p50": 17.192286002682522,
   "p95": 17.29584600252565,
   "server_timing": "db;dur=7.3;desc=\"3 ops\", app;dur=8.7"
  }
 ],
 "Booking detail (3 ledgers)": [
  {
   "url": "/api/bookings/00245431-d08d-4ef9-b92f-3c6a63ab5024",
   "status": [
    200
   ],
   "bytes": 25117,
   "p50": 6.980758000281639,
   "p95": 7.0942960010143,
   "server_timing": "db;dur=7.0;desc=\"8 ops\", app;dur=0.0"
  },
  {
   "url": "/api/bookings/00245431-d08d-4ef9-b92f-3c6a63ab5024/ledger?book=cash",
   "status": [
    200
   ],
   "bytes": 12107,
   "p50": 5.404345996794291,
   "p95": 5.4978629923425615,
   "server_timing": "db;dur=1.2;desc=\"3 ops\", app;dur=3.4"
  },
  {
   "url": "/api/bookings/00245431-d08d-4ef9-b92f-3c6a63ab5024/ledger?book=account",
   "status": [
    200
   ],
   "bytes": 12107,
   "p50": 5.0917960033984855,
   "p95": 5.3067760018166155,
   "server_timing": "db;dur=1.1;desc=\"3 ops\", app;dur=3.3"
  },
  {
   "url": "/api/bookings/00245431-d08d-4ef9-b92f-3c6a63ab5024/ledger?book=other",
   "status": [
    200
   ],
   "bytes": 12107,
   "p50": 5.447988005471416,
   "p95": 5.700271998648532,
   "server_timing": "db;dur=1.3;desc=\"3 ops\", app;dur=3.3"
  }
 ],
 "Payments": [
  {
   "url": "/api/payments?page_size=50",
   "status": [
    200
   ],
   "bytes": 72491,
   "p50": 52.08932400273625,
   "p95": 52.61414099368267,
   "server_timing": "db;dur=70.4;desc=\"4 ops\", app;dur=0.0"
  },
  {
   "url": "/api/payments/summary",
   "status": [
    200
   ],
   "bytes": 286,
   "p50": 23.44417899439577,
   "p95": 23.731844004942104,
   "server_timing": "db;dur=19.6;desc=\"2 ops\", app;dur=2.8"
  }
 ],
 "Leads board": [
  {
   "url": "/api/leads/board",
   "status": [
    200
   ],
   "bytes": 152716,
   "p50": 19.496923006954603,
   "p95": 19.78750700072851,
   "server_timing": "db;dur=4.2;desc=\"3 ops\", app;dur=13.9"
  },
  {
   "url": "/api/leads?page_size=50",
   "status": [
    200
   ],
   "bytes": 41745,
   "p50": 7.0969919906929135,
   "p95": 7.221114996355027,
   "server_timing": "db;dur=2.5;desc=\"3 ops\", app;dur=3.6"
  }
 ],
 "Site visits": [
  {
   "url": "/api/site-visits?page_size=50",
   "status": [
    200
   ],
   "bytes": 43541,
   "p50": 7.4685860017780215,
   "p95": 7.6629660034086555,
   "server_timing": "db;dur=2.2;desc=\"4 ops\", app;dur=4.5"
  }
 ],
 "Service": [
  {
   "url": "/api/service-requests?page_size=50",
   "status": [
    200
   ],
   "bytes": 66532,
   "p50": 12.866006989497691,
   "p95": 13.08811700437218,
   "server_timing": "db;dur=3.7;desc=\"4 ops\", app;dur=8.1"
  }
 ],
 "Reports": [
  {
   "url": "/api/reports",
   "status": [
    200
   ],
   "bytes": 957,
   "p50": 3.247733009629883,
   "p95": 3.3254779991693795,
   "server_timing": "db;dur=0.4;desc=\"1 ops\", app;dur=1.6"
  },
  {
   "url": "/api/reports/collections?page_size=50",
   "status": [
    400
   ],
   "bytes": 405,
   "p50": 3.371633996721357,
   "p95": 3.734572004759684,
   "server_timing": "db;dur=0.3;desc=\"1 ops\", app;dur=2.0"
  }
 ],
 "Catalogues": [
  {
   "url": "/api/catalogues",
   "status": [
    200
   ],
   "bytes": 67695,
   "p50": 11.025857005733997,
   "p95": 11.41436600300949,
   "server_timing": "db;dur=3.5;desc=\"3 ops\", app;dur=6.2"
  }
 ],
 "Users": [
  {
   "url": "/api/users?page_size=50",
   "status": [
    200
   ],
   "bytes": 3256,
   "p50": 4.618790000677109,
   "p95": 4.805400007171556,
   "server_timing": "db;dur=1.6;desc=\"4 ops\", app;dur=2.1"
  },
  {
   "url": "/api/roles",
   "status": [
    200
   ],
   "bytes": 3984,
   "p50": 5.2956270083086565,
   "p95": 5.425707000540569,
   "server_timing": "db;dur=1.8;desc=\"4 ops\", app;dur=2.5"
  }
 ],
 "Settings": [
  {
   "url": "/api/settings/company",
   "status": [
    200
   ],
   "bytes": 1210,
   "p50": 3.584865989978425,
   "p95": 3.706485003931448,
   "server_timing": "db;dur=0.7;desc=\"2 ops\", app;dur=2.0"
  },
  {
   "url": "/api/admin/integrity-report",
   "status": [
    200
   ],
   "bytes": 140,
   "p50": 4.120081997825764,
   "p95": 4.190296996966936,
   "server_timing": "db;dur=0.8;desc=\"2 ops\", app;dur=2.4"
  }
 ],
 "Global search": [
  {
   "url": "/api/search?q=Sinha",
   "status": [
    200
   ],
   "bytes": 43,
   "p50": 9.416186003363691,
   "p95": 9.7053650097223,
   "server_timing": "db;dur=14.8;desc=\"8 ops\", app;dur=0.0"
  }
 ]
}
```
</details>
