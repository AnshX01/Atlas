# Atlas — Agent Handoff Context

> Generated 2026-08-09. Read this top to bottom before touching code — it reflects the
> ACTUAL current state of the repo, not aspirational/planned state. The old file
> `agent_handoff_context.md` in the repo root is STALE (describes work already done,
> e.g. draft/approve/execute flow, card persistence — both already implemented).
> Prefer this file. You may delete `agent_handoff_context.md` once you've confirmed
> this file supersedes it.

---

## 1. What Atlas Is

Privacy-first AI desktop app (Electron + Next.js) — a personal "AI Chief of Staff."
Connects to Gmail, Google Calendar, Google Tasks, GitHub, Slack, Notion, and local
files; fetches data, summarizes it, and executes actions on the user's behalf. All AI
runs locally via Ollama (`llama3:8b` for chat, `nomic-embed-text` for embeddings).
No cloud AI dependency. An optional FastAPI backend (Docker) exists purely for
cross-device sync of conversations/tokens — the app is fully functional without it.

- **Repo**: `github.com/AnshX01/Atlas.git`, branch `main`
- **Location**: `C:\Users\anshw\Documents\Atlas`
- **OS**: Windows (use PowerShell syntax — `;` not `&&` for command chaining)

---

## 2. Repo Layout

```
Atlas/
├── DEBUGGING_PROMPT.md         # The 33-issue debugging brief (see §5 — mostly DONE)
├── AGENT_HANDOFF.md            # This file
├── agent_handoff_context.md    # STALE — old handoff, superseded
├── .env / .env.example         # Backend env vars (optional Docker backend only)
├── docker-compose.yml          # Postgres, Redis, Neo4j, Qdrant, Celery (OPTIONAL)
├── backend/                    # FastAPI backend — optional, cross-device sync only
│   └── app/{api,core,domain,services,workers}/
└── frontend/                   # THE APP — Electron + Next.js. This is where you work.
    ├── electron/
    │   ├── main.ts              # App lifecycle, IPC handlers, OAuth HTTP server
    │   ├── preload.ts           # contextBridge → window.atlasElectron API
    │   └── services/
    │       ├── orchestrator.ts       # ~1700 lines. THE BRAIN. Intent→route→fetch→draft→approve→execute
    │       ├── mcp-manager.ts        # Spawns MCP subprocesses (GitHub/Slack/FS) + direct API (Google/Notion)
    │       ├── intent-classifier.ts  # Keyword scoring + Ollama fallback for ambiguous queries
    │       ├── ollama.ts             # streamChat/chat/generateEmbedding/checkHealth — DO NOT need changes
    │       ├── google-oauth.ts       # System-browser OAuth flow, dynamic redirect port
    │       ├── token-store.ts        # JSON file at Electron userData path
    │       ├── local-store.ts        # SQLite: conversations/messages/tool executions
    │       ├── local-auth.ts         # SQLite local user auth (email/password)
    │       ├── mcp-protocol.ts       # JSON-RPC stdio protocol handler for MCP servers
    │       ├── config.ts
    │       └── connectors/
    │           ├── gmail.ts          # Gmail + Calendar + Tasks direct API (OAuth token based)
    │           ├── notion.ts         # Notion direct API
    │           ├── github.ts         # GitHub direct API (also has official MCP server option)
    │           ├── slack.ts          # Slack direct API (also has official MCP server option)
    │           └── index.ts
    ├── src/
    │   ├── app/
    │   │   ├── chat/page.tsx         # ~1150 lines. Main chat UI — READ THIS FIRST for UI work
    │   │   ├── briefing/page.tsx     # Daily briefing (React Query)
    │   │   ├── dashboard/page.tsx
    │   │   ├── settings/page.tsx     # Connector config UI (~790 lines)
    │   │   ├── login/page.tsx        # Email/password + Google OAuth
    │   │   ├── profile/page.tsx
    │   │   └── oauth-callback/page.tsx
    │   ├── components/
    │   │   ├── layout/{Sidebar,AppShell,ErrorBoundary,OfflineBanner,PageTransition}.tsx
    │   │   ├── composite/{BriefingCard,ToolExecutionCard,ActionApprovalCard}.tsx
    │   │   ├── icons/ProviderLogos.tsx
    │   │   └── ui/{Button,Toast,Skeleton,SearchSkeleton,Badge,Input}.tsx
    │   ├── lib/
    │   │   ├── store/{useChatStore,useAuthStore,useBriefingStore,useAppStore}.ts  # Zustand + persist
    │   │   ├── api/{client,auth,connectors,briefing,conversation-sync,token-sync}.ts
    │   │   ├── hooks/useWorkflow.ts
    │   │   └── utils.ts
    │   ├── types/electron.d.ts       # window.atlasElectron type declarations
    │   └── styles/{globals,animations}.css
    ├── package.json
    └── dist-electron/            # Compiled output of electron/*.ts (tsup → CJS)
```

