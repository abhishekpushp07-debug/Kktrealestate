import os

from cryptography.fernet import Fernet, InvalidToken

_fernet = None


def _f() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = Fernet(os.environ["ENCRYPTION_KEY"].encode())
    return _fernet


def encrypt_field(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    return _f().encrypt(value.encode()).decode()


def decrypt_field(token: str | None) -> str | None:
    if not token:
        return None
    try:
        return _f().decrypt(token.encode()).decode()
    except InvalidToken:
        return None


def mask(value: str | None, visible: int = 4) -> str | None:
    if not value:
        return None
    if len(value) <= visible:
        return "*" * len(value)
    return "*" * (len(value) - visible) + value[-visible:]
