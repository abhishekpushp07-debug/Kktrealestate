"""Leaf: the API error type. No project imports."""
from fastapi import HTTPException


class ApiError(HTTPException):
    def __init__(self, status_code: int, detail: str, code: str = "ERROR", extra: dict | None = None):
        super().__init__(status_code=status_code, detail=detail)
        self.code = code
        self.extra = extra
