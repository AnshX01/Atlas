# ⚡ Atlas — Personal Command Center

> **The world's first AI Chief of Staff for knowledge workers.**  
> Atlas eliminates the integration tax of modern work by connecting your entire digital ecosystem into a single, unified, proactively briefed intelligence layer.

[![CI](https://github.com/your-org/atlas/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/atlas/actions)
[![Python 3.12](https://img.shields.io/badge/python-3.12-blue.svg)](https://python.org)
[![Next.js 14](https://img.shields.io/badge/Next.js-14-black.svg)](https://nextjs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Electron Desktop Shell                            │
│   ┌─────────────────────────────────────────────────────────────┐   │
│   │              Next.js 14 (App Router + React)                │   │
│   │   CommandBar │ DailyBriefing │ OmniSearch │ Settings        │   │
│   └────────────────────────┬────────────────────────────────────┘   │
│                            │ HTTP + WebSocket                        │
└────────────────────────────┼────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────────┐
│                    FastAPI Backend (Python 3.12)                      │
│   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│   │  /v1/    │  │ LangGraph │  │  Celery  │  │   WebSocket Relay │  │
│   │  REST    │  │ Agents   │  │  Workers │  │   (Redis Pub/Sub) │  │
│   └──────────┘  └──────────┘  └──────────┘  └───────────────────┘  │
└────────────┬──────────┬──────────┬──────────────────────────────────┘
             │          │          │
    ┌────────▼─┐  ┌─────▼───┐  ┌──▼──────┐  ┌─────────┐
    │PostgreSQL│  │  Neo4j  │  │ Qdrant  │  │  Redis  │
    │ (State)  │  │ (Graph) │  │(Vectors)│  │(Broker) │
    └──────────┘  └─────────┘  └─────────┘  └─────────┘
```

---

## Quick Start (Local Dev)

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) ≥ 24
- [Node.js](https://nodejs.org/) ≥ 20 (for frontend-only dev)
- [Python](https://python.org) ≥ 3.12 (for backend-only dev)

### 1. Clone and set up secrets

```bash
git clone https://github.com/your-org/atlas.git
cd atlas

# Generate random secrets (.env will be created)
make init-secrets

# Fill in your OAuth credentials and AI API keys:
# GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
# GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET
# OPENAI_API_KEY (or set OLLAMA_ENABLED=true for local AI)
nano .env
```

### 2. Start all services

```bash
make up
# Equivalent to: docker-compose up -d --build
```

Services will be available at:

| Service | URL | Credentials |
|---------|-----|-------------|
| **Atlas API** | http://localhost:8000 | — |
| **API Docs** | http://localhost:8000/docs | — |
| **Next.js UI** | http://localhost:3000 | — |
| **Neo4j Browser** | http://localhost:7474 | neo4j / (see .env) |
| **Flower (Celery)** | http://localhost:5555 | — |

### 3. Create your first user

```bash
curl -X POST http://localhost:8000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "SecurePass1", "full_name": "Your Name"}'
```

### 4. Run the desktop app (Electron)

```bash
cd frontend
npm install
npm run electron-dev
```

---

## Project Structure

```
atlas/
├── backend/                    # FastAPI + Celery (Python 3.12)
│   ├── app/
│   │   ├── api/v1/             # REST endpoints
│   │   ├── core/               # Config, Security, Logging, Exceptions
│   │   ├── domain/             # ORM models, Pydantic schemas, Interfaces
│   │   ├── infrastructure/     # PG, Neo4j, Qdrant, Redis clients
│   │   ├── services/           # AI agents, Connectors, Briefing
│   │   └── workers/            # Celery sync + embedding tasks
│   ├── alembic/                # Database migrations
│   └── tests/                  # Unit + integration tests
│
├── frontend/                   # Next.js 14 + Electron
│   ├── src/
│   │   ├── app/                # App Router pages (briefing, settings)
│   │   ├── components/         # UI atoms, composite widgets, layout
│   │   └── lib/                # Zustand stores, API fetchers, shortcuts
│   └── electron/               # Desktop shell (main.ts + preload.ts)
│
├── docs/
│   ├── adr/                    # Architecture Decision Records
│   └── developer-guide/        # Connector onboarding, API guides
│
├── docker-compose.yml          # Full local stack
├── Makefile                    # Dev commands
└── .env.example                # Environment template
```

---

## Key Commands

```bash
make up              # Start all Docker services
make down            # Stop and remove containers
make logs            # Follow all service logs
make migrate         # Run Alembic DB migrations
make init-secrets    # Generate random secrets into .env
make lint            # Ruff (Python) + ESLint (TypeScript)
make test            # Run all unit tests
make test-integration  # Run integration tests (requires Docker)
make shell-backend   # Open bash in the backend container
```

---

## Environment Variables

See [`.env.example`](.env.example) for the full reference. Key variables:

| Variable | Description |
|----------|-------------|
| `APP_MASTER_ENCRYPTION_KEY` | AES-256 key for OAuth token encryption at rest |
| `JWT_SECRET_KEY` | HMAC secret for JWT signing |
| `OPENAI_API_KEY` | OpenAI API key (or use `OLLAMA_ENABLED=true`) |
| `GOOGLE_CLIENT_ID/SECRET` | Google OAuth for Gmail + Calendar |
| `GITHUB_CLIENT_ID/SECRET` | GitHub OAuth for Issues + PRs |
| `OLLAMA_ENABLED` | Route all AI to local Ollama (privacy mode) |

---

## Phase 1 MVP Features

- [x] Electron + Next.js shell (dark mode, glass morphism, Cmd+Space command bar)
- [x] FastAPI backend with JWT auth, RFC 7807 errors, OpenAPI docs
- [x] PostgreSQL schema + Alembic migrations
- [x] Neo4j graph with RBAC schema constraints
- [x] Qdrant vector store with per-user collection isolation
- [x] Google Workspace connector (Gmail + Calendar, read-only)
- [x] GitHub connector (PRs + Issues, with tenacity retry)
- [x] Local File System connector (watchdog, 15 file types)
- [x] LangGraph supervisor → Triage → Synthesizer → Action agents
- [x] Hybrid RAG (vector + graph + cross-encoder reranking)
- [x] Daily Briefing with Focus Score ring
- [x] Celery workers with Redis Pub/Sub → WebSocket real-time updates
- [x] GitHub Actions CI (lint, test, multi-arch Docker build)

## Roadmap

- **Phase 2 (Months 3-4)**: Read/write actions, Neo4j relationship mapping, Triage Agent scoring, push notifications
- **Phase 3 (Months 5-6)**: Public connector API, Ollama deep integration, mobile companion app

---

## Documentation

- [API Reference](http://localhost:8000/docs) — Auto-generated OpenAPI (Swagger)
- [ADR-001: Neo4j for Knowledge Graph](docs/adr/001-use-neo4j-for-knowledge-graph.md)
- [ADR-002: Hybrid RAG Pipeline](docs/adr/002-hybrid-rag-pipeline.md)
- [Writing a Connector](docs/developer-guide/writing-a-connector.md)

---

## Security

All OAuth tokens are encrypted at rest with AES-256-GCM. The master key must reside exclusively in your environment's secret manager (AWS Secrets Manager, Doppler, or `.env` for local dev only). Every database query, vector search, and graph traversal enforces `user_id` RBAC isolation. See [Section 10](docs/adr/) for the full threat model.

---

## License

MIT © 2026 Atlas
