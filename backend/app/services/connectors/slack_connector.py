"""Atlas - Slack Connector.

Syncs: Direct messages, important channel messages, tasks assigned via Slack.
Phase 1: Polling-based. Phase 2: Real-time via Slack Events API.
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


class SlackConnector(BaseConnector):
    """Connector for Slack messages, mentions, and assigned tasks."""

    PROVIDER = "slack"

    def __init__(self, connector: Connector, user_id: uuid.UUID) -> None:
        super().__init__(connector, user_id)

    async def authenticate(self, auth_code: str) -> None:
        """Exchange Slack OAuth code for bot + user tokens."""
        # TODO: Implement Slack OAuth token exchange
        # POST https://slack.com/api/oauth.v2.access
        logger.info("Slack authentication placeholder")
        raise NotImplementedError("Slack OAuth not yet configured")

    async def sync(self) -> dict[str, int]:
        """Sync DMs, mentions, and channel messages.

        Fetches:
        - Direct messages from the last 7 days
        - Mentions (@user) in channels
        - Messages in starred/priority channels
        - Tasks assigned via workflow or bot commands
        """
        # TODO: Implement with slack_sdk
        # from slack_sdk.web.async_client import AsyncWebClient
        # client = AsyncWebClient(token=access_token)
        # conversations = await client.conversations_list(types="im,mpim")
        # For each conversation, fetch messages since last sync
        logger.info("Slack sync placeholder")
        return {"synced": 0, "failed": 0, "skipped": 0}

    async def watch(self) -> AsyncIterator[dict[str, Any]]:
        """Real-time Slack events via Events API (Phase 2)."""
        while True:
            await asyncio.sleep(300)
            yield {"type": "poll_tick", "payload": {}}

    async def teardown(self) -> None:
        pass
