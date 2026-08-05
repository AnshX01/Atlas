"""
Atlas — Daily Briefing Service.

Aggregates triage results from all connectors into the daily briefing.
Generates Focus Score and sorted list of prioritized BriefingItems.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from statistics import mean
from typing import Any

from app.core.logging import get_logger
from app.domain.models.connector import Connector, ConnectorStatus
from app.domain.schemas import BriefingItem, DailyBriefingResponse
from app.infrastructure.database import get_session_factory
from app.infrastructure.qdrant_client import semantic_search
from app.services.ai.supervisor_agent import run_atlas_pipeline
from sentence_transformers import SentenceTransformer
from sqlalchemy import select

logger = get_logger(__name__)

_briefing_embedder: SentenceTransformer | None = None


def _get_briefing_embedder() -> SentenceTransformer:
    """Lazy-load the embedding model for briefing queries."""
    global _briefing_embedder
    if _briefing_embedder is None:
        _briefing_embedder = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    return _briefing_embedder


def _source_label(type_str: str) -> str:
    """Map Qdrant payload type to a human-readable source name."""
    _map = {
        "email": "Gmail",
        "pr": "GitHub",
        "issue": "GitHub",
        "calendar": "Google Calendar",
        "file": "Local Files",
        "document": "Local Files",
    }
    return _map.get(type_str, "Atlas")


def _compute_focus_score(items: list[BriefingItem]) -> tuple[int, str]:
    """
    Compute an overall Focus Score from the individual item priority scores.
    Uses weighted average biased toward the top-3 highest-priority items.
    """
    if not items:
        return 0, "Clear Day"

    scores = [item.priority_score for item in items]
    top_3 = sorted(scores, reverse=True)[:3]
    # Weighted: top-3 count for 70%, rest for 30%
    top_avg = mean(top_3) if top_3 else 0
    rest = scores[3:] if len(scores) > 3 else []
    rest_avg = mean(rest) if rest else 0
    weighted = int(top_avg * 0.7 + rest_avg * 0.3)

    if weighted >= 80:
        label = "🔴 High Focus Day"
    elif weighted >= 55:
        label = "🟡 Moderate Focus Day"
    elif weighted >= 30:
        label = "🟢 Light Day"
    else:
        label = "✨ Clear Day"

    return weighted, label


class BriefingService:
    """Generates the daily briefing by running the triage pipeline."""

    def __init__(self, user_id: uuid.UUID) -> None:
        self.user_id = user_id

    async def _fetch_raw_items(self) -> list[dict[str, Any]]:
        """Fetch recent items from Qdrant for all active connectors."""
        factory = get_session_factory()
        async with factory() as session:
            stmt = select(Connector).where(
                Connector.user_id == self.user_id,
                Connector.status == ConnectorStatus.ACTIVE,
            )
            result = await session.execute(stmt)
            active_connectors = result.scalars().all()

        if not active_connectors:
            return []

        # Embed a broad query to retrieve recent items
        embedder = _get_briefing_embedder()
        query_vector = embedder.encode(
            "recent important items emails pull requests issues tasks"
        ).tolist()

        results = await semantic_search(
            user_id=self.user_id,
            query_vector=query_vector,
            limit=20,
            score_threshold=0.0,
        )

        items = []
        for r in results:
            payload = r.get("payload", {})
            item_type = payload.get("type", "document")
            # Normalise type to match BriefingItem schema
            item_type = (
                item_type
                if item_type in ("email", "pr", "issue", "calendar", "document", "task")
                else "document"
            )
            text_chunk = payload.get("text_chunk", "")
            title = text_chunk[:80] if text_chunk else "Untitled"
            items.append(
                {
                    "id": r["id"],
                    "type": item_type,
                    "title": title,
                    "sender": payload.get("sender_email", payload.get("author", "")),
                    "preview": text_chunk[:200],
                    "source": _source_label(payload.get("type", "document")),
                    "timestamp": payload.get("timestamp", datetime.now(UTC).isoformat()),
                }
            )
        return items

    async def generate_briefing(self) -> DailyBriefingResponse:
        """Run the full triage pipeline and return a structured daily briefing."""
        raw_items = await self._fetch_raw_items()

        # Run triage via the Atlas pipeline
        triage_state = await run_atlas_pipeline(
            user_input="Generate triage scores for today's inbox items",
            user_id=self.user_id,
            extra_state={"items_to_triage": raw_items, "intent": "triage"},
        )

        triage_scores: list[dict[str, Any]] = triage_state.get("triage_scores", [])
        score_map = {s["item_id"]: s for s in triage_scores}

        # Build BriefingItems
        briefing_items = []
        for raw in raw_items:
            score_data = score_map.get(raw["id"], {})
            item = BriefingItem(
                id=raw["id"],
                type=raw["type"],
                title=raw["title"],
                summary=score_data.get("rationale", raw["preview"][:100]),
                source=raw["source"],
                priority_score=score_data.get("priority_score", 50),
                action_label=score_data.get("recommended_action"),
                metadata={"sender": raw.get("sender", "")},
                timestamp=datetime.fromisoformat(raw["timestamp"]),
            )
            briefing_items.append(item)

        # Sort by priority score descending
        briefing_items.sort(key=lambda x: x.priority_score, reverse=True)
        focus_score, focus_label = _compute_focus_score(briefing_items)

        logger.info(
            "Daily briefing generated",
            items=len(briefing_items),
            focus_score=focus_score,
            user_id=str(self.user_id),
        )

        return DailyBriefingResponse(
            date=datetime.now(UTC),
            focus_score=focus_score,
            focus_score_label=focus_label,
            items=briefing_items,
            total_unread=len(briefing_items),
            generated_at=datetime.now(UTC),
        )
