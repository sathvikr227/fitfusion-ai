from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    ML_SERVICE_API_KEY: str = ""
    MODEL_DIR: Path = Path("./models")
    LOG_LEVEL: str = "info"

    # Optional. Set these only if you want /predict/injury-risk to read Supabase
    # itself when a caller sends nothing but a user_id. Next.js normally sends
    # the features it already has, in which case these stay unset and the ML
    # service holds no database credentials at all.
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_ROLE_KEY: str = ""
    SUPABASE_TIMEOUT_SECONDS: float = 5.0

    @property
    def supabase_enabled(self) -> bool:
        return bool(self.SUPABASE_URL and self.SUPABASE_SERVICE_ROLE_KEY)


settings = Settings()
