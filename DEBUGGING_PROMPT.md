# Atlas — Full Codebase Debugging & Fix Prompt

## Project Overview

Atlas is a **privacy-first AI desktop app** (Electron + Next.js) that acts as a personal AI Chief of Staff. It connects to Gmail, Google Calendar, Google Tasks, GitHub, Slack, Notion, and local files — fetching data, summarizing it, and executing actions on behalf of the user. Everything runs locally using Ollama (llama3:8b) for AI. No cloud AI dependency.

**Repository:** `github.com/AnshX01/Atlas.git` (main branch)
**Location:** `C:\Users\anshw\Documents\Atlas`

---

## Architecture

```
Electron Desktop App
├── Renderer (Next.js 16 @ localhost:3000)
│   ├── /chat — AI chatbot (main feature)
│   ├── /briefing — AI-generated daily briefing
│   ├── /dashboard — Overview with quick actions
│   ├── /settings — Connector configuration
│   ├── /login — Auth (email/password + Google OAuth)
│   └── /profile — User profile
│
├── Electron Main Process
│   ├── orchestrator.ts — LangGraph-style state machine (classify → route → fetch → draft → approve → execute)
│   ├── mcp-manager.ts — Manages MCP server subprocesses + direct API connectors
│   ├── intent-classifier.ts — Keyword + Ollama intent classification
│   ├── ollama.ts — Local LLM streaming (llama3:8b)
│   ├── google-oauth.ts — OAuth flow (opens system browser, handles callback)
│   ├── token-store.ts — Stores connector credentials in JSON file
│   ├── local-store.ts — SQLite for conversations/messages
│   ├── local-auth.ts — Local user auth (SQLite)
│   ├── connectors/gmail.ts — Direct API for Gmail, Calendar, Tasks
│   ├── connectors/notion.ts — Direct API for Notion
│   ├── main.ts — App lifecycle, IPC handlers, OAuth HTTP server (port 19876)
│   └── preload.ts — Context bridge (secure IPC API)
│
└── Backend (Docker, OPTIONAL — for cross-device sync only)
    ├── FastAPI @ localhost:8000
    ├── PostgreSQL, Redis, Neo4j, Qdrant
    └── Celery workers
```

---

## Key Files & Their Purpose

### Frontend (Next.js)
- `src/app/chat/page.tsx` (~1100 lines) — Chat UI: messages, result cards, DraftCard, tool execution indicators, stop button
- `src/app/briefing/page.tsx` — Daily briefing page using React Query
- `src/app/dashboard/page.tsx` — Dashboard with sync status, quick actions, recent activity
- `src/app/settings/page.tsx` — Connector configuration (Google OAuth, GitHub PAT, Slack token, Notion token, Local Files paths)
- `src/app/login/page.tsx` — Login/signup with email+password and Google OAuth
- `src/lib/store/useChatStore.ts` — Zustand + persist for conversations/messages (includes results, actions, draft, toolExecutions)
- `src/lib/store/useAuthStore.ts` — Zustand + persist for auth tokens/user
- `src/lib/api/briefing.ts` — Fetches data via MCP, generates briefing with Ollama locally
- `src/lib/api/connectors.ts` — Checks which connectors are configured (reads from Electron token store)
- `src/lib/api/conversation-sync.ts` — Syncs conversations to backend (best-effort)
- `src/lib/api/token-sync.ts` — Syncs connector tokens to/from backend for cross-device
- `src/lib/api/client.ts` — Axios client with token refresh interceptor
- `src/components/composite/BriefingCard.tsx` — Briefing item card component
- `src/components/layout/Sidebar.tsx` — Navigation sidebar with connectors + conversations
- `src/components/layout/AppShell.tsx` — Auth guard, hydration spinner

### Electron Main Process
- `electron/main.ts` — App lifecycle, window creation, OAuth HTTP server on port 19876, IPC handlers for all APIs
- `electron/preload.ts` — Context bridge exposing `window.atlasElectron` API to renderer
- `electron/services/orchestrator.ts` (~1100 lines) — The brain: intent classification → tool routing → pre-fetch → Ollama draft → approval → execution
- `electron/services/mcp-manager.ts` — Spawns MCP subprocess servers (GitHub, Slack, Filesystem), routes to direct API connectors (Google, Notion)
- `electron/services/intent-classifier.ts` — Keyword scoring + Ollama for ambiguous cases
- `electron/services/ollama.ts` — Streaming chat, embeddings, health check with inactivity timeout (120s)
- `electron/services/google-oauth.ts` — Opens system browser for OAuth, waits for callback, exchanges code for tokens
- `electron/services/token-store.ts` — Read/write JSON file at Electron userData path
- `electron/services/local-store.ts` — SQLite database for conversations, messages, tool executions
- `electron/services/connectors/gmail.ts` — Gmail API (list/search/send/reply/forward), Calendar API (list/create/delete events), Google Tasks API (list tasks)
- `electron/services/connectors/notion.ts` — Notion API (search pages, get page, create page)

