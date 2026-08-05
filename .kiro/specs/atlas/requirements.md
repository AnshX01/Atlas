# Requirements Document

## Introduction

Atlas Phase 1 established the full scaffold: FastAPI backend with DDD structure, LangGraph AI pipeline, three connectors (Google Workspace, GitHub, Local FS), Celery workers, and Next.js/Electron frontend. All connector sync methods, OAuth callbacks, embedding calls, and Neo4j writes contain `# TODO` stubs.

Phase 2 completes the application by wiring every stub into fully functional code, resulting in a working end-to-end product where a user can register, connect integrations, receive a live AI-prioritized daily briefing, and perform semantic search across their connected data.

## Glossary

| Term | Definition |
|------|------------|
| Embedding | Numerical vector representation of text, stored in Qdrant for semantic search |
| RAG | Retrieval-Augmented Generation — fetching context vectors before LLM generation |
| Neo4j node | A graph database record representing an entity (Person, Document, PR, Meeting, Task) |
| Tombstone | Deletion of Qdrant vectors when their source document/file is removed |
| Triage | AI scoring of inbox items from 1–100 by urgency |
| Focus Score | Weighted aggregate of triage scores displayed on the daily briefing |
| RBAC | Role-based access control — all data isolated per `user_id` |
| Connector | Integration adapter syncing a third-party data source into Atlas |

---

## Requirements

### Requirement 1: Qdrant Embedding Pipeline

**User Story:** As an Atlas user, I want all my synced emails, PRs, issues, calendar events, and local files to be embedded into a searchable vector store, so that I can find anything across my connected sources using natural language.

#### Acceptance Criteria

1. WHEN a GitHub PR is synced, THEN the system SHALL embed the PR title and body as a text chunk and upsert it into Qdrant with payload fields: `source_id`, `type="pr"`, `timestamp`, `text_chunk`, `user_id`, `repo`, `pr_number`.

2. WHEN a GitHub Issue is synced, THEN the system SHALL embed the issue title and body and upsert it into Qdrant with payload fields: `source_id`, `type="issue"`, `timestamp`, `text_chunk`, `user_id`, `repo`, `issue_number`.

3. WHEN a Gmail message is synced, THEN the system SHALL extract the subject and snippet from metadata headers and embed them as a text chunk in Qdrant with payload fields: `source_id`, `type="email"`, `timestamp`, `text_chunk`, `user_id`, `sender`, `subject`.

4. WHEN a Google Calendar event is synced, THEN the system SHALL embed the event summary and description into Qdrant with payload fields: `source_id`, `type="calendar"`, `timestamp`, `text_chunk`, `user_id`, `attendees`, `start_time`.

5. WHEN a local file is indexed by the LocalFS connector, THEN the system SHALL read the file, split it into chunks of at most 500 tokens with 50-token overlap, embed each chunk, and upsert all chunks into Qdrant with payload fields: `source_id`, `type="file"`, `timestamp`, `text_chunk`, `user_id`, `file_path`, `chunk_index`.

6. WHEN a local file is deleted, THEN the system SHALL call `delete_by_source_id` to tombstone all Qdrant vectors for that file, so that the deleted content cannot appear in future search results.

7. WHEN embedding a batch of items, THEN the system SHALL dispatch a `batch_embed_chunks` Celery task rather than embedding synchronously, so that sync latency is not blocked by embedding computation.

8. WHERE the `SentenceTransformer("all-MiniLM-L6-v2")` model is used for embedding, THEN the vector dimension SHALL be exactly 384 to match the existing Qdrant collection configuration.

---

### Requirement 2: Neo4j Knowledge Graph Population

**User Story:** As an Atlas user, I want my synced data to be represented as a knowledge graph so that the AI can traverse relationships.

#### Acceptance Criteria

1. WHEN a GitHub PR is synced, THEN the system SHALL create or merge a `(:PR)` node with properties `{id, title, url, state, repo, author, updated_at, user_id}` and create a `(:User)-[:OWNS]->(:PR)` relationship.

