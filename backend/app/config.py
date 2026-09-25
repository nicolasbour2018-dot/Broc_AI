from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "BrocAI"
    environment: str = "development"
    database_url: str = "postgresql+psycopg://brocai:brocai@localhost:5432/brocai"
    cors_origins: str = "http://localhost:5173,http://localhost:8080"
    upload_dir: Path = Path("data/uploads")
    max_upload_mb: int = 8
    image_max_edge_px: int = 1920
    image_jpeg_quality: int = 90
    image_webp_quality: int = 90
    ai_provider: str = "mock"
    gemini_api_key: str | None = None
    gemini_model: str = "gemini-3.5-flash-lite"
    gemini_quality_model: str = "gemini-3.6-flash"
    ai_force_quality_scale_up: bool = False
    hf_token: str | None = None
    hf_router_url: str = "https://router.huggingface.co/v1/chat/completions"
    hf_qwen_model: str = "Qwen/Qwen3.5-35B-A3B:deepinfra"
    hf_timeout_seconds: int = 30
    hf_fallback_max_attempts: int = 3
    ai_routing_mode: str = "auto"
    ai_force_primary_failure: bool = False
    admin_token: str | None = None
    # Kill switch: false lets any device write to any stand again, as before the stand codes.
    stand_pin_required: bool = True

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
