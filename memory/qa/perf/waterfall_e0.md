# Screen waterfall — http://localhost:8002 · 7 runs each · 2026-10-26 01:56

| Screen | Requests (first paint, bootstrap excl.) | Bytes | Σ p50 ms | Σ p95 ms | Slowest call | p95 ms | Status |
|---|---|---|---|---|---|---|---|
| Home | 1 | 27.8 KB | 5 | 5 | `/api/dashboard/home` | 5 | 200 |
| Projects list | 1 | 14.2 KB | 3 | 4 | `/api/projects?page_size=50` | 4 | 200 |
| Project workspace | 3 | 73.1 KB | 24 | 24 | `/api/projects/c683ce83-6b1d-4808-ad8e-f89791d45a9c` | 14 | 200,200,200 |
| Inventory grid | 2 | 53.7 KB | 11 | 12 | `/api/flats?block_id=96acf466-5975-4377-89bf-989a50e08e60&page_size=200` | 6 | 200,200 |
| Customers list | 1 | 55.9 KB | 8 | 8 | `/api/customers?page_size=50` | 8 | 200 |
| Customers search | 1 | 56.1 KB | 15 | 15 | `/api/customers?search=Sinha&page_size=50` | 15 | 200 |
| Customer 360 | 3 | 10.4 KB | 25 | 26 | `/api/customers/3dbbf479-8f13-4583-94ec-f2a4e3fa6a22/timeline?limit=20` | 14 | 200,200,200 |
| Bookings list | 1 | 130.5 KB | 11 | 11 | `/api/bookings?page_size=50` | 11 | 200 |
| Booking detail (3 ledgers) | 4 | 60.0 KB | 24 | 26 | `/api/bookings/00245431-d08d-4ef9-b92f-3c6a63ab5024` | 8 | 200,200,200,200 |
| Payments | 2 | 71.1 KB | 50 | 51 | `/api/payments?page_size=50` | 28 | 200,200 |
| Leads board | 2 | 122.4 KB | 18 | 22 | `/api/leads/board` | 18 | 200,200 |
| Site visits | 1 | 42.5 KB | 5 | 6 | `/api/site-visits?page_size=50` | 6 | 200 |
| Service | 1 | 65.0 KB | 9 | 10 | `/api/service-requests?page_size=50` | 10 | 200 |
| Reports | 2 | 1.3 KB | 6 | 6 | `/api/reports/collections?page_size=50` | 3 | 200,400 |
| Catalogues | 1 | 66.1 KB | 8 | 8 | `/api/catalogues` | 8 | 200 |
| Users | 2 | 7.1 KB | 8 | 8 | `/api/roles` | 4 | 200,200 |
| Settings | 2 | 1.3 KB | 8 | 8 | `/api/settings/company` | 4 | 200,200 |
| Global search | 1 | 0.0 KB | 10 | 11 | `/api/search?q=Sinha` | 11 | 200 |

<details><summary>Per-request detail</summary>