2. WHEN a GitHub Issue is synced, THEN the system SHALL create or merge a `(:Task)` node with properties `{id, title, url, state, repo, assignee, updated_at, user_id}` and create a `(:User)-[:OWNS]->(:Task)` relationship.

3. WHEN a Gmail message is synced, THEN the system SHALL create or merge a `(:Message)` node with properties `{id, subject, sender_email, timestamp, user_id}` and a `(:User)-[:OWNS]->(:Message)` relationship. If the sender email is new, a `(:Person {email})` node SHALL also be created with a `(:Message)-[:SENT_BY]->(:Person)` edge.

4. WHEN a Calendar event is synced, THEN the system SHALL create or merge a `(:Meeting)` node with properties `{id, title, start_time, end_time, user_id}` and a `(:User)-[:OWNS]->(:Meeting)` relationship. Each attendee email SHALL produce a `(:Person)` node linked via `(:Meeting)-[:ATTENDED_BY]->(:Person)`.

5. WHEN a local file is indexed, THEN the system SHALL create or merge a `(:Document)` node with properties `{id, file_path, file_type, last_modified, user_id}` and a `(:User)-[:OWNS]->(:Document)` relationship.

6. ALL Cypher `MERGE` statements SHALL use the `user_id` property in node identity to enforce RBAC data isolation between users.

7. WHEN Neo4j is unavailable during a sync, THEN the connector SHALL log a warning and continue without failing the sync, so Qdrant embedding is not blocked.

---

### Requirement 3: OAuth Callback Wiring

**User Story:** As an Atlas user, I want to connect my Google and GitHub accounts through OAuth so that Atlas can sync my data.

#### Acceptance Criteria

1. WHEN a user visits `/v1/auth/oauth/google/callback?code=...`, THEN the system SHALL look up or create a `Connector` record for `provider=google_workspace` scoped to the current user, call `GoogleWorkspaceConnector.authenticate(code)`, and redirect to `http://localhost:3000/settings?connected=google` on success.

2. WHEN a user visits `/v1/auth/oauth/github/callback?code=...`, THEN the system SHALL look up or create a `Connector` record for `provider=github`, call `GitHubConnector.authenticate(code)`, and redirect to `http://localhost:3000/settings?connected=github` on success.

3. WHEN an OAuth callback receives an `error` query parameter, THEN the system SHALL redirect to `http://localhost:3000/settings?error=<provider>_auth_failed`.

4. WHEN a user initiates a Google OAuth flow, THEN the system SHALL provide a `/v1/auth/oauth/google/initiate` endpoint that returns the Google authorization URL with a signed `state` parameter encoding the user_id.

5. WHEN a user initiates a GitHub OAuth flow, THEN the system SHALL provide a `/v1/auth/oauth/github/initiate` endpoint that returns the GitHub authorization URL with a signed `state` parameter.

6. WHEN tokens are stored, THEN they SHALL be encrypted using `encrypt_token()` before database persistence.

---

### Requirement 4: WebSocket JWT Authentication

**User Story:** As an Atlas user, I want the real-time sync event WebSocket to be secured so that only I can receive my sync progress events.

#### Acceptance Criteria

1. WHEN a client connects to `/ws/{user_id}`, THEN the system SHALL require a valid JWT passed as the `token` query parameter.

2. WHEN the JWT is valid and the `sub` claim matches the `user_id` path parameter, THEN the connection SHALL be accepted.

3. WHEN the JWT is invalid, expired, or the `sub` does not match `user_id`, THEN the server SHALL close the connection with code `4001` before accepting.

4. WHEN the JWT is missing entirely, THEN the server SHALL close the connection with code `4001`.

5. AFTER authentication, the WebSocket behavior SHALL remain unchanged — relaying Redis Pub/Sub sync events to the authenticated client.

---

