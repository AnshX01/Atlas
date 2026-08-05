# Implementation Plan: Atlas Phase 2

## Overview

Complete all Phase 2 stubs to make Atlas fully functional end-to-end. Tasks are ordered to respect dependencies: chunker and Neo4j helpers first, then connectors, then auth/WS, then briefing/frontend/tests.

## Task Dependency Graph

```json
{
  "waves": [
    {
      "wave": 1,
      "tasks": ["1", "2"],
      "description": "Foundation utilities — no dependencies"
    },
    {
      "wave": 2,
      "tasks": ["3", "4", "5"],
      "description": "Connector embedding + graph — depends on tasks 1 and 2"
    },
    {
      "wave": 3,
      "tasks": ["6", "7", "10"],
      "description": "Auth, WebSocket, connector API — independent of wave 2"
    },
    {
      "wave": 4,
      "tasks": ["8"],
      "description": "Live briefing — depends on connectors writing to Qdrant (tasks 3, 4, 5)"
    },
    {
      "wave": 5,
      "tasks": ["9"],
      "description": "Frontend integration — depends on tasks 6, 7, 8, 10"
    },
    {
      "wave": 6,
      "tasks": ["11"],
      "description": "Tests — depends on all previous tasks"
    }
  ]
}
```

## Tasks

- [ ] 1. Text Chunking Utility
  - [ ] 1.1 Create file `backend/app/services/chunker.py`
  - [ ] 1.2 Implement `chunk_text(text: str, max_tokens: int = 500, overlap: int = 50) -> list[str]` using whitespace splitting as token approximation
  - [ ] 1.3 Return `[]` for empty or whitespace-only input
  - [ ] 1.4 Return `[text]` when `len(words) <= max_tokens`
  - [ ] 1.5 For longer text: iterate with step `max_tokens - overlap`, join words back to strings, stop at end of input
  - [ ] 1.6 Add module docstring explaining whitespace-tokenization approximation

- [ ] 2. Neo4j Graph Upsert Helpers
  - [ ] 2.1 Add `upsert_pr_node(user_id, pr_id, title, url, state, repo, author, updated_at)` to `backend/app/infrastructure/neo4j_client.py` — MERGE PR node with all properties, MERGE User node, MERGE OWNS relationship
  - [ ] 2.2 Add `upsert_task_node(user_id, issue_id, title, url, state, repo, assignee, updated_at)` — MERGE Task node, MERGE OWNS relationship
  - [ ] 2.3 Add `upsert_message_node(user_id, msg_id, subject, sender_email, sender_name, timestamp)` — MERGE Message node, MERGE Person node by email, MERGE SENT_BY relationship
  - [ ] 2.4 Add `upsert_meeting_node(user_id, event_id, title, start_time, end_time, attendees)` — MERGE Meeting node, for each attendee email MERGE Person + ATTENDED_BY relationship
  - [ ] 2.5 Add `upsert_document_node(user_id, file_path, file_type, last_modified)` — MERGE Document node using file_path as id, MERGE OWNS relationship
  - [ ] 2.6 Wrap each function body in `try/except Exception as e: logger.warning(...); return` so Neo4j failures never propagate
  - [ ] 2.7 All functions call existing `run_cypher` function and use `{id: $id, user_id: $user_id}` MERGE keys for RBAC isolation

- [ ] 3. GitHub Connector — Embed PRs and Issues into Qdrant and Neo4j
  - [ ] 3.1 Add imports to `backend/app/services/connectors/github_connector.py`: `from app.workers.embedding_tasks import batch_embed_chunks` and `from app.infrastructure.neo4j_client import upsert_pr_node, upsert_task_node`
  - [ ] 3.2 In `_sync_prs`: after each PR, build chunk dict with keys `id`, `source_id`, `type="pr"`, `text=f"PR #{pr.number}: {pr.title}\n\n{pr.body or ''}"`, `timestamp`, `metadata` dict containing repo, pr_number, url, author, state
  - [ ] 3.3 In `_sync_prs`: collect chunks in a list per repo; after the PR loop dispatch `batch_embed_chunks.delay(str(self.user_id), chunks)`
  - [ ] 3.4 In `_sync_prs`: call `upsert_pr_node(str(self.user_id), str(pr.id), pr.title, pr.html_url, pr.state, repo.full_name, pr.user.login, pr.updated_at.isoformat())` inside try/except
  - [ ] 3.5 In `_sync_issues`: build chunk dict with `type="issue"`, `text=f"Issue #{issue.number}: {issue.title}\n\n{issue.body or ''}"`, collect chunks, dispatch embedding task
  - [ ] 3.6 In `_sync_issues`: call `upsert_task_node(...)` per issue inside try/except
  - [ ] 3.7 Remove all `# TODO` comments in these two methods

