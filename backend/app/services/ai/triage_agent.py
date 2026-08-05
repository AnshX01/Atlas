"""
Atlas — Triage Agent.

Scores incoming items (emails, PRs, issues) from 1-100.
Uses temperature=0 and Pydantic structured outputs to prevent hallucination.
"""

from __future__ import annotations

from typing import Any

from app.core.config import get_settings
from app.core.logging import get_logger
from app.domain.interfaces.base_connector import BaseAgent
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

logger = get_logger(__name__)


class TriageScore(BaseModel):
    """Structured output for a single triage score."""

    item_id: str
    priority_score: int = Field(ge=1, le=100, description="Priority 1 (lowest) to 100 (highest)")
    rationale: str = Field(max_length=200)
    recommended_action: str = Field(max_length=100)
    urgency_label: str  # e.g., "URGENT", "HIGH", "MEDIUM", "LOW"


class TriageOutput(BaseModel):
    """Structured output for batch triage."""

    scores: list[TriageScore]


TRIAGE_SYSTEM_PROMPT = """You are the Atlas Triage Agent. Your job is to assign priority scores (1-100) to knowledge-worker items.

Scoring rubric:
  90-100: URGENT — Financial, legal, security, or investor communication. Act today.
  70-89:  HIGH   — Direct ask from manager/founder/VIP, PR blocking team, deadline < 24h.
  40-69:  MEDIUM — Standard PR review, routine meeting, non-critical update.
  1-39:   LOW    — FYI emails, newsletters, non-blocking notifications.

Rules:
  - Temperature 0: Be deterministic and consistent.
  - Return ONLY valid JSON matching the TriageOutput schema.
  - Never hallucinate senders, deadlines, or context not present in the input.
  - Each item MUST have a recommended_action (e.g., "Reply now", "Review PR", "Defer to Friday").
"""


class TriageAgent(BaseAgent):
    """Priority scoring agent for inbox items."""

    async def run(self, state: dict[str, Any]) -> dict[str, Any]:
        """
        Score all items in state["items_to_triage"].

        Returns state with "triage_scores" populated.
        """
        items = state.get("items_to_triage", [])
        if not items:
            logger.warning("TriageAgent called with no items")
            return {**state, "triage_scores": []}

        settings = get_settings()
        llm = ChatOpenAI(
            model=settings.OPENAI_MODEL,
            temperature=0.0,
            api_key=settings.OPENAI_API_KEY,
        ).with_structured_output(TriageOutput)

        items_text = "\n\n".join(
            f"[{i['id']}] {i.get('type', 'item').upper()}: {i.get('title', '')}\n"
            f"From: {i.get('sender', 'Unknown')}\n"
            f"Preview: {i.get('preview', '')[:200]}"
            for i in items
        )

        try:
            output: TriageOutput = await llm.ainvoke(
                [
                    SystemMessage(content=TRIAGE_SYSTEM_PROMPT),
                    HumanMessage(content=f"Score these items:\n\n{items_text}"),
                ]
            )
            scores = [s.model_dump() for s in output.scores]
            logger.info("Triage complete", item_count=len(scores), user_id=state.get("user_id"))
            return {**state, "triage_scores": scores}
        except Exception as exc:
            logger.error("TriageAgent failed", error=str(exc))
            return {**state, "triage_scores": [], "error": str(exc)}
