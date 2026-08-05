# ADR-002: Hybrid RAG Pipeline (Vector + Graph + Cross-Encoder)

**Status**: Accepted  
**Date**: 2026-08-05  
**Deciders**: Atlas AI Engineering  
**Category**: AI Architecture

---

## Context and Problem Statement

Atlas needs to answer natural language questions like "What did Sarah say about the design?" by retrieving relevant content from a user's digital workspace spanning Gmail, GitHub, Notion, and local files. Pure vector search suffers from semantic drift for entity-specific queries (names, project codes). Pure keyword/graph search fails for paraphrasing. We need a retrieval strategy that is both **semantically rich** and **entity-aware**.

## Considered Options

| Option | Semantic | Entity-Aware | Latency |
|--------|----------|--------------|---------|
| Vector search only (Qdrant) | ✅ High | ❌ Low | < 50ms |
| Graph traversal only (Neo4j Cypher) | ❌ Low | ✅ High | < 30ms |
| **Hybrid: Vector + Graph + Reranker** | ✅ High | ✅ High | ~200ms |
| BM25 + Dense (Elasticsearch) | Medium | Medium | ~100ms |

## Decision Outcome

**Chosen option: Hybrid Retrieval with Cross-Encoder Reranking**

### Pipeline (Section 6.2)

```
User Query
    │
    ▼
┌─────────────────────────────┐
│  1. Query Rewriting (LLM)   │  "What did Sarah say about the design?"
│     → 3 search variants     │  → ["Sarah design spec", "Sarah UI wireframes", ...]
└─────────────┬───────────────┘
              │
    ┌─────────┴──────────┐
    ▼                    ▼
┌──────────┐        ┌──────────┐
│  Vector  │        │  Graph   │
│  Search  │        │  Search  │
│ (Qdrant) │        │ (Neo4j)  │
│ Cosine   │        │ Cypher   │
│ Sim ≥0.6 │        │ Entity   │
│ top-15   │        │ Lookup   │
└────┬─────┘        └────┬─────┘
     └──────┬────────────┘
            ▼
    ┌───────────────┐
    │  Merge &      │
    │  Deduplicate  │
    │  by source_id │
    └───────┬───────┘
            ▼
    ┌───────────────┐
    │  Cross-Encoder │
    │  Reranking    │  ms-marco-MiniLM-L-6-v2
    │  top-5        │
    └───────┬───────┘
            ▼
    ┌───────────────┐
    │  Generation   │  Temperature=0, Citations enforced
    │  (OpenAI/     │  via Pydantic structured output
    │   Ollama)     │
    └───────────────┘
```

## Hallucination Prevention Strategy

Per Section 6.3:
1. **Temperature = 0.0** on all extraction, summarization, and action construction calls.
2. **Pydantic structured output** (`.with_structured_output(Schema)`) prevents raw text leakage.
3. **Citation enforcement**: The `RAGOutput` schema requires `citations: list[str]` to be populated with `source_id` values from retrieved context. The system prompt instructs: _"You must append [source_id] to every factual claim."_
4. **`cannot_answer` flag**: If retrieved context is insufficient, the model sets `cannot_answer=True` instead of generating plausible-sounding but unfounded claims.

## Embedding Model Choice

- **Model**: `sentence-transformers/all-MiniLM-L6-v2` (384-dim)
- **Rationale**: Runs locally with no API cost; fast (CPU: ~5ms/chunk); sufficient accuracy for knowledge-worker content; compatible with Qdrant's default index.
- **Distance metric**: Cosine Similarity (Section 5.3).
- **Reranker**: `cross-encoder/ms-marco-MiniLM-L-6-v2` — higher accuracy than bi-encoder alone, small enough to run on CPU.

## Consequences

- **Positive**: Handles both "Sarah" (entity → graph) and "design feedback" (semantic → vector) in a single query.
- **Positive**: Reranking dramatically reduces top-k noise from 15 → 5 candidates.
- **Negative**: Two inference passes (embedding + reranker) add ~50ms latency. Acceptable given the 2.5s streaming target.
- **Negative**: Requires both Qdrant and Neo4j running. Mitigated by Docker Compose health checks.

## Review Trigger

Revisit if: (a) query latency consistently exceeds 500ms under load, or (b) Ragas context precision drops below 0.85 in CI evaluation.