- [ ] 4. Google Workspace Connector — Embed Gmail and Calendar into Qdrant and Neo4j
  - [ ] 4.1 Add imports to `backend/app/services/connectors/google_workspace.py`: `from app.workers.embedding_tasks import batch_embed_chunks` and `from app.infrastructure.neo4j_client import upsert_message_node, upsert_meeting_node`
  - [ ] 4.2 In `_sync_gmail`: extract headers dict from `msg.get("payload", {}).get("headers", [])`, get Subject and From values; build chunk dict with `type="email"`, `text=f"{subject}\n{snippet}"`, `timestamp` from `internalDate` field
  - [ ] 4.3 Modify `_sync_gmail` to return `(dict_result, chunks_list)` tuple; call `upsert_message_node(...)` per message inside try/except
  - [ ] 4.4 In `_sync_calendar`: build chunk dict per event with `type="calendar"`, `text=f"{event.get('summary','')}\n{event.get('description','')}"`, `timestamp` from start dateTime
  - [ ] 4.5 Modify `_sync_calendar` to return `(dict_result, chunks_list)` tuple; call `upsert_meeting_node(...)` per event inside try/except
  - [ ] 4.6 In `sync()`: update calls to `_sync_gmail` and `_sync_calendar` to unpack the tuple; collect all chunks; dispatch `batch_embed_chunks.delay(str(self.user_id), all_chunks)` once
  - [ ] 4.7 Remove all `# TODO` comments

- [ ] 5. LocalFS Connector — Embed Files into Qdrant and Tombstone Deletes
  - [ ] 5.1 Add imports to `backend/app/services/connectors/local_fs.py`: `from app.services.chunker import chunk_text`, `from app.workers.embedding_tasks import batch_embed_chunks`, `from app.infrastructure.qdrant_client import delete_by_source_id`, `from app.infrastructure.neo4j_client import upsert_document_node`
  - [ ] 5.2 In `_index_existing_files`: read file with `file_path.read_text(encoding="utf-8", errors="ignore")`, call `chunk_text(content)`, build chunk dicts with `source_id=str(file_path)`, `type="file"`, `chunk_index=i` in metadata
  - [ ] 5.3 In `_index_existing_files`: dispatch `batch_embed_chunks.delay(str(self.user_id), chunks)` per file; call `upsert_document_node(str(self.user_id), str(file_path), file_path.suffix, ...)` inside try/except
  - [ ] 5.4 In `watch()` for `file_deleted` events: call `await delete_by_source_id(self.user_id, event["path"])`
  - [ ] 5.5 In `watch()` for `file_created` and `file_modified` events: read file content, call `chunk_text`, build chunk dicts, dispatch `batch_embed_chunks.delay(str(self.user_id), chunks)`
  - [ ] 5.6 Remove all `# TODO` comments

