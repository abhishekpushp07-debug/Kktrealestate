"""Phase K: append-only guard for audit_logs and ledger_entries.
Enforced where:
1. Application layer (this module): the shared `db` handle returns a GuardedCollection for the two collections. Content fields are immutable:
   - update/replace/find_one_and_*: rejected unless the update is a pure `$set` of allowed *metadata* fields (audit_logs: propagation / snapshot bookkeeping written by events.py). Replace, $unset of content, delete_* and bulk_write raise ImmutableError (API code IMMUTABLE, 409).
   - `raw(reason)` is the explicit, logged escape hatch used only by the audit archiver (moves rows to cold storage) and the ledger projection rebuild (ledger_entries is a derived, date-ordered projection rebuilt from source rows; the rebuild deletes and re-inserts the whole booking's rows).
2. Database layer: the deployment connection string has no admin rights to create a second insert-only role, so no DB-level role is enforced (documented gap: docs/IMMUTABILITY.md). Mongo validators cannot express "no updates".
Test: tests/test_phase_k_hardening.py::test_audit_and_ledger_rows_immutable_via_app_connection."""
import logging

log = logging.getLogger("immutable")
ALLOWED_SET = {
    "audit_logs": {"propagated", "propagated_complete", "propagated_at", "replayed_at", "snapshot", "snapshot_ctx", "snapshot_before", "archived", "archive_batch", "load_test"},
    "ledger_entries": set(),
}


class ImmutableError(RuntimeError):
    code = "IMMUTABLE"


class GuardedCollection:
    _HARD = ("replace_one", "delete_one", "delete_many", "find_one_and_replace", "find_one_and_delete", "bulk_write", "drop", "rename")

    def __init__(self, coll, name: str):
        self._coll, self.name = coll, name

    def _check_update(self, update):
        if not isinstance(update, dict) or set(update) != {"$set"} or not set(update["$set"]) <= ALLOWED_SET.get(self.name, set()):
            raise ImmutableError(f"{self.name} is append-only: only $set of metadata fields {sorted(ALLOWED_SET.get(self.name, set()))} is allowed")

    def update_one(self, flt, update, *a, **k):
        self._check_update(update)
        return self._coll.update_one(flt, update, *a, **k)

    def update_many(self, flt, update, *a, **k):
        self._check_update(update)
        return self._coll.update_many(flt, update, *a, **k)

    def find_one_and_update(self, flt, update, *a, **k):
        self._check_update(update)
        return self._coll.find_one_and_update(flt, update, *a, **k)

    def __getattr__(self, item):
        if item in self._HARD:
            def _blocked(*a, **k):
                raise ImmutableError(f"{self.name} is append-only: {item} is not allowed")
            return _blocked
        return getattr(self._coll, item)

    def raw(self, reason: str):
        log.info("raw access to %s: %s", self.name, reason)
        return self._coll


class GuardedDatabase:
    """Thin proxy over the motor Database: attribute / item access to guarded names returns a GuardedCollection."""
    GUARDED = ("audit_logs", "ledger_entries")

    def __init__(self, database):
        object.__setattr__(self, "_db", database)

    def __getattr__(self, item):
        if item in self.GUARDED:
            return GuardedCollection(getattr(self._db, item), item)
        return getattr(self._db, item)

    def __getitem__(self, item):
        if item in self.GUARDED:
            return GuardedCollection(self._db[item], item)
        return self._db[item]