---

## 3. How To Run It

```powershell
cd C:\Users\anshw\Documents\Atlas\frontend
npm install                    # if not already done
npm run electron-dev           # runs Next.js dev server + compiles electron + launches Electron
```

Prereqs for full functionality (app runs without these but features degrade gracefully):
- Ollama running locally: `ollama pull llama3:8b` and `ollama pull nomic-embed-text`, then `ollama serve` (or it auto-runs as a service on some installs)
- Connector credentials entered in Settings → Integrations (Google OAuth via Cloud Console, GitHub PAT, Slack bot token, Notion integration token, or local folder paths)

Other useful commands (PowerShell — use `;` to chain, NOT `&&`):
```powershell
npx next build                                                                                    # verify frontend TS + build
npx tsup electron/main.ts electron/preload.ts --outDir dist-electron --format cjs --external electron --external sql.js   # verify electron TS
npm test                                                                                           # Jest unit tests (14 tests currently, all passing)
npm run electron-compile                                                                           # same as the tsup command above, via package.json script
docker-compose up -d          # from repo root — OPTIONAL backend for cross-device sync only
```

---

## 4. Architecture Deep-Dive

### Orchestrator flow (`electron/services/orchestrator.ts`)
1. User sends message → renderer calls `window.atlasElectron.executeWorkflow(text)`.
2. IPC handler in `main.ts` calls `orchestrator.execute(prompt, mainWindow, conversationId)`.
3. Context enrichment: short follow-ups (≤5 words) get combined with the previous user
   message for routing — UNLESS the follow-up is a standalone response like "yes"/"cancel"
   (this guard was added recently, see §5).
4. **Router node** — `classifyIntent()`: keyword scoring first (instant, cached Ollama
   health check now avoids a redundant round-trip); Ollama classification only for
   genuinely ambiguous cases (confidence < 0.75).
5. Branches by intent:
   - `search` → `searchNode` (calls MCP tools via `resolveTools()`) → `responseNode`
     (Ollama summarizes fetched data in plain text, dates humanized)
   - `action` → `prefetchActionContext` (fetches relevant data first, e.g. the actual
     email to reply to) → `actionNode` (resolves the tool, flags destructive ones) →
     if destructive: `draftNode` (Ollama generates draft JSON, validated/fixed with
     real context data) → `approvalNode` (blocks until user clicks Approve/Reject in
     the DraftCard UI) → `executeNode` (calls the real API)
   - `chat` → `responseNode` directly (conversation history + Ollama)
6. Events streamed to renderer: `workflow-stream` (tokens), `workflow-tool-executing`,
   `workflow-draft-ready`, `workflow-complete`.

### MCP Manager (`electron/services/mcp-manager.ts`)
- GitHub, Slack, Filesystem → spawned as real MCP subprocess servers via `npx -y
  @modelcontextprotocol/server-*`, JSON-RPC over stdio. Now has adaptive startup
  retries (5 attempts, 1.5s backoff) instead of a blind 2s sleep, and surfaces
  `lastError` on failure.
- Google Workspace, Notion → direct REST API connectors (no MCP package exists for
  these), routed through `callGoogleTool`/`callNotionTool`.
- Filesystem server paths are passed as CLI args (`getArgs()`), NOT an env var — this
  was a real bug that's now fixed (server never actually read an `FS_PATHS` env var).

### Connectors (`electron/services/connectors/`)
- `gmail.ts`: Gmail read/send/reply/forward, Calendar list/create/delete, Google Tasks
  list/create/update/complete (create/update/complete added recently — previously
  read-only). Token refresh persists back to token-store with a fallback path if the
  stored creds lookup fails.