- [ ] 6. OAuth Callbacks and Initiate Endpoints
  - [ ] 6.1 Add imports to `backend/app/api/v1/auth.py`: `from fastapi.responses import RedirectResponse`, `from datetime import timedelta`, `from app.domain.models.connector import Connector, ConnectorProvider, ConnectorStatus`, connector class imports
  - [ ] 6.2 Add async helper `_get_or_create_connector(session, user_id, provider)` — SELECT connector for user+provider; INSERT new Connector with status=INACTIVE if not found; commit and return
  - [ ] 6.3 Add `GET /auth/oauth/google/initiate` endpoint requiring `get_current_user`: encode state as `create_access_token(str(user.id), expires_delta=timedelta(minutes=10), extra_claims={"purpose": "oauth_state"})`, build Google auth URL via Flow, return `{"auth_url": url}`
  - [ ] 6.4 Add `GET /auth/oauth/github/initiate` endpoint requiring `get_current_user`: same state encoding, return `{"auth_url": f"https://github.com/login/oauth/authorize?client_id=...&state={state}&scope=repo"}`
  - [ ] 6.5 Rewrite `google_oauth_callback`: decode state JWT, verify `purpose == "oauth_state"`, extract user_id, call `_get_or_create_connector`, instantiate `GoogleWorkspaceConnector`, call `await connector.authenticate(code)`, return `RedirectResponse` to settings page
  - [ ] 6.6 Rewrite `github_oauth_callback`: same pattern for GitHub
  - [ ] 6.7 On any exception in callbacks: return `RedirectResponse("http://localhost:3000/settings?error=<provider>_auth_failed", status_code=302)`

- [ ] 7. WebSocket JWT Authentication
  - [ ] 7.1 Add `from fastapi import Query` to imports in `backend/app/main.py`
  - [ ] 7.2 Ensure `from app.core.security import decode_token` is imported
  - [ ] 7.3 Update WebSocket signature to add `token: str = Query(default="")` parameter
  - [ ] 7.4 Add JWT validation block before `await websocket.accept()`: call `decode_token(token)`, verify `payload.get("sub") == user_id`, on any exception call `await websocket.close(code=4001)` and return
  - [ ] 7.5 Remove the `# TODO` comment from the WebSocket docstring
  - [ ] 7.6 Keep all existing relay logic after `websocket.accept()` unchanged

- [ ] 8. Live Briefing Service
  - [ ] 8.1 Add imports to `backend/app/services/briefing_service.py`: `from app.infrastructure.qdrant_client import semantic_search` and `from sentence_transformers import SentenceTransformer`
  - [ ] 8.2 Add module-level `_briefing_embedder: SentenceTransformer | None = None` and `_get_briefing_embedder()` lazy-loader
  - [ ] 8.3 Add private helper `_source_label(type_str: str) -> str` mapping: `email→Gmail`, `pr→GitHub`, `issue→GitHub`, `calendar→Google Calendar`, `file→Local Files`, `document→Local Files`
  - [ ] 8.4 Rewrite `_fetch_raw_items()`: query Connector table for active connectors for this user_id; return `[]` if none found
  - [ ] 8.5 In `_fetch_raw_items()`: embed broad query using `_get_briefing_embedder()`, call `await semantic_search(self.user_id, vector, limit=20, score_threshold=0.0)`, map Qdrant payloads to raw item dicts
  - [ ] 8.6 Remove the hardcoded stub items list and the `# TODO: Replace stubs` comment

- [ ] 9. Frontend API Integration
  - [ ] 9.1 Create `frontend/src/lib/api/client.ts`: Axios instance with `baseURL: process.env.NEXT_PUBLIC_API_URL`, request interceptor attaching Bearer token from localStorage, response interceptor for 401 auto-refresh then redirect to `/login`
  - [ ] 9.2 Create `frontend/src/lib/api/auth.ts`: `login()`, `register()`, `refreshToken()`, `getMe()` functions using `apiClient`
  - [ ] 9.3 Create `frontend/src/lib/api/search.ts`: `omniSearch(query, limit?)` posting to `/v1/search/omni` with `Idempotency-Key` header
  - [ ] 9.4 Create `frontend/src/lib/api/connectors.ts`: `listConnectors()`, `createConnector(provider)`, `triggerSync(provider)`, `initiateOAuth(provider)` — last function calls GET initiate endpoint then sets `window.location.href = data.auth_url`
  - [ ] 9.5 Verify and update `frontend/src/lib/api/briefing.ts` to use `apiClient` and return typed `DailyBriefingResponse`
  - [ ] 9.6 Create `frontend/src/lib/store/useAuthStore.ts`: Zustand store with `accessToken`, `refreshToken`, `user`, `setTokens(access, refresh)` saving to localStorage, `logout()` clearing localStorage and navigating to `/login`
  - [ ] 9.7 Create `frontend/src/lib/store/useWebSocketStore.ts`: Zustand store with `events: SyncEvent[]`, `dispatch(event)` appending, `clearEvents()` resetting
  - [ ] 9.8 Create `frontend/src/lib/hooks/useWebSocket.ts`: React hook opening WS to `${NEXT_PUBLIC_WS_URL}/ws/${userId}?token=${token}`, dispatching to WebSocketStore on message, closing on unmount
  - [ ] 9.9 Create `frontend/src/app/login/page.tsx`: login/register form; on success call `useAuthStore.setTokens()` and `router.push("/briefing")`
  - [ ] 9.10 Create `frontend/src/components/ui/Toast.tsx`: fixed-position toast component with message, type (success/error), auto-dismiss after 4 seconds
  - [ ] 9.11 Update `frontend/src/app/settings/page.tsx`: Connect buttons call `initiateOAuth(provider)`; on mount read `?connected=` and `?error=` query params and show Toast
  - [ ] 9.12 Update `frontend/src/app/layout.tsx`: fix `QueryClientProvider` by moving `QueryClient` instantiation inside component via `useState`; initialize auth store from localStorage on mount

