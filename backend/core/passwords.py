"""Leaf: password hashing + policy (bcrypt via passlib). Shared by routers.auth, routers.portal, users, seeds and owner bootstrap."""
import re

from passlib.context import CryptContext

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
_DUMMY_HASH = pwd_ctx.hash("kkt-dummy-timing-equaliser")


def hash_password(pw: str) -> str:
    return pwd_ctx.hash(pw)


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return pwd_ctx.verify(pw, hashed)
    except Exception:
        return False


def validate_password_policy(pw: str) -> str:
    if len(pw) < 8 or not re.search(r"\d", pw) or not re.search(r"[A-Za-z]", pw):
        raise ValueError("Password must be at least 8 characters with at least 1 letter and 1 number")
    return pw
