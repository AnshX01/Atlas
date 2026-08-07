"""
Atlas — Daily Briefing Service.

Aggregates triage results from all connectors into the daily briefing.
Generates Focus Score and sorted list of prioritized BriefingItems.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
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
        return 0, "✨ Clear Day"

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

    def _fallback_priority_score(self, raw_item: dict) -> int:
        """Assign a heuristic priority score when the AI agent is unavailable."""
        item_type = raw_item.get("type", "document")
        base_scores = {
            "email": 60,      # Communications need attention
            "calendar": 75,   # Meetings are time-sensitive
            "pr": 70,         # PRs often block teammates
            "issue": 55,      # Issues need review
            "task": 65,       # Tasks have deadlines
            "document": 30,   # Documents are reference material
        }
        score = base_scores.get(item_type, 40)

        # Boost for recent items (within last 4 hours)
        timestamp = raw_item.get("timestamp", "")
        if timestamp:
            try:
                item_time = datetime.fromisoformat(timestamp)
                hours_ago = (datetime.now(UTC) - item_time).total_seconds() / 3600
                if hours_ago < 4:
                    score += 15
                elif hours_ago < 12:
                    score += 8
            except (ValueError, TypeError):
                pass

        # Extra boost for today's calendar events
        if item_type == 'calendar' and timestamp:
            try:
                item_time = datetime.fromisoformat(timestamp)
                if item_time.date() == datetime.now(UTC).date():
                    score += 20  # Today's meetings are high priority
            except (ValueError, TypeError):
                pass

        # Boost emails from people (not automated/noreply)
        sender = raw_item.get("sender", "")
        if sender and "noreply" not in sender.lower() and "no-reply" not in sender.lower():
            score += 5

        return min(score, 100)

    def _generate_fallback_rationale(self, raw_item: dict) -> str:
        """Generate a human-readable rationale when AI triage is unavailable."""
        item_type = raw_item.get("type", "document")
        sender = raw_item.get("sender", "")
        title = raw_item.get("title", "")

        if item_type == "email" and sender:
            return f"Email from {sender}: {title[:60]}"
        elif item_type == "pr":
            return f"Pull request needs review: {title[:60]}"
        elif item_type == "issue":
            return f"Issue assigned or updated: {title[:60]}"
        elif item_type == "calendar":
            return f"Upcoming meeting: {title[:60]}"
        elif item_type == "task":
            return f"Task requires attention: {title[:60]}"
        return raw_item.get("preview", "")[:100]

    def _suggest_action(self, raw_item: dict) -> str:
        """Suggest a default action based on item type."""
        item_type = raw_item.get("type", "document")
        actions = {
            "email": "Reply",
            "pr": "Review",
            "issue": "Triage",
            "calendar": "Prepare",
            "task": "Complete",
            "document": "Read",
        }
        return actions.get(item_type, "View")

    async def _fetch_raw_items(self) -> list[dict[str, Any]]:
        """Fetch today's actionable items from Qdrant across all connectors.

        The briefing only shows items that require action TODAY:
        - Calendar: only events happening today
        - Email: unread actionable emails from recent days
        - PR/Issue: open items assigned or relevant
        - Task: incomplete tasks (especially those due today)
        """
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

        embedder = _get_briefing_embedder()
        all_results: dict[str, dict[str, Any]] = {}

        # Query 1: Today's meetings and schedule
        today_str = datetime.now(UTC).strftime("%Y-%m-%d")
        calendar_vector = embedder.encode(
            f"meetings today {today_str} calendar events schedule calls"
        ).tolist()
        calendar_results = await semantic_search(
            user_id=self.user_id,
            query_vector=calendar_vector,
            limit=20,
            score_threshold=0.0,
            source_filter="calendar",
        )
        for r in calendar_results:
            all_results[r["id"]] = r

        # Query 2: Actionable items (emails, PRs, issues, tasks)
        action_vector = embedder.encode(
            "urgent emails requiring reply pull requests to review issues assigned tasks deadline"
        ).tolist()
        action_results = await semantic_search(
            user_id=self.user_id,
            query_vector=action_vector,
            limit=15,
            score_threshold=0.0,
        )
        for r in action_results:
            if r["id"] not in all_results:
                all_results[r["id"]] = r

        # Post-retrieval filtering: only keep TODAY's items
        today_date = datetime.now(UTC).date()
        tomorrow_date = today_date + timedelta(days=1)

        items = []
        for r in all_results.values():
            payload = r.get("payload", {})
            item_type = payload.get("type", "document")
            item_type = (
                item_type
                if item_type in ("email", "pr", "issue", "calendar", "document", "task")
                else "document"
            )

            timestamp_str = payload.get("timestamp", "")

            # Calendar events: ONLY show today's events
            if item_type == "calendar" and timestamp_str:
                try:
                    event_date = datetime.fromisoformat(
                        timestamp_str.replace("Z", "+00:00")
                    ).date()
                    if event_date != today_date and event_date != tomorrow_date:
                        continue  # Skip events not happening today/tomorrow
                except (ValueError, TypeError):
                    continue  # Skip if we can't parse the date

            # Skip birthday/anniversary items that slipped through
            text_chunk = payload.get("text_chunk", "")
            title = text_chunk[:80] if text_chunk else "Untitled"
            title_lower = title.lower()
            if any(kw in title_lower for kw in ("birthday", "anniversary", "happy birthday")):
                continue

            items.append(
                {
                    "id": r["id"],
                    "type": item_type,
                    "title": title,
                    "sender": payload.get("sender_email", payload.get("author", "")),
                    "preview": text_chunk[:200],
                    "source": _source_label(payload.get("type", "document")),
                    "timestamp": timestamp_str or datetime.now(UTC).isoformat(),
                    "metadata": {
                        "sender": payload.get("sender_email", payload.get("author", "")),
                        "sender_name": payload.get("sender_name", ""),
                        "source_id": payload.get("source_id", r["id"]),
                        "url": payload.get("url", ""),
                        "repo": payload.get("repo", ""),
                        "pr_number": payload.get("pr_number"),
                        "issue_number": payload.get("issue_number"),
                        "attendees": payload.get("attendees", []),
                        "subject": payload.get("subject", ""),
                    },
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

        # Build BriefingItems with fallback scoring when AI agent fails
        use_fallback = not triage_scores or len(triage_scores) == 0

        briefing_items = []
        for raw in raw_items:
            score_data = score_map.get(raw["id"], {})
            if use_fallback or not score_data:
                priority = self._fallback_priority_score(raw)
                rationale = self._generate_fallback_rationale(raw)
                action = self._suggest_action(raw)
            else:
                priority = score_data.get("priority_score", 50)
                rationale = score_data.get("rationale", raw["preview"][:100])
                action = score_data.get("recommended_action")

            item = BriefingItem(
                id=raw["id"],
                type=raw["type"],
                title=raw["title"],
                summary=rationale,
                source=raw["source"],
                priority_score=priority,
                action_label=action,
                metadata=raw.get("metadata", {"sender": raw.get("sender", "")}),
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