- [ ] 10. Connector Management API Endpoints
  - [ ] 10.1 Add `ConnectorCreateRequest` to `backend/app/domain/schemas/__init__.py`: `class ConnectorCreateRequest(BaseModel): provider: ConnectorProvider; display_name: str | None = None`
  - [ ] 10.2 Add `GET /connectors` endpoint to `connectors_router` in `backend/app/api/v1/__init__.py`: requires `get_current_user`, SELECT all Connectors for user, return `list[ConnectorResponse]`
  - [ ] 10.3 Add `POST /connectors` endpoint to `connectors_router`: requires `get_current_user`, body `ConnectorCreateRequest`; if connector for user+provider already exists return it with 200; otherwise INSERT new Connector with `status=INACTIVE` and return with 201
  - [ ] 10.4 Check `backend/app/domain/models/base.py` for `created_at` and `updated_at` columns; add them if missing so `ConnectorResponse.created_at` is accessible

- [ ] 11. Tests
  - [ ] 11.1 Create `backend/tests/unit/test_chunker.py` with tests: `test_empty_string_returns_empty_list`, `test_whitespace_only_returns_empty_list`, `test_short_text_returns_single_chunk`, `test_long_text_produces_multiple_chunks`, `test_chunk_overlap_correct`, `test_no_words_lost`
  - [ ] 11.2 Create `backend/tests/unit/test_briefing_service.py` with tests: `test_focus_score_empty_returns_zero`, `test_focus_score_single_item`, `test_focus_score_weighted_formula`, `test_focus_label_high`, `test_focus_label_moderate`, `test_focus_label_light`, `test_focus_label_clear`
  - [ ] 11.3 Update `backend/tests/unit/test_security.py`: add `test_encrypt_decrypt_round_trip` and `test_decrypt_tampered_raises`
  - [ ] 11.4 Create `backend/tests/integration/test_auth_flow.py` with tests: `test_register_returns_tokens`, `test_login_returns_tokens`, `test_get_briefing_authenticated`, `test_get_briefing_unauthenticated`; mock `run_atlas_pipeline` to return `{"triage_scores": []}` to avoid requiring OpenAI key
  - [ ] 11.5 Update `backend/tests/conftest.py`: add `async_client` fixture using `httpx.AsyncClient(app=app, base_url="http://test")`, add database setup creating all tables before tests run

## Notes

- All changes follow existing patterns — no new backend dependencies beyond `pyproject.toml`
- The frontend does not need new npm packages — axios, zustand, react-query are already in `package.json`
- LocalFS binary file handling uses `errors="ignore"` in `read_text()` — no additional parsing library needed
- Check `backend/app/domain/models/base.py` for `created_at`/`updated_at` — the Alembic migration adds these columns but the ORM Base class may need them explicitly mapped
- Google OAuth initiate uses `google_auth_oauthlib` which is already a declared dependency
- Integration tests mock OpenAI/Anthropic calls so no API keys are required to run the test suite
