from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app import database
from app.routers import admin, proxy
from app.services.seeder import seed_initial_data


@asynccontextmanager
async def lifespan(_: FastAPI):
    """Initialize schema and seed baseline enterprise telemetry on startup."""
    await database.init_db()
    async with database.AsyncSessionLocal() as session:
        await seed_initial_data(session)
    yield


def create_app() -> FastAPI:
    """Construct and configure the AEGIS // GATEWAY FastAPI application."""
    settings = get_settings()

    application = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        description=(
            "Enterprise OpenAI-Compatible AI Proxy Gateway, Zero-Trust Guardrails Firewall, "
            "Semantic Cache Engine, and FinOps Observability Platform."
        ),
        lifespan=lifespan,
    )

    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=[
            "X-Aegis-Trace-Id",
            "X-Aegis-Tenant",
            "X-Aegis-Status",
            "X-Aegis-Cache-Hit",
            "X-Aegis-Similarity",
            "X-Aegis-PII-Redacted",
            "X-Aegis-Cost-USD",
            "X-Aegis-Saved-USD",
            "X-Aegis-Latency-Ms",
            "X-Aegis-Routed-Model",
            "X-Aegis-Fallback-Used",
            "X-Aegis-Routing-Strategy",
            "Retry-After",
        ],
    )

    application.include_router(proxy.router)
    application.include_router(admin.router)

    @application.get("/health", tags=["System"])
    async def health_check() -> dict[str, str]:
        """Liveness and autonomous provider status probe."""
        upstream_mode = "live_openai" if settings.OPENAI_API_KEY else "autonomous_simulator"
        return {
            "status": "healthy",
            "service": settings.APP_NAME,
            "version": settings.APP_VERSION,
            "upstream_mode": upstream_mode,
        }

    # Serve compiled Vite frontend when packaged in unified production container
    frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"
    if not frontend_dist.exists():
        frontend_dist = Path("/app/frontend/dist")

    if frontend_dist.exists() and (frontend_dist / "index.html").is_file():
        assets_dir = frontend_dist / "assets"
        if assets_dir.exists():
            application.mount("/assets", StaticFiles(directory=str(assets_dir)), name="assets")

        @application.get("/{full_path:path}", include_in_schema=False)
        async def serve_spa(full_path: str) -> FileResponse:
            target = frontend_dist / full_path
            if full_path and target.exists() and target.is_file():
                return FileResponse(str(target))
            return FileResponse(str(frontend_dist / "index.html"))

    return application


app = create_app()
