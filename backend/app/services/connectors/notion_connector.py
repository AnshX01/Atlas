"""Atlas - Notion Connector. Syncs pages, databases, and tasks."""
from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
from app.core.logging import get_logger
from app.core.security import decrypt_token
from app.domain.interfaces.base_connector import BaseConnector
from app.domain.models.connector import Connector, ConnectorStatus, OAuthToken
from app.infrastructure.database import get_session_factory
from app.workers.embedding_tasks import enqueue_embedding_batches
from app.infrastructure.neo4j_client import upsert_document_node, upsert_task_node
from sqlalchemy import select

logger = get_logger(__name__)

NOTION_API = "https://api.notion.com/v1"
NOTION_VERSION = "2022-06-28"


class NotionConnector(BaseConnector):
    PROVIDER = "notion"

    def __init__(self, connector: Connector, user_id: uuid.UUID) -> None:
        super().__init__(connector, user_id)
        self._token: str | None = None

    async def _get_token(self) -> str:
        if self._token:
            return self._token
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(OAuthToken).where(OAuthToken.connector_id == self.connector.id)
            result = await session.execute(stmt)
            token_row = result.scalar_one_or_none()
            if not token_row:
                raise ValueError(f"No OAuth token for Notion connector {self.connector.id}")
            self._token = decrypt_token(token_row.access_token)
        return self._token

    async def _notion_api(self, method: str, path: str, json_body: dict | None = None) -> dict:
        token = await self._get_token()
        headers = {
            "Authorization": f"Bearer {token}",
            "Notion-Version": NOTION_VERSION,
            "Content-Type": "application/json",
        }
        async with httpx.AsyncClient() as client:
            if method == "GET":
                resp = await client.get(f"{NOTION_API}{path}", headers=headers)
            else:
                resp = await client.post(f"{NOTION_API}{path}", headers=headers, json=json_body or {})
            try:
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                if e.response.status_code == 401:
                    await self._mark_requires_reauth()
                raise
            return resp.json()

    async def authenticate(self, auth_code: str) -> None:
        pass  # Handled in OAuth callback

    async def _get_blocks(self, block_id: str) -> list[dict]:
        blocks = []
        has_more = True
        next_cursor = None
        while has_more:
            path = f"/blocks/{block_id}/children?page_size=100"
            if next_cursor:
                path += f"&start_cursor={next_cursor}"
            try:
                res = await self._notion_api("GET", path)
                blocks.extend(res.get("results") or [])
                has_more = res.get("has_more", False)
                next_cursor = res.get("next_cursor")
            except Exception as e:
                logger.error("Failed to fetch blocks for %s: %s", block_id, e)
                break
        return blocks

    async def _parse_blocks_to_text(self, block_id: str) -> str:
        blocks = await self._get_blocks(block_id)
        lines = []
        for b in blocks:
            if not isinstance(b, dict):
                continue
            b_type = b.get("type")
            if not b_type:
                continue
            b_data = b.get(b_type) or {}
            
            rich_text = b_data.get("rich_text") or []
            text_content = "".join(t.get("plain_text", "") for t in rich_text if isinstance(t, dict))
            
            if b_type == "paragraph":
                lines.append(text_content)
            elif b_type in ("heading_1", "heading_2", "heading_3"):
                lines.append(text_content)
            elif b_type in ("bulleted_list_item", "numbered_list_item"):
                lines.append(f"- {text_content}")
            elif b_type == "to_do":
                checked = b_data.get("checked", False)
                lines.append(f"[{'x' if checked else ' '}] {text_content}")
            elif b_type == "child_page":
                child_title = b_data.get("title", "Untitled")
                lines.append(f"[Child Page: {child_title}]")
            elif b_type == "table":
                if b.get("has_children"):
                    table_rows = await self._get_blocks(b.get("id", ""))
                    for row in table_rows:
                        if isinstance(row, dict) and row.get("type") == "table_row":
                            cells = (row.get("table_row") or {}).get("cells") or []
                            row_text = " | ".join(
                                "".join(t.get("plain_text", "") for t in cell if isinstance(t, dict)) for cell in cells if isinstance(cell, list)
                            )
                            lines.append(f"| {row_text} |")
            else:
                if text_content:
                    lines.append(text_content)

            if b.get("has_children") and b_type != "table":
                child_text = await self._parse_blocks_to_text(b.get("id", ""))
                if child_text:
                    lines.append(child_text)
                    
        return "\n".join(lines)

    async def sync(self) -> dict[str, int]:
        """Sync Notion pages and database items."""
        synced = 0
        chunks: list[dict[str, Any]] = []
        since = datetime.now(UTC) - timedelta(days=7)

        try:
            results = await self._notion_api("POST", "/search", {
                "filter": {"property": "object", "value": "page"},
                "sort": {"direction": "descending", "timestamp": "last_edited_time"},
                "page_size": 50,
            })
        except Exception as e:
            logger.error("Failed to search Notion pages: %s", e)
            return {"synced": 0, "failed": 1, "skipped": 0}

        for page in results.get("results") or []:
            if not isinstance(page, dict):
                continue
                
            title = ""
            props = page.get("properties") or {}
            for prop in props.values():
                if isinstance(prop, dict) and prop.get("type") == "title":
                    title_parts = prop.get("title") or []
                    title = "".join(t.get("plain_text", "") for t in title_parts if isinstance(t, dict))
                    break

            if not title.strip():
                title = "Untitled"

            page_url = page.get("url", "")
            last_edited = page.get("last_edited_time", datetime.now(UTC).isoformat())

            item_type = "document"
            for prop in props.values():
                if isinstance(prop, dict) and prop.get("type") in ("status", "checkbox"):
                    item_type = "task"
                    break

            # Parse block content
            page_id = page.get("id", "")
            if not page_id:
                continue
                
            page_content = await self._parse_blocks_to_text(page_id)
            full_text = f"{title}\n\n{page_content}".strip()

            chunks.append({
                "id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"notion:{page_id}")),
                "source_id": page_id,
                "type": item_type,
                "text": full_text,
                "timestamp": last_edited,
                "metadata": {
                    "url": page_url,
                    "source": "Notion",
                    "notion_id": page_id,
                },
            })
            synced += 1

            if item_type == "document":
                await upsert_document_node(str(self.user_id), page_id, "notion_page", last_edited)
            elif item_type == "task":
                await upsert_task_node(
                    user_id=str(self.user_id),
                    issue_id=page_id,
                    title=title,
                    url=page_url,
                    state="open",
                    repo="Notion",
                    assignee=None,
                    updated_at=last_edited,
                )

        if chunks:
            enqueue_embedding_batches(str(self.user_id), chunks)

        logger.info("Notion sync complete: synced=%d", synced)
        return {"synced": synced, "failed": 0, "skipped": 0}

    async def watch(self) -> AsyncIterator[dict[str, Any]]:
        while True:
            await asyncio.sleep(600)
            yield {"type": "poll_tick", "payload": {}}

    async def teardown(self) -> None:
        pass
