"""
Atlas Backend — Exception Handlers & RFC 7807 Error Responses.

All HTTP error responses conform to RFC 7807 "Problem Details for HTTP APIs".
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import ORJSONResponse
from jose import JWTError
from sqlalchemy.exc import OperationalError



# ── Custom Exception Classes ──────────────────────────────────────────────────
class AtlasError(Exception):
    """Base exception for all Atlas application errors."""

    def __init__(
        self,
        message: str,
        status_code: int = status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail: str | None = None,
    ) -> None:
        self.message = message
        self.status_code = status_code
        self.detail = detail or message
        super().__init__(message)


class NotFoundError(AtlasError):
    """Raised when a requested resource does not exist."""

    def __init__(self, resource: str, identifier: Any = None) -> None:
        msg = f"{resource} not found"
        if identifier:
            msg = f"{resource} '{identifier}' not found"
        super().__init__(msg, status_code=status.HTTP_404_NOT_FOUND)


class AuthenticationError(AtlasError):
    """Raised when JWT auth fails."""

    def __init__(self, detail: str = "Could not validate credentials") -> None:
        super().__init__(detail, status_code=status.HTTP_401_UNAUTHORIZED)


class AuthorizationError(AtlasError):
    """Raised when user lacks permission for an action."""

    def __init__(self, detail: str = "Insufficient permissions") -> None:
        super().__init__(detail, status_code=status.HTTP_403_FORBIDDEN)


class ConnectorError(AtlasError):
    """Raised when a third-party connector encounters an error."""

    def __init__(self, provider: str, detail: str) -> None:
        super().__init__(
            f"Connector '{provider}' error: {detail}",
            status_code=status.HTTP_502_BAD_GATEWAY,
        )


class RateLimitError(AtlasError):
    """Raised when a third-party API rate limit is hit."""

    def __init__(self, provider: str, retry_after: int | None = None) -> None:
        msg = f"Rate limited by {provider}"
        if retry_after:
            msg += f" — retry after {retry_after}s"
        super().__init__(msg, status_code=status.HTTP_429_TOO_MANY_REQUESTS)


class AIError(AtlasError):
    """Raised when an AI agent or LLM call fails."""

    def __init__(self, detail: str = "AI processing failed") -> None:
        super().__init__(detail, status_code=status.HTTP_503_SERVICE_UNAVAILABLE)


# ── RFC 7807 Response Builder ─────────────────────────────────────────────────
def _problem_response(
    status_code: int,
    title: str,
    detail: str,
    instance: str | None = None,
    extensions: dict[str, Any] | None = None,
) -> ORJSONResponse:
    """Build an RFC 7807-compliant problem detail JSON response."""
    body: dict[str, Any] = {
        "type": f"https://atlas.app/errors/{title.lower().replace(' ', '-')}",
        "title": title,
        "status": status_code,
        "detail": detail,
    }
    if instance:
        body["instance"] = instance
    if extensions:
        body.update(extensions)

    return ORJSONResponse(
        status_code=status_code,
        content=body,
        media_type="application/problem+json",
    )


# ── Handler Registration ──────────────────────────────────────────────────────
def register_exception_handlers(app: FastAPI) -> None:
    """Register all custom exception handlers on the FastAPI app."""

    @app.exception_handler(AtlasError)
    async def atlas_error_handler(request: Request, exc: AtlasError) -> ORJSONResponse:
        return _problem_response(
            status_code=exc.status_code,
            title=type(exc).__name__,
            detail=exc.detail,
            instance=str(request.url),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, exc: RequestValidationError
    ) -> ORJSONResponse:
        return _problem_response(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            title="Validation Error",
            detail="Request body or parameters failed validation.",
            instance=str(request.url),
            extensions={"errors": exc.errors()},
        )

    @app.exception_handler(JWTError)
    async def jwt_error_handler(request: Request, exc: JWTError) -> ORJSONResponse:
        return _problem_response(
            status_code=status.HTTP_401_UNAUTHORIZED,
            title="Authentication Error",
            detail="Invalid or expired token.",
            instance=str(request.url),
        )

    @app.exception_handler(OperationalError)
    async def sqlalchemy_operational_error_handler(request: Request, exc: OperationalError) -> ORJSONResponse:
        # Detect transient DB locks or disconnects
        detail_msg = str(exc).lower()
        if "locked" in detail_msg or "timeout" in detail_msg or "server closed the connection" in detail_msg:
            return _problem_response(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                title="Database Unavailable",
                detail="The database is temporarily locked or unavailable. Please retry.",
                instance=str(request.url),
            )
        # Fallback for other operational errors
        return _problem_response(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            title="Database Error",
            detail="An internal database error occurred.",
            instance=str(request.url),
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> ORJSONResponse:
        # Never leak internal tracebacks to clients
        return _problem_response(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            title="Internal Server Error",
            detail="Atlas encountered an unexpected error. Please try again.",
            instance=str(request.url),
        )
