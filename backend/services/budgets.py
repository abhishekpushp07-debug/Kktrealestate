"""Phase K.8: query budgets. maxTimeMS on search / report aggregations (env QUERY_BUDGET_SEARCH_MS=5000, QUERY_BUDGET_REPORT_MS=20000).
A Mongo ExecutionTimeout is turned into 503 QUERY_TIMEOUT + Retry-After: 5 by the global exception handler (server.py)."""
import os

SEARCH_MS = int(os.environ.get("QUERY_BUDGET_SEARCH_MS", "5000"))
REPORT_MS = int(os.environ.get("QUERY_BUDGET_REPORT_MS", "20000"))


def agg(coll, pipeline, budget_ms: int = REPORT_MS):
    """Budgeted aggregation cursor."""
    return coll.aggregate(pipeline, maxTimeMS=budget_ms)


def find(coll, *args, budget_ms: int = SEARCH_MS, **kw):
    """Budgeted find cursor."""
    return coll.find(*args, **kw).max_time_ms(budget_ms)