- `notion.ts`: search/get/create pages. `createPage` now has a `getDefaultParent()`
  fallback (checks cached `default_parent_page_id`, else searches for any accessible
  page) so it doesn't hard-fail when the user doesn't specify a parent.
- `github.ts` / `slack.ts`: simple direct REST wrappers (also have MCP-server
  alternatives wired in mcp-manager.ts).

### Frontend chat UI (`src/app/chat/page.tsx`)
Single ~1150-line file containing: `ChatPageInner` (main state/logic), `ChatMessageBubble`,
`ResultCard`, `ActionCard`, `DraftCard`, `ToolExecutionCard`, `ChatInput`, `EmptyState`.
- Uses Electron IPC path (`window.atlasElectron.executeWorkflow`) when running in
  Electron, falls back to an HTTP path (`/v1/search/omni`) when running as a plain
  browser/dev-mode tab (rare, mostly for isolated frontend dev).
- `DraftData.status`: `pending | approved | rejected | executing | done | failed`
  (`failed` added recently, distinct from `rejected` — a failed tool execution now
  shows a red "Failed: <error>" state instead of being conflated with user-cancelled).
- Stop button hoists all IPC unsubscribe functions into `unsubscribersRef` so clicking
  Stop actually detaches listeners immediately (previously they were unreachable
  closure variables — real bug, now fixed). NOTE: this does NOT abort the in-flight
  Ollama HTTP stream in the main process; that would require passing an AbortController
  handle through the orchestrator's public API, which hasn't been done yet (see §6).
- `filterRelevantResults()` heuristic hides result cards whose title doesn't appear in
  the AI's response text, when there are >3 results (reduces card spam).
- `stripMarkdown()` sanitizes stray `**bold**`/`* bullets`/backticks from Ollama output
  on the FINAL rendered content only (not applied per-token during streaming).

### State (`src/lib/store/useChatStore.ts`)
Zustand + persist to localStorage. `ChatMessage` includes `results`, `actions`,
`toolExecutions`, `draft` — full card data persists across conversation switches
(this was fixed a while back per the old handoff doc — confirmed still working).
`backgroundSync()` (debounced 1s, fire-and-forget to optional backend) now includes
these fields too (previously stripped them, so cross-device sync lost all card
context — fixed recently).

---

## 5. Debugging Session Just Completed (2026-08-09)

`DEBUGGING_PROMPT.md` in the repo root lists 33 known issues across 7 categories.
**All 33 were addressed** in this session via 3 parallel subagents (split by file
ownership to avoid merge conflicts) plus one direct fix. Details:

