from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "BrocAI"
    environment: str = "development"
    database_url: str = "postgresql+psycopg://brocai:brocai@localhost:5432/brocai"
    cors_origins: str = "http://localhost:5173,http://localhost:8080"
    upload_dir: Path = Path("data/uploads")
    max_upload_mb: int = 8
    ai_provider: str = "mock"
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-2.5-flash"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
