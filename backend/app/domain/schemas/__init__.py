"""Atlas — Pydantic schemas for Briefing, Search, Connectors, and Actions."""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field

from app.domain.models.connector import ConnectorProvider


# ── Briefing Schemas ──────────────────────────────────────────────────────────
class BriefingItem(BaseModel):
    """A single prioritized item in the daily briefing."""

    id: str
    type: Literal["email", "pr", "issue", "calendar", "document", "task"]
    title: str
    summary: str
    source: str  # e.g., "Gmail", "GitHub"
    priority_score: int = Field(ge=1, le=100, description="Triage score 1-100")
    action_label: str | None = None  # e.g., "Reply", "Merge", "Pay"
    action_url: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime


class DailyBriefingResponse(BaseModel):
    """The full morning briefing response."""

    date: datetime
    focus_score: int = Field(ge=0, le=100, description="Overall day urgency 0-100")
    focus_score_label: str  # e.g., "High Focus Day"
    items: list[BriefingItem]
    total_unread: int
    generated_at: datetime


# ── Search Schemas ────────────────────────────────────────────────────────────
class OmniSearchRequest(BaseModel):
    """Universal search request."""

    query: str = Field(min_length=1, max_length=1000)
    limit: int = Field(default=10, ge=1, le=50)
    sources: list[str] | None = None  # Filter by source (optional)


class SearchResult(BaseModel):
    """A single search result from hybrid retrieval."""

    id: str
    type: str
    title: str
    excerpt: str
    source: str
    score: float = Field(ge=0.0, le=1.0)
    url: str | None = None
    timestamp: datetime
    metadata: dict[str, Any] = Field(default_factory=dict)
    # Citations from RAG pipeline
    source_ids: list[str] = Field(default_factory=list)


class OmniSearchResponse(BaseModel):
    """Search results with rewritten query and reranked results."""

    original_query: str
    rewritten_query: str
    results: list[SearchResult]
    took_ms: float


# ── Connector Schemas ─────────────────────────────────────────────────────────
class ConnectorResponse(BaseModel):
    """Public connector state."""

    id: uuid.UUID
    provider: ConnectorProvider
    status: str
    display_name: str | None
    external_account_id: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ConnectorCreateRequest(BaseModel):
    """Request body for creating a new connector."""

    provider: ConnectorProvider
    display_name: str | None = None


class SyncTriggerResponse(BaseModel):
    """Response when a manual sync is triggered."""

    task_id: str
    connector_id: uuid.UUID
    provider: ConnectorProvider
    message: str


# ── Action Schemas ────────────────────────────────────────────────────────────
class ActionRequest(BaseModel):
    """Execute an autonomous action on behalf of the user."""

    action_type: Literal[
        "reply_email",
        "draft_email",
        "merge_pr",
        "close_issue",
        "create_calendar_event",
        "search_and_summarize",
    ]
    parameters: dict[str, Any] = Field(default_factory=dict)
    # Idempotency key — caller must supply
    idempotency_key: str = Field(min_length=1, max_length=128)


class ActionResponse(BaseModel):
    """Result of an executed action."""

    action_type: str
    success: bool
    result: dict[str, Any] = Field(default_factory=dict)
    message: str
    executed_at: datetime