| # | Issue | Status | Where |
|---|---|---|---|
| 1 | Email reply wrong recipient | Fixed | orchestrator.ts draftNode — validates `to` has `@`, scans context for real email, blanks + flags `_recipientNotFound` if truly not found |
| 2 | "Sent successfully" shows on failure | Fixed | gmail.ts sendEmail/replyEmail/forwardEmail now throw on invalid/missing `to`; DraftCard has distinct `failed` status |
| 3 | Ollama classification latency | Fixed | intent-classifier.ts wired up the previously-unused health-check cache (30s TTL) |
| 4 | Raw ISO dates in responses | Fixed | orchestrator.ts `humanizeDates()` applied before LLM-facing context strings |
| 5 | DraftCard false success | Fixed | new `failed` status, distinct red UI from `rejected` |
| 6 | Reference cards show ALL results | Fixed | `filterRelevantResults()` in chat/page.tsx |
| 7 | Markdown leaking into chat bubble | Fixed | `stripMarkdown()` applied to final assistant content |
| 8 | Briefing loading slow | Partially fixed | Fixed a real listener-leak bug (`removeOnChatStream` didn't exist, was silently no-op'ing every call); did NOT add incremental/skeleton loading UI |
| 9 | Sidebar conversation list not updating | Verified OK | Already uses reactive `useChatStore((s) => s.conversations)` hook |
| 10 | Stop button doesn't abort | Partially fixed | Now detaches listeners immediately via hoisted ref; does NOT abort backend Ollama stream (needs orchestrator API change, see §6) |
| 11-16 | Orchestrator logic issues | Fixed | keyword lookup via Set (O(1)), single-tool cap for "latest X" queries, standalone-response guard for context enrichment, documented intentional keyword overlap, tightened Slack prefetch conditions, regex-based fallback draft fields |
| 17-18 | GitHub/Slack MCP subprocess startup | Fixed | adaptive retry (5×1.5s) instead of blind 2s sleep; `lastError` surfaced |
| 19 | Google token refresh persistence | Verified + hardened | added fallback path using connector's own in-memory fields if token-store lookup fails post-refresh |
| 20 | Notion createPage needs parentId | Fixed | `getDefaultParent()` fallback |
| 21 | Local Files empty paths / wrong env var | Fixed | paths now passed as CLI args, not the nonexistent `FS_PATHS` env var |
| 22 | Google Tasks read-only | Fixed | added createTask/updateTask/completeTask |
| 23 | Login require()/dynamic import | Fixed | replaced with static imports |
| 24 | backgroundSync missing fields | Fixed | now includes results/actions/toolExecutions/draft |
| 25 | OAuth port 19876 no fallback | Fixed | tries 19876→19877→19878, dynamic redirect URI |
| 26 | Offline mode UX unclear | Fixed | Toast notice on local-auth fallback |
| 27-30 | Performance (Ollama timeout, briefing prompt size, N+1 email fetch, MCP cold start) | Partially addressed | Ollama-related latency and listener-leak fixed; **N+1 Gmail fetch (`listEmails` fetches list then details per-message) was NOT changed** — still an open perf issue, see §6 |
| 31 | Zap icon remnants | Fixed | last occurrence was in `briefing/page.tsx` empty state, replaced with `CheckSquare` |
| 32 | Green accent scope | Verified OK | reviewed Badge.tsx/Sidebar.tsx colored classes — all intentional (priority severity colors, explicitly-allowed blue BETA badge) |
| 33 | BriefingCard styling inconsistency | Fixed | expanded-details section aligned to `bg-white/[0.02] border-white/[0.06]` pattern |

**Verification performed**: `npx next build` (exit 0), `npx tsup ...` electron build
(exit 0), `npm test` (14/14 passed). **Not verified**: live runtime behavior in
`npm run electron-dev` with real Ollama/OAuth/MCP servers — all fixes are
build-clean and logically sound but haven't been exercised against the 10 "Testing
Scenarios" listed in `DEBUGGING_PROMPT.md` (those require live credentials + Ollama).

### Uncommitted changes right now
`git status` shows 18 modified files + `DEBUGGING_PROMPT.md` untracked, NOT YET
COMMITTED:
```
frontend/electron/main.ts
frontend/electron/preload.ts
frontend/electron/services/connectors/gmail.ts
frontend/electron/services/connectors/notion.ts
frontend/electron/services/google-oauth.ts
frontend/electron/services/intent-classifier.ts
frontend/electron/services/mcp-manager.ts
frontend/electron/services/orchestrator.ts
frontend/next-env.d.ts
frontend/src/app/briefing/page.tsx
frontend/src/app/chat/page.tsx
frontend/src/app/dashboard/page.tsx        ← modified but NOT by this session, pre-existing
frontend/src/app/login/page.tsx
frontend/src/components/composite/BriefingCard.tsx
frontend/src/lib/api/briefing.ts
frontend/src/lib/api/conversation-sync.ts
frontend/src/lib/store/useChatStore.ts
frontend/src/types/electron.d.ts
```
**Action needed**: review the diff and commit when ready. Not committed automatically
per this assistant's git safety policy (only commits when explicitly asked). Suggested
commit message: `fix: resolve 33 known issues from DEBUGGING_PROMPT.md (orchestrator, connectors, chat UI, auth sync)`.
Consider splitting into logical commits (orchestrator/connectors vs frontend UI) rather
than one giant commit, and review `frontend/src/app/dashboard/page.tsx`'s diff separately
since it wasn't part of this session's explicit task list.

---

## 6. Known Open Items / Not Yet Done

These were identified but explicitly deferred or only partially fixed — pick these up next:

