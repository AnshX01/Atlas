# ADR-001: Use Neo4j for the Atlas Knowledge Graph

**Status**: Accepted  
**Date**: 2026-08-05  
**Deciders**: Atlas Engineering  
**Category**: Data Storage

---

## Context and Problem Statement

Atlas must store and traverse relationships between entities in a user's digital workspace — e.g., _[Person: Sarah] → WROTE → [Document: Q3 Spec] → BELONGS_TO → [Project: Atlas]_. We need to answer questions like "What did Sarah write related to our investor deck?" by traversing multi-hop graph paths efficiently, which is fundamentally a graph query problem, not a relational one.

## Considered Options

| Option | Pros | Cons |
|--------|------|------|
| **Neo4j** (Graph DB) | Native Cypher traversals, APOC plugin ecosystem, mature driver | Additional service to operate, licensing considerations |
| **PostgreSQL with recursive CTEs** | No new service, familiar | Multi-hop traversals become complex SQL; poor developer ergonomics |
| **Amazon Neptune** | Managed, scalable | Vendor lock-in; poor local dev story; costly |
| **DGraph / ArangoDB** | GraphQL native, open-source | Smaller community; less mature LangChain integration |

## Decision Outcome

**Chosen option: Neo4j 5 Community Edition** — for these reasons:

1. **Cypher is expressive**: Multi-hop relationship queries like `MATCH (p:Person)-[:WROTE|:MENTIONED]->(d:Document)-[:BELONGS_TO]->(proj:Project)` are a single declarative line vs. recursive SQL.

2. **LangChain native**: `langchain-community` ships a `Neo4jGraph` wrapper that directly feeds Cypher results into the RAG pipeline as structured context.

3. **Local dev parity**: Neo4j Community runs in Docker with no license cost. The enterprise features we may need (clustering, advanced security) only become relevant in Phase 3 (Enterprise tier).

4. **APOC plugin**: The APOC library provides full-text search indexes (`db.index.fulltext.*`) enabling the hybrid vector + graph retrieval from Section 6.2 without a separate search service.

## Implementation Notes

- All graph nodes carry a `user_id` property. **Every Cypher query MUST include `WHERE n.user_id = $user_id`** to enforce multi-tenant RBAC isolation.
- Constraints and indexes are created at startup via `initialize_schema_constraints()` in [`neo4j_client.py`](../../backend/app/infrastructure/neo4j_client.py).
- Node types (Section 5.2): `User`, `Document`, `Message`, `Person`, `Project`, `Task`, `Meeting`.
- Edge types: `WROTE`, `MENTIONS`, `ATTENDED`, `BLOCKS`, `BELONGS_TO`, `REPLIED_TO`.

## Consequences

- **Positive**: Relationship queries are highly performant (O(relationship depth), not O(table size)).
- **Positive**: The schema is schema-flexible — new node types can be added without migrations.
- **Negative**: Operators must learn Cypher query language. Addressed by providing query examples in the developer guide.
- **Negative**: One additional container in Docker Compose. Addressed by the health-check dependency chain.

## Review Trigger

Revisit this decision if: (a) graph traversals consistently exceed 50ms at > 100k nodes, or (b) we require ACID distributed transactions across graph + relational data.
