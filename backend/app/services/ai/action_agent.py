"""
Atlas — Action Agent.

Constructs and executes strict JSON payloads for autonomous actions.
Uses Pydantic structured outputs to prevent raw text leakage.
Supported actions (Phase 1): draft_email, search_and_summarize
Planned (Phase 2): reply_email, merge_pr, close_issue, create_calendar_event
"""

from __future__ import annotations

from typing import Any, Literal

from app.core.config import get_settings
from app.core.logging import get_logger
from app.domain.interfaces.base_connector import BaseAgent
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

logger = get_logger(__name__)


class DraftEmailPayload(BaseModel):
    """Structured payload for drafting an email."""

    to: list[str] = Field(description="Recipient email addresses")
    subject: str = Field(max_length=200)
    body: str = Field(description="Email body in plain text. Professional tone.")
    tone: Literal["formal", "friendly", "concise"] = "professional"  # type: ignore[assignment]


class ActionOutput(BaseModel):
    """Validated action execution result."""

    success: bool
    action_type: str
    payload: dict[str, Any] = Field(default_factory=dict)
    message: str
    requires_confirmation: bool = Field(
        default=True,
        description="Actions requiring irreversible effects should always require user confirmation.",
    )


ACTION_SYSTEM_PROMPT = """You are the Atlas Action Agent. You construct precise, validated action payloads.

Rules:
1. NEVER execute destructive actions (delete, merge, send) without requires_confirmation=true.
2. Use temperature=0 for deterministic output.
3. Return ONLY the JSON schema — no prose.
4. If parameters are insufficient, return success=false and explain what is needed.
5. Emails must be professional unless explicitly asked otherwise.
"""


class ActionAgent(BaseAgent):
    """Constructs and executes autonomous actions."""

    async def run(self, state: dict[str, Any]) -> dict[str, Any]:
        """Execute the requested action from state."""
        action_type = state.get("action_type", "")
        parameters = state.get("action_parameters", {})

        if not action_type:
            return {
                **state,
                "result": {
                    "success": False,
                    "message": "No action_type specified in state",
                },
            }

        settings = get_settings()
        llm = ChatOpenAI(
            model=settings.OPENAI_MODEL,
            temperature=0.0,
            api_key=settings.OPENAI_API_KEY,
        ).with_structured_output(ActionOutput)

        prompt = f"""Execute this action:
Action Type: {action_type}
Parameters: {parameters}
Context from user query: {state.get("input", "")}

Construct the appropriate payload and return an ActionOutput."""

        try:
            output: ActionOutput = await llm.ainvoke(
                [
                    SystemMessage(content=ACTION_SYSTEM_PROMPT),
                    HumanMessage(content=prompt),
                ]
            )

            logger.info(
                "Action constructed",
                action_type=action_type,
                success=output.success,
                requires_confirmation=output.requires_confirmation,
                user_id=state.get("user_id"),
            )

            return {
                **state,
                "result": output.model_dump(),
            }

        except Exception as exc:
            logger.error("ActionAgent failed", error=str(exc), action_type=action_type)
            return {
                **state,
                "result": {
                    "success": False,
                    "action_type": action_type,
                    "message": f"Action failed: {exc}",
                    "requires_confirmation": False,
                },
                "error": str(exc),
            }
