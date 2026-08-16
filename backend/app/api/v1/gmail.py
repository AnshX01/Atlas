"""Atlas — Gmail Integration API."""

from __future__ import annotations

from typing import Any

from app.api.deps import get_current_user
from app.domain.models.connector import Connector, ConnectorProvider, ConnectorStatus
from app.domain.models.user import User
from app.infrastructure.database import get_session_factory
from app.services.connectors.google_workspace import GoogleWorkspaceConnector
from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select

gmail_router = APIRouter(prefix="/gmail", tags=["Gmail"])

class DraftEmailRequest(BaseModel):
    to: str
    subject: str
    body: str
    cc: str | None = None
    bcc: str | None = None

class SendEmailRequest(BaseModel):
    to: str
    subject: str
    body: str
    cc: str | None = None
    bcc: str | None = None
    draft_id: str | None = None

async def _get_gmail_connector(user_id: str) -> GoogleWorkspaceConnector:
    factory = get_session_factory()
    async with factory() as session:
        stmt = select(Connector).where(
            Connector.user_id == user_id,
            Connector.provider == ConnectorProvider.GOOGLE_WORKSPACE,
            Connector.status == ConnectorStatus.ACTIVE,
        )
        result = await session.execute(stmt)
        connector_model = result.scalar_one_or_none()
        
    if not connector_model:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Active Google Workspace connector not found. Please connect your account first.",
        )
        
    return GoogleWorkspaceConnector(connector_model, user_id)

@gmail_router.get("/search", summary="Search Gmail messages")
async def search_emails(
    q: str = Query(..., description="Gmail search query"),
    max_results: int = Query(10, ge=1, le=50, description="Max results to return"),
    current_user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    connector = await _get_gmail_connector(current_user.id)
    try:
        return await connector.search_emails(q, max_results)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to search emails: {str(e)}")

@gmail_router.get("/message/{message_id}", summary="Get a specific Gmail message")
async def get_email(
    message_id: str,
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    connector = await _get_gmail_connector(current_user.id)
    try:
        return await connector.get_email(message_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch email: {str(e)}")

@gmail_router.post("/draft", summary="Create a Gmail draft")
async def draft_email(
    payload: DraftEmailRequest,
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    connector = await _get_gmail_connector(current_user.id)
    try:
        return await connector.draft_email(
            to=payload.to,
            subject=payload.subject,
            body=payload.body,
            cc=payload.cc,
            bcc=payload.bcc,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to draft email: {str(e)}")

@gmail_router.post("/send", summary="Send an email or a draft")
async def send_email(
    payload: SendEmailRequest,
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    connector = await _get_gmail_connector(current_user.id)
    try:
        return await connector.send_email(
            to=payload.to,
            subject=payload.subject,
            body=payload.body,
            cc=payload.cc,
            bcc=payload.bcc,
            draft_id=payload.draft_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send email: {str(e)}")
