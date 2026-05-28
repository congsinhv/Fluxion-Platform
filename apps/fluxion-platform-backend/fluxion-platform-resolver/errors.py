"""Typed application errors. Resolver maps to GraphQL extensions; checkin maps to REST."""

from __future__ import annotations


class AppError(Exception):
    """Base typed error: (code, http_status, message)."""

    def __init__(self, code: str, http_status: int, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.http_status = http_status
        self.message = message

    def to_dict(self) -> dict:
        return {
            "error_code": self.code,
            "message": self.message,
            "retry_strategy": {
                "retryable": self.http_status >= 500,
                "backoff_seconds": 5 if self.http_status >= 500 else None,
                "max_attempts": 5 if self.http_status >= 500 else None,
            },
        }


class NotFound(AppError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(code, 404, message)


class Conflict(AppError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(code, 409, message)


class BadRequest(AppError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(code, 400, message)


class Forbidden(AppError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(code, 403, message)


class Unauthorized(AppError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(code, 401, message)


class InternalError(AppError):
    def __init__(self, message: str = "Temporary backend failure") -> None:
        super().__init__("INTERNAL_ERROR", 500, message)