### Backend (Docker)
- `backend/app/api/v1/auth.py` — Login, register, Google OAuth login callback, connector OAuth callback
- `backend/app/core/config.py` — Settings (Google Client ID/Secret, redirect URIs)
- `docker-compose.yml` — Backend services (Postgres, Redis, Neo4j, Qdrant, Celery)

---

## How The Chat Works (Orchestrator Flow)

1. **User types message** → renderer calls `window.atlasElectron.executeWorkflow(text)`
2. **IPC handler** in main.ts calls `orchestrator.execute(prompt, mainWindow, conversationId)`
3. **Context enrichment** — If message is short (≤5 words), combines with previous user message for routing
4. **Router Node** — `classifyIntent()`: keyword scoring first (instant), Ollama for ambiguous cases (confidence < 0.75)
5. **Based on intent:**
   - `search` → searchNode (calls MCP tools) → responseNode (Ollama summarizes results)
   - `action` → prefetchActionContext (gets relevant data) → actionNode (resolves tools) → draftNode (Ollama generates draft) → approvalNode (waits for user) → executeNode (calls tool)
   - `chat` → responseNode (Ollama with conversation history)
6. **Events emitted to renderer:** `workflow-stream` (tokens), `workflow-tool-executing`, `workflow-draft-ready`, `workflow-complete`

---

## Known Issues & Bugs To Fix

### Critical
1. **Email reply still sometimes gets wrong recipient** — `fixDraftFieldsWithContext` extracts email from `from` field, but if pre-fetch fails or returns empty, the LLM output isn't validated
2. **"Sent successfully" shows even on failure** — Fixed for error responses but need to verify the Gmail `sendEmail` actually throws/returns error properly when TO is invalid
3. **Ollama classification adds 5-10s latency for ambiguous queries** — The Ollama classifier runs for any query with keyword confidence < 0.75, which is many queries
4. **Dates in response text are raw ISO format** — "Sat, 8 Aug 2026 13:18:41 -0700" should be human-readable

### UI/UX
5. **DraftCard "Sent successfully" green text should not show for actions that failed** — Verify the error flow works end-to-end
6. **Reference cards show ALL fetched results, not just the ones used in the response** — Need smarter filtering (only show cards mentioned in the AI's response)
7. **Chat message bubble shows raw text** — No markdown rendering, but Ollama sometimes still outputs `*` bullets despite the prompt saying not to
8. **Briefing loading takes 30-60s** — Fetches all connectors + Ollama generation. Should show incremental loading or skeleton
9. **Sidebar conversation list might not update immediately** after new chat creation
10. **Stop button (red square)** — verify it actually aborts the Ollama stream cleanly

### Orchestrator Logic
11. **TOOL_ROUTING keyword matching is O(n)** — Scans ALL keywords for every query. Could be optimized with a prefix trie or early-exit
12. **`resolveTools` limit of 3** may still be too many for simple queries like "what's my latest email"
13. **Context enrichment can cause wrong routing** — "yesterday?" after "what emails today" combines to "what emails today — yesterday?" which might not route correctly
14. **Action intent vs Search intent conflicts** — "email" is in both ACTION_KEYWORDS and is a TOOL_ROUTING keyword for search. The tie-breaking and Ollama disambiguation help but edge cases exist
15. **`prefetchActionContext` runs for ALL action intents** — Even ones that don't need it (like "create a branch" which doesn't need email pre-fetch)
16. **Draft generation relies on Ollama outputting valid JSON** — If Ollama outputs invalid JSON (common with smaller models), the fallback fields are very generic

### MCP/Connectors
17. **GitHub MCP server subprocess** — May fail to start if `@modelcontextprotocol/server-github` isn't installed globally. The `npx -y` flag should handle it but might be slow
18. **Slack MCP server** — Same subprocess startup issue
19. **Google token refresh** — `refreshGoogleToken` is called on 401, but the new token should be persisted back to token-store.json (partially implemented in gmail.ts `authFetch`)
20. **Notion connector** — `createPage` requires a `parentId` but the user might not provide one. Need a default workspace/page
21. **Local Files connector** — `search_files` and `read_file` are routed but the MCP filesystem server needs paths configured. If paths are empty, it errors
22. **Google Tasks** — Only `listTasks` (read) is implemented. No create/update/complete task functionality yet

