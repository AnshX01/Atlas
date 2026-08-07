"""Atlas — Users API Router."""

from __future__ import annotations

from typing import Any

from app.api.deps import get_current_user, get_db
from app.core.security import hash_password, verify_password
from app.domain.models.user import User
from app.infrastructure.database import get_session_factory
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.ext.asyncio import AsyncSession

users_router = APIRouter(prefix="/users", tags=["Users"])


class SettingsUpdateRequest(BaseModel):
    settings: dict[str, Any]


class ProfileUpdateRequest(BaseModel):
    full_name: str | None = None
    email: EmailStr | None = None


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str


class UserResponse(BaseModel):
    id: str
    email: str
    full_name: str | None
    settings_json: dict[str, Any]

    model_config = {"from_attributes": True}


@users_router.patch(
    "/me/settings",
    response_model=UserResponse,
    summary="Update the current user's settings",
)
async def update_settings(
    payload: SettingsUpdateRequest,
    current_user: User = Depends(get_current_user),
) -> UserResponse:
    factory = get_session_factory()
    async with factory() as session:
        current_settings = dict(current_user.settings_json or {})
        current_settings.update(payload.settings)
        current_user.settings_json = current_settings
        session.add(current_user)
        await session.commit()
        await session.refresh(current_user)
    return UserResponse(
        id=str(current_user.id),
        email=current_user.email,
        full_name=current_user.full_name,
        settings_json=current_user.settings_json or {},
    )


@users_router.patch(
    "/me/profile",
    response_model=UserResponse,
    summary="Update user profile",
)
async def update_profile(
    payload: ProfileUpdateRequest,
    current_user: User = Depends(get_current_user),
) -> UserResponse:
    factory = get_session_factory()
    async with factory() as session:
        if payload.full_name is not None:
            current_user.full_name = payload.full_name
        if payload.email is not None:
            current_user.email = payload.email
        session.add(current_user)
        await session.commit()
        await session.refresh(current_user)
    return UserResponse(
        id=str(current_user.id),
        email=current_user.email,
        full_name=current_user.full_name,
        settings_json=current_user.settings_json or {},
    )


@users_router.patch(
    "/me/password",
    summary="Change password",
)
async def change_password(
    payload: PasswordChangeRequest,
    current_user: User = Depends(get_current_user),
) -> dict:
    if not verify_password(payload.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect",
        )
    factory = get_session_factory()
    async with factory() as session:
        current_user.hashed_password = hash_password(payload.new_password)
        session.add(current_user)
        await session.commit()
    return {"message": "Password changed successfully"}
