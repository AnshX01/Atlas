"""
Atlas — Abstract Base Interfaces for Connectors and Agents.

All concrete connectors must extend BaseConnector.
All AI agents must extend BaseAgent.
"""
from __future__ import annotations

import uuid
from abc import ABC, abstractmethod
from typing import TYPE_CHECKING, Any, AsyncIterator

if TYPE_CHECKING:
    from app.domain.models.connector import Connector


class BaseConnector(ABC):
    """
    Abstract base class for all third-party data source connectors.

    Lifecycle:
        1. authenticate() — exchange code for token, persist encrypted token.
        2. sync()         — fetch all new/changed data since last cursor.
        3. watch()        — subscribe to real-time webhooks/events.
        4. teardown()     — clean up resources on disconnect.

    All implementations MUST:
        - Handle rate limits with exponential backoff (use tenacity).
        - Detect 401 responses and call _mark_requires_reauth().
        - Store only encrypted tokens via security.encrypt_token().
        - Scope all DB writes to the owning user_id (RBAC).
    """

    def __init__(self, connector: "Connector", user_id: uuid.UUID) -> None:
        self.connector = connector
        self.user_id = user_id
        self.provider = connector.provider

    @abstractmethod
    async def authenticate(self, auth_code: str) -> None:
        """
        Exchange an OAuth authorization code for access + refresh tokens.
        Must persist the encrypted tokens via OAuthToken model.
        """

    @abstractmethod
    async def sync(self) -> dict[str, int]:
        """
        Fetch all data since the last known cursor.

        Returns:
            Dict with keys: {"synced": int, "failed": int, "skipped": int}
        """

    @abstractmethod
    async def watch(self) -> AsyncIterator[dict[str, Any]]:
        """
        Yield real-time events from the provider (webhooks, polling, SSE).
        Each event is a dict with at least {"type": str, "payload": dict}.
        """

    async def teardown(self) -> None:
        """
        Optional cleanup (revoke webhook, close WebSocket, etc.).
        Override in subclass if needed.
        """

    async def _mark_requires_reauth(self) -> None:
        """Update connector status to REQUIRES_REAUTH in the DB."""
        from app.domain.models.connector import ConnectorStatus
        from app.infrastructure.database import get_async_session

        async for session in get_async_session():
            self.connector.status = ConnectorStatus.REQUIRES_REAUTH
            session.add(self.connector)
            await session.commit()


class BaseAgent(ABC):
    """Abstract base for all LangGraph sub-agents."""

    @abstractmethod
    async def run(self, state: dict[str, Any]) -> dict[str, Any]:
        """
        Execute the agent's logic against the given LangGraph state.

        Args:
            state: The current graph state dict.

        Returns:
            Updated state dict with agent outputs merged in.
        """