### Auth & Sync
23. **Login page** — The `handleLoginSuccess` uses dynamic `import()` and `require()` which may not work in all Next.js contexts
24. **Cross-device sync** — `backgroundSync` in useChatStore fires on every message but may not include results/actions/draft fields in the synced data correctly
25. **OAuth callback server** — Port 19876 might be taken on some machines. No fallback port logic
26. **Backend dependency for login** — If Docker is down, the app tries local auth but the UX isn't clear about offline mode

### Performance
27. **Ollama streaming** — 120s inactivity timeout may be too long. If model is truly stuck, user waits 2 minutes
28. **Briefing Ollama generation** — Sends ALL raw data to Ollama for summarization. Large email bodies make the prompt huge and slow
29. **Multiple sequential API calls** — `listEmails` fetches message list, then fetches details for each one individually (N+1 problem). Should batch or use `format=metadata` in list call
30. **MCP server cold start** — First tool call to GitHub/Slack may take 5-10s to spawn the subprocess

### Design System
31. **Verify NO Zap icon remains anywhere** — Should be fully replaced with CheckSquare (tasks) and Send (messages)
32. **Green accent color** — Only used for sync status dots and success states. Verify no other colored accents leaked in
33. **BriefingCard expanded view** — The expanded details section styling might be inconsistent with the rest of the app

---

## What To Do

1. **Read all files listed above** to understand the full codebase
2. **Run `npx next build`** to check for TypeScript errors
3. **Run `npx tsup electron/main.ts electron/preload.ts --outDir dist-electron --format cjs --external electron --external sql.js`** to check Electron compilation
4. **Fix each issue** in priority order (Critical → UI/UX → Logic → Connectors → Performance)
5. **Test by running `npm run electron-dev`** from the `frontend/` directory
6. **Ensure the app works with minimal setup**: git clone → npm install → ollama pull llama3:8b → npm run electron-dev

---

## Commands

```bash
cd C:\Users\anshw\Documents\Atlas\frontend
npm run electron-dev          # Run the full app
npm run electron-compile      # Compile Electron TS only
npx next build                # Verify frontend compiles
npx tsup electron/main.ts electron/preload.ts --outDir dist-electron --format cjs --external electron --external sql.js  # Compile Electron
docker-compose up -d          # Start backend (from project root, OPTIONAL)
```

---

## Design System Rules

- Dark mode only: `--bg-primary: #09090b`, `--bg-secondary: #111113`
- Accent: white/gray (`--accent: #e4e4e7`)
- NO colored icons except: connector logos in sidebar, BETA badge (blue), green dots for active status
- All card icons: white/70 opacity, no background boxes
- Source names: "Google Workspace", "GitHub", "Slack", "Notion", "Local Files"
- Font: Inter
- Cards: `rounded-xl` or `rounded-2xl`, `border-white/[0.06]`
- Animations: framer-motion springs (stiffness 400, damping 30)
- No Zap icon anywhere — use CheckSquare for tasks, Send for messages
- No markdown in AI responses — plain text only

---

## Testing Scenarios

1. "Summarize today's emails" → Should fetch from Gmail, show summary + source cards
2. "What meetings do I have today" → Should fetch from Calendar (timeMin: start of today)
3. "Reply to Pranav's latest email saying I won't attend" → Should pre-fetch email, extract real email address, draft reply, show DraftCard
4. "Schedule a meeting with X tomorrow at 3pm" → Should draft calendar event with proper ISO times
5. "Create a branch named feature-x in Atlas repo" → Should route to GitHub MCP, draft with owner auto-filled
6. "What are my tasks" → Should search Google Tasks + Calendar + Notion
7. "Post in #general that deployment is complete" → Should draft Slack message
8. "Add a page to Notion about project roadmap" → Should draft Notion page
9. "Find docs about onboarding" → Should search Notion + Gmail + Local Files
10. Short follow-up "yesterday?" after a meeting query → Should use context enrichment to fetch yesterday's calendar

---

## Environment

- OS: Windows
- Node.js: ≥20
- Ollama: llama3:8b + nomic-embed-text
- Electron: 36
- Next.js: 16.3.0
- Package manager: npm
- TypeScript throughout