1. **Stop button doesn't abort the backend Ollama stream.** Currently only detaches
   renderer-side listeners. To truly abort: `orchestrator.ts`'s `streamChat` calls
   (in `draftNode`'s `generateDraft` and `responseNode`) would need to accept/track
   an `AbortController` per `conversationId`/`executionId`, exposed via a new
   `orchestrator.abort(conversationId)` method, wired to a `workflow-abort` IPC call
   (the IPC plumbing/preload method already exists as a stub — `abortWorkflow()` —
   but main.ts's handler doesn't do anything beyond acknowledge; it needs to actually
   call into the orchestrator).
2. **N+1 Gmail fetch problem** (#29 in the debugging doc) — `gmail.ts`'s `listEmails`
   fetches the message list then does `Promise.all` of individual detail fetches per
   message. Should use Gmail's `format=metadata` batch capabilities or `fields` param
   to reduce round-trips, or a real batch endpoint.
3. **Briefing incremental loading** (#8) — the listener leak is fixed but the UX still
   waits for the full Ollama generation before showing anything. Consider streaming
   the briefing generation token-by-token into partial UI, or showing fetched-but-not-
   yet-summarized raw cards immediately with a "AI is summarizing..." skeleton overlay.
4. **MCP server cold start** (#30) — first GitHub/Slack tool call still spawns a fresh
   subprocess (5-10s). Consider pre-warming servers on app startup for any connector
   with valid stored credentials, rather than waiting for first user request.
5. Live-test the 10 scenarios in `DEBUGGING_PROMPT.md`'s "Testing Scenarios" section
   against a running `npm run electron-dev` instance with real Ollama + at least one
   connector configured, to catch anything the static build/TS checks couldn't.
6. Decide whether to delete the stale `agent_handoff_context.md` (superseded by this file).

---

## 7. Design System Rules (unchanged, still enforced)

- Dark mode only: `--bg-primary: #09090b`, `--bg-secondary: #111113`, accent
  `--accent: #e4e4e7` (white/gray)
- NO colored icons except: connector logos in sidebar, BETA badge (blue), green dots
  for active/success status. Priority badges (urgent/high/medium/low → red/orange/
  yellow/green) are also intentional functional-severity colors, not decoration.
- Card icons: white/70 opacity, no background boxes
- Source display names: "Google Workspace", "GitHub", "Slack", "Notion", "Local Files"
- Font: Inter
- Cards: `rounded-xl`/`rounded-2xl`, `border-white/[0.06]`, `bg-white/[0.02]`
- Animations: framer-motion springs, `stiffness: 400, damping: 30`
- No Zap icon anywhere (confirmed zero remaining occurrences as of this session) —
  use `CheckSquare` for tasks, `Send` for messages
- No markdown in AI responses — plain text only (enforced both via system prompts to
  Ollama AND client-side `stripMarkdown()` as a safety net)

---

## 8. Environment / Secrets Notes

- `.env` at repo root is for the OPTIONAL backend only (Postgres/Redis/Neo4j/Qdrant/
  JWT secrets/OAuth client secrets for the backend's own OAuth flows). **Do not echo
  its contents** — reference by key name only if you need to discuss it.
- The Electron app's OWN connector credentials (Google OAuth tokens, GitHub PAT, Slack
  bot token, Notion integration token, local folder paths) are stored separately in a
  JSON file at the Electron `userData` path via `token-store.ts` — entered through the
  Settings UI, not via `.env`.
- Google OAuth for connectors uses a DIFFERENT client id/secret than the backend's own
  Google login OAuth — don't conflate the two flows when debugging.

---

## 9. Quick Orientation Checklist For a New Agent Session

1. Read this file fully (you just did).
2. Run `git status` and `git diff --stat` to see the exact current diff state (18
   files, uncommitted, per §5) — decide with the user whether to commit first.
3. Run `npx next build` and the `npx tsup ...` electron command to confirm the build
   is still green before making further changes.
4. If picking up §6's open items, start with #1 (Stop button abort) since it touches
   the most-visible UX gap; it requires editing `orchestrator.ts` (add abort tracking)
   + `main.ts` (wire the IPC handler to actually call it) + already-done preload/
   frontend plumbing.
5. Preserve the parallel-subagent pattern for large independent fix sets — split by
   non-overlapping file ownership (e.g. orchestrator/connectors vs frontend UI) to
   avoid merge conflicts, as was done this session.
