from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables or defaults."""

    APP_NAME: str = "AEGIS // GATEWAY"
    APP_VERSION: str = "2.0.0-enterprise"
    ENVIRONMENT: str = "development"

    DATABASE_URL: str = "sqlite+aiosqlite:///./aegis_gateway.db"

    OPENAI_API_KEY: str = ""
    GEMINI_API_KEY: str = ""
    OPENAI_BASE_URL: str = "https://api.openai.com/v1"

    DEFAULT_CACHE_THRESHOLD: float = 0.92
    DEFAULT_INJECTION_THRESHOLD: float = 0.75
    DEFAULT_RATE_LIMIT_RPM: int = 60
    DEFAULT_DAILY_BUDGET_USD: float = 50.0

    ALLOWED_ORIGINS: list[str] = ["*"]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return cached singleton settings instance."""
    return Settings()
