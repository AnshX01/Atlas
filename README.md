# Atlas
# AI Desktop Command Center.

> **Your personal AI Chief of Staff — a privacy-first Electron desktop app.**  
> Atlas connects your entire digital ecosystem (Gmail, GitHub, Slack, Notion, local files) into a unified AI-powered chatbot that can search, summarize, and take actions on your behalf.

**100% local. No cloud. No servers. Just clone, install, and run.**

---

## What Atlas Does

- **AI Chatbot** — Ask anything about your emails, PRs, calendar, documents. Get structured answers with cards and take actions inline.
- **Write Actions** — Reply to emails, merge PRs, post to Slack, create Notion pages — all from the chat with approval flow.
- **Daily Briefing** — AI-generated priority feed of what needs your attention today.
- **Local-First** — Runs Ollama locally for AI. Your data never leaves your machine.
- **MCP Integration** — Model Context Protocol servers for each connector (Google, GitHub, Slack, Notion, Files).

---

## Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) ≥ 20
- [Ollama](https://ollama.ai/) (for local AI)

### 1. Clone and install

```bash
git clone https://github.com/your-org/atlas.git
cd atlas/frontend
npm install
```

### 2. Set up Ollama

```bash
# Install Ollama from https://ollama.ai
ollama pull llama3:8b
ollama pull nomic-embed-text
```

### 3. Run the app

```bash
npm run electron-dev
```

That's it! Atlas opens as a desktop app. Create an account on first launch (stored locally), then configure your connectors in Settings.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Electron Desktop Shell                            │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │              Next.js 15 (App Router + React)                 │   │
│   │   Dashboard │ AI Chatbot │ Daily Briefing │ Settings        │   │
│   └────────────────────────┬────────────────────────────────────┘   │
│                            │ Electron IPC                            │
│   ┌────────────────────────┼────────────────────────────────────┐   │
│   │          Local Services (Electron Main Process)              │   │
│   │                                                              │   │
│   │   ┌──────────┐  ┌──────────────┐  ┌────────────────────┐   │   │
│   │   │  Ollama  │  │  MCP Servers │  │  LangGraph Engine  │   │   │
│   │   │ (LLM AI) │  │  (Connectors)│  │  (Orchestrator)    │   │   │
│   │   └──────────┘  └──────────────┘  └────────────────────┘   │   │
│   │                                                              │   │
│   │   ┌──────────────────────────────────────────────────────┐  │   │
│   │   │  SQLite (userData) — Auth, Conversations, Config     │  │   │
│   │   └──────────────────────────────────────────────────────┘  │   │
│   └──────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Configuring Connectors

Go to **Settings → Integrations** in the app and provide credentials for each service:

| Connector | What to provide | Where to get it |
|-----------|----------------|-----------------|
| **Google Workspace** | Client ID + Client Secret | [Google Cloud Console](https://console.cloud.google.com/) → APIs & Services → Credentials |
| **GitHub** | Personal Access Token | [GitHub Settings](https://github.com/settings/tokens) → Generate new token (scopes: `repo`, `user`) |
| **Slack** | Bot Token (`xoxb-...`) | [Slack API](https://api.slack.com/apps) → Create App → Install → Bot Token |
| **Notion** | Integration Token (`secret_...`) | [Notion Integrations](https://www.notion.so/my-integrations) → Create Integration |
| **Local Files** | Directory paths | Just enter paths to folders you want Atlas to index |

---

## Project Structure

```
atlas/
├── frontend/                   # The entire app (Electron + Next.js)
│   ├── src/
│   │   ├── app/                # Pages: dashboard, chat, briefing, settings, profile
│   │   ├── components/         # UI components, layout, icons
│   │   ├── lib/                # Stores (Zustand), API clients, utilities
│   │   └── types/              # TypeScript declarations
│   ├── electron/
│   │   ├── main.ts             # Electron main process
│   │   ├── preload.ts          # Context bridge (secure IPC)
│   │   └── services/           # Ollama, MCP manager, orchestrator, local DB
│   └── public/                 # Static assets (logo, favicon)
│
├── backend/                    # Optional: FastAPI backend (for advanced/dev use)
└── README.md
```

---

## Key Commands

```bash
cd frontend

npm run electron-dev          # Run desktop app in development
npm run electron-build        # Build production installer
npm run dev                   # Run Next.js only (UI development)
npm run build                 # Build static export
npm test                      # Run tests
```

---

## Building for Distribution

```bash
cd frontend
npm run electron-build
```

Produces platform-specific installers in `frontend/release/`:
- **Windows**: `.exe` installer
- **macOS**: `.dmg` disk image
- **Linux**: `.AppImage` and `.deb`

---

## How It Works

1. **You ask a question** in the AI Chat (e.g., "What emails did Sarah send me this week?")
2. **Atlas classifies intent** locally using Ollama (search, action, or general chat)
3. **MCP servers fetch data** from your connected services (Gmail, GitHub, etc.) using your stored tokens
4. **Ollama generates a response** with the fetched context, streaming tokens in real-time
5. **If an action is needed** (reply, merge, etc.), Atlas shows an approval card — nothing executes without your explicit OK

---

## Security & Privacy

- **Zero cloud dependency** — AI runs locally via Ollama, no data sent to OpenAI/Anthropic
- **Tokens stored locally** — OAuth credentials and API keys stored in your OS app data folder
- **Per-user isolation** — SQLite database in Electron userData, sandboxed
- **Electron security** — contextIsolation + sandbox enabled, no nodeIntegration in renderer
- **No telemetry** — Zero analytics, zero tracking, zero phone-home

---

## Tech Stack

- **Frontend**: Next.js 15, React 18, Tailwind CSS, Framer Motion, Zustand
- **Desktop**: Electron 36, electron-builder
- **AI**: Ollama (llama3:8b, nomic-embed-text)
- **Connectors**: MCP (Model Context Protocol) stdio servers
- **Storage**: SQLite (better-sqlite3)
- **Language**: TypeScript throughout

---

## License

MIT © 2026 Atlas
