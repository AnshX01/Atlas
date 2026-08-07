# Atlas Deployment Guide

## Architecture

| Component | Service | Notes |
|-----------|---------|-------|
| Frontend (Next.js) | Vercel | Automatic from GitHub |
| Backend (FastAPI) | Railway / Render | Docker-based |
| Celery Worker | Railway / Render | Same Docker image, different command |
| PostgreSQL | Neon / Supabase | Managed, free tier available |
| Redis | Upstash | Serverless, free tier |
| Qdrant | Qdrant Cloud | 1GB free cluster |
| Neo4j | Neo4j Aura | Free tier available |

## Prerequisites

- GitHub repository (already at github.com/AnshX01/Atlas)
- Vercel account
- Railway/Render account
- OAuth credentials (Google, GitHub)
- OpenAI API key

## Step 1: Database Setup

### PostgreSQL (Neon)
1. Go to https://neon.tech and create a project
2. Copy the connection string: `postgresql://user:pass@host/db`
3. Note: Use `?sslmode=require` suffix

### Redis (Upstash)
1. Go to https://upstash.com and create a Redis database
2. Copy the Redis URL: `rediss://default:pass@host:port`

### Qdrant Cloud
1. Go to https://cloud.qdrant.io
2. Create a free 1GB cluster
3. Copy the URL and API key

### Neo4j Aura
1. Go to https://neo4j.com/cloud/aura-free/
2. Create a free instance
3. Copy the bolt URI, username, password

## Step 2: Backend Deployment (Railway)

1. Go to https://railway.app and connect your GitHub repo
2. Create a new service from the `backend/` directory
3. Set the Dockerfile path: `backend/Dockerfile`
4. Set environment variables:

```env
APP_ENV=production
DATABASE_URL=postgresql+asyncpg://user:pass@host/db?ssl=require
REDIS_URL=rediss://default:pass@host:port
CELERY_BROKER_URL=rediss://default:pass@host:port/1
CELERY_RESULT_BACKEND=rediss://default:pass@host:port/2
QDRANT_HOST=your-cluster.cloud.qdrant.io
QDRANT_PORT=6333
QDRANT_API_KEY=your-qdrant-api-key
NEO4J_URI=neo4j+s://xxxxx.databases.neo4j.io
NEO4J_USER=neo4j
NEO4J_PASSWORD=your-password
JWT_SECRET_KEY=generate-a-random-64-char-string
APP_MASTER_ENCRYPTION_KEY=generate-a-32-byte-base64-key
OPENAI_API_KEY=sk-...
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=https://your-backend.railway.app/v1/auth/oauth/google/callback
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
GITHUB_REDIRECT_URI=https://your-backend.railway.app/v1/auth/oauth/github/callback
GOOGLE_SCOPES=openid email profile https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/tasks.readonly
CORS_ORIGINS=["https://your-app.vercel.app","http://localhost:3000"]
```

5. Start command: `alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port $PORT`

### Celery Worker (Railway)
1. Create another service from same repo/directory
2. Same env vars as backend
3. Start command: `celery -A app.workers.celery_app worker --loglevel=info --concurrency=2 -Q default,sync,embedding`

## Step 3: Frontend Deployment (Vercel)

1. Go to https://vercel.com and import your GitHub repo
2. Set root directory: `frontend`
3. Framework: Next.js (auto-detected)
4. Environment variables:

```env
NEXT_PUBLIC_API_URL=https://your-backend.railway.app
NEXT_PUBLIC_WS_URL=wss://your-backend.railway.app
```

5. Deploy!

## Step 4: OAuth Redirect URIs

Update your OAuth providers with production URLs:

### Google Cloud Console
- Authorized redirect URI: `https://your-backend.railway.app/v1/auth/oauth/google/callback`

### GitHub OAuth App
- Authorization callback URL: `https://your-backend.railway.app/v1/auth/oauth/github/callback`

## Step 5: Run Migrations

Railway runs `alembic upgrade head` on startup (in the start command).
If needed manually:
```bash
railway run alembic upgrade head
```

## Step 6: Verify

1. Visit `https://your-app.vercel.app`
2. Register a new account
3. Connect Google Workspace
4. Check that briefing populates
5. Test AI search (Cmd+Space)

## Production Checklist

- [ ] Set strong JWT_SECRET_KEY (64+ random chars)
- [ ] Set strong APP_MASTER_ENCRYPTION_KEY (32-byte base64)
- [ ] Enable HTTPS on all services
- [ ] Set CORS_ORIGINS to your exact Vercel domain
- [ ] Add rate limiting (already in FastAPI middleware)
- [ ] Set up Celery Beat for periodic syncs (add beat scheduler service)
- [ ] Monitor with Railway metrics / Vercel analytics
- [ ] Set up error tracking (Sentry recommended)

## Cost Estimate (Hobby/Free Tier)

| Service | Free Tier | Paid |
|---------|-----------|------|
| Vercel | Hobby (free) | Pro $20/mo |
| Railway | $5 credit/mo | ~$10-20/mo |
| Neon | 0.5GB free | $19/mo |
| Upstash | 10K commands/day | $0.2/100K |
| Qdrant Cloud | 1GB free | $25/mo |
| Neo4j Aura | Free tier | $65/mo |
| OpenAI | Pay-per-use | ~$5-20/mo |

Total for hobby: ~$5-15/month (mostly Railway)