```json
{
 "Home": [
  {
   "url": "/api/dashboard/home",
   "status": [
    200
   ],
   "bytes": 28418,
   "p50": 4.947946988977492,
   "p95": 5.253782001091167,
   "server_timing": "db;dur=0.5, dbq;dur=1;desc=\"queries\", app;dur=3.2"
  }
 ],
 "Projects list": [
  {
   "url": "/api/projects?page_size=50",
   "status": [
    200
   ],
   "bytes": 14538,
   "p50": 3.128779004327953,
   "p95": 3.748667993932031,
   "server_timing": "db;dur=0.3, dbq;dur=1;desc=\"queries\", app;dur=2.2"
  }
 ],
 "Project workspace": [
  {
   "url": "/api/projects/c683ce83-6b1d-4808-ad8e-f89791d45a9c",
   "status": [
    200
   ],
   "bytes": 41779,
   "p50": 14.116942998953164,
   "p95": 14.185417996486649,
   "server_timing": "db;dur=8.1, dbq;dur=10;desc=\"queries\", app;dur=5.0"
  },
  {
   "url": "/api/blocks?project_id=c683ce83-6b1d-4808-ad8e-f89791d45a9c&page_size=100",
   "status": [
    200
   ],
   "bytes": 28592,
   "p50": 5.034971996792592,
   "p95": 5.379573995014653,
   "server_timing": "db;dur=0.9, dbq;dur=3;desc=\"queries\", app;dur=3.0"
  },
  {
   "url": "/api/projects/c683ce83-6b1d-4808-ad8e-f89791d45a9c/summary",
   "status": [
    200
   ],
   "bytes": 4495,
   "p50": 4.376465003588237,
   "p95": 4.61375700251665,
   "server_timing": "db;dur=0.8, dbq;dur=2;desc=\"queries\", app;dur=2.8"
  }
 ],
 "Inventory grid": [
  {
   "url": "/api/blocks/96acf466-5975-4377-89bf-989a50e08e60",
   "status": [
    200
   ],
   "bytes": 4053,
   "p50": 5.595334994723089,
   "p95": 5.7549229968572035,
   "server_timing": "db;dur=1.7, dbq;dur=7;desc=\"queries\", app;dur=2.7"
  },
  {
   "url": "/api/flats?block_id=96acf466-5975-4377-89bf-989a50e08e60&page_size=200",
   "status": [
    200
   ],
   "bytes": 50886,
   "p50": 5.595312002697028,
   "p95": 5.920374998822808,
   "server_timing": "db;dur=0.8, dbq;dur=3;desc=\"queries\", app;dur=4.0"
  }
 ],
 "Customers list": [
  {
   "url": "/api/customers?page_size=50",
   "status": [
    200
   ],
   "bytes": 57218,
   "p50": 7.974148000357673,
   "p95": 8.13530599407386,
   "server_timing": "db;dur=2.1, dbq;dur=4;desc=\"queries\", app;dur=4.7"
  }
 ],
 "Customers search": [
  {
   "url": "/api/customers?search=Sinha&page_size=50",
   "status": [
    200
   ],
   "bytes": 57435,
   "p50": 14.753119990928099,
   "p95": 14.904027004376985,
   "server_timing": "db;dur=13.5, dbq;dur=6;desc=\"queries\", app;dur=0.0"
  }
 ],
 "Customer 360": [
  {
   "url": "/api/customers/3dbbf479-8f13-4583-94ec-f2a4e3fa6a22",
   "status": [
    200
   ],
   "bytes": 2626,
   "p50": 7.863067003199831,
   "p95": 8.28499099588953,
   "server_timing": "db;dur=3.8, dbq;dur=7;desc=\"queries\", app;dur=3.3"
  },
  {
   "url": "/api/customers/3dbbf479-8f13-4583-94ec-f2a4e3fa6a22/timeline?limit=20",
   "status": [
    200
   ],
   "bytes": 5117,
   "p50": 13.639158001751639,
   "p95": 13.734787004068494,
   "server_timing": "db;dur=7.4, dbq;dur=15;desc=\"queries\", app;dur=5.5"
  },
  {
   "url": "/api/bookings?customer_id=3dbbf479-8f13-4583-94ec-f2a4e3fa6a22&page_size=20",
   "status": [
    200
   ],
   "bytes": 2897,
   "p50": 3.233782001188956,
   "p95": 3.991189005319029,
   "server_timing": "db;dur=0.3, dbq;dur=1;desc=\"queries\", app;dur=1.9"
  }
 ],
 "Bookings list": [
  {
   "url": "/api/bookings?page_size=50",
   "status": [
    200
   ],
   "bytes": 133675,
   "p50": 10.915655991993845,
   "p95": 11.00138301262632,
   "server_timing": "db;dur=0.4, dbq;dur=1;desc=\"queries\", app;dur=9.2"
  }
 ],
 "Booking detail (3 ledgers)": [
  {
   "url": "/api/bookings/00245431-d08d-4ef9-b92f-3c6a63ab5024",
   "status": [
    200
   ],
   "bytes": 25117,
   "p50": 7.469379997928627,
   "p95": 8.165277002262883,
   "server_timing": "db;dur=7.9, dbq;dur=8;desc=\"queries\", app;dur=0.0"
  },
  {
   "url": "/api/bookings/00245431-d08d-4ef9-b92f-3c6a63ab5024/ledger?book=cash",
   "status": [
    200
   ],
   "bytes": 12107,
   "p50": 5.771943993750028,
   "p95": 6.072577001759782,
   "server_timing": "db;dur=1.2, dbq;dur=3;desc=\"queries\", app;dur=3.5"
  },
  {
   "url": "/api/bookings/00245431-d08d-4ef9-b92f-3c6a63ab5024/ledger?book=account",
   "status": [
    200
   ],
   "bytes": 12107,
   "p50": 5.521476996364072,
   "p95": 5.611436004983261,
   "server_timing": "db;dur=1.2, dbq;dur=3;desc=\"queries\", app;dur=3.5"
  },
  {
   "url": "/api/bookings/00245431-d08d-4ef9-b92f-3c6a63ab5024/ledger?book=other",
   "status": [
    200
   ],
   "bytes": 12107,
   "p50": 5.463398003485054,
   "p95": 5.705927993403748,
   "server_timing": "db;dur=1.3, dbq;dur=3;desc=\"queries\", app;dur=3.6"
  }
 ],
 "Payments": [
  {
   "url": "/api/payments?page_size=50",
   "status": [
    200
   ],
   "bytes": 72491,
   "p50": 27.136518998304382,
   "p95": 27.519825991475955,
   "server_timing": "db;dur=19.7, dbq;dur=2;desc=\"queries\", app;dur=6.1"
  },
  {
   "url": "/api/payments/summary",
   "status": [
    200
   ],
   "bytes": 286,
   "p50": 23.293981997994706,
   "p95": 23.66436801094096,
   "server_timing": "db;dur=19.7, dbq;dur=2;desc=\"queries\", app;dur=2.6"
  }
 ],
 "Leads board": [
  {
   "url": "/api/leads/board",
   "status": [
    200
   ],
   "bytes": 83564,
   "p50": 13.748644007137045,
   "p95": 17.649294997681864,
   "server_timing": "db;dur=4.6, dbq;dur=2;desc=\"queries\", app;dur=8.1"
  },
  {
   "url": "/api/leads?page_size=50",
   "status": [
    200
   ],
   "bytes": 41764,
   "p50": 4.660538994357921,
   "p95": 4.736632996355183,
   "server_timing": "db;dur=0.4, dbq;dur=1;desc=\"queries\", app;dur=3.6"
  }
 ],
 "Site visits": [
  {
   "url": "/api/site-visits?page_size=50",
   "status": [
    200
   ],
   "bytes": 43541,
   "p50": 5.457335995743051,
   "p95": 5.8141829940723255,
   "server_timing": "db;dur=0.5, dbq;dur=2;desc=\"queries\", app;dur=4.2"
  }
 ],
 "Service": [
  {
   "url": "/api/service-requests?page_size=50",
   "status": [
    200
   ],
   "bytes": 66532,
   "p50": 9.421392998774536,
   "p95": 9.75070999993477,
   "server_timing": "db;dur=0.9, dbq;dur=2;desc=\"queries\", app;dur=7.7"
  }
 ],
 "Reports": [
  {
   "url": "/api/reports",
   "status": [
    200
   ],
   "bytes": 957,
   "p50": 2.7197199960937724,
   "p95": 2.8639279917115346,
   "server_timing": "db;dur=0.3, dbq;dur=1;desc=\"queries\", app;dur=1.6"
  },
  {
   "url": "/api/reports/collections?page_size=50",
   "status": [
    400
   ],
   "bytes": 405,
   "p50": 3.058162998058833,
   "p95": 3.3015919907484204,
   "server_timing": "db;dur=0.3, dbq;dur=1;desc=\"queries\", app;dur=2.0"
  }
 ],
 "Catalogues": [
  {
   "url": "/api/catalogues",
   "status": [
    200
   ],
   "bytes": 67695,
   "p50": 7.877885000198148,
   "p95": 7.944579992908984,
   "server_timing": "db;dur=0.6, dbq;dur=2;desc=\"queries\", app;dur=6.1"
  }
 ],
 "Users": [
  {
   "url": "/api/users?page_size=50",
   "status": [
    200
   ],
   "bytes": 3256,
   "p50": 3.73449400649406,
   "p95": 3.932941996026784,
   "server_timing": "db;dur=0.6, dbq;dur=2;desc=\"queries\", app;dur=2.4"
  },
  {
   "url": "/api/roles",
   "status": [
    200
   ],
   "bytes": 3984,
   "p50": 3.9042320131557062,
   "p95": 4.168097002548166,
   "server_timing": "db;dur=0.8, dbq;dur=2;desc=\"queries\", app;dur=2.4"
  }
 ],
 "Settings": [
  {
   "url": "/api/settings/company",
   "status": [
    200
   ],
   "bytes": 1210,
   "p50": 3.907983991666697,
   "p95": 4.085622989805415,
   "server_timing": "db;dur=0.8, dbq;dur=2;desc=\"queries\", app;dur=2.3"
  },
  {
   "url": "/api/admin/integrity-report",
   "status": [
    200
   ],
   "bytes": 140,
   "p50": 3.6939940036972985,
   "p95": 3.8087819993961602,
   "server_timing": "db;dur=0.8, dbq;dur=2;desc=\"queries\", app;dur=2.3"
  }
 ],
 "Global search": [
  {
   "url": "/api/search?q=Sinha",
   "status": [
    200
   ],
   "bytes": 43,
   "p50": 10.082449007313699,
   "p95": 10.608352007693611,
   "server_timing": "db;dur=15.9, dbq;dur=8;desc=\"queries\", app;dur=0.0"
  }
 ]
}
```
</details>
