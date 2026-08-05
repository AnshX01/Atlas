"""
Atlas — FastAPI Dependency Injection.

Provides reusable dependencies for:
  - Database sessions
  - Current authenticated user
  - Idempotency key validation
"""
from __future__ import annotations

import uuid
from collections.abc import AsyncGenerator

from fastapi import Depends, Header, HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AuthenticationError
from app.core.security import decode_token
from app.domain.models.user import User
from app.infrastructure.database import get_async_session

_bearer = HTTPBearer(auto_error=False)


async def get_db(session: AsyncSession = Depends(get_async_session)) -> AsyncGenerator[AsyncSession, None]:
    """Yield a database session. Alias for use in router dependencies."""
    yield session


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Security(_bearer),
    session: AsyncSession = Depends(get_db),
) -> User:
    """
    Decode the JWT Bearer token and return the authenticated User.

    Raises:
        AuthenticationError: If token is missing, invalid, or expired.
        HTTPException 401: If user no longer exists in DB.
    """
    if not credentials:
        raise AuthenticationError("Authorization header missing")

    try:
        payload = decode_token(credentials.credentials)
        user_id_str: str | None = payload.get("sub")
        if not user_id_str:
            raise AuthenticationError("Token missing subject claim")
        user_id = uuid.UUID(user_id_str)
    except (JWTError, ValueError) as exc:
        raise AuthenticationError(str(exc)) from exc

    user = await session.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    return user


async def require_idempotency_key(
    idempotency_key: str = Header(..., alias="Idempotency-Key"),
) -> str:
    """
    Validate the Idempotency-Key header required on all POST requests.
    Per Section 7.1 (Stripe-like API standards).
    """
    if not idempotency_key or len(idempotency_key) < 8:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Idempotency-Key header must be at least 8 characters",
        )
    return idempotency_key
