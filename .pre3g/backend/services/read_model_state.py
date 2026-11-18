"""Dirty-scope state shared by read_models (writer) and trends (reader) without an import cycle."""

dirty = {"projects": set(), "blocks": set(), "customers": set(), "all": False, "task": None}


def has_marks() -> bool:
    return bool(dirty["all"] or dirty["projects"] or dirty["blocks"] or dirty["customers"])


def pending() -> bool:
    """True while a change is marked but its read-model flush has not finished."""
    t = dirty["task"]
    return has_marks() or bool(t and not t.done())
