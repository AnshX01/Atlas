.PHONY: help up down logs shell-backend shell-frontend migrate init-secrets lint test

SHELL := /bin/bash

# ── Default target ────────────────────────────────────────────────────────────
help:
	@echo ""
	@echo "  Atlas — Command Reference"
	@echo "  ─────────────────────────────────────────────────────────"
	@echo "  make up              Start all services (docker-compose)"
	@echo "  make down            Stop and remove containers"
	@echo "  make logs            Follow logs for all services"
	@echo "  make migrate         Run Alembic migrations"
	@echo "  make init-secrets    Generate random secrets into .env"
	@echo "  make lint            Run Ruff + ESLint"
	@echo "  make test            Run backend (pytest) + frontend (jest) tests"
	@echo "  make shell-backend   Open bash in the backend container"
	@echo "  make shell-frontend  Open bash in the frontend container"
	@echo "  ─────────────────────────────────────────────────────────"
	@echo ""

# ── Docker ───────────────────────────────────────────────────────────────────
up:
	docker-compose up -d --build

down:
	docker-compose down -v

logs:
	docker-compose logs -f --tail=100

shell-backend:
	docker-compose exec backend bash

shell-frontend:
	docker-compose exec frontend bash

# ── Database ─────────────────────────────────────────────────────────────────
migrate:
	docker-compose exec backend alembic upgrade head

migrate-create:
	docker-compose exec backend alembic revision --autogenerate -m "$(MSG)"

# ── Secrets ──────────────────────────────────────────────────────────────────
init-secrets:
	@echo "Generating .env from .env.example with random secrets..."
	@cp -n .env.example .env || true
	@python3 -c "\
import secrets, base64, re; \
key32 = secrets.token_urlsafe(32); \
aes_key = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(); \
jwt_key = secrets.token_urlsafe(48); \
content = open('.env').read(); \
content = re.sub(r'CHANGE_ME_32_CHAR_RANDOM_STRING_HERE', key32, content); \
content = re.sub(r'CHANGE_ME_AES256_BASE64_KEY_HERE', aes_key, content); \
content = re.sub(r'CHANGE_ME_JWT_SECRET_KEY_HERE', jwt_key, content); \
open('.env', 'w').write(content); \
print('  ✓ APP_SECRET_KEY generated'); \
print('  ✓ APP_MASTER_ENCRYPTION_KEY generated'); \
print('  ✓ JWT_SECRET_KEY generated'); \
print('  → Fill in remaining CHANGE_ME values (OAuth, DB passwords, AI keys).'); \
"

# ── Code Quality ─────────────────────────────────────────────────────────────
lint:
	@echo "── Ruff (Python) ──────────────────────────────────"
	cd backend && ruff check . && ruff format --check .
	@echo "── ESLint + Prettier (TypeScript) ─────────────────"
	cd frontend && npm run lint

lint-fix:
	cd backend && ruff check . --fix && ruff format .
	cd frontend && npm run lint:fix

# ── Tests ─────────────────────────────────────────────────────────────────────
test:
	@echo "── Backend Unit Tests ──────────────────────────────"
	cd backend && pytest tests/unit -v --tb=short
	@echo "── Frontend Tests ──────────────────────────────────"
	cd frontend && npm test -- --watchAll=false

test-integration:
	@echo "── Backend Integration Tests (requires Docker) ─────"
	cd backend && pytest tests/integration -v --tb=short

test-e2e:
	@echo "── Playwright E2E Tests ────────────────────────────"
	cd frontend && npx playwright test
