# Atlas — Next Session: Chat UX Overhaul

## Project Location
- `C:\Users\anshw\Documents\Atlas`
- Frontend: `frontend/` (Next.js 16 + Electron + Tailwind)
- Backend: `backend/` (FastAPI, running via docker-compose)
- GitHub: `github.com/AnshX01/Atlas.git` (main branch)

## Current State
- Desktop Electron app running with `npm run electron-dev` from `frontend/`
- Backend running via `docker-compose up -d`
- Ollama running locally (llama3:8b)
- Google OAuth working (system browser → localhost:19876 callback → Electron IPC)
- Connectors configured: Google Workspace, GitHub (tokens stored locally + synced to backend)
- AI Chatbot at `/chat` — uses Ollama for responses, MCP manager for tool calls
- White/monochrome accent design (no blue except BETA badge)

## What Needs To Be Done (UX Overhaul)

### 1. Result Cards — Modern Redesign
**Current:** Basic cards with icon + title + excerpt, look flat and primitive.
**Target:** Modern glassmorphism cards with subtle borders, better typography, hover effects. Think Linear/Notion style — clean, minimal, with proper spacing. Cards should feel like part of the conversation, not bolted-on UI.

**Files:** `src/app/chat/page.tsx` (ResultCard component, around line 120-160)

### 2. Cards Must Persist in Old Chats
**Current:** When you click an old conversation in the sidebar, the messages load but result cards and action cards are LOST because `useChatStore` only stores `{id, role, content, timestamp}` — no `results` or `actions` fields.

**Fix:** Update the `ChatMessage` type in `useChatStore.ts` and the `addMessage` action to include `results`, `actions`, and `toolExecutions` fields. When saving messages after a response, include the full card data.

**Files:** 
- `src/lib/store/useChatStore.ts` — update `StoredChatMessage` type and persistence
- `src/app/chat/page.tsx` — when loading from store, map stored messages to include card data

### 3. Proper Summarization (Not Just Cards)
**Current:** When user asks "summarize today's emails", the AI responds with "Found 5 results for..." and shows result cards. This is wrong — it should give a natural language summary.

**Target:** The orchestrator should:
1. Fetch data from MCP/connectors
2. Pass the raw data to Ollama with a prompt like "Summarize these emails for the user"
3. Stream the natural language summary as the response
4. Optionally show the source items as collapsed/expandable cards below

**Files:** `electron/services/orchestrator.ts` — the `responseNode` needs to take fetched context and generate a real summary, not just relay raw results.

### 4. No Auto-Generated Action Buttons in Responses
**Current:** After showing email results, the code auto-generates "Reply" and "Merge" action cards via `deriveActionsFromResults()`. This is wrong.

**Target:** Remove `deriveActionsFromResults()` entirely. Actions should ONLY appear when the user explicitly asks for them (e.g., "reply to Sarah's email saying I'll be late").

**File:** `src/app/chat/page.tsx` — remove the `deriveActionsFromResults` function and its usage in the HTTP fallback path.

### 5. Draft → Approve → Execute Flow for All Write Actions
**Current:** Action cards show approve/reject but don't actually execute anything meaningful.

**Target flow:**
1. User: "Reply to Sarah's email saying I'll be late to the meeting"
2. AI drafts the reply and shows it in a styled "Draft" card:
   - Shows: To, Subject, Body preview
   - Buttons: "Send" (green) and "Edit" (neutral) and "Cancel" (red)
3. User clicks "Send" → AI executes via MCP/connector → shows confirmation

This pattern applies to ALL write operations:
- **Email:** Draft → Approve → Send
- **GitHub:** Show PR merge details → Approve → Merge
- **Slack:** Draft message → Approve → Post
- **Notion:** Show page preview → Approve → Create

**Files:**
- `electron/services/orchestrator.ts` — detect write-intent, generate draft, pause for approval
- `src/app/chat/page.tsx` — new `DraftCard` component that shows the draft with approve/edit/cancel
- `src/components/composite/ActionApprovalCard.tsx` — redesign for draft display

### 6. Orchestrator Logic Change
**Current orchestrator flow:** classify intent → call tools → stream response from Ollama
**New flow:**
1. Classify intent (search vs action vs chat)
2. If **search/query**: call tools → pass results to Ollama → stream natural language summary
3. If **action/write**: call tools to get context → generate draft with Ollama → emit `workflow-approval-needed` with draft details → wait for user approval → execute on approval
4. If **general chat**: just stream Ollama response directly (no tools needed)

**File:** `electron/services/orchestrator.ts`

## Key Architecture Notes
- Electron main process: `frontend/electron/main.ts` (compiled to `dist-electron/main.js` via tsup)
- MCP Manager: `frontend/electron/services/mcp-manager.ts` (uses direct API connectors for Google/Notion, MCP packages for GitHub/Slack/FS)
- Direct connectors: `frontend/electron/services/connectors/` (github.ts, gmail.ts, slack.ts, notion.ts)
- Orchestrator: `frontend/electron/services/orchestrator.ts` (LangGraph-style state machine with Ollama)
- Chat page: `frontend/src/app/chat/page.tsx` (~800 lines, has ChatMessageBubble, ResultCard, ActionCard, ChatInput, EmptyState)
- Chat store: `frontend/src/lib/store/useChatStore.ts` (Zustand + persist)
- Preload IPC bridge: `frontend/electron/preload.ts`

## Design System
- Dark mode: `--bg-primary: #09090b`, `--bg-secondary: #111113`, `--accent: #e4e4e7` (white/gray)
- Font: Inter via next/font
- Cards: `rounded-2xl border border-[var(--border-default)]`
- No focus borders anywhere
- Spinners: white/gray rotating ring
- Animations: framer-motion springs (stiffness 400, damping 30)

## Commands
```bash
cd frontend
npm run electron-dev     # Run desktop app
npm run electron-compile # Compile electron TS
npx next build          # Verify frontend compiles
docker-compose up -d    # Start backend (from project root)
```
