from collections.abc import AsyncGenerator
from pathlib import Path
import httpx
import pytest
import pytest_asyncio
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app import database
from app.main import create_app
from app.services.guardrails import rate_limiter
from app.services.seeder import seed_initial_data


@pytest_asyncio.fixture(scope="function")
async def test_client(tmp_path: Path) -> AsyncGenerator[httpx.AsyncClient, None]:
    """Provide an isolated FastAPI test client backed by a fresh SQLite DB per test."""
    db_file = tmp_path / "aegis_test.db"
    db_url = f"sqlite+aiosqlite:///{db_file.as_posix()}"

    test_engine = database._build_engine(db_url)
    test_session_maker = async_sessionmaker(
        bind=test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
        autoflush=False,
    )

    original_engine = database.engine
    original_session_local = database.AsyncSessionLocal
    database.engine = test_engine
    database.AsyncSessionLocal = test_session_maker
    rate_limiter.reset()

    await database.init_db(test_engine)
    async with test_session_maker() as session:
        await seed_initial_data(session)

    test_app = create_app()
    transport = httpx.ASGITransport(app=test_app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client

    await test_engine.dispose()
    database.engine = original_engine
    database.AsyncSessionLocal = original_session_local
    rate_limiter.reset()
