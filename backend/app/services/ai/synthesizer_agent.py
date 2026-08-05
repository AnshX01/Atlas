"""
Atlas — Synthesizer Agent (RAG Pipeline).

Implements strict RAG per Section 6.2:
  1. Query Rewriting
  2. Hybrid Retrieval (Vector + Cypher Graph)
  3. Cross-encoder Reranking
  4. Citation-enforced Generation (Temperature=0)
"""
from __future__ import annotations

import uuid
from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field
from sentence_transformers import CrossEncoder, SentenceTransformer

from app.core.config import get_settings
from app.core.logging import get_logger
from app.domain.interfaces.base_connector import BaseAgent
from app.infrastructure import neo4j_client, qdrant_client as qc

logger = get_logger(__name__)

# ── Embedding Model (local, no API cost) ──────────────────────────────────────
_embedder: SentenceTransformer | None = None
_reranker: CrossEncoder | None = None


def get_embedder() -> SentenceTransformer:
    global _embedder
    if _embedder is None:
        _embedder = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
    return _embedder


def get_reranker() -> CrossEncoder:
    global _reranker
    if _reranker is None:
        _reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
    return _reranker


class RAGOutput(BaseModel):
    """Structured RAG response with mandatory citations."""

    answer: str = Field(description="The synthesized answer to the user's query.")
    citations: list[str] = Field(
        description="List of source_ids from retrieved context. Every factual claim must cite a source."
    )
    confidence: float = Field(ge=0.0, le=1.0, description="Confidence score 0-1.")
    cannot_answer: bool = Field(
        default=False,
        description="True if the retrieved context is insufficient to answer the query.",
    )


SYNTHESIS_SYSTEM_PROMPT = """You are Atlas Synthesizer, an AI assistant that answers questions STRICTLY from provided context.

Rules (MANDATORY):
1. Every factual claim MUST be followed by [source_id] citation.
2. If the context does not contain the answer, set cannot_answer=true and explain what is missing.
3. NEVER invent information not present in the context.
4. Temperature is 0 — be precise and deterministic.
5. If multiple sources agree, cite all of them.
"""


class SynthesizerAgent(BaseAgent):
    """
    Hybrid RAG agent: vector search + graph traversal + reranking + citation generation.
    """

    async def _rewrite_query(self, query: str) -> list[str]:
        """Expand the user's query into multiple search-optimized variants."""
        settings = get_settings()
        llm = ChatOpenAI(model=settings.OPENAI_MODEL, temperature=0.0, api_key=settings.OPENAI_API_KEY)

        prompt = f"""Rewrite the following query into 3 search-optimized variants for a semantic search engine.
Return ONLY a JSON array of 3 strings. No explanation.

Query: {query}"""

        response = await llm.ainvoke([HumanMessage(content=prompt)])
        import json
        try:
            variants = json.loads(response.content.strip())
            if isinstance(variants, list):
                return [query] + variants[:3]
        except Exception:
            pass
        return [query]

    async def _vector_search(
        self, user_id: str, queries: list[str], limit: int = 15
    ) -> list[dict[str, Any]]:
        """Run vector search for each query variant and deduplicate by id."""
        embedder = get_embedder()
        all_results: dict[str, dict[str, Any]] = {}

        for query in queries:
            vector = embedder.encode(query).tolist()
            results = await qc.semantic_search(
                user_id=uuid.UUID(user_id),
                query_vector=vector,
                limit=limit,
            )
            for r in results:
                if r["id"] not in all_results or r["score"] > all_results[r["id"]]["score"]:
                    all_results[r["id"]] = r

        return list(all_results.values())

    async def _graph_search(self, user_id: str, query: str) -> list[dict[str, Any]]:
        """
        Run a Cypher traversal to find related graph nodes.
        Currently searches Message and Document nodes.
        """
        cypher = """
        MATCH (u:User {id: $user_id})
        CALL db.index.fulltext.queryNodes("content_index", $query) YIELD node, score
        WHERE (u)-[:OWNS]->(node)
        RETURN node.id AS id, node.content AS content, node.type AS type, score
        LIMIT 10
        """
        try:
            rows = await neo4j_client.run_cypher(cypher, {"user_id": user_id, "query": query})
            return [
                {
                    "id": r["id"],
                    "score": r["score"] / 10.0,  # normalize Neo4j scores to 0-1
                    "payload": {"type": r["type"], "text_chunk": r["content"]},
                }
                for r in rows
            ]
        except Exception as e:
            logger.warning("Graph search failed", error=str(e))
            return []

    def _rerank(
        self, query: str, candidates: list[dict[str, Any]], top_k: int = 5
    ) -> list[dict[str, Any]]:
        """Apply cross-encoder reranking to select the most relevant contexts."""
        if not candidates:
            return []

        reranker = get_reranker()
        texts = [c.get("payload", {}).get("text_chunk", "") for c in candidates]
        pairs = [(query, t) for t in texts if t]

        if not pairs:
            return candidates[:top_k]

        scores = reranker.predict(pairs)
        scored = sorted(zip(candidates, scores), key=lambda x: x[1], reverse=True)
        return [item for item, _ in scored[:top_k]]

    async def run(self, state: dict[str, Any]) -> dict[str, Any]:
        """Execute the full RAG pipeline."""
        query = state.get("input", "")
        user_id = state.get("user_id", "")

        if not query or not user_id:
            return {**state, "error": "Missing query or user_id for RAG pipeline"}

        # 1. Query rewriting
        queries = await self._rewrite_query(query)
        logger.info("Query rewritten", original=query, variants=queries)

        # 2. Hybrid retrieval
        vector_results = await self._vector_search(user_id, queries)
        graph_results = await self._graph_search(user_id, queries[0])

        # Merge and deduplicate
        all_candidates: dict[str, dict[str, Any]] = {}
        for r in vector_results + graph_results:
            rid = r.get("id", "")
            if rid not in all_candidates or r["score"] > all_candidates[rid]["score"]:
                all_candidates[rid] = r

        # 3. Reranking
        reranked = self._rerank(query, list(all_candidates.values()), top_k=5)

        # Build context string for the LLM
        context_blocks = []
        for item in reranked:
            payload = item.get("payload", {})
            context_blocks.append(
                f"[{item['id']}] ({payload.get('type', 'unknown')}): "
                f"{payload.get('text_chunk', '')[:500]}"
            )
        context_text = "\n\n".join(context_blocks)

        # 4. Generation with citations
        settings = get_settings()
        llm = ChatOpenAI(
            model=settings.OPENAI_MODEL,
            temperature=0.0,
            api_key=settings.OPENAI_API_KEY,
        ).with_structured_output(RAGOutput)

        try:
            output: RAGOutput = await llm.ainvoke(
                [
                    SystemMessage(content=SYNTHESIS_SYSTEM_PROMPT),
                    HumanMessage(
                        content=f"Context:\n{context_text}\n\nUser Question: {query}"
                    ),
                ]
            )

            result = {
                "answer": output.answer,
                "confidence": output.confidence,
                "cannot_answer": output.cannot_answer,
            }

            logger.info(
                "RAG synthesis complete",
                citations=len(output.citations),
                confidence=output.confidence,
                user_id=user_id,
            )

            return {
                **state,
                "context": reranked,
                "result": result,
                "citations": output.citations,
            }
        except Exception as exc:
            logger.error("SynthesizerAgent failed", error=str(exc))
            return {**state, "error": str(exc)}
