# Design Document

## Overview

Atlas Phase 2 wires all `# TODO` stubs into working implementations. No new architectural patterns are introduced — every change follows the patterns already established in Phase 1. The six major areas are: text chunking utility, embedding pipeline per connector, Neo4j graph population, OAuth callback wiring, WebSocket JWT auth, live briefing data, frontend API integration, and connector management endpoints.

---

## Architecture

The existing architecture is unchanged. Phase 2 fills in the data flow paths that were scaffolded but empty:

```
User Action
    │
    ├─► OAuth Flow ──► Connector.authenticate() ──► Encrypted token in PostgreSQL
    │
    ├─► Celery Beat (15min) or manual trigger
    │       │
    │       ▼
    │   sync_connector_job
    │       ├─► Connector.sync() ──► provider API
    │       │       ├─► batch_embed_chunks.delay() ──► Qdrant (vectors)
    │       │       └─► neo4j upsert helpers ──────► Neo4j (graph nodes)
    │       └─► SyncLog updated + Redis event published
    │
    ├─► GET /v1/briefing/daily
    │       └─► BriefingService ──► Qdrant semantic_search ──► TriageAgent ──► response
    │
    └─► WebSocket /ws/{user_id}?token=<jwt>
            └─► JWT validated ──► Redis Pub/Sub relay ──► Electron client
```

---

## Components and Interfaces

### 1. `app/services/chunker.py` (NEW)

```python
def chunk_text(text: str, max_tokens: int = 500, overlap: int = 50) -> list[str]:
    """Split text into overlapping token-window chunks. Whitespace = token boundary."""
```

Used by `LocalFSConnector._index_existing_files()` and `watch()`.

### 2. Neo4j Upsert Helpers (added to `app/infrastructure/neo4j_client.py`)

Five new async functions, each wrapping a Cypher `MERGE` pattern:

| Function | Node Label | Key Properties |
|----------|-----------|----------------|
| `upsert_pr_node` | `:PR` | `id`, `user_id`, `title`, `url`, `state`, `repo`, `author` |
| `upsert_task_node` | `:Task` | `id`, `user_id`, `title`, `url`, `state`, `repo`, `assignee` |
| `upsert_message_node` | `:Message` + `:Person` | `id`, `user_id`, `subject`, `sender_email` |
| `upsert_meeting_node` | `:Meeting` + `:Person` (attendees) | `id`, `user_id`, `title`, `start_time`, `end_time` |
| `upsert_document_node` | `:Document` | `id`=`file_path`, `user_id`, `file_type`, `last_modified` |

All use `MERGE (u:User {id: $user_id})` to anchor the user node and `MERGE (node {id: $id, user_id: $user_id})` for item nodes. All wrapped in try/except — log warning on failure, never raise.

### 3. Connector Embedding Integration

Each connector's sync method builds a `chunks: list[dict]` and dispatches `batch_embed_chunks.delay(str(user_id), chunks)`. The chunk dict schema:

```python
{
    "id": str(uuid.uuid4()),       # unique point ID for Qdrant
    "source_id": str,              # stable ID for tombstoning (file path, API item ID)
    "type": str,                   # "pr" | "issue" | "email" | "calendar" | "file"
    "text": str,                   # text to embed
    "timestamp": str,              # ISO datetime
    "metadata": dict               # type-specific fields stored as Qdrant payload
}
```

### 4. OAuth Initiate + Callback (updated `app/api/v1/auth.py`)

New endpoints:
- `GET /v1/auth/oauth/google/initiate` — authenticated, returns `{"auth_url": str}`
- `GET /v1/auth/oauth/github/initiate` — authenticated, returns `{"auth_url": str}`

Updated endpoints:
- `GET /v1/auth/oauth/google/callback` — unauthenticated (redirect target), wires to `GoogleWorkspaceConnector.authenticate(code)`
- `GET /v1/auth/oauth/github/callback` — unauthenticated, wires to `GitHubConnector.authenticate(code)`

State token: short-lived JWT (10 min) with `{"sub": user_id, "purpose": "oauth_state"}`.

Helper: `_get_or_create_connector(session, user_id, provider)` — SELECT then INSERT if not found.

### 5. WebSocket JWT Auth (updated `app/main.py`)

```python
@app.websocket("/ws/{user_id}")
async def sync_events_websocket(websocket: WebSocket, user_id: str, token: str = Query(default="")):
    try:
        payload = decode_token(token)
        if payload.get("sub") != user_id:
            raise ValueError("user_id mismatch")
    except Exception:
        await websocket.close(code=4001)
        return
    await websocket.accept()
    # ... existing relay logic unchanged
```

### 6. Live Briefing (`app/services/briefing_service.py`)

`_fetch_raw_items()` rewritten:
1. Query active connectors from PostgreSQL
2. If none: return `[]`
3. Embed broad query vector
4. `semantic_search(user_id, vector, limit=20, score_threshold=0.0)`
5. Map Qdrant payloads → raw item dicts

### 7. Connector Management Endpoints (updated `app/api/v1/__init__.py`)

```
GET  /v1/connectors        → list[ConnectorResponse]
POST /v1/connectors        → ConnectorResponse
```

New schema `ConnectorCreateRequest` added to `domain/schemas/__init__.py`.

### 8. Frontend API Layer (`frontend/src/lib/`)

