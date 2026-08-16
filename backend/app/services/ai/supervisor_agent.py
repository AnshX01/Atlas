"""
Atlas — LangGraph Supervisor Agent.

Routes incoming requests to specialized sub-agents:
  - TriageAgent:      Priority scoring of messages/PRs
  - SynthesizerAgent: RAG-based question answering
  - ActionAgent:      Autonomous action execution

Graph State:
    input          The user's query or system trigger
    user_id        For RBAC — all agents must pass this through
    intent         Classified by the supervisor (triage | search | action)
    context        Retrieved context from RAG
    result         Final output from the terminal node
    citations      Source IDs from RAG pipeline
    error          Any error encountered during processing
"""

from __future__ import annotations

import uuid
from typing import Any, Literal, TypedDict

from app.core.config import get_settings
from app.core.logging import get_logger
from app.services.ai.action_agent import ActionAgent
from app.services.ai.synthesizer_agent import SynthesizerAgent
from app.services.ai.triage_agent import TriageAgent
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.graph import END, StateGraph

logger = get_logger(__name__)


# ── Graph State Schema ─────────────────────────────────────────────────────────
class AtlasState(TypedDict, total=False):
    """Shared state propagated through the LangGraph pipeline."""

    input: str
    user_id: str
    intent: Literal["triage", "search", "action", "unknown"]
    context: list[dict[str, Any]]
    result: dict[str, Any]
    citations: list[str]
    error: str | None
    # Triage-specific
    items_to_triage: list[dict[str, Any]]
    triage_scores: list[dict[str, Any]]
    # Action-specific
    action_type: str
    action_parameters: dict[str, Any]


# ── Supervisor Node ────────────────────────────────────────────────────────────
async def supervisor_node(state: AtlasState) -> AtlasState:
    """
    Classify intent and route to the appropriate sub-agent.
    Uses temperature=0 for deterministic routing.

    If a valid intent is already set in the state (e.g., pre-classified by
    the omni_search endpoint or briefing service), the LLM call is skipped
    to save latency and avoid misrouting.
    """
    valid_intents = {"triage", "search", "action"}

    # Skip LLM classification if intent is already pre-classified
    existing_intent = state.get("intent")
    if existing_intent in valid_intents:
        logger.info(
            "Supervisor skipping classification — intent pre-set",
            intent=existing_intent,
            user_id=state.get("user_id"),
        )
        return state

    settings = get_settings()

    llm = ChatOpenAI(
        model=settings.OPENAI_MODEL,
        temperature=0.0,
        api_key=settings.OPENAI_API_KEY,
        timeout=30.0,
        max_retries=2,
    )

    system_prompt = """You are the Atlas Supervisor. Classify the user's request into exactly one intent:
- "triage": User wants to prioritize or score incoming items (emails, PRs, issues).
- "search": User wants to find information across their connected sources.
- "action": User wants to execute an action (draft email, merge PR, create event).
- "unknown": Cannot be classified.

Respond with ONLY the intent label. No explanation."""

    response = await llm.ainvoke(
        [
            SystemMessage(content=system_prompt),
            HumanMessage(content=state.get("input", "")),
        ]
    )

    intent_raw = response.content.strip().lower()
    intent = intent_raw if intent_raw in valid_intents else "unknown"

    logger.info("Supervisor routed request", intent=intent, user_id=state.get("user_id"))
    return {**state, "intent": intent}  # type: ignore[return-value]


def _route_intent(state: AtlasState) -> Literal["triage", "synthesizer", "action", "end"]:
    """Conditional edge: map intent to next node."""
    intent = state.get("intent", "unknown")
    mapping = {
        "triage": "triage",
        "search": "synthesizer",
        "action": "action",
    }
    return mapping.get(intent, "end")  # type: ignore[return-value]


# ── Graph Builder ──────────────────────────────────────────────────────────────
def build_supervisor_graph() -> Any:
    """
    Build and compile the Atlas LangGraph state machine.

    Flow:
        supervisor → [triage | synthesizer | action | END]
    """
    triage_agent = TriageAgent()
    synthesizer_agent = SynthesizerAgent()
    action_agent = ActionAgent()

    graph = StateGraph(AtlasState)

    # Add nodes
    graph.add_node("supervisor", supervisor_node)
    graph.add_node("triage", triage_agent.run)
    graph.add_node("synthesizer", synthesizer_agent.run)
    graph.add_node("action", action_agent.run)

    # Entry point
    graph.set_entry_point("supervisor")

    # Conditional routing from supervisor
    graph.add_conditional_edges(
        "supervisor",
        _route_intent,
        {
            "triage": "triage",
            "synthesizer": "synthesizer",
            "action": "action",
            "end": END,
        },
    )

    # Terminal edges — all sub-agents end the graph
    graph.add_edge("triage", END)
    graph.add_edge("synthesizer", END)
    graph.add_edge("action", END)

    return graph.compile()


# ── Public Interface ───────────────────────────────────────────────────────────
_compiled_graph = None


def get_supervisor_graph() -> Any:
    """Return the compiled supervisor graph (singleton)."""
    global _compiled_graph
    if _compiled_graph is None:
        _compiled_graph = build_supervisor_graph()
    return _compiled_graph


async def run_atlas_pipeline(
    user_input: str,
    user_id: uuid.UUID,
    extra_state: dict[str, Any] | None = None,
) -> AtlasState:
    """
    Execute the full Atlas AI pipeline.

    Args:
        user_input: The user's query or system-generated trigger text.
        user_id: RBAC — passed through to all agents.
        extra_state: Additional initial state (e.g., items_to_triage).

    Returns:
        Final AtlasState with result, citations, and any errors.
    """
    graph = get_supervisor_graph()

    initial_state: AtlasState = {
        "input": user_input,
        "user_id": str(user_id),
        "intent": "unknown",
        "context": [],
        "citations": [],
        "error": None,
        **(extra_state or {}),
    }

    try:
        final_state = await graph.ainvoke(initial_state)
        return final_state
    except Exception as exc:
        logger.error("Atlas pipeline failed", error=str(exc), user_id=str(user_id))
        return {**initial_state, "error": str(exc)}
