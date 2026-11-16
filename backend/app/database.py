from collections.abc import AsyncGenerator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings


class Base(DeclarativeBase):
    """Declarative base for all SQLAlchemy ORM models."""


def _build_engine(database_url: str) -> AsyncEngine:
    """Build an async SQLAlchemy engine configured for SQLite or PostgreSQL."""
    if database_url.startswith("sqlite"):
        return create_async_engine(
            database_url,
            echo=False,
            connect_args={"check_same_thread": False},
        )
    return create_async_engine(
        database_url,
        echo=False,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
    )


settings = get_settings()
engine: AsyncEngine = _build_engine(settings.DATABASE_URL)
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Yield an async database session per request."""
    async with AsyncSessionLocal() as session:
        yield session


async def init_db(target_engine: AsyncEngine | None = None) -> None:
    """Initialize database tables and optional pgvector extension."""
    db_engine = target_engine or engine
    if not str(db_engine.url).startswith("sqlite"):
        async with db_engine.begin() as conn:
            try:
                await conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            except Exception:
                # Extension may require superuser privileges or not be needed if JSON storage is used
                pass
    async with db_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        if str(db_engine.url).startswith("sqlite"):
            cols = {
                row[1]
                for row in (await conn.execute(text("PRAGMA table_info(audit_traces)"))).fetchall()
            }
            if "routed_model" not in cols:
                await conn.execute(
                    text("ALTER TABLE audit_traces ADD COLUMN routed_model VARCHAR(64) NOT NULL DEFAULT ''")
                )
            if "fallback_used" not in cols:
                await conn.execute(
                    text("ALTER TABLE audit_traces ADD COLUMN fallback_used BOOLEAN NOT NULL DEFAULT 0")
                )
        else:
            await conn.execute(
                text("ALTER TABLE audit_traces ADD COLUMN IF NOT EXISTS routed_model VARCHAR(64) NOT NULL DEFAULT ''")
            )
            await conn.execute(
                text("ALTER TABLE audit_traces ADD COLUMN IF NOT EXISTS fallback_used BOOLEAN NOT NULL DEFAULT FALSE")
            )