```
lib/
├── api/
│   ├── client.ts       ← Axios instance + interceptors
│   ├── auth.ts         ← login, register, refreshToken, getMe
│   ├── briefing.ts     ← getDaily (updated)
│   ├── search.ts       ← omniSearch
│   └── connectors.ts   ← listConnectors, createConnector, triggerSync, initiateOAuth
├── store/
│   ├── useAuthStore.ts      ← token, user, setTokens, logout
│   ├── useWebSocketStore.ts ← syncEvents[], dispatch
│   ├── useBriefingStore.ts  ← (existing, verify)
│   └── useAppStore.ts       ← (existing)
└── hooks/
    └── useWebSocket.ts ← WS lifecycle hook
```

New pages:
- `frontend/src/app/login/page.tsx` — login/register form
- `frontend/src/components/ui/Toast.tsx` — OAuth feedback

---

## Data Models

### Chunk dict (runtime, not persisted)

```typescript
interface Chunk {
  id: string;        // UUID string
  source_id: string; // stable source identifier for tombstoning
  type: "pr" | "issue" | "email" | "calendar" | "file" | "document";
  text: string;      // content to embed
  timestamp: string; // ISO 8601
  metadata: Record<string, unknown>;
}
```

### Qdrant payload (stored per vector point)

```python
{
    "source_id": str,
    "type": str,
    "timestamp": str,
    "text_chunk": str,     # truncated to 2000 chars (existing limit in batch_embed_chunks)
    "user_id": str,        # always present for RBAC filter
    # type-specific fields from metadata
}
```

### Neo4j node properties (all include `user_id` for RBAC)

| Node | Properties |
|------|-----------|
| `:PR` | `id`, `user_id`, `title`, `url`, `state`, `repo`, `author`, `updated_at` |
| `:Task` | `id`, `user_id`, `title`, `url`, `state`, `repo`, `assignee`, `updated_at` |
| `:Message` | `id`, `user_id`, `subject`, `sender_email`, `timestamp` |
| `:Meeting` | `id`, `user_id`, `title`, `start_time`, `end_time` |
| `:Document` | `id`=`file_path`, `user_id`, `file_path`, `file_type`, `last_modified` |
| `:Person` | `email`, `display_name` |

### Auth store (frontend localStorage)

```
atlas_access_token  → JWT string
atlas_refresh_token → JWT string
atlas_user_id       → UUID string
```

---

## Correctness Properties

### Property 1: RBAC Isolation
Every Qdrant search and Neo4j query includes a `user_id` filter. No user can see another user's data. Verified by: integration test asserting that user A cannot retrieve user B's briefing items.

**Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 2.6, 5.5**

### Property 2: Tombstone Completeness
When a local file is deleted, `delete_by_source_id` is called in `watch()` before yielding the event. Deleted file content never appears in future search results. Verified by: unit test mocking `delete_by_source_id` and asserting it is called with the correct source_id on file deletion.

**Validates: Requirements 1.6**

### Property 3: Token Encryption Round-Trip
OAuth tokens are always passed through `encrypt_token()` before storage and `decrypt_token()` before use. Plaintext tokens never appear in the database. Verified by: `test_encrypt_decrypt_round_trip` and `test_decrypt_tampered_raises`.

**Validates: Requirements 3.6, 8.4**

### Property 4: WebSocket Authorization
The WebSocket connection is never accepted before JWT validation passes. Close code `4001` is used for auth failures. Verified by: test connecting with invalid token and asserting close code 4001.

**Validates: Requirements 4.1, 4.2, 4.3, 4.4**

### Property 5: Embedding Idempotency
`upsert_vectors` uses UPSERT semantics — re-syncing the same item updates rather than duplicates its vector. The `source_id` payload field enables tombstoning without duplicates. Verified by: running sync twice and asserting Qdrant collection size is stable.

**Validates: Requirements 1.7, 1.8**

### Property 6: Neo4j Non-Blocking
Neo4j failures never propagate to the Celery task result. The sync job succeeds (returns synced count) even when all Neo4j writes fail. Verified by: unit test patching `run_cypher` to raise and asserting sync task still returns success.

**Validates: Requirements 2.7**

---

## Error Handling

| Scenario | Handling |
|----------|---------|
| Neo4j unavailable during sync | Log warning, continue, Neo4j write silently skipped |
| Binary file read in LocalFS | Catch `UnicodeDecodeError`, log debug, skip file |
| OAuth state token expired | Redirect to `settings?error=<provider>_auth_failed` |
| OAuth provider error param | Redirect to `settings?error=<provider>_auth_failed` |
| WebSocket token invalid | `websocket.close(code=4001)`, return immediately |
| Qdrant unavailable in briefing | Propagate exception to API layer, return 503 |
| Frontend 401 from API | Auto-refresh once, then redirect to `/login` |
| Empty Qdrant results for briefing | Return empty briefing, never return stub data |

---

## Testing Strategy

### Unit tests (no external services)

- `test_chunker.py` — pure function, no mocks needed
- `test_briefing_service.py` — `_compute_focus_score` is pure
- `test_security.py` — extend with AES round-trip and tamper detection

### Integration tests (mock external services)

- `test_auth_flow.py` — uses `httpx.AsyncClient(app=app)` with real PostgreSQL (testcontainers or SQLite via `aiosqlite`)
- `run_atlas_pipeline` mocked to return empty triage scores (no OpenAI key needed)
- Qdrant and Neo4j calls mocked via `unittest.mock.patch`

### Property-based correctness tests

- `chunk_text` invariant: `" ".join(all_words_in_chunks)` covers every word in original (no words dropped, accounting for overlap)
- `encrypt_token / decrypt_token` round-trip: for any non-empty string, `decrypt(encrypt(s)) == s`
