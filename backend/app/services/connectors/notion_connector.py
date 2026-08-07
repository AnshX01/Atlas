"""Atlas - Notion Connector.

Syncs: Tasks from databases, page content, assigned items.
Phase 1: Polling-based. Phase 2: Notion webhooks.
"""
from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

from app.core.logging import get_logger
from app.domain.interfaces.base_connector import BaseConnector
from app.domain.models.connector import Connector, ConnectorStatus
from app.infrastructure.database import get_session_factory
from app.workers.embedding_tasks import batch_embed_chunks

logger = get_logger(__name__)


class NotionConnector(BaseConnector):
    """Connector for Notion pages, databases, and tasks."""

    PROVIDER = "notion"

    def __init__(self, connector: Connector, user_id: uuid.UUID) -> None:
        super().__init__(connector, user_id)

    async def authenticate(self, auth_code: str) -> None:
        """Exchange Notion OAuth code for access token."""
        # TODO: Implement Notion OAuth
        # POST https://api.notion.com/v1/oauth/token
        logger.info("Notion authentication placeholder")
        raise NotImplementedError("Notion OAuth not yet configured")

    async def sync(self) -> dict[str, int]:
        """Sync Notion pages, databases, and tasks.

        Fetches:
        - All pages the user has access to (titles + content)
        - Database items (tasks, projects, etc.)
        - Items assigned to the user
        - Recently modified pages
        """
        # TODO: Implement with notion-client
        # from notion_client import AsyncClient
        # notion = AsyncClient(auth=access_token)
        # results = await notion.search(filter={"property": "object", "value": "page"})
        logger.info("Notion sync placeholder")
        return {"synced": 0, "failed": 0, "skipped": 0}

    async def watch(self) -> AsyncIterator[dict[str, Any]]:
        """Notion doesn't support real-time webhooks yet - polling only."""
        while True:
            await asyncio.sleep(600)
            yield {"type": "poll_tick", "payload": {}}

    async def teardown(self) -> None:
        pass