### Requirement 5: Live Briefing Data

**User Story:** As an Atlas user, I want my daily briefing to show real items from my connected integrations rather than stub data.

#### Acceptance Criteria

1. WHEN `BriefingService.generate_briefing()` is called, THEN the system SHALL query the database for all `Connector` records with `status=ACTIVE` belonging to the current user.

2. FOR each active connector, THEN the system SHALL fetch the most recent synced items from Qdrant and include them in the briefing.

3. WHEN no active connectors exist for the user, THEN the system SHALL return an empty briefing with `focus_score=0` and `items=[]`.

4. WHEN Qdrant returns no items for a user, THEN the briefing SHALL return an empty list — never the hardcoded stub items.

5. WHEN fetching briefing items from Qdrant, THEN the system SHALL apply a `user_id` filter to ensure strict RBAC isolation.

---

### Requirement 6: Frontend API Integration

**User Story:** As an Atlas user, I want the frontend to call real backend API endpoints so I can register, log in, view my briefing, and search my data.

#### Acceptance Criteria

1. WHEN the frontend mounts, THEN it SHALL check for a stored JWT in `localStorage` and set the Authorization header on all subsequent API requests.

2. WHEN a user logs in successfully, THEN the frontend SHALL store the `access_token` and `refresh_token` in `localStorage` and navigate to `/briefing`.

3. WHEN an API request returns 401, THEN the frontend SHALL automatically attempt a token refresh, retry the original request once, and redirect to `/login` if the refresh also fails.

4. WHEN the briefing page loads, THEN it SHALL call `GET /v1/briefing/daily` with the Authorization header and render the returned items.

5. WHEN the OmniSearch command bar submits a query, THEN it SHALL call `POST /v1/search/omni` and display the returned results.

6. WHEN the Settings page shows an integration as "Connect", THEN clicking it SHALL redirect the browser to the OAuth initiate endpoint for that provider.

7. WHEN the frontend receives a `connected=<provider>` query parameter after OAuth redirect, THEN it SHALL show a success notification and mark the integration as active in the UI.

8. WHEN the frontend starts in Electron, THEN it SHALL connect to the WebSocket at `ws://localhost:8000/ws/{user_id}?token=<jwt>` and dispatch incoming sync events to the Zustand store.

---

### Requirement 7: Text Chunking Utility

**User Story:** As a developer, I want a reusable text chunking function so that all connectors produce consistently sized embedding inputs.

#### Acceptance Criteria

1. THE system SHALL provide a `chunk_text(text: str, max_tokens: int = 500, overlap: int = 50) -> list[str]` function in `app/services/chunker.py`.

2. WHEN the input text is shorter than `max_tokens` tokens, THEN the function SHALL return a list containing the full text as a single chunk.

3. WHEN the input text exceeds `max_tokens` tokens, THEN the function SHALL split it into overlapping chunks where consecutive chunks share `overlap` tokens.

4. The chunker SHALL use whitespace tokenization as the token approximation.

5. WHEN `chunk_text` is called with empty or whitespace-only input, THEN it SHALL return an empty list.

---

### Requirement 8: Integration Tests

**User Story:** As a developer, I want tests covering the key workflows so I can verify the system works without deploying.

#### Acceptance Criteria

1. THERE SHALL be a pytest integration test that registers a user, logs in, and asserts that `GET /v1/briefing/daily` returns a valid `DailyBriefingResponse` with `focus_score` in range 0–100.

2. THERE SHALL be pytest unit tests for `chunk_text` verifying: single chunk for short input, multiple chunks for long input, overlap correctness, and empty input handling.

3. THERE SHALL be pytest unit tests for `_compute_focus_score` verifying the weighted scoring formula for 0, 1, and N items.

4. THERE SHALL be a pytest unit test for `encrypt_token` / `decrypt_token` round-trip.

5. ALL existing tests in `tests/unit/` SHALL continue to pass after Phase 2 changes.
