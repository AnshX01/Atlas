"""Atlas — Users API Router."""

from __future__ import annotations

from typing import Any

from app.api.deps import get_current_user
from app.domain.models.user import User
from app.infrastructure.database import get_session_factory
from fastapi import APIRouter, Depends
from pydantic import BaseModel

users_router = APIRouter(prefix="/users", tags=["Users"])


class SettingsUpdateRequest(BaseModel):
    settings: dict[str, Any]


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
    """Partially update the user's settings_json."""
    factory = get_session_factory()
    async with factory() as session:
        # Merge new settings into existing
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
        settings_json=current_user.settings_json,
    )
