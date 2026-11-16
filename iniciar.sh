#!/usr/bin/env bash
set -euo pipefail

echo "============================================================"
echo "  AEGIS // GATEWAY (Release Enterprise V1.0) Launcher"
echo "============================================================"

if [ ! -f ".env" ] && [ -f ".env.example" ]; then
  cp .env.example .env
  echo "[INIT] Created .env from .env.example"
fi

MODE="${1:-local}"

if [ "$MODE" = "docker" ]; then
  echo "[DOCKER] Starting PostgreSQL (pgvector:pg15) + Unified Gateway..."
  docker compose up --build -d
  echo "[READY] Console & OpenAI Proxy running at http://localhost:8000"
  exit 0
fi

echo "[LOCAL] Installing backend requirements and launching FastAPI + Vite..."
python -m pip install -r backend/requirements.txt
npm --prefix frontend install --no-audit --no-fund

(
  cd backend
  uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
) &
BACKEND_PID=$!

cleanup() {
  echo ""
  echo "[SHUTDOWN] Stopping backend (PID $BACKEND_PID)..."
  kill "$BACKEND_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "[FRONTEND] Starting Vite console on http://localhost:5173 ..."
npm --prefix frontend run dev
